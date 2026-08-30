"""
pdf_service.py — 文章导出 PDF 的本地服务（FastAPI，端口 5057）

把 server/pdf_export.py（reportlab 排版 + PyMuPDF 标注）封装成 HTTP 接口，
供前端工具栏的「PDF」按钮调用。

之所以走 Python 服务而不是纯前端 jsPDF：
  1. jsPDF 没有两端对齐，也没有 Highlight / Underline 注释 API —— 需手工拼
     /Annots 字典与 /AP 外观流，代码量大且健壮性差；
  2. 本项目的批注靠 (段号, 段内偏移) 定位，前端方案还得自己实现排版才能
     知道字符坐标，等于在浏览器里重写一遍 reportlab。

对外接口：
  GET  /health           -> { ok, engine: "pymupdf" }
  POST /api/export-pdf   -> application/pdf

请求体（JSON）：
  {
    "title": "文章标题",
    "content": "正文纯文本（\\n 分段）",
    "annotations": [
      {"paragraphIndex":0,"startOffset":10,"endOffset":18,
       "type":"highlight","color":"#FFEB3B","note":"注释内容"}
    ],
    "options": { "markHighlight": true, "markUnderline": true, "withContents": true }
  }

依赖（项目虚拟环境已装）：PyMuPDF, reportlab, fastapi, uvicorn

运行：
  "F:\\PythonProject\\.venv\\Scripts\\pythonw.exe" server\\pdf_service.py
"""
import os
import sys
import urllib.parse
from typing import Any

# pythonw.exe 下 sys.stdout / sys.stderr 都是 None，uvicorn 配置 logging 时会因此崩溃，
# 而异常无处输出 —— 表现为「进程静默退出、端口不通」。这里显式兜底到 devnull。
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

# 允许直接 `python server/pdf_service.py` 运行时导入同目录的 pdf_export
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

try:
    import fitz  # PyMuPDF
    from pdf_export import export_article_to_pdf
except Exception as _e:  # 依赖缺失时服务仍可启动，接口返回明确错误
    fitz = None
    _IMPORT_ERROR = _e

app = FastAPI(title="PDF Export Service (PyMuPDF)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

PORT = 5057

# 仅允许前端覆盖这些选项，避免任意参数透传
_ALLOWED_OPTIONS = {
    "mark_highlight",
    "mark_underline",
    "with_contents",
    "show_title",
    "font_size",
    "line_height",
    "page_size",
    "underline_width",
}

# 前端 JS 使用驼峰命名，需映射到 pdf_export 的下划线键名
# （不做映射时选项会被白名单静默丢弃，功能"看起来正常"但开关无效 —— 参考项目踩过）
_OPTION_ALIASES = {
    "markHighlight": "mark_highlight",
    "markUnderline": "mark_underline",
    "withContents": "with_contents",
    "showTitle": "show_title",
    "fontSize": "font_size",
    "lineHeight": "line_height",
    "pageSize": "page_size",
    "underlineWidth": "underline_width",
}


def _normalize_options(raw: Any) -> dict:
    """把前端传入的 options（可能用驼峰键）转成 pdf_export 认识的键，并做白名单过滤。"""
    out = {}
    if not isinstance(raw, dict):
        return out
    for k, v in raw.items():
        key = _OPTION_ALIASES.get(k, k)
        if key in _ALLOWED_OPTIONS:
            out[key] = v
    return out


def _safe_filename(title: str) -> str:
    name = "".join(ch for ch in (title or "article") if ch not in r'\/:*?"<>|' + "\r\n")
    return (name.strip() or "article")[:80] + ".pdf"


def _ascii_filename(name: str) -> str:
    """
    HTTP 响应头只能承载 latin-1，含中文的标题直接放进 filename= 会抛异常。
    这里生成 ASCII 回退名，精确名称由 filename*= 提供（RFC 5987）。
    """
    return "".join(ch if ord(ch) < 128 else "_" for ch in name)


@app.get("/health")
def health():
    return {
        "ok": fitz is not None,
        "engine": "pymupdf",
        "version": getattr(fitz, "__version__", None) if fitz else None,
    }


@app.post("/api/export-pdf")
async def api_export_pdf(payload: dict):
    if fitz is None:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": f"PyMuPDF 未安装：{_IMPORT_ERROR}"},
        )

    if not isinstance(payload, dict):
        return JSONResponse(status_code=400, content={"ok": False, "error": "请求体必须是 JSON 对象"})

    content = payload.get("content")
    if not content or not str(content).strip():
        return JSONResponse(status_code=400, content={"ok": False, "error": "正文为空"})

    options = _normalize_options(payload.get("options"))

    try:
        data = export_article_to_pdf(payload, options)
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": f"导出失败：{e}"})

    filename = _safe_filename(payload.get("title"))
    # RFC 5987：ASCII 回退名 + UTF-8 精确名双写，兼顾旧浏览器与中文标题
    quoted = urllib.parse.quote(filename)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition":
                f"attachment; filename=\"{_ascii_filename(filename)}\";"
                f" filename*=UTF-8''{quoted}",
            "X-Export-Engine": "pymupdf",
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
