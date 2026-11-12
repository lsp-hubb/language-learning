r"""
notes_pdf_export.py — 笔记内容单独导出 PDF，并与正文 PDF 合并

背景
----
导出 PDF 时，笔记（articles.notes）原先完全不参与导出，产物只有「正文 + 批注」。
笔记的排版需求与正文不同：正文要「两端对齐 + 按字符偏移回填批注注释」，
而笔记是结构化的短文本（英文原句 / 中文释义 / 词汇行），只需清晰可读、中文不乱码，
不需要任何字符级定位。

为什么不直接改 server/pdf_export.py
------------------------------------
正文导出链路里有一批靠实测校准的细节：下划线要自绘 /AP 外观流、/BBox 必须与 /Rect 重合、
中文只能按字符段混排（CID 字体度量不准，整体切换会让纯英文行差 4~8pt）……
这些牵一发动全身。笔记只是纯排版，混进去既无收益又有回归风险。

因此：**笔记走独立文件独立排版**，导出后用 merge_pdfs() 追加到正文 PDF 之后，
正文导出的任何一行都不改动。两份 PDF 各自独立可用，合并只是把它们顺序拼接。

笔记的存储形态（与后端 GET /api/articles/:id/notes 一致）
--------------------------------------------------------
articles.notes 只有一种存法：用户粘贴的纯文本生文本，形如
       1. The Supreme Court ...
       最高法院……
       （roe\green-light\on the ropes）

       2. ...
   块之间空行分隔，块内三行依次为：英文原句 / 中文释义 / 词汇行
   （词汇行用全角括号包裹，词之间以 \ 分隔 —— 与前端 NotePanel.parseRaw 的约定一致）

重点标记（marks）
----------------
articles.marks 是 JSON 对象，键 `noteIndex__词汇文本`，值 true。它不在 articles.notes
里，而是由前端导出时经 GET /api/articles/:id/marks 读取、放进 payload.marks 一并传进来。
笔记排版按块索引找到对应词组，把被标记的项渲染成红色（同界面 .vocab-marked 的 #ff1f1f）；
无 marks / 读取失败时全部按普通灰色词汇输出，导出链路不受影响。

命令行
------
  python notes_pdf_export.py --input notes.txt --out notes.pdf
  python notes_pdf_export.py --input article.json --out notes.pdf   # {"title","notes","marks"(可选)}
  # --input 省略则从 stdin 读；--out 省略则输出到 stdout

模块调用
--------
  from notes_pdf_export import export_notes_to_pdf, merge_pdfs
  main_pdf  = export_article_to_pdf(payload)          # 正文（pdf_export.py，未改动）
  notes_pdf = export_notes_to_pdf(payload)            # 笔记 + payload.marks 标红；无笔记返回 b""
  data      = merge_pdfs([main_pdf, notes_pdf])       # 合并后一起返回
"""
import argparse
import io
import json
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

import fitz  # PyMuPDF（仅用于合并 PDF）
from reportlab.lib.colors import Color
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph

# ---------------------------------------------------------------- 默认配置
DEFAULTS: Dict[str, Any] = {
    "page_size": "a4",              # a4 / letter（与正文导出保持一致）
    "body_font": "Helvetica",       # reportlab 内置字体
    "bold_font": "Helvetica-Bold",  # 首页大标题
    "cjk_font": "STSong-Light",     # reportlab 内置 CID 中文字体（无需外部字体文件）
    "font_size": 11,
    "line_height": 1.5,
    "title_font_size": 16,
    "section_font_size": 13,        # 预留：当前笔记无分节
    "vocab_font_size": 10,
    "margin_x": 56,
    "margin_top": 64,
    "margin_bottom": 60,
    "block_gap": 12,                # 每条笔记之间的间距（pt）
    "heading_text": "笔记",         # 首页大标题（有文章标题时拼成「标题 — 笔记」）
    "show_title": True,
    "vocab_color": (0.42, 0.45, 0.50),   # 词汇行灰色，弱于正文
    # 重点词汇：与界面 .vocab-marked 的 #ff1f1f 一致（255/255, 31/255, 31/255）
    "vocab_marked_color": (1.0, 0.1216, 0.1216),
    "author": "LanguageLearning",
}

CJK_RE = re.compile(r"[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]")
# 连续的 CJK 段（含 CJK 标点/全角字符）
CJK_RUN_RE = re.compile(r"[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]+")

# 词汇行：整行被全角/半角括号包裹，如（roe\green-light\on the ropes）
VOCAB_LINE_RE = re.compile(r"^[（(]\s*(.*?)\s*[）)]$")
# 词汇行内部的分隔符：反斜杠（录入约定）以及常见的 / | ｜
VOCAB_SEP_RE = re.compile(r"[\\/｜|]")
# 词组内部的连续空白：压成单个空格，见 _vocab_words 的说明
_WORD_SPACE_RE = re.compile(r"\s+")

# 笔记块切分：与前端 NotePanel.parseRaw 的 /\n(?=\d+\.\s?)/ 保持一致，
# 这里额外容忍顿号与数字后的空格，避免手抄笔记被漏切。
BLOCK_SPLIT_RE = re.compile(r"\n(?=\d+\s*[.、]\s?)")

_cjk_ready = {"done": False}


def _ensure_cjk(name: str) -> bool:
    """注册 reportlab 内置 CID 中文字体（仅注册一次）。"""
    if _cjk_ready["done"]:
        return True
    try:
        pdfmetrics.registerFont(UnicodeCIDFont(name))
        _cjk_ready["done"] = True
        return True
    except Exception:
        return False


def _esc(t: str) -> str:
    """reportlab 的 Paragraph 接受受限 HTML，需转义 & < >"""
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _markup_cjk(t: str, cjk_font: str) -> str:
    """
    把连续的中文段包进 <font name="...">，其余保持西文字体。

    与 pdf_export.py 同思路：内置 CID 字体（STSong-Light）的字符宽度度量与实际渲染
    不一致，整体切换会让纯英文行对不齐；按段混排只让中文部分受影响。
    """
    return CJK_RUN_RE.sub(lambda m: f'<font name="{cjk_font}">{m.group(0)}</font>', t)


def _normalize_text(t: Any) -> str:
    """
    统一特殊连字符 -> ASCII，避免 PDF 出现黑框（tofu）。
    与 pdf_export.py 的处理保持一致：这些字符屏幕上正常、库里正常，只有导出会变黑框。
    """
    if not isinstance(t, str):
        t = "" if t is None else str(t)
    return (t
            .replace("\u2010", "-")   # hyphen
            .replace("\u2011", "-")   # non-breaking hyphen（网页复制最常见）
            .replace("\u2012", "-")   # figure dash
            .replace("\u00ad", ""))   # soft hyphen：仅断词提示，直接删除


# ---------------------------------------------------------------- 笔记解析
def parse_notes_blocks(raw: Any) -> List[Tuple[str, str]]:
    """
    把 articles.notes 拆成 [(节标题, 笔记文本), ...]。

    articles.notes 只有纯文本生文本一种存法，无条件整篇排版：
    - 非空内容 -> [("", 全文)]（节标题恒为空）
    - 空内容 / None -> []
    """
    if raw is None:
        return []

    text = _normalize_text(raw).strip()
    if not text:
        return []

    return [("", text)]


def _split_blocks(text: str) -> List[List[str]]:
    """
    笔记文本 -> 若干块，每块是行列表。

    按「数字. 」开头的行切块（与前端 parseRaw 一致）；
    没有编号的自由文本则整体作为一块，行序原样保留。
    """
    blocks: List[List[str]] = []
    for chunk in BLOCK_SPLIT_RE.split(text):
        lines = [ln.strip() for ln in chunk.split("\n")]
        lines = [ln for ln in lines if ln]
        if lines:
            blocks.append(lines)
    return blocks


def _vocab_words(line: str) -> Optional[List[str]]:
    """
    词汇行 -> 词组列表；不是词汇行返回 None。

    输出形态见 _layout：去掉「词汇短语：」前缀，一个词组单独一行、行尾加句号，
    不再拼成「词汇短语：a、 b、 c」一整段。这样词组既不会被从中间折断，
    也不会因为排版宽度不同而挤在一行里显得参差 ——
    根因是 reportlab 只在 ASCII 空白处分行，中文顿号「、」不是断点，
    原先才只能从词组内部的空格处换行。

    词组内部的多余空白压成一个普通空格：极长词组放不下一行时，仍在词与词之间折行，
    比整行无断点时被按字符硬拆（"abund" / "ance"）可读得多。
    """
    m = VOCAB_LINE_RE.match(line)
    if not m:
        return None
    words = [w.strip() for w in VOCAB_SEP_RE.split(m.group(1)) if w.strip()]
    if not words:
        return None
    return [_WORD_SPACE_RE.sub(" ", w) for w in words]


# 与前端 src/utils/normalizeQuotes.js 对齐（弯引号 + HTML 实体 → 直引号）。
# 只用于「重点标记键 ↔ 渲染词组」比对，不改变 PDF 里实际显示的文本，
# 避免旧数据里一侧是弯引号、一侧是直引号时标记失配。
_SINGLE_QUOTE_RE = re.compile(r"[\u2018\u2019]|&(?:lsquo|rsquo|#8216|#8217);", re.I)
_DOUBLE_QUOTE_RE = re.compile(r"[\u201c\u201d]|&(?:ldquo|rdquo|#8220|#8221);", re.I)


def _normalize_quotes(t: str) -> str:
    return _DOUBLE_QUOTE_RE.sub('"', _SINGLE_QUOTE_RE.sub("'", t))


def _marked_vocab(marks: Any) -> Dict[int, set]:
    """
    articles.marks -> {笔记块索引: {被标记为「重点」的词组文本}}。

    - 只保留值为 true 的键：界面 toggleMark 取消标记时写的是 false，不会删键；
    - 键里的词汇按 _vocab_words 的同一套规则拆开、压空白，保证与渲染出来的
      词组逐一对得上（前端只按 \\ 分隔，词组内若含 / | ｜，PDF 会拆成多行，
      展开后这些行都能标红）；
    - 引号两侧都归一，兼容尚未清洗的旧笔记 / 旧标记。
    """
    out: Dict[int, set] = {}
    if not isinstance(marks, dict):
        return out
    for key, val in marks.items():
        if not val or not isinstance(key, str):
            continue
        sep = key.find("__")
        if sep < 0:
            continue
        try:
            idx = int(key[:sep])
        except ValueError:
            continue
        pieces = [_WORD_SPACE_RE.sub(" ", p.strip())
                  for p in VOCAB_SEP_RE.split(key[sep + 2:]) if p.strip()]
        bucket = out.setdefault(idx, set())
        for p in pieces:
            bucket.add(_normalize_quotes(p))
    return out


# ---------------------------------------------------------------- 排版
def _layout(title: str, sections: List[Tuple[str, str]], opt: Dict[str, Any],
            marks: Any = None) -> bytes:
    """用 reportlab 排版笔记，返回 PDF bytes。"""
    marked = _marked_vocab(marks)
    if opt["page_size"] == "letter":
        page_w, page_h = letter
    else:
        page_w, page_h = A4

    left = opt["margin_x"]
    frame_w = page_w - left * 2
    frame_h = page_h - opt["margin_top"] - opt["margin_bottom"]

    cjk_font = opt["cjk_font"]
    sample = [title, str(opt.get("heading_text") or "")]
    for heading, text in sections:
        sample.append(heading)
        sample.append(text)
    has_cjk = any(CJK_RE.search(s or "") for s in sample)
    cjk_ok = has_cjk and _ensure_cjk(cjk_font)

    def markup(t: str) -> str:
        esc = _esc(t)
        return _markup_cjk(esc, cjk_font) if cjk_ok else esc

    fs = opt["font_size"]

    buf = io.BytesIO()
    doc = BaseDocTemplate(buf, pagesize=(page_w, page_h),
                          leftMargin=0, rightMargin=0, topMargin=0, bottomMargin=0)
    # Frame 默认有 6pt 内边距，会让版心偏离设定值，必须显式置 0（与 pdf_export.py 同）
    frame = Frame(left, opt["margin_bottom"], frame_w, frame_h, id="f",
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame])])

    story: List[Any] = []

    if opt["show_title"]:
        heading = str(opt.get("heading_text") or "笔记")
        heading = f"{title} — {heading}" if title else heading
        story.append(Paragraph(markup(heading), ParagraphStyle(
            "nh", fontName=opt["bold_font"], fontSize=opt["title_font_size"],
            leading=opt["title_font_size"] * 1.3, spaceAfter=14)))

    body_style = ParagraphStyle(
        "nb", fontName=opt["body_font"], fontSize=fs, leading=fs * opt["line_height"],
        alignment=TA_LEFT, spaceAfter=0,
        # 中文没有词间空格：默认（None）只在 ASCII 空白处分行，中英混排的长句
        # 只能退回英文单词之间的空格换行（例如 "Not only置于句首…" 一行放不下时，
        # 只能在 "Not" 后断开，行尾留一大片空白）。
        # CJK 模式允许在汉字之间断行，行能被填满；此时英文仍优先在空格处断
        # （reportlab 的 dumbSplit 会回退寻找空格 / 汉字边界，不会把单词拆成字母）。
        wordWrap="CJK" if cjk_ok else None)
    # 块首行：额外上间距，形成「一条笔记」的视觉分组
    body_first_style = ParagraphStyle("nbf", parent=body_style, spaceBefore=opt["block_gap"])
    vocab_style = ParagraphStyle(
        "nv", parent=body_style, fontSize=opt["vocab_font_size"],
        leading=opt["vocab_font_size"] * 1.45, textColor=Color(*opt["vocab_color"]))
    # 重点词汇：与界面一致标红。只换颜色不切粗体 —— 内置 CID 中文字体没有 bold 变体，
    # 强行加粗会让中英混排的词组一半粗一半细（甚至触发字体映射错误）
    vocab_marked_style = ParagraphStyle(
        "nvm", parent=vocab_style, textColor=Color(*opt["vocab_marked_color"]))
    section_style = ParagraphStyle(
        "ns", fontName=opt["bold_font"], fontSize=opt["section_font_size"],
        leading=opt["section_font_size"] * 1.35, spaceBefore=14, spaceAfter=6)

    for heading, text in sections:
        if heading:
            story.append(Paragraph(markup(heading), section_style))
        # 块索引即前端 NotePanel.parseRaw 的 noteIndex（marks 键形如 `0__词组`）。
        # _split_blocks 与前端切块规则在标准「1. 」编号下一致；若笔记用了「1、」
        # 等非标准编号，两边块数可能不同，对应标记会错位（见 PDF_EXPORT.md）。
        for block_index, lines in enumerate(_split_blocks(text)):
            marked_words = marked.get(block_index, set())
            for i, line in enumerate(lines):
                words = _vocab_words(line)
                if words is not None:
                    # 词汇行：一个词组一行，行尾加句号（不再输出「词汇短语：」前缀）
                    for w in words:
                        style = (vocab_marked_style if _normalize_quotes(w) in marked_words
                                 else vocab_style)
                        story.append(Paragraph(markup(w + "。"), style))
                else:
                    story.append(Paragraph(
                        markup(line), body_first_style if i == 0 else body_style))

    if not story:  # 防止空文档报错
        story.append(Paragraph(" ", body_style))

    doc.build(story)
    return buf.getvalue()


def _pick_options(options: Optional[dict]) -> Dict[str, Any]:
    """
    只取本模块认识的选项键。

    pdf_service.py 会把它那套（mark_highlight / include_notes ...）原样传进来，
    这里做一次白名单过滤，避免无关键混进排版配置。
    """
    if not isinstance(options, dict):
        return {}
    return {k: v for k, v in options.items() if k in DEFAULTS}


# ---------------------------------------------------------------- 对外接口
def export_notes_to_pdf(article: Any, options: Optional[dict] = None) -> bytes:
    """
    把笔记导出为 PDF（只含笔记，不含正文）。

    :param article: {"title":..., "notes":..., "marks":...}，也可直接传笔记字符串
                    （marks 可选，键 `noteIndex__词汇文本`，值 true 的项标红）
    :param options: 见 DEFAULTS
    :return: PDF 字节；**无笔记时返回 b""**（调用方据此跳过合并）
    """
    if isinstance(article, dict):
        title = str(article.get("title") or "").strip()
        raw = article.get("notes")
        marks = article.get("marks")
    else:
        title, raw, marks = "", article, None

    opt = {**DEFAULTS, **_pick_options(options)}
    sections = parse_notes_blocks(raw)
    if not sections:
        return b""
    return _layout(_normalize_text(title), sections, opt, marks)


def merge_pdfs(parts: List[bytes]) -> bytes:
    """
    按顺序把多份 PDF 合并成一份（正文在前、笔记在后）。

    用 PyMuPDF 的 insert_pdf 整页搬移：页面内容与注释（含正文导出的 Highlight /
    Underline 及其 /AP 外观流）随页面一起复制，不会丢失，也不需要重新排版。

    :param parts: PDF 字节列表，空元素会被跳过
    :return: 合并后的 PDF 字节
    """
    parts = [p for p in (parts or []) if p]
    if not parts:
        raise ValueError("没有可合并的 PDF")
    if len(parts) == 1:
        return parts[0]

    out = fitz.open()
    try:
        for p in parts:
            src = fitz.open(stream=p)
            try:
                out.insert_pdf(src)  # annots 默认保留
            finally:
                src.close()
        return out.tobytes(garbage=3, deflate=True)
    finally:
        out.close()


# ---------------------------------------------------------------- 命令行
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="把文章笔记单独导出为 PDF（可与正文 PDF 合并）")
    ap.add_argument("--input", help="笔记文本，或文章 JSON（含 title/notes）；省略则从 stdin 读")
    ap.add_argument("--out", help="输出 PDF 路径；省略则输出到 stdout")
    ap.add_argument("--title", default="", help="文章标题（JSON 输入时以 JSON 内的为准）")
    args = ap.parse_args(argv)

    raw = open(args.input, "r", encoding="utf-8").read() if args.input else sys.stdin.read()

    payload: Any
    if raw.strip().startswith("{"):
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {"title": args.title, "notes": raw}
    else:
        payload = {"title": args.title, "notes": raw}

    data = export_notes_to_pdf(payload)
    if not data:
        print("笔记为空，未导出", file=sys.stderr)
        return 1

    if args.out:
        with open(args.out, "wb") as f:
            f.write(data)
        print(f"已导出：{args.out}（{len(data)} 字节）", file=sys.stderr)
    else:
        sys.stdout.buffer.write(data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
