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

导出产物 = 各独立 PDF 片段按顺序合并（每份整页搬移，**每个片段都从新页开始**）：
  1. 批注（三栏表格，条目挂 PDF Highlight 注释，note 写入 /Contents）
  2. 重点
  3. 句子（收藏的笔记卡片内容拷贝，每条英文 + 中文；来自 payload.favorites）
  4. 文章正文（pdf_export.py，始终存在）
  5. 笔记全文
  和为 0 的片段跳过；正文导出代码不受影响。最终产物按上述顺序写**五个一级书签**，
  页码按各片段页数累加，供阅读器目录跳转。

请求体（JSON）：
  {
    "title": "文章标题",
    "content": "正文纯文本（\\n 分段）",
    "notes": "笔记生文本（纯文本，整篇排版）",
    "marks": {"0__词组": true},  # 可选：重点标记（键 noteIndex__词汇文本），对应词组在笔记 PDF 中标红
    "annotations": [
      {"paragraphIndex":0,"startOffset":10,"endOffset":18,
       "type":"highlight","color":"#FFEB3B","text":"被标注原文","note":"注释内容"}
    ],
    "options": {
      "markHighlight": true, "markUnderline": true, "withContents": true,
      "includeNotes": true,
      "annotationsLandscape": true  # 批注章节独立横版（其余章节仍竖版）
    }
  }

响应头 X-Include-Notes：1 = 已附带笔记侧片段（集中节或笔记全文任一有内容），0 = 一个都没有。

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

# 笔记导出（server/notes_pdf_export.py）：输出多个独立片段，服务层插入正文后合并。
# 单独 try：即使该文件缺失/出错，也只是「不导出笔记」，正文导出不受影响。
try:
    from notes_pdf_export import export_note_parts, merge_pdfs
except Exception as _e2:
    export_note_parts = None
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
    "annotations_landscape",  # 批注章节独立横版（其余章节仍竖版）
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
    "annotationsLandscape": "annotations_landscape",
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


def _add_navigation(data: bytes, toc: list) -> bytes:
    """
    给最终产物写入 PDF 大纲（书签），供阅读器左侧目录跳转。

    toc 由服务层按片段顺序构造，全是 level 1：
      批注 → 重点 → 句子 → 文章标题 → 笔记全文（只含有内容的片段）。
    每项 [1, 标题, 起始页]，页码 1-based，按各片段页数累加得出；
    每个片段都是独立 PDF，因此每个书签都指向该片段的第 1 页（新页）。
    PageMode 设为 UseOutlines，打开时默认展开书签栏。
    """
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

        # 2) 笔记侧各独立片段：批注（三栏 + PDF 高亮注释）/ 重点 / 句子 / 笔记全文
        note_parts = []
        if include_notes and export_note_parts is not None:
            note_parts = [p for p in export_note_parts(payload, options) if p.get("pdf")]

        # 3) 按「批注 → 重点 → 句子 → 文章标题 → 笔记全文」拼接。
        #    每个片段都是独立 PDF，整页搬移后必然各自从新的一页开始。
        summary = [p for p in note_parts if p["key"] != "notes"]
        notes = [p for p in note_parts if p["key"] == "notes"]
        article_title = _outline_text(payload.get("title"), "") or "正文"
        ordered = (summary + [{"key": "article", "title": article_title, "pdf": main_pdf}]
                   + notes)

        pdfs = [p["pdf"] for p in ordered]
        data = merge_pdfs(pdfs) if merge_pdfs and len(pdfs) > 1 else pdfs[0]

        # 4) 一级书签：顺序同上，页码为各片段首页（按片段页数累加）
        toc = []
        page = 1
        for p in ordered:
            toc.append([1, _outline_text(p["title"], "节"), page])
            d = fitz.open(stream=p["pdf"])
            try:
                page += d.page_count
            finally:
                d.close()
        data = _add_navigation(data, toc)
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
            # 前端据此提示「含笔记」；集中节或笔记全文任一有内容即为 1
            "X-Include-Notes": "1" if note_parts else "0",
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
