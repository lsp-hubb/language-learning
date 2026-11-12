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

导出产物 = 正文 PDF（pdf_export.py）+ 笔记 PDF（notes_pdf_export.py）合并：
  正文在前、笔记在后；文章没有笔记时只返回正文。
  两份 PDF 各自独立排版，合并只用 PyMuPDF 整页搬移，正文导出代码不受影响。
  最终产物还会写入两处一级 PDF 大纲（书签）：文章标题 → 第 1 页、
  「文章标题 — 笔记」→ 笔记首页（无笔记时只有前者），供阅读器目录跳转。

请求体（JSON）：
  {
    "title": "文章标题",
    "content": "正文纯文本（\\n 分段）",
    "notes": "笔记生文本（纯文本，整篇排版）",
    "marks": {"0__词组": true},  # 可选：重点标记（键 noteIndex__词汇文本），对应词组在笔记 PDF 中标红
    "annotations": [
      {"paragraphIndex":0,"startOffset":10,"endOffset":18,
       "type":"highlight","color":"#FFEB3B","note":"注释内容"}
    ],
    "options": {
      "markHighlight": true, "markUnderline": true, "withContents": true,
      "includeNotes": true
    }
  }

响应头 X-Include-Notes：1 = 已附带笔记，0 = 无笔记（前端据此提示）。

依赖（项目虚拟环境已装）：PyMuPDF, reportlab, fastapi, uvicorn

运行：
  "D:\\PythonFiles\\.venv\\Scripts\\python.exe" server\\pdf_service.py
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

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

try:
    import fitz  # PyMuPDF
    from pdf_export import export_article_to_pdf
except Exception as _e:  # 依赖缺失时服务仍可启动，接口返回明确错误
    fitz = None
    export_article_to_pdf = None
    _IMPORT_ERROR = _e

# 笔记导出（server/notes_pdf_export.py）：独立排版，导出后合并到正文 PDF 之后。
# 单独 try：即使该文件缺失/出错，也只是「不导出笔记」，正文导出不受影响。
try:
    from notes_pdf_export import export_notes_to_pdf, merge_pdfs
except Exception as _e2:
    export_notes_to_pdf = None
    merge_pdfs = None
    _NOTES_IMPORT_ERROR = _e2

app = FastAPI(title="PDF Export Service (PyMuPDF)")
# expose_headers：前端需要读 X-Include-Notes 来自定义提示语，默认不会暴露给 JS
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"], expose_headers=["*"])

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
    "include_notes",      # 是否把笔记一并导出（默认开）
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
    "includeNotes": "include_notes",
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


def _outline_text(value: Any, fallback: str) -> str:
    """书签文字：控制字符换成空格、折叠换行，避免阅读器目录里断行或出现方框。"""
    text = "".join(" " if ord(ch) < 32 else ch for ch in str(value or ""))
    return " ".join(text.split())[:120] or fallback


def _add_navigation(data: bytes, title: Any, notes_start_page: int) -> bytes:
    """
    给最终产物写入 PDF 大纲（书签），供阅读器左侧目录跳转：

    - 一级节点「文章标题」→ 第 1 页（必有）
    - 一级节点「文章标题 — 笔记」→ 笔记首页（仅本次附带笔记时）
    - PageMode 设为 UseOutlines，打开时默认展开书签栏

    页码为 1-based；notes_start_page 由服务层按正文页数 + 1 算出，0 表示无笔记。
    """
    clean = _outline_text(title, "")
    article = clean or "正文"
    suffix = " — 笔记"
    notes = (clean[:120 - len(suffix)] + suffix) if clean else "笔记"

    toc = [[1, article, 1]]
    if notes_start_page:
        toc.append([1, notes, notes_start_page])

    doc = fitz.open(stream=data)
    try:
        doc.set_toc(toc)
        # PageMode 是较新版本的 API：老版本缺少时只跳过「默认展开书签栏」，不影响大纲本身
        if hasattr(doc, "set_pagemode"):
            doc.set_pagemode("UseOutlines")
        # 与 merge_pdfs 相同的打包参数：注释及其 /AP 外观流随页面保留
        return doc.tobytes(garbage=3, deflate=True)
    finally:
        doc.close()


@app.get("/health")
def health():
    return {
        "ok": fitz is not None,
        "engine": "pymupdf",
        "version": getattr(fitz, "__version__", None) if fitz else None,
    }


@app.post("/api/export-pdf")
async def api_export_pdf(request: Request):
    if fitz is None:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": f"PyMuPDF 未安装：{_IMPORT_ERROR}"},
        )

    # 不用 payload: dict 形参：FastAPI 会先做类型校验，非对象 / 非法 JSON 直接返回 422，
    # 文档约定的 400 分支就永远不可达。这里自行解析，保证错误码与 body 一致。
    try:
        payload = await request.json()
    except Exception:
        payload = None
    if not isinstance(payload, dict):
        return JSONResponse(status_code=400, content={"ok": False, "error": "请求体必须是 JSON 对象"})

    content = payload.get("content")
    if not content or not str(content).strip():
        return JSONResponse(status_code=400, content={"ok": False, "error": "正文为空"})

    options = _normalize_options(payload.get("options"))
    # include_notes 是本服务层的开关，不下传给排版函数（两边 DEFAULTS 不通用）
    include_notes = options.pop("include_notes", True)

    try:
        # 1) 正文 + 批注（原链路，一行未改）
        main_pdf = export_article_to_pdf(payload, options)

        # 2) 笔记（独立排版，无笔记时返回 b""）。payload 整体传入，其中的 marks
        #    由 notes_pdf_export 按块索引把被标记的重点词汇渲染成红色
        notes_pdf = b""
        if include_notes and export_notes_to_pdf is not None:
            notes_pdf = export_notes_to_pdf(payload, options) or b""

        # 3) 合并：正文在前、笔记在后（只有正文时直接用，不额外复制一遍）
        notes_start_page = 0
        if notes_pdf and merge_pdfs:
            main_doc = fitz.open(stream=main_pdf)
            try:
                notes_start_page = main_doc.page_count + 1
            finally:
                main_doc.close()
            data = merge_pdfs([main_pdf, notes_pdf])
        else:
            data = main_pdf

        # 4) 写入导航节：无笔记时只有「文章标题」一处
        data = _add_navigation(data, payload.get("title"), notes_start_page)
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
            # 前端据此提示「含笔记」；笔记导出模块异常时为 0
            "X-Include-Notes": "1" if notes_pdf else "0",
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
