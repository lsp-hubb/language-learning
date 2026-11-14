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

因此：**笔记走独立文件独立排版**，导出后用 merge_pdfs() 与正文 PDF 拼接，
正文导出的任何一行都不改动。各份 PDF 各自独立可用，合并只是把它们顺序拼接。

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

产物结构（每个片段是独立 PDF，合并后各自从新页开始）
------------------------------------------------------
服务层按下面的顺序拼接，五个一级书签也按此顺序指向各自首页：
  1. 「批注」：**三栏（三列）表格**，与网页集中卡片一致 —— 列优先、按正文出现
     顺序「从上到下、从左到右」铺开，每格只放被标注的原文。
  2. 「重点」：marks 里值为 true 的重点词汇，带所属笔记编号 #N（红色）。
  3. 「句子」：收藏的笔记卡片内容拷贝（articles.note_favorites），每条只显示英文 + 中文，
     不列词汇；由本模块从 payload.favorites 生成。
  4. 文章正文（pdf_export.py 的产物，由服务层插在这里）。
  5. 「笔记全文」：原有笔记排版（marks 标红）。
只有有内容的片段才生成；正文片段始终存在。本模块产出 1/2/3/5，服务层插入 4。

音标 / PDF 高亮注释
-------------------
三栏里每条被标注原文都挂一条 **PDF Highlight 注释**，注释内容（/Contents）是该条的
note（查词结果里的英 / 美音标、词性、释义等）。note 不再由 reportlab 渲染到页面上：
reportlab 内置 Helvetica / STSong-Light 以及系统常见字体都缺少 IPA 音标字形
（实测 Vera 仅覆盖 2/24 个常用 IPA 码位），画出来就是一行黑框；
改由阅读器在注释框里显示 Unicode 文本，音标既不乱码也不丢失。

命令行
------
  python notes_pdf_export.py --input notes.txt --out notes.pdf
  python notes_pdf_export.py --input article.json --out notes.pdf   # {"title","notes","marks","annotations"(可选)}
  # --input 省略则从 stdin 读；--out 省略则输出到 stdout

模块调用
--------
  from notes_pdf_export import export_note_parts, merge_pdfs
  parts = export_note_parts(payload)        # [{key,title,pdf}]：批注 / 重点 / 句子 / 笔记全文
  main_pdf = export_article_to_pdf(payload)
  # 服务层把 main_pdf 插到「句子」和「笔记全文」之间，再按片段页数累加写一级书签
  data = merge_pdfs([p["pdf"] for p in parts if p["key"] != "notes"] + [main_pdf] + [p["pdf"] for p in parts if p["key"] == "notes"])
"""
import argparse
import io
import json
import math
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

import fitz  # PyMuPDF（合并 PDF + 写三栏的 Highlight 注释）
from reportlab.lib.colors import Color
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Table, TableStyle

# ---------------------------------------------------------------- 默认配置
DEFAULTS: Dict[str, Any] = {
    "page_size": "a4",              # a4 / letter（与正文导出保持一致）
    "body_font": "Helvetica",       # reportlab 内置字体
    "bold_font": "Helvetica-Bold",  # 首页大标题
    "cjk_font": "STSong-Light",     # reportlab 内置 CID 中文字体（无需外部字体文件）
    "font_size": 12,
    "line_height": 1.5,
    "title_font_size": 16,
    "section_font_size": 16,        # 各片段首页的节标题
    "vocab_font_size": 11,
    "annotation_col_gap": 8,        # 三栏表格单元格左右内边距（pt）
    "margin_x": 56,
    "margin_top": 64,
    "margin_bottom": 60,
    "block_gap": 12,                # 每条笔记之间的间距（pt）
    "heading_text": "笔记",         # 首页大标题（有文章标题时拼成「标题 — 笔记」）
    "show_title": True,
    "vocab_color": (0.42, 0.45, 0.50),   # 词汇行灰色，弱于正文
    # 重点词汇：与界面 .vocab-marked 的 #ff1f1f 一致（255/255, 31/255, 31/255）
    "vocab_marked_color": (1.0, 0.1216, 0.1216),
    # 三栏条目统一挂的 PDF 高亮注释颜色（淡黄色）
    "annotation_bg_color": (1.0, 0.97, 0.65),
    "annotations_landscape": False,  # 批注章节独立横版（其余章节仍竖版）；前端默认开
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


# ---------------------------------------------------------------- 集中节数据
def _annotation_items(payload: Dict[str, Any]) -> List[dict]:
    """
    批注条目：与 NotePanel.annotationItems 同源同序（正文出现顺序）。

    优先用批注自带的 text（前端导出时带上）；命令行 / 旧数据没有 text 时回退到
    「正文按非空行切段 + 段内偏移」还原 —— 切段规则与 pdf_export.export_article_to_pdf
    一致，避免两处对同一批注算出不同文本。
    """
    raw = payload.get("annotations")
    if not isinstance(raw, list):
        return []
    paragraphs = [ln for ln in str(payload.get("content") or "").split("\n") if ln.strip()]
    items: List[dict] = []
    for a in raw:
        if not isinstance(a, dict):
            continue
        text = _normalize_text(a.get("text") or "").strip()
        if not text:
            try:
                pno = int(a["paragraphIndex"])
                start, end = int(a["startOffset"]), int(a["endOffset"])
                if 0 <= pno < len(paragraphs):
                    text = _normalize_text(paragraphs[pno][start:end]).strip()
            except (KeyError, TypeError, ValueError):
                text = ""
        if not text:
            continue
        pno = a.get("paragraphIndex")
        start = a.get("startOffset")
        items.append({
            "text": text,
            "note": a.get("note") or "",
            "type": a.get("type") or "",
            "pno": pno if isinstance(pno, int) else 0,
            "start": start if isinstance(start, int) else 0,
            "created": str(a.get("createdAt") or ""),
            "order": len(items),
        })
    items.sort(key=lambda x: (x["pno"], x["start"], x["created"], x["order"]))
    return items


def _marked_items(marks: Any) -> List[dict]:
    """重点条目：值 true 的 marks 键 -> (笔记块索引, 词汇文本)，与界面徽章 #N 一致。"""
    out: List[dict] = []
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
        vocab = _normalize_text(key[sep + 2:]).strip()
        if vocab:
            out.append({"noteIndex": idx, "vocab": vocab, "order": len(out)})
    out.sort(key=lambda x: (x["noteIndex"], x["order"]))
    return out


def _favorite_items(payload: Dict[str, Any]) -> List[dict]:
    """
    收藏的句子条目（articles.note_favorites）：每条是内容拷贝 {english, chinese, vocabItems}。
    PDF 里只展示英文 + 中文（不列词汇），与界面收藏集中视图一致。
    """
    raw = payload.get("favorites")
    if not isinstance(raw, list):
        return []
    items: List[dict] = []
    for f in raw:
        if not isinstance(f, dict):
            continue
        eng = _normalize_text(f.get("english") or "").strip()
        chs = _normalize_text(f.get("chinese") or "").strip()
        if not eng and not chs:
            continue
        items.append({"english": eng, "chinese": chs})
    return items



def _build_parts(payload: Dict[str, Any]) -> List[dict]:
    """
    构造片段描述（PDF 字节稍后生成），顺序即最终页序：
      批注 → 重点 → 句子 → 笔记全文（服务层把正文片段插到「句子」与「笔记全文」之间）。
    只为有内容的片段建条目；每个片段是独立 PDF，合并后必然从新页开始。
    """
    parts: List[dict] = []
    anns = _annotation_items(payload)
    if anns:
        parts.append({
            "key": "annotations", "title": f"批注（{len(anns)}）",
            "kind": "annotations", "items": anns,
        })
    marked = _marked_items(payload.get("marks"))
    if marked:
        parts.append({
            "key": "marked", "title": f"重点（{len(marked)}）",
            "kind": "marked", "items": marked,
        })
    favs = _favorite_items(payload)
    if favs:
        parts.append({
            "key": "favorites", "title": f"句子（{len(favs)}）",
            "kind": "favorites", "items": favs,
        })
    for _, text in parse_notes_blocks(payload.get("notes")):
        if text and text.strip():
            parts.append({"key": "notes", "title": "笔记全文", "kind": "notes", "text": text})
    return parts


class _TaggedParagraph(Paragraph):
    """
    三栏单元格：排版时把自身绘制矩形记进 boxes，供 _attach_highlight_notes
    精确挂注释。比事后 search_for 文本可靠 —— 重复原文、跨行长文本都不会串位。
    """

    def __init__(self, text: str, style: Any, item: dict, boxes: list, page_height: float):
        super().__init__(text, style)
        self._item = item
        self._boxes = boxes
        self._page_height = page_height

    def draw(self):
        super().draw()
        try:
            x0, y0 = self.canv.absolutePosition(0, 0)
            x1, y1 = self.canv.absolutePosition(self.width, self.height)
            # reportlab 的 y 从左下起算，PyMuPDF 的 Rect 从左上起算
            self._boxes.append((
                self.canv.getPageNumber(),
                (x0, self._page_height - y1, x1, self._page_height - y0),
                self._item,
            ))
        except Exception:
            pass


def _attach_highlight_notes(pdf: bytes, boxes: list, color: Any) -> bytes:
    """
    给三栏里每条被标注原文挂 PDF Highlight 注释，note 写入 /Contents。

    note 含 IPA 音标等 Unicode，由阅读器注释框渲染，排版层不再碰这些字符，
    从根上避开 reportlab 内置字体缺字形导致的黑框（实测 Vera 仅覆盖 2/24 个常用 IPA）。
    """
    doc = fitz.open(stream=pdf)
    try:
        # 必须保持 Page 对象存活：新版 PyMuPDF 的 Annot.set_info() 会校验
        # annot 是否仍绑定在页面上，doc[pno] 临时对象被回收就会报
        # "annotation not bound to any page"。
        pages = [doc.load_page(i) for i in range(doc.page_count)]
        for pno, rect, it in boxes:
            if not 1 <= pno <= len(pages):
                continue
            annot = pages[pno - 1].add_highlight_annot(fitz.Rect(*rect))
            annot.set_info(
                content=str(it.get("note") or "").strip() or "（暂无注释）",
                title=str(it.get("type") or "批注"),
            )
            annot.set_colors(stroke=tuple(float(c) for c in color))
            annot.update()
        return doc.tobytes(garbage=3, deflate=True)
    finally:
        doc.close()


# ---------------------------------------------------------------- 排版
def _layout_part(part: Dict[str, Any], opt: Dict[str, Any], marks: Any = None) -> bytes:
    """把一个片段排成**独立 PDF**（合并后自然从新页开始），返回 PDF bytes。"""
    marked = _marked_vocab(marks)
    if opt["page_size"] == "letter":
        base_w, base_h = letter
    else:
        base_w, base_h = A4
    # 批注章节可独立横版：仅旋转该片段自身页面尺寸，其余章节仍竖版
    if part.get("kind") == "annotations" and opt.get("annotations_landscape"):
        page_w, page_h = base_h, base_w
    else:
        page_w, page_h = base_w, base_h

    left = opt["margin_x"]
    frame_w = page_w - left * 2
    frame_h = page_h - opt["margin_top"] - opt["margin_bottom"]

    kind = part["kind"]
    items = part.get("items") or []
    text = part.get("text") or ""
    cjk_font = opt["cjk_font"]
    # 只探测会画到页面上的文字；note 进 PDF 注释，不参与字体选择
    sample = [part.get("title") or "", text if kind == "notes" else ""]
    sample += [str(it.get("text") or it.get("vocab") or it.get("english") or it.get("chinese") or "") for it in items]
    cjk_ok = any(CJK_RE.search(s or "") for s in sample) and _ensure_cjk(cjk_font)

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

    body_style = ParagraphStyle(
        "nb", fontName=opt["body_font"], fontSize=fs, leading=fs * opt["line_height"],
        alignment=TA_LEFT, spaceAfter=0,
        # 中文没有词间空格：默认（None）只在 ASCII 空白处分行，中英混排的长句
        # 只能退回英文单词之间的空格换行；CJK 模式允许在汉字之间断行，行能被填满
        wordWrap="CJK" if cjk_ok else None)
    body_first_style = ParagraphStyle("nbf", parent=body_style, spaceBefore=opt["block_gap"])
    vocab_style = ParagraphStyle(
        "nv", parent=body_style, fontSize=opt["vocab_font_size"],
        leading=opt["vocab_font_size"] * 1.45, textColor=Color(*opt["vocab_color"]))
    # 重点词汇：与界面一致标红。只换颜色不切粗体 —— 内置 CID 中文字体没有 bold 变体
    vocab_marked_style = ParagraphStyle(
        "nvm", parent=vocab_style, textColor=Color(*opt["vocab_marked_color"]))
    section_style = ParagraphStyle(
        "ns", fontName=opt["bold_font"], fontSize=opt["section_font_size"],
        leading=opt["section_font_size"] * 1.35, spaceAfter=14)
    marked_item_style = ParagraphStyle("nmi", parent=vocab_marked_style, spaceBefore=2)
    # 三栏单元格：正文顺序、每格只放被标注原文；黄色高亮由 PDF 注释提供，
    # 页面不再铺底色以避免双层叠加；underline 类型保留下划线以区分原标注类型
    cell_style = ParagraphStyle(
        "nac", parent=body_style, fontSize=fs - 1, leading=(fs - 1) * 1.5)

    story: List[Any] = []
    boxes: list = []  # (页号, 矩形, 批注条目)，由 _TaggedParagraph.draw() 收集
    if opt["show_title"]:
        story.append(Paragraph(markup(part.get("title") or ""), section_style))

    if kind == "annotations":
        # 列优先（与网页三栏一致）：先从上到下填满第一列，再第二、第三列
        per = max(1, math.ceil(len(items) / 3))
        cols = [items[c * per:(c + 1) * per] for c in range(3)]

        def cell(it: Optional[dict]) -> Any:
            if not it:
                return ""
            body = markup(_normalize_text(it.get("text") or ""))
            text = f"<u>{body}</u>" if it.get("type") == "underline" else body
            return _TaggedParagraph(text, cell_style, it, boxes, page_h)

        rows = [[cell(cols[c][r]) if r < len(cols[c]) else "" for c in range(3)]
                for r in range(per)]
        gap = opt["annotation_col_gap"]
        table = Table(rows, colWidths=[frame_w / 3] * 3, splitByRow=1)
        table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), gap),
            ("RIGHTPADDING", (0, 0), (-1, -1), gap),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LINEAFTER", (0, 0), (1, -1), 0.4, Color(0.92, 0.93, 0.95)),
        ]))
        story.append(table)
    elif kind == "marked":
        for it in items:
            label = f"#{int(it['noteIndex']) + 1}  {_normalize_text(it.get('vocab') or '')}"
            story.append(Paragraph(markup(label), marked_item_style))
    elif kind == "favorites":
        # 收藏的句子：每条只展示英文 + 中文，按 block_gap 分隔；词汇列表不输出
        for it in items:
            eng = _normalize_text(it.get("english") or "")
            chs = _normalize_text(it.get("chinese") or "")
            if eng:
                story.append(Paragraph(markup(eng), body_first_style))
            if chs:
                story.append(Paragraph(markup(chs), body_style))
    else:  # notes：原有整篇排版，含 marks 标红
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
    pdf = buf.getvalue()
    if kind == "annotations":
        pdf = _attach_highlight_notes(pdf, boxes, opt["annotation_bg_color"])
    return pdf


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
def export_note_parts(article: Any, options: Optional[dict] = None) -> List[dict]:
    """
    生成笔记侧的各**独立 PDF 片段**（每份从新页开始）。

    :param article: {"title","notes","marks","annotations","content"}，也可直接传笔记字符串
    :param options: 见 DEFAULTS
    :return: [{"key","title","kind","pdf"}]，顺序为批注 / 重点 / 句子 / 笔记全文，
             只含有内容的片段。服务层把正文片段插到「句子」与「笔记全文」之间，
             再按各片段页数累加写出一级书签。
    """
    payload = article if isinstance(article, dict) else {"notes": article}
    opt = {**DEFAULTS, **_pick_options(options)}
    parts = _build_parts(payload)
    for part in parts:
        part["pdf"] = _layout_part(part, opt, payload.get("marks"))
    return parts


def export_notes_to_pdf(article: Any, options: Optional[dict] = None) -> bytes:
    """命令行 / 独立使用：把各片段顺序合成一份 PDF；没有任何内容时返回 b""。"""
    pdfs = [p["pdf"] for p in export_note_parts(article, options) if p.get("pdf")]
    return merge_pdfs(pdfs) if pdfs else b""


def merge_pdfs(parts: List[bytes]) -> bytes:
    """
    按顺序把多份独立 PDF 片段合并成一份（每份整页搬移，各自从新页开始）。

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
