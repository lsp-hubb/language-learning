"""Edge TTS 朗读合成辅助脚本（单进程批量并发）。

由 Node 后端 spawn 调用：从 stdin 读一行 JSON 参数，向 stdout 输出一行 JSON 结果。
输入: {"items":[{"id":..., "text":"..."}, ...], "voice":"...", "rate":"+0%"}
输出: {"results": {"<id>": {"audio":"<base64 mp3>", "words":[...]}, ...}}
  - offset/duration 为 100ns tick（edge-tts 原生单位），前端除以 10000 得毫秒。
  - words 用 WordBoundary，Edge TTS 会把 "since 2015" 这类数字单元作为一个词返回，
    直接用其 text 在段全文里定位高亮即可，无需前端猜测。
  - 全部段在【同一进程】内用 asyncio.gather 并发合成：省掉每段重复 spawn + import edge-tts
    的开销（实测 4 段从 ~7.3s 降到 ~2.9s）。单段失败只标记该项 error，不拖垮整批。
  - 单段失败 / 超时（每次 20s）自动重试，最多 3 次，退避 1s / 2s；全部失败才标记该项 error。

兼容旧的单段入参 {"text": "..."}（视作 id=0）。依赖：edge-tts（虚拟环境已装）。
"""
import sys
import json
import asyncio
import base64

import edge_tts

DEFAULT_VOICE = "en-US-AndrewNeural"
MAX_ATTEMPTS = 3  # 单段合成失败后自动重试次数（含首次共 3 次）
ATTEMPT_TIMEOUT = 20  # 单次尝试超时（秒），超时即取消并重试


def _safe_text(value):
    """替换字符串里的孤立代理项（Unicode surrogate），避免 UTF-8 编码时报错。"""
    return str(value).encode("utf-8", "replace").decode("utf-8")


def _json_dump(obj):
    """输出纯 ASCII JSON：中文用 \\uXXXX 转义，彻底规避 Windows 下 stdout 编码差异导致的乱码。"""
    return json.dumps(obj, ensure_ascii=True)


async def _synth_once(text, voice, rate):
    communicate = edge_tts.Communicate(
        text, voice, rate=rate, boundary="WordBoundary"
    )
    audio = bytearray()
    words = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
        elif chunk["type"] == "WordBoundary":
            words.append({
                "text": _safe_text(chunk["text"]),
                "offset": chunk["offset"],
                "duration": chunk["duration"],
            })
    if not audio:
        raise RuntimeError("TTS 未返回音频数据")
    return base64.b64encode(bytes(audio)).decode("ascii"), words


async def synth_one(text, voice, rate):
    """单段合成：失败 / 超时自动重试，最多 MAX_ATTEMPTS 次，每次限时 ATTEMPT_TIMEOUT 秒。"""
    last_err = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            return await asyncio.wait_for(
                _synth_once(text, voice, rate), timeout=ATTEMPT_TIMEOUT
            )
        except Exception as exc:  # noqa: BLE001 - 网络 / 服务端错误统一重试
            last_err = exc
            if attempt < MAX_ATTEMPTS:
                # 退避 1s / 2s，避开 Edge TTS 临时限流
                await asyncio.sleep(attempt)
    raise RuntimeError(f"TTS 合成失败（已尝试 {MAX_ATTEMPTS} 次）: {last_err}")


async def synth_many(items, voice, rate):
    async def one(it):
        return await synth_one(it["text"], voice, rate)

    outcomes = await asyncio.gather(
        *(one(it) for it in items), return_exceptions=True
    )
    results = {}
    for it, outcome in zip(items, outcomes):
        if isinstance(outcome, Exception):
            results[str(it["id"])] = {"error": _safe_text(outcome)}
        else:
            audio_b64, words = outcome
            results[str(it["id"])] = {"audio": audio_b64, "words": words}
    return results


def main():
    # Windows 下 stdio 默认可能是 GBK：强制 UTF-8，避免中文参数 / 错误提示乱码
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        params = json.loads(sys.stdin.readline())
        voice = params.get("voice") or DEFAULT_VOICE
        rate = params.get("rate") or "+0%"
        items = params.get("items")
        if not items:  # 兼容旧单段入参
            text = (params.get("text") or "").strip()
            if not text:
                raise ValueError("空文本")
            items = [{"id": 0, "text": text}]
        results = asyncio.run(synth_many(items, voice, rate))
        sys.stdout.write(_json_dump({"results": results}))
    except Exception as exc:  # noqa: BLE001 - 任何异常都转成结构化错误回传给后端
        sys.stdout.write(_json_dump({"error": _safe_text(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
