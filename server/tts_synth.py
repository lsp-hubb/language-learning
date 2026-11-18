"""Edge TTS 朗读合成辅助脚本（单进程批量并发）。

由 Node 后端 spawn 调用：从 stdin 读一行 JSON 参数，向 stdout 输出一行 JSON 结果。
输入: {"items":[{"id":..., "text":"..."}, ...], "voice":"...", "rate":"+0%"}
输出: {"results": {"<id>": {"audio":"<base64 mp3>", "words":[...]}, ...}}
  - offset/duration 为 100ns tick（edge-tts 原生单位），前端除以 10000 得毫秒。
  - words 用 WordBoundary，Edge TTS 会把 "since 2015" 这类数字单元作为一个词返回，
    直接用其 text 在段全文里定位高亮即可，无需前端猜测。
  - 全部段在【同一进程】内用 asyncio.gather 并发合成：省掉每段重复 spawn + import edge-tts
    的开销（实测 4 段从 ~7.3s 降到 ~2.9s）。单段失败只标记该项 error，不拖垮整批。

兼容旧的单段入参 {"text": "..."}（视作 id=0）。依赖：edge-tts（虚拟环境已装）。
"""
import sys
import json
import asyncio
import base64

import edge_tts

DEFAULT_VOICE = "en-US-AndrewNeural"


async def synth_one(text, voice, rate):
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
                "text": chunk["text"],
                "offset": chunk["offset"],
                "duration": chunk["duration"],
            })
    if not audio:
        raise RuntimeError("TTS 未返回音频数据")
    return base64.b64encode(bytes(audio)).decode("ascii"), words


async def synth_many(items, voice, rate):
    async def one(it):
        return await synth_one(it["text"], voice, rate)

    outcomes = await asyncio.gather(
        *(one(it) for it in items), return_exceptions=True
    )
    results = {}
    for it, outcome in zip(items, outcomes):
        if isinstance(outcome, Exception):
            results[str(it["id"])] = {"error": str(outcome)}
        else:
            audio_b64, words = outcome
            results[str(it["id"])] = {"audio": audio_b64, "words": words}
    return results


def main():
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
        sys.stdout.write(json.dumps({"results": results}, ensure_ascii=False))
    except Exception as exc:  # noqa: BLE001 - 任何异常都转成结构化错误回传给后端
        sys.stdout.write(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
