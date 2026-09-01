"""
pdf_export.py — 文章正文 + 阅读器批注导出 PDF

排版：reportlab（Paragraph，TA_JUSTIFY 两端对齐）
标注：PyMuPDF 读取排版后的真实字符位置，写入 Highlight / Underline 注释

采用「排版引擎排版 + PDF 库读回坐标」两阶段，而不是自己逐词定位：
  1. reportlab 的 TA_JUSTIFY 是成熟的两端对齐实现，段落末行不拉伸（排版惯例）；
  2. 自己逐词 insert_text 会让每个词成为独立文本片段，复制出来会逐词换行；
     reportlab 输出的是连续文本流，复制到别处仍是正常段落；
  3. 排版后用 PyMuPDF 读回每个字符的真实位置（含基线）与页码，
     据此生成注释，位置精确且天然支持跨页。

与参考项目（pdf-export）的关键差异 —— 批注定位方式：
  参考项目的标注是「单词/短语词表」，后端需要在词序列上重新匹配所有出现位置；
  本项目的批注自带 (paragraphIndex, startOffset, endOffset)，是**精确坐标**，
  因此不需要任何匹配算法，只需把「段内字符偏移」映射到「PDF 字符」即可。
  映射靠「非空白字符序列」对齐完成，天然免疫 reportlab 对空白的合并/丢弃。

命令行：
  python pdf_export.py --input article.json --out article.pdf
  # --input 省略则从 stdin 读；--out 省略则输出到 stdout

模块调用：
  from pdf_export import export_article_to_pdf
  data = export_article_to_pdf({'title':..., 'content':..., 'annotations':[...]})
"""
import argparse
import io
import json
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

import fitz  # PyMuPDF
from reportlab.lib.colors import Color
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph

# 下划线的粗细与位置（单位 pt，相对基线）。见 _set_underline_appearance 的说明
#
# 数值关系：线覆盖 [gap - w/2, gap + w/2]，而 11pt 字号的下伸部（p/g/y）约 2.31pt。
# 要留出约 0.4pt 的视觉间隙，须满足  gap - w/2 >= 2.31 + 0.4 = 2.71。
# 当前 w=1.2 / gap=3.3 -> 线上缘 2.70pt，与下伸部留 ~0.39pt。
UNDERLINE_WIDTH_PT = 1.2   # 线宽（BBox==Rect 修复后不再被放大，此即真实粗细）
UNDERLINE_GAP_PT = 3.3     # 线中心相对基线的偏移（随线宽下移，避免接触下伸字母 g/p/y）

# ---------------------------------------------------------------- 默认配置
DEFAULTS: Dict[str, Any] = {
    "page_size": "a4",              # a4 / letter
    "body_font": "Helvetica",       # reportlab 内置字体名
    "cjk_font": "STSong-Light",     # reportlab 内置 CID 中文字体（无需外部字体文件）
    "font_size": 11,
    "line_height": 1.6,
    "title_font_size": 18,
    "margin_x": 56,                 # 左右边距 ≈ 2cm
    "margin_top": 64,
    "margin_bottom": 60,
    "paragraph_gap": 10,
    "show_title": True,
    "mark_highlight": True,         # highlight 批注 -> PDF Highlight 注释
    "mark_underline": True,         # underline 批注 -> PDF Underline 注释
    "with_contents": True,          # 把批注的 note 写进注释内容
    "underline_width": UNDERLINE_WIDTH_PT,  # 下划线线宽（pt），见 _set_underline_appearance
    "author": "LanguageLearning",
}

CJK_RE = re.compile(r"[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]")
# 连续的 CJK 段（含 CJK 标点/全角字符）
CJK_RUN_RE = re.compile(r"[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]+")
HEX_COLOR_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")

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

    为什么不做「含中文就整体切换字体」：
      内置 CID 字体（STSong-Light）的字符宽度度量与实际渲染不一致
      （实测同一串 ASCII：Helvetica 111.87pt vs STSong-Light 95.25pt），
      一旦整体切换，reportlab 按错误度量排版，**纯英文正文也会差 4~8pt 对不齐右边界**。
      本项目正文是英文外刊、中文只零星出现，按段混排可以让英文部分仍由
      Helvetica 排版（度量准确、两端对齐精确），仅中文段用 CID 字体。
    """
    return CJK_RUN_RE.sub(lambda m: f'<font name="{cjk_font}">{m.group(0)}</font>', t)


def _normalize_text(t: Any) -> Any:
    """
    把排版字体可能缺字形的特殊连字符统一为 ASCII 连字符，避免 PDF 出现黑框（tofu）。
    这些字符在屏幕上显示正常、数据库里也正常，只有导出 PDF 才会变黑框。

    必须同时作用于正文与批注文本，否则两边字符不一致会导致批注匹配失败或位置错位。
    """
    if not isinstance(t, str):
        return t
    return (t
            .replace("\u2010", "-")   # hyphen
            .replace("\u2011", "-")   # non-breaking hyphen（网页复制最常见）
            .replace("\u2012", "-")   # figure dash
            .replace("\u00ad", ""))   # soft hyphen：仅断词提示，直接删除


def _is_ws(s: str) -> bool:
    return not s.strip()


def _hex_to_rgb(color: Any) -> Optional[Tuple[float, float, float]]:
    """#FFEB3B -> (1.0, 0.921, 0.231)；无法识别返回 None。"""
    if not isinstance(color, str):
        return None
    m = HEX_COLOR_RE.match(color.strip())
    if not m:
        return None
    v = int(m.group(1), 16)
    return ((v >> 16 & 255) / 255.0, (v >> 8 & 255) / 255.0, (v & 255) / 255.0)


def _parse_annotations(v: Any) -> List[dict]:
    if not v:
        return []
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            return []
    return [x for x in v if isinstance(x, dict)]


# ---------------------------------------------------------------- 阶段一：排版
def _layout(title: str, paragraphs: List[str], opt: Dict[str, Any]) -> bytes:
    """用 reportlab 排版（两端对齐），返回 PDF bytes。"""
    if opt["page_size"] == "letter":
        page_w, page_h = letter
    else:
        page_w, page_h = A4

    left = opt["margin_x"]
    frame_w = page_w - left * 2
    frame_h = page_h - opt["margin_top"] - opt["margin_bottom"]

    # 中文按需注册内置 CID 字体（无需外部字体文件），并按字符段混排，
    # 不整体替换正文西文字体（原因见 _markup_cjk 的说明）
    cjk_font = opt["cjk_font"]
    has_cjk = any(CJK_RE.search(s) for s in [title, *paragraphs])
    cjk_ok = has_cjk and _ensure_cjk(cjk_font)

    def markup(t: str) -> str:
        esc = _esc(t)
        return _markup_cjk(esc, cjk_font) if cjk_ok else esc

    body_font = opt["body_font"]

    buf = io.BytesIO()
    doc = BaseDocTemplate(buf, pagesize=(page_w, page_h),
                          leftMargin=0, rightMargin=0, topMargin=0, bottomMargin=0)
    # Frame 默认有 6pt 内边距，会让版心偏离设定值、右边界对不齐，必须显式置 0
    frame = Frame(left, opt["margin_bottom"], frame_w, frame_h, id="f",
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame])])

    story: List[Any] = []
    fs = opt["font_size"]

    if opt["show_title"] and title:
        story.append(Paragraph(markup(title), ParagraphStyle(
            "t", fontName=body_font, fontSize=opt["title_font_size"],
            leading=opt["title_font_size"] * 1.32, spaceAfter=12)))

    body_style = ParagraphStyle(
        "b", fontName=body_font, fontSize=fs, leading=fs * opt["line_height"],
        alignment=TA_JUSTIFY, spaceAfter=opt["paragraph_gap"])

    for p in paragraphs:
        story.append(Paragraph(markup(p), body_style))

    if not story:  # 防止空文档报错
        story.append(Paragraph(" ", body_style))

    doc.build(story)
    return buf.getvalue()


# ---------------------------------------------------------------- 阶段二：读回位置
def _read_chars(doc) -> List[dict]:
    """
    读取每个字符的真实渲染位置。

    rawdict 中字符的 bbox 是「字体度量框」（含 ascender/descender 空间），
    同一行所有字符的 bbox 上下边界相同；span["origin"][1] 才是**基线**。
    因此下划线/高亮都基于基线定位，避免被下伸字母（p/g/y）拉偏。

    空格字符也一并读回 —— 它们参与区间跨度（批注覆盖了空格时区间要连起来）。
    """
    out: List[dict] = []
    for pno in range(doc.page_count):
        rd = doc[pno].get_text("rawdict")
        for blk in rd.get("blocks", []):
            if blk.get("type") != 0:
                continue
            for line in blk.get("lines", []):
                for span in line.get("spans", []):
                    bl = span["origin"][1]  # 基线
                    for ch in span.get("chars", []):
                        c = ch.get("c", "")
                        if not c:
                            continue
                        bb = ch.get("bbox")
                        if not bb:
                            continue
                        out.append({"page": pno, "x0": bb[0], "x1": bb[2],
                                    "bl": bl, "c": c})
    return out


def _drop_head(chars: List[dict], n: int) -> List[dict]:
    """跳过前 n 个非空白字符（用于把标题/副标题排除在批注之外）。"""
    if n <= 0:
        return chars
    cnt = 0
    for i, c in enumerate(chars):
        if not c["c"].isspace():
            cnt += 1
            if cnt > n:
                return chars[i:]
    return []


def _nw(text: str) -> List[Tuple[int, str]]:
    """段落文本的非空白字符序列：[(段内偏移, 字符), ...]"""
    return [(i, ch) for i, ch in enumerate(text) if not ch.isspace()]


def _map_chars(chars: List[dict], paragraphs: List[str], window: int = 4000):
    """
    把读回的字符序列按段落对齐，给每个字符打上 (段号, 段内偏移) 标签。

    为什么用「非空白字符序列」而不是整串匹配：
      reportlab 会合并连续空格、去掉段首尾空白，但**不会增删非空白字符**。
      因此去掉所有空白后两边必然严格一致，对齐不受空白差异影响。

    返回 (mapping, failed)：
      mapping[i] = (段号, 段内偏移) 或 None（该字符未对齐，通常是空白字符）
      failed = 未能对齐的段号列表（局部失败不影响其他段的批注）
    """
    nw_idx = [i for i, c in enumerate(chars) if not c["c"].isspace()]
    mapping: List[Optional[Tuple[int, int]]] = [None] * len(chars)
    failed: List[int] = []

    k = 0  # 已消费的非空白字符数
    for pno, text in enumerate(paragraphs):
        seq = _nw(text)
        if not seq:
            continue
        want = "".join(ch for _, ch in seq)
        n = len(seq)

        def take(start: int) -> bool:
            if start + n > len(nw_idx):
                return False
            return "".join(chars[nw_idx[start + j]]["c"] for j in range(n)) == want

        if take(k):
            start = k
        else:
            # 局部错位：在有限窗口内向后找该段的起始位置
            start = -1
            limit = min(len(nw_idx) - n, k + window)
            for s in range(k, max(k, limit) + 1):
                if take(s):
                    start = s
                    break
            if start < 0:
                failed.append(pno)
                continue

        for j in range(n):
            mapping[nw_idx[start + j]] = (pno, seq[j][0])
        k = start + n

    return mapping, failed


def _build_para_index(mapping: List[Optional[Tuple[int, int]]]) -> Dict[int, List[Tuple[int, int]]]:
    """
    按段号建索引：段号 -> [(段内偏移, 字符下标), ...]（按段内偏移升序）。
    批注只需在自己的段里做一次区间查找，避免每条批注全量扫描。
    """
    idx: Dict[int, List[Tuple[int, int]]] = {}
    for ci, m in enumerate(mapping):
        if m is None:
            continue
        idx.setdefault(m[0], []).append((m[1], ci))
    for lst in idx.values():
        lst.sort()
    return idx


def _range_of(lst: List[Tuple[int, int]], start: int, end: int) -> List[Tuple[int, int]]:
    """在升序列表里取 offset ∈ [start, end) 的项（二分定位起点）。"""
    import bisect
    i = bisect.bisect_left(lst, (start, -1))
    out = []
    while i < len(lst) and lst[i][0] < end:
        out.append(lst[i])
        i += 1
    return out


# ---------------------------------------------------------------- 阶段三：几何聚合
def _annotation_geometry(chars: List[dict],
                         para_index: Dict[int, List[Tuple[int, int]]],
                         ann: dict) -> List[Tuple[int, float, float, float]]:
    """
    把一条批注的 (段号, 起始偏移, 结束偏移) 转成几何区间列表。

    返回 [(页码, 基线, x0, x1), ...] —— 同一页同一行合并成一个连续区间。

    与参考项目不同：参考项目靠「间隙容差」猜测哪些词属于同一条标注，
    本项目批注自带精确字符范围，直接按 (页码, 基线) 分组取 min/max 即可，
    既不会误合并，也不会漏合并跨行的部分。
    """
    pno = ann.get("_para")
    start, end = ann.get("_start", 0), ann.get("_end", 0)
    if end <= start:
        return []

    items = _range_of(para_index.get(pno, []), start, end)
    if not items:
        return []

    by_line: Dict[Tuple[int, int], List[float]] = {}
    for _off, ci in items:
        c = chars[ci]
        key = (c["page"], round(c["bl"] * 10))  # 0.1pt 量化，容忍浮点误差
        cur = by_line.get(key)
        if cur is None:
            by_line[key] = [c["x0"], c["x1"]]
        else:
            if c["x0"] < cur[0]:
                cur[0] = c["x0"]
            if c["x1"] > cur[1]:
                cur[1] = c["x1"]

    return [(page, bl_key / 10.0, xs[0], xs[1])
            for (page, bl_key), xs in sorted(by_line.items(), key=lambda kv: (kv[0][0], kv[0][1]))]


def _set_underline_appearance(doc, annot, page_h: float,
                              items: List[Tuple[float, float, float]],
                              rgb: Tuple[float, float, float],
                              width: float = UNDERLINE_WIDTH_PT,
                              gap: float = UNDERLINE_GAP_PT) -> None:
    """
    重写下划线注释的 /AP/N 外观流，自定义线宽与位置。

    为什么必须自己重写：
      PyMuPDF 按「线宽 = rect 高度 / 18」生成外观流 —— 实测 1.36pt 高的 rect
      只得 0.075pt 的线，几乎不可见；想得到 1pt 的线就要把 rect 撑到 18pt 高，
      而 rect 同时是鼠标热区，会盖住上一行文字。
      且 set_border() 对 Underline 无效（只打印 "Cannot set border" 警告，不写 /BS），
      没有 /BS 时阅读器一律按 /AP 外观流渲染 —— 所以只能改外观流。

    做法：rect 保留为合理热区（基线下方 1~4pt，不会与相邻行冲突），
    线的粗细与位置完全由这里生成的内容流决定，两者解耦。

    :param items:   [(x0, x1, 基线), ...]，top-based 坐标
    :param width:   线宽（pt）
    :param gap:     线中心相对基线的偏移（pt），需避开下伸字母 p/g/y
    """
    obj = doc.xref_object(annot.xref)
    m = re.search(r"/AP\s*<<(.*?)>>", obj, re.S)
    if not m:
        return
    nm = re.search(r"/N\s+(\d+)\s+0\s+R", m.group(1))
    if not nm:
        return
    n_xref = int(nm.group(1))

    r, g, b = rgb
    seg: List[str] = []
    for x0, x1, bl in items:
        y = page_h - (bl + gap)  # top-based -> bottom-based（PDF 原生坐标）
        seg.append(f"{x0:.3f} {y:.3f} m\n{x1:.3f} {y:.3f} l")
    # 所有线段作为子路径，末尾一次 S 全部描边
    stream = (f"{r:.3f} {g:.3f} {b:.3f} RG\n{width} w\n"
              + "\n".join(seg) + "\nS\n")
    doc.update_stream(n_xref, stream.encode("latin1"))

    # BBox 必须与注释的 /Rect 完全重合（同为绝对页面坐标、bottom-based）。
    #
    # 关键：PDF 阅读器渲染注释外观时，会把 /AP/N 的 BBox 缩放 + 平移映射到注释的
    # /Rect 上（PDF 规范 12.5.5），映射为 scaleY = Rect.h / BBox.h。
    # 若 BBox 只紧紧包住线本身（远矮于 Rect），内容会被纵向拉伸且整体上移：
    #   单行：Rect.h 3.38 / BBox.h 1.60 ≈ 2.11 倍 —— 线被拉粗到 ~1.27pt、抬到 +2.50pt
    #   跨行：Rect.h 20.98 / BBox.h 19.20 ≈ 1.09 倍 —— 几乎不缩放，与单行粗细不一致
    # 于是「跨行线比单行细」，且跨行首段被抬到下伸部、贴住文字底部。
    # 令 BBox == Rect，映射退化为恒等变换，线宽与位置才与内容流一致。
    ar = annot.rect
    bbox = [ar.x0, page_h - ar.y1, ar.x1, page_h - ar.y0]
    doc.xref_set_key(n_xref, "BBox",
                     "[" + " ".join(f"{v:.3f}" for v in bbox) + "]")


# ---------------------------------------------------------------- 主流程
def export_article_to_pdf(article: dict, options: Optional[dict] = None) -> bytes:
    """
    导出文章为 PDF：reportlab 两端对齐排版 + PyMuPDF 写入批注注释。

    :param article: {"title", "content", "annotations"}
        annotations 元素：{"paragraphIndex","startOffset","endOffset","type","color","note"}
    :param options: 见 DEFAULTS
    :return: PDF 文件字节
    """
    opt = {**DEFAULTS, **(options or {})}

    title = _normalize_text((article.get("title") or "").strip())
    content = _normalize_text(article.get("content") or "")
    # 与前端 ArticlePage.paragraphs 保持一致的切分规则
    paragraphs = [ln for ln in content.split("\n") if ln.strip()]

    raw_anns = _parse_annotations(
        opt.get("annotations") if opt.get("annotations") is not None
        else article.get("annotations")
    )

    def clean(value):
        if isinstance(value, str):
            return _normalize_text(value)
        if isinstance(value, list):
            return [clean(x) for x in value]
        if isinstance(value, dict):
            return {k: clean(v) for k, v in value.items()}
        return value

    anns = clean(raw_anns)

    fs = opt["font_size"]

    # 1) 排版（两端对齐）
    pdf_bytes = _layout(title, paragraphs, opt)

    # 2) 读回真实字符位置
    doc = fitz.open(stream=pdf_bytes)
    chars = _read_chars(doc)
    if not chars:
        out = doc.tobytes(garbage=3, deflate=True)
        doc.close()
        return out

    # 3) 标题不参与批注：跳过它贡献的非空白字符
    if opt["show_title"] and title:
        chars = _drop_head(chars, len(_nw(title)))

    # 4) 段落对齐：给每个字符打上 (段号, 段内偏移)
    mapping, failed = _map_chars(chars, paragraphs)
    failed_set = set(failed)
    para_index = _build_para_index(mapping)

    # 5) 逐条批注生成注释
    skipped = 0
    for ann in anns:
        a_type = (ann.get("type") or "").lower()
        if a_type == "highlight" and not opt["mark_highlight"]:
            continue
        if a_type == "underline" and not opt["mark_underline"]:
            continue
        if a_type not in ("highlight", "underline"):
            continue

        pno = ann.get("paragraphIndex")
        start = ann.get("startOffset")
        end = ann.get("endOffset")
        if not isinstance(pno, int) or not isinstance(start, int) or not isinstance(end, int):
            skipped += 1
            continue
        if pno in failed_set:
            skipped += 1
            continue

        ann["_para"], ann["_start"], ann["_end"] = pno, start, end
        geo = _annotation_geometry(chars, para_index, ann)
        if not geo:
            skipped += 1
            continue

        # 跨行/跨页：按页聚合成**一条**注释，多矩形 = 多个 QuadPoints（与 Acrobat 一致）
        by_page: Dict[int, List[Tuple[float, float, float]]] = {}
        for page, bl, x0, x1 in geo:
            by_page.setdefault(page, []).append((x0, x1, bl))

        # 下划线线宽/位置（本条批注统一），rect 需按此计算以包住线
        u_w = float(opt.get("underline_width") or UNDERLINE_WIDTH_PT)
        u_gap = UNDERLINE_GAP_PT

        for page, items in by_page.items():
            pg = doc[page]  # 重新取页对象（缓存的 Page 在增删页后会失效）
            if a_type == "highlight":
                # 覆盖 x-height 到基线下方一点
                rects = [fitz.Rect(x0, bl - 0.80 * fs, x1, bl + 0.24 * fs)
                         for x0, x1, bl in items]
                annot = pg.add_highlight_annot(rects)
            else:
                # rect 只作鼠标热区，但**必须完整包住线**：
                # /BBox 已与 /Rect 重合（见 _set_underline_appearance），BBox 容不下
                # 线宽就会被阅读器裁掉一半，因此这里按 gap ± (w/2 + pad) 动态取值。
                # 仍远在下一行文字上方（行距 fs*1.6，下一行字顶约在基线下方 9.7pt），不冲突。
                pad = u_w / 2 + 0.3
                rects = [fitz.Rect(x0, bl + u_gap - pad, x1, bl + u_gap + pad)
                         for x0, x1, bl in items]
                annot = pg.add_underline_annot(rects)

            # 用批注自身颜色；无法识别时回退到阅读器里的默认色
            rgb = _hex_to_rgb(ann.get("color"))
            if rgb is None:
                rgb = (1.0, 0.922, 0.231) if a_type == "highlight" else (0.906, 0.298, 0.235)
            annot.set_colors(stroke=rgb)
            if a_type == "highlight":
                annot.set_opacity(0.55)

            note = (ann.get("note") or "").strip()
            if opt["with_contents"] and note:
                annot.set_info(title=opt["author"], content=note)
            else:
                annot.set_info(title=opt["author"])
            annot.update()

            # update() 生成 /AP 之后才能重写外观流（顺序不可颠倒）
            if a_type == "underline":
                _set_underline_appearance(
                    doc, annot, pg.rect.height, items, rgb,
                    width=u_w, gap=u_gap,
                )

    out = doc.tobytes(garbage=3, deflate=True)
    doc.close()
    return out


# ---------------------------------------------------------------- 命令行
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="把文章正文 + 批注导出为 PDF（两端对齐 + 标注注释）")
    ap.add_argument("--input", help="文章 JSON 文件路径；省略则从 stdin 读取")
    ap.add_argument("--out", help="输出 PDF 路径；省略则输出到 stdout")
    ap.add_argument("--no-highlight", action="store_true", help="不导出高亮批注")
    ap.add_argument("--no-underline", action="store_true", help="不导出下划线批注")
    args = ap.parse_args(argv)

    raw = open(args.input, "r", encoding="utf-8").read() if args.input else sys.stdin.read()
    article = json.loads(raw)

    opts = {}
    if args.no_highlight:
        opts["mark_highlight"] = False
    if args.no_underline:
        opts["mark_underline"] = False

    data = export_article_to_pdf(article, opts)

    if args.out:
        with open(args.out, "wb") as f:
            f.write(data)
        print(f"已导出：{args.out}（{len(data)} 字节）", file=sys.stderr)
    else:
        sys.stdout.buffer.write(data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
