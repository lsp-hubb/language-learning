# PDF 导出功能

把「文章正文 + 阅读器批注」导出为 PDF：正文是**可选中、可搜索、可复制的真实文本**，
阅读器里的高亮/下划线批注以 **PDF 标准标记注释**（Highlight / Underline）写入，
在 Acrobat / Edge / Firefox 中悬浮即可看到批注内容。

文章有笔记时，会**额外排一份笔记 PDF 追加在正文之后**（详见第十节）。

---

> ⚠️ 运行环境：5057 需要 Python 虚拟环境装有 `fastapi` / `uvicorn` / `PyMuPDF` / `reportlab`。
> 换机后若 venv 是新建的、尚未安装这些包，服务能启动但 `/health` 返回 `ok:false`、导出接口返回 500。
> 安装：`pip install fastapi "uvicorn[standard]" PyMuPDF reportlab`（详见 `docs/python-env.md`）。

## 一、架构

```
┌──────────────────────────────────────────┐
│  ArticleToolbar.vue                      │
│    └─ PdfExportButton.vue   [●] [图标]    │
│         ● 绿=服务已连接  ● 红=未启动       │
│         ● 黄闪=检测中                      │
└───────────────┬──────────────────────────┘
                │ 服务在线才能导出（无浏览器端回退）
                ▼
   ┌────────────────────────────┐
   │ server/pdf_service.py:5057 │  FastAPI 封装
   └───────────┬────────────────┘
               ▼
   ┌────────────────────────────────────────────────┐
   │ server/pdf_export.py                            │
   │                                                 │
   │  阶段一 排版  reportlab Paragraph + TA_JUSTIFY   │
   │          → 连续文本流，两端对齐，末行不拉伸       │
   │                        ↓ PDF bytes              │
   │  阶段二 读回  PyMuPDF get_text("rawdict")        │
   │          → 每个字符的真实位置（含基线）与页码     │
   │                        ↓                        │
   │  阶段三 映射  按「非空白字符序列」对齐           │
   │          → 每个字符打上 (段号, 段内偏移) 标签     │
   │                        ↓                        │
   │  阶段四 注释  按批注偏移量取字符 → 按行合并       │
   │          → add_highlight_annot / add_underline   │
   └────────────────────────────────────────────────┘
                        ↓  服务层：5 个独立片段按序整页合并（每个都从新页开始）
                        ↓  _add_navigation() 写 5 个一级书签
                   最终 application/pdf
```

### 为什么是两阶段，而不是一步到位

自己逐词 `insert_text` 有两个硬伤：

1. **复制出来逐词换行** —— 每个 `insert_text` 生成独立的 `BT/ET` 文本块，
   阅读器按块边界插入换行，粘到 Word 会变成竖排一堆单词。
2. **两端对齐要自己实现** —— 需要自己算每行剩余空间、分配到空格、处理末行不拉伸，
   等于重写排版引擎。

让排版引擎（reportlab）负责排版，PDF 库（PyMuPDF）只读回几何信息做标注，
两边都用最擅长的部分。

> 补充：PyMuPDF 的 `fill_textbox(justify=True)` 对**含 `\n` 的文本不拉伸**，
> 所以「自己断行 + 让它拉伸」这条路也走不通。

---

## 二、文件清单

| 路径 | 作用 |
|------|------|
| `server/pdf_export.py` | **核心**：reportlab 排版 + PyMuPDF 写注释（两阶段）—— 只管正文 + 批注 |
| `server/notes_pdf_export.py` | 笔记单独排版成 PDF，并提供 `merge_pdfs()` 与正文 PDF 合并 |
| `server/pdf_service.py` | FastAPI 服务，端口 **5057**，负责「正文 + 笔记」两份 PDF 的合并 |
| `src/components/PdfExportButton.vue` | 前端导出按钮，含服务状态指示灯 |

接入点：
- `src/components/ArticleToolbar.vue` — 工具栏「笔记」按钮后挂载 `PdfExportButton`
- `src/views/ArticlePage.vue` — 向工具栏传 `:article` 与 `:annotations`（当前文章与全部批注）
- `scripts/start-all.py` / `scripts/stop-all.py` — 拉起 / 停止 5057
- `scripts/restart-pdf.py` — 只重启 5057（改了 `server/*.py` 后用它，见第十节）

---

## 三、与参考项目（pdf-export）的关键差异

参考项目提供了技术路径，但两边的标注数据结构不同，定位方式必须重新设计。
**接口不能照搬。**

| 维度 | 参考项目 | 本项目 |
|------|---------|--------|
| 标注数据 | `words` / `phrases` 全局词表 | `annotations`，含 `(paragraphIndex, startOffset, endOffset)` |
| 定位方式 | 后端在词序列上重新**匹配**所有出现 | 按偏移量**直接定位**，不需要匹配算法 |
| 同行合并 | 靠「间隙容差」猜测哪些词属于同一条标注 | 批注自带精确字符范围，按 `(页码, 基线)` 分组取 min/max |
| 注释内容 | 音标 / 词性 / 释义 | 用户手写的 `note` |
| 标注颜色 | 固定两色 | 取批注自身的 `color` |
| 标题 | title + subtitle | 仅 title（articles 表无 subtitle 字段） |
| 中文处理 | 含中文就整体切 CID 字体 | **按字符段混排**（见下），英文正文仍用 Helvetica |
| 回退链路 | jsPDF 浏览器端（546 行） | **不实现**，服务未启动时明确提示 |

### 为什么不做 jsPDF 回退

1. jsPDF 无两端对齐，也无 `add_highlight_annot` / `add_underline_annot` API，
   需手工拼 `/Annots` 字典与 `/AP` 外观流；
2. 更关键的是：本项目的批注靠**段内字符偏移**定位，浏览器端方案必须先自己完成排版
   才能知道字符坐标 —— 等于在浏览器里重写一遍 reportlab，而重写出来的还是左对齐版本。

与其维护 500+ 行低质量的回退代码，不如让按钮明确提示「服务未启动」。
生产环境保证 5057 常驻即可（已接入 `start-all.py`）。

### 画布笔迹不导出

`canvas_strokes` 的坐标是**相对阅读容器的屏幕像素**（容器高度为 `scrollHeight`），
而 PDF 是分页的、版心宽度与行断点都不同，两者不存在可换算的映射关系
（同一条线在屏幕上跨 3 行，在 PDF 里可能跨 5 行）。
强行按比例缩放必然错位，故不导出笔迹。

---

## 四、接口

### `GET /health`

```bash
curl http://127.0.0.1:5057/health
# {"ok":true,"engine":"pymupdf","version":"1.28.2"}   # 版本随 venv 实际安装变化
```

`ok:false` 表示 PyMuPDF 未安装（此时导出接口返回 500）。

### `POST /api/export-pdf`

```json
{
  "title": "文章标题",
  "content": "正文纯文本（\\n 分段）",
  "notes": "笔记生文本（纯文本）",
  "marks": {"0__词组": true},
  "favorites": [
    {"english": "被收藏的英文句子", "chinese": "对应的中文译文", "vocabItems": ["vocab1"]}
  ],
  "annotations": [
    {
      "paragraphIndex": 0,
      "startOffset": 4,
      "endOffset": 26,
      "type": "highlight",
      "color": "#FFEB3B",
      "text": "被标注的原文（笔记 PDF「批注」节显示）",
      "note": "注释内容"
    }
  ],
  "options": {
    "markHighlight": true,
    "markUnderline": true,
    "withContents": true
  }
}
```

`marks`（可选）：**重点标记**，即 `GET /api/articles/:id/marks` 返回的 `data` 对象，
键为 `noteIndex__词汇文本`、值 `true` 表示该项是重点。`PdfExportButton.vue` 在导出前实时读取
（`article` 对象里不含 `marks`），服务把它随整个 payload 交给 `notes_pdf_export`，
后者把笔记 PDF 里对应词组渲染成红色，详见第十节「重点词汇标红（marks）」。
字段缺省 / 读取失败时按普通词汇导出，不阻断导出；它不是 `options` 开关，不参与白名单过滤，
正文导出会忽略该字段。除标红外，值为 `true` 的 marks 还生成产物第 2 个片段「重点」。

`annotations[].text`（可选）：被标注的原文，由 `PdfExportButton.vue` 从批注对象直接带上，
供「批注」节显示；正文 PDF 的 Highlight / Underline 注释仍只用坐标，不依赖它。
缺省时 `notes_pdf_export._annotation_items()` 会按 `(paragraphIndex, startOffset, endOffset)`
从 `content` 回退还原（切段规则与 `pdf_export.export_article_to_pdf()` 一致），
命令行入口因此也能生成批注/重点节。

**选项白名单**（未在列内的键会被丢弃）：

| 前端（驼峰） | 后端（下划线） | 默认 | 说明 |
|-------------|---------------|------|------|
| `markHighlight` | `mark_highlight` | `true` | 高亮批注 → Highlight 注释 |
| `markUnderline` | `mark_underline` | `true` | 下划线批注 → Underline 注释 |
| `withContents` | `with_contents` | `true` | 把 `note` 写进注释内容 |
| `showTitle` | `show_title` | `true` | 是否输出标题 |
| `fontSize` | `font_size` | `12` | 正文字号（pt） |
| `lineHeight` | `line_height` | `1.6` | 行高倍数 |
| `pageSize` | `page_size` | `a4` | `a4` / `letter` |
| `underlineWidth` | `underline_width` | `1.2` | 下划线线宽（pt），见「实现要点 3b」 |
| `includeNotes` | `include_notes` | `true` | 是否把笔记一并导出（无笔记时自动跳过） |
| `annotationsLandscape` | `annotations_landscape` | `true` | 批注章节独立横版（仅「批注」一节旋转页面尺寸，其余章节仍竖版） |

> ⚠️ 前端用驼峰、后端用下划线，**必须**经 `_OPTION_ALIASES` 映射，
> 否则选项会被白名单静默丢弃，表现为「开关无效但导出正常」。
> 新增选项时记得同步 `_ALLOWED_OPTIONS` 与 `_OPTION_ALIASES`。

白名单之外的参数一律丢弃。下面这些只在 `pdf_export.py` 的 `DEFAULTS` 里，
**改它们要直接改代码**（没有对外开关）：

| 常量 | 默认 | 说明 |
|------|------|------|
| `title_font_size` | `18` | 标题字号（pt） |
| `body_font` | `Helvetica` | 正文字体 |
| `cjk_font` | `STSong-Light` | 中文 CID 字体（reportlab 内置） |
| `margin_x` / `margin_top` / `margin_bottom` | `56` / `64` / `60` | 页边距（pt，左右 ≈ 2cm） |
| `paragraph_gap` | `10` | 段间距（pt） |

**响应**：`200` + `application/pdf`

```
Content-Disposition: attachment; filename="___.pdf"; filename*=UTF-8''%E4%B8%AD...
X-Export-Engine: pymupdf
X-Include-Notes: 1
```

`X-Include-Notes`：`1` = 本次产物已附带笔记侧片段（批注 / 重点 / 句子 / 笔记全文任一有内容）；`0` = 一个都没有（`includeNotes` 关闭或笔记导出模块不可用），前端据此提示。即使 `notes` 为空，只要存在批注、重点或收藏句子，也会生成对应片段。
读该头需要在 CORS 里 `expose_headers`（`pdf_service.py` 已开 `["*"]`）。

**产物带 PDF 大纲（书签）导航节**（见「实现要点 8」）：全部为**一级书签**，顺序与页序一致 ——
`批注（N）` → `重点（N）` → `句子（N）` → `文章标题`（空白时 `正文`）→ `笔记全文`，
各自指向该片段的第 1 页；只生成有内容的片段，文章正文片段始终存在。
`PageMode` 设为 `/UseOutlines`，阅读器打开时默认展开书签栏。
注意 `GET /health` 与两个命令行导出入口不经过服务层，产物不带大纲。

失败：

| 状态码 | body | 场景 |
|--------|------|------|
| `400` | `{"ok":false,"error":"正文为空"}` | content 缺失或空白 |
| `400` | `{"ok":false,"error":"请求体必须是 JSON 对象"}` | 请求体不是 JSON 对象（数组 / 字符串 / `null`）或不是合法 JSON |
| `500` | `{"ok":false,"error":"PyMuPDF 未安装：..."}` | 依赖缺失 |
| `500` | `{"ok":false,"error":"导出失败：..."}` | 导出异常 |

> 这条 400 由服务自行解析 body 后判定。不要把签名改回 `payload: dict` ——
> FastAPI 会先做类型校验并直接返回 422，该分支就永远不可达。

### 命令行导出（排错用）

```bash
python server/pdf_export.py --input article.json --out out.pdf
type article.json | python server/pdf_export.py > out.pdf
```

`article.json` 格式同上（不含 `options` 外壳）。

---

## 五、实现要点

### 1. 字符级定位（本项目核心）

批注的 `(paragraphIndex, startOffset, endOffset)` 是**段内字符偏移**，
而 PDF 里字符是按行、按页分布的。要把两者对上：

```
读回字符流 chars（含 page / x0 / x1 / 基线 / 字符）
   ↓  跳过标题贡献的非空白字符（_drop_head）
   ↓  _map_chars：按「非空白字符序列」把字符对齐到段落
   ↓  每个字符获得 (段号, 段内偏移)
   ↓  _build_para_index：按段建索引，批注只查自己那一段
   ↓  _annotation_geometry：取区间内字符，按 (页码, 基线) 分组取 min/max
```

**为什么用「非空白字符序列」对齐**：
reportlab 会合并连续空格、去掉段首尾空白，但**不会增删非空白字符**。
去掉所有空白后两边必然严格一致，对齐天然免疫空白差异。

对齐是**逐段推进**的：某段对不上时，在有限窗口内向后搜索该段起始位置；
仍失败则只跳过该段（`failed` 列表），**不影响其他段的批注**。

### 2. 同行合并

与参考项目不同：批注自带精确字符范围，不需要靠「间隙容差」猜哪些词属于同一条标注。
直接按 `(页码, 基线)` 分组取 `min(x0) / max(x1)`，既不会误合并，也不会漏合并跨行部分。

跨行时**按页聚合成一条注释**，多矩形 = 多个 QuadPoints（与 Acrobat 一致），
不是每行一条注释。

### 3. 注释几何（基于基线，不是 bbox）

`rawdict` 里字符的 `bbox` 是**字体度量框**（含 ascender/descender 预留空间），
同一行所有字符的 bbox 上下边界完全相同；`span["origin"][1]` 才是**基线**。
用 bbox 定位下划线会被 `p`/`g`/`y` 的下伸部拉偏。

高亮是填充色，rect 直接决定视觉区域，不受线宽影响：

```python
# fs = 字号，bl = 基线
Rect(x0, bl - 0.80*fs, x1, bl + 0.24*fs)   # 高亮：覆盖 x-height 到基线下方
```

### 3b. 下划线的粗细：必须自己重写外观流

**下划线不一样。** PyMuPDF 按「线宽 = rect 高度 / 18」生成 `/AP/N` 外观流：

| rect 高度 | 生成的线宽 |
|---|---|
| 1.36pt | **0.075pt** ← 几乎看不见 |
| 2.82pt | 0.156pt |
| 4.50pt | 0.250pt |

初版用了 `Rect(bl+1.0, bl+2.2)`（高 1.2pt），得到 **0.075pt 的线，基本不可见**。
而 rect 同时是鼠标热区 —— 想靠撑高 rect 拿到 1pt 的线，就得把 rect 做到 18pt 高，
热区会盖住**上一行**文字。这条路走不通。

且 `annot.set_border(width=...)` **对 Underline 无效**（只打印
`Cannot set border for 'Underline'.` 警告，不写 `/BS` 字典）；
没有 `/BS` 时阅读器一律按 `/AP` 外观流渲染，所以改 `/BS` 也没用。

**做法：让 rect 与线宽解耦。**

1. rect 只作热区，按 `gap ± (w/2 + 0.3)` 动态计算（`w=1.2` 时高 **1.8pt**、位于基线下方 2.4~4.2pt），不与相邻行冲突；不要写死 `bl+1.0 ~ bl+4.0`；
2. `annot.update()` 生成 `/AP` **之后**，用 `_set_underline_appearance()` 重写
   `/AP/N` 内容流，自己画粗线（顺序不可颠倒）：

```python
# items = [(x0, x1, 基线), ...]，top-based
y = page_h - (bl + gap)          # top-based -> bottom-based（PDF 原生坐标）
stream = f"{r} {g} {b} RG\n{width} w\n" + "\n".join(f"{x0} {y} m\n{x1} {y} l") + "\nS\n"
doc.update_stream(n_xref, stream)
# BBox 必须容得下线宽，否则阅读器会裁掉线的一半
doc.xref_set_key(n_xref, "BBox", "[...]")
```

默认参数（`pdf_export.py` 顶部常量）：

| 常量 | 默认 | 说明 |
|------|------|------|
| `UNDERLINE_WIDTH_PT` | `1.2` | 线宽（pt） |
| `UNDERLINE_GAP_PT` | `3.3` | 线中心相对基线的偏移（pt） |

**两者必须配套调整**：线覆盖 `[gap - w/2, gap + w/2]`，而 12pt 字号的下伸部约 **2.52pt**（11pt 时为 2.31pt），
要留出约 0.4pt 视觉间隙须满足 `gap - w/2 >= 2.92`。改线宽不改 gap，线就会压到 `p`/`g`/`y`。
当前正文默认字号已调到 12pt，上缘间隙收窄到约 **0.18pt**；若想进一步放大正文字号，须同步调大 `UNDERLINE_GAP_PT`（每 +1pt 字号约需 +0.2pt gap），否则下划线会接触下伸部。

实测（w=1.2 / gap=3.3）线覆盖**基线下方 2.70~3.90pt**，12pt 下距下伸部上缘约 **0.18pt** 间隙 ——
既不会压到 `p`/`g`/`y`，也不会因为离文字太远而显得脱节。

> ⚠️ 注释的 `/Rect` 会**按 gap ± (w/2 + 0.3) 动态计算**，以完整包住线。
> 因为 `/BBox` 已与 `/Rect` 重合（见「实现要点 3c」），BBox 容不下线宽就会被裁掉一半 ——
> **不要改回写死的 `bl+1.0 ~ bl+4.0`**。

也可通过选项 `underlineWidth` 覆盖（见「接口」一节的选项表）；但该选项只改线宽，
`gap` 仍取常量，故传 `2.0` 以上时线会轻微接近下伸部（实测 w=2.0 时上缘 +2.22pt）。

> 📌 历史修正：早期注释写「用户反馈原 1.2pt 太粗且贴字，已减半」—— 该结论是在
> `/BBox` 缩放 bug 存在时得出的：当时单行被放大 2.11 倍，设 1.2 实际渲染成 ~2.53pt
> 且被抬到贴字位置。bug 修复后 1.2pt 即真实 1.2pt，故已恢复为 1.2。

### 3c. `/BBox` 必须与 `/Rect` 重合（否则跨行线会变细 + 贴字）

**症状**：跨行的下划线比单行细，且首行那段线抬到了文字底部、压住 `p`/`g`/`y` 的下伸部。

**根因**：内容流写的是**绝对页面坐标**，`/Matrix` 也是单位矩阵，看似「所见即所得」。
但 PDF 规范（12.5.5）规定：阅读器渲染注释外观时，会把 `/AP/N` 的 `/BBox`
**缩放 + 平移映射到注释的 `/Rect`** 上，缩放系数为 `scaleY = Rect.h / BBox.h`。

早期实现把 `/BBox` 设成「刚好包住线本身」的紧框（远矮于 `/Rect`），于是内容被纵向拉伸且整体上移：

| 用例 | Rect.h | BBox.h | scaleY | 后果 |
|------|--------|--------|--------|------|
| 单行 | 3.38 | 1.60 | **2.11** | 线被拉粗到 ~1.27pt、中心抬到 +2.50pt |
| 跨行(2 行) | 20.98 | 19.20 | **1.09** | 几乎不缩放（~0.66pt），与单行粗细不一致 |

单行被放大 2.11 倍、跨行只有 1.09 倍 —— 所以**跨行看起来只有单行的一半粗**；
且跨行时各段被压缩进同一个高矩形，首段从 +3.0 被抬到 ~+1.68pt，正好落进下伸部。
（理论值与 400dpi 像素实测逐项吻合到小数点后两位，可确认。）

**做法**：令 `/BBox` 与注释 `/Rect` **完全重合**（同为绝对页面坐标、bottom-based），
映射即退化为恒等变换，线宽与位置与内容流完全一致：

```python
ar = annot.rect
bbox = [ar.x0, page_h - ar.y1, ar.x1, page_h - ar.y0]   # 注意 top-based -> bottom-based
doc.xref_set_key(n_xref, "BBox", "[...]")
```

> 修复后实测：单行 / 跨行 2 行 / 整段 6 行的线宽与线到基线的距离**彼此一致**，
> 「跨行变细 + 首行贴字」消失。下列读数来自早期线宽 `0.6pt` 的参数组合
> （厚度 **0.54~0.72pt** ≈ 0.6pt + 抗锯齿；中心 **+2.94 ~ +3.02pt**，也不同于
> 当前 `gap=3.3` 的 +3.30pt），属历史数据；当前默认 `1.2pt` 下的数值以第六节为准
> （中心 **+3.30pt**、厚度 **1.26pt**），一致性结论不变，两代数值不要混用。
> 注意 `/BBox` 不要再改回「紧包住线」——那会重新引入缩放。

### 4. 中文字体：按字符段混排

内置 CID 字体（`STSong-Light`）的字符宽度度量**与实际渲染不一致**：

| 同一串 ASCII（`stringWidth`, 11pt） | 值 |
|---|---|
| Helvetica | 111.870 |
| STSong-Light | 95.249 |

一旦「含中文就整体切换字体」，reportlab 按错误度量排版，
**纯英文正文也会差 4~8pt 对不齐右边界**（实测：整体切换时行右边界 531~535，
目标 539.28；改为混排后 16 行全部贴齐到 +0.00）。

本项目正文是英文外刊、中文只零星出现在标题，故改为
**把连续 CJK 段包进 `<font name="STSong-Light">`**，其余保持 Helvetica：

```python
CJK_RUN_RE.sub(lambda m: f'<font name="{cjk_font}">{m.group(0)}</font>', escaped_text)
```

> 注意顺序：先 `_esc()` 转义 `& < >`，再插入 `<font>` 标签（否则标签会被转义掉）。

### 5. 特殊连字符 → 黑框（tofu）

从网页/有道复制的文本常混入 Unicode 连字符家族，PDF 渲染时**找不到字形**变黑框，
而屏幕上和数据库里都正常：

| 字符 | 码点 | 处理 |
|------|------|------|
| non-breaking hyphen | U+2011 | → `-` |
| hyphen | U+2010 | → `-` |
| figure dash | U+2012 | → `-` |
| soft hyphen | U+00AD | **删除**（仅断词提示，不可见） |

`_normalize_text()` 必须同时作用于**正文与批注文本**，
否则两边字符不一致会导致批注匹配不到或位置错位。

**批注偏移的跨端基准必须一致**：批注的 `(paragraphIndex, startOffset, endOffset)`
来自前端 `ArticlePage.paragraphs`，即 `normalizeQuotes(content)` 后按 `\n` 切分的结果。
因此：

1. `PdfExportButton.vue` 导出时把 `content` 先过一遍 `normalizeQuotes()` 再放进 payload
   （其中 `&lsquo;` 等 HTML 实体是**多字符 → 单字符**替换，不归一会让偏移整体错位）；
2. `_normalize_text()` 的三种连字符是等长替换，不影响偏移；U+00AD 是**删除**，
   会缩短段落。`pdf_export.py` 按原始段落记录被删位置（`soft_hyphen_pos`），
   把每条批注的 `startOffset` / `endOffset` 按「该段内小于此偏移的删除数」前移后再定位。

缺了第 2 步，含 soft hyphen 的段落会在 `_map_chars` 里对不齐，导致该段批注被整段跳过。

### 6. HTTP 头只能承载 latin-1

中文标题直接放进 `Content-Disposition: filename=` 会抛 `UnicodeEncodeError` → 500。
用 RFC 5987 双写：ASCII 回退名 + `filename*=UTF-8''<percent-encoded>`（由 `_ascii_filename()` 生成回退名）。
前端优先解析 `filename*`。

文件名先经 `_safe_filename()`：剔除 `\/:*?"<>|` 与换行、**截断到 80 字符**后再拼 `.pdf`。

### 7. `pythonw.exe` 会让 uvicorn 静默崩溃

`pythonw` 下 `sys.stdout` / `sys.stderr` 均为 `None`，uvicorn 配置 logging 时崩溃，
而异常无处输出 —— 表现为**进程静默退出、端口不通**。

两处防护：
- `pdf_service.py` 顶部检测并兜底重定向到 `os.devnull`
- `start-all.py` 用 `python.exe` + `CREATE_NO_WINDOW`（既无窗口又保留可重定向的输出）

### 8. PDF 大纲（导航节）

合并完成后由 `pdf_service.py::_add_navigation()` 在**最终产物**上写 `set_toc()`，
不改动 `pdf_export.py` 的排版 / 注释阶段，也不改动 `notes_pdf_export.py` 的排版函数。

产物由 4 个**独立 PDF 片段**整页拼接，每份都从新的一页开始；书签全部是 level 1，
顺序即片段顺序：

| 顺序 | 条目 | 目标页 | 条件 |
|------|------|--------|------|
| 1 | `批注（N）` | 1 | 有批注条目 |
| 2 | `重点（N）` | 上一片段页数累加 | 有值为 true 的 marks |
| 3 | `句子（N）` | 累加 | 有收藏的句子（`payload.favorites` 非空） |
| 4 | 文章标题（空白时回退 `正文`） | 累加 | 始终 |
| 5 | `笔记全文` | 累加 | 有笔记全文 |

- `export_note_parts()` 返回 `[{key,title,kind,pdf}]`（顺序：批注 → 重点 → 句子 → 笔记全文）；服务层把正文片段插到
  「句子」与「笔记全文」之间，再遍历 `ordered` 用
  `fitz.open(stream=p["pdf"]).page_count` 累加出每个片段的 1-based 起始页 ——
  不再依赖「正文页数 + 1」的假设。
- 每个片段都是独立 PDF，`insert_pdf` 整页搬移，书签指向的必然是该片段首页，
  目录顺序与页序天然一致；无内容的片段直接跳过，不产生空白页。
- 标题经 `_outline_text()` 把控制字符换成空格、折叠连续空白并截断到 120 字符，
  避免阅读器目录里出现断行 / 方框；`set_toc()` 按 UTF-16 写中文标题无问题。
- `set_pagemode("UseOutlines")` 让书签栏默认展开；老版本 PyMuPDF 没有该方法时
  用 `hasattr` 跳过，不影响大纲写入。
- 写大纲需要重新 `tobytes(garbage=3, deflate=True)`，与 `merge_pdfs()` 用同一组参数；
  实测正文的 Highlight / Underline 与三栏的 Highlight 注释及其 `/AP` 外观流均保留。

---

## 六、实测数据

构造用例（3 段长文 + 4 条批注，含 1 条跨行）：

| 项目 | 结果 |
|------|------|
| 两端对齐 | 拉伸行 **16 行全部距右 +0.00pt**，左边界 56.00 |
| 段落末行 | 不拉伸（排版惯例，非 bug） |
| 注释数量 | 4 条批注 → 4 条注释 |
| 覆盖正确性 | 失败 0 |
| 跨行处理 | 1 条注释、2 个 QuadPoints（非 2 条注释） |
| 中文注释内容 | `adj. 易受伤害的`、`n. 预警系统` 正常（UTF-16BE） |
| 中文标题 | 正常，且文件名 RFC 5987 双写正确 |
| `/Popup` | 0（不弹信息框） |
| `/Subtype /Text` | 0（不用便签注释） |
| `/AP` 外观流 | 全部注释均带 |
| 文本可提取 | 3595 字符，可搜索 |

真实文章（`1. The Supreme Court: Roe on the ropes`，3562 字符 / 8 段）导出 2 页，
32 行贴齐，批注精确覆盖 `['justices', 'green-light', 'a']`。

下划线专项（400dpi 渲染 + 内容流核对）：

| 项目 | 结果 |
|------|------|
| 内容流线宽 | `1.2 w`（`UNDERLINE_WIDTH_PT`，BBox bug 修复后即真实粗细） |
| 线相对基线 | 中心 **+3.30pt**，覆盖基线下方 2.70~3.90pt |
| 下伸字母 | 12pt 字号下伸部约 2.52pt（11pt 时为 2.31pt），与线上缘留有约 **0.18pt** 间隙（接近下伸部；正文字号超过约 12.5pt 需调大 `UNDERLINE_GAP_PT`） |
| 热区 | 按 `gap ± (w/2 + 0.3)` 动态计算（w=1.2 时高 1.8pt），不与相邻行冲突 |
| 像素实测 | 厚度 **1.26pt**（1.2pt + 抗锯齿），单行 / 跨行 2 行 / 整段 6 行**完全一致**，无断裂 |
| 线宽可调 | `underlineWidth` 传 `0.6` / `1.2` / `2.0` 均准确生效（实测 0.72 / 1.26 / 2.16pt） |

> ⚠️ 历史坑：早期版本「跨行的下划线变细、且首行贴住文字底部」。
> 根因不是内容流写错，而是**外观流的 `/BBox` 与注释 `/Rect` 不重合** —— 见「实现要点 3c」。

---

## 七、验证时的四个坑（写验证脚本会踩）

1. **`/QuadPoints` 是 bottom-based 坐标**。从 `doc.xref_object()` 读到的原始 y 是
   PDF 原生坐标（原点在左下），而 `annot.rect` / 词坐标是 top-based。
   直接比对会全部错位，必须先 `y_top = page_height - y_raw`。
   （`annot.vertices` 本可避免此问题，但它要求 annot 绑定到 page。）
2. **覆盖判定要用「区间重叠」而非「完全包含」**。PyMuPDF 分词会带上紧邻标点
   （`systems.` 的 bbox 比批注覆盖的字符范围宽约 3pt），包含判定会误报未命中。
3. **别拿 `words[3]` 当基线**。`get_text("words")` 的 y1 是**词 bbox 底边**，
   含下伸部（比基线低约 2.3pt）。核对下划线位置时用它当基线会得出「线在基线上方」
   的错误结论。真实基线要用 `rawdict` 的 `span["origin"][1]`。
4. **`annot.rect` / `annot.type` 在 annot 未绑定 page 时抛异常**
   （`annotation not bound to any page`）。遍历 `page.annots()` 时应**立即**把
   `rect`、`info` 取出来存下，别在循环外再访问 annot 对象。

---

## 八、已知限制

1. **无断词（hyphenation）**：reportlab 的 `hyphenationLang` 依赖未随 pip 包提供的
   `reportlab.lib.hyphen`，行尾长单词不拆分，个别行可能略松散。
2. **无浏览器端回退**：服务未启动时只能提示，不能导出（见第三节的理由）。
3. **服务地址硬编码**：`PdfExportButton.vue` 中 `PDF_SERVICE = 'http://127.0.0.1:5057'`。
4. **画布笔迹不导出**：坐标语义与 PDF 分页不兼容（见第三节）。
5. **大量中文正文时对齐会偏差**：混排方案下含中文的行仍受 CID 字体度量影响，
   但仅影响这些行；纯英文行仍然精确。

---

## 九、维护建议

- 改 `pdf_export.py` 后，务必跑一遍**跨行批注**用例（最容易回归的点）：
  渲染到 400dpi 后逐行量测，确认**单行与跨行的线宽、线到基线的距离彼此一致**
  （曾经因 `/BBox` 与 `/Rect` 不重合，出现「跨行变细 + 首行贴字」，见「实现要点 3c」）。
- **`_set_underline_appearance()` 的 `/BBox` 必须等于注释 `/Rect`**，不要改回「紧包住线」的写法。
- 新增导出选项时，同步 `pdf_service.py` 的 `_ALLOWED_OPTIONS` 与 `_OPTION_ALIASES`。
- 若改了 `_normalize_text()`，确认正文与批注文本都走同一套清洗。
- 端口 5057 需与 `scripts/start-all.py` / `stop-all.py` 保持一致。
- **改下划线粗细**：调 `UNDERLINE_WIDTH_PT` / `UNDERLINE_GAP_PT`，或传 `underlineWidth`
  选项；**不要试图改 rect 高度**来调线宽（见「实现要点 3b」）。
- 改 `notes_pdf_export.py` 的词汇行拆词规则时，同步核对 `_marked_vocab()` 的展开规则：
  两边必须共用 `VOCAB_SEP_RE` / `_WORD_SPACE_RE`，否则重点标记会对不上。
- 改了 `pdf_export.py` / `notes_pdf_export.py` / `pdf_service.py` 后需**重启 5057 服务**才生效（服务启动时会导入模块）。
- 改导航节顺序时同步改 `api_export_pdf()` 里 `ordered` 的拼装顺序与 `export_note_parts()`
  的片段顺序；页码按各片段页数累加，不要退回「正文页数 + 1」的写法（见「实现要点 8」）。
- 改批注/重点节内容 / 顺序时同步核对 `_build_parts()` 的 `key`，片段与一级书签由它一一对应。
- 三栏注释靠 `_TaggedParagraph.draw()` 记录的排版坐标挂载：改三栏布局（列数 / 内边距 /
  表格样式）后要复验注释数是否等于批注数，含**多页表格**与**重复原文**两种用例。
- 新版 PyMuPDF 的 `Annot.set_info()` 要求 annot 仍绑定在 Page 上，
  `_attach_highlight_notes()` 必须保持 `pages` 列表引用，不能用临时 `doc[pno]`。

---

## 十、笔记导出（独立文件 + 合并）

导出时按 5 个片段分别排版、整页拼接，**每个片段都从新的一页开始**：
批注（三栏）→ 重点 → 句子 → 文章正文（含批注注释）→ 笔记全文。
只有有内容的片段才生成（正文片段始终存在），顺序即 PDF 页序，也是五个一级书签的顺序。

### 为什么单独一个文件，而不是改 `pdf_export.py`

| 维度 | 正文导出 | 笔记导出 |
|------|---------|---------|
| 排版目标 | 两端对齐、按字符偏移回填批注 | 清晰可读即可 |
| 字符级定位 | 需要（批注靠段内偏移） | 不需要 |
| 关键细节 | 下划线自绘外观流、`/BBox` 与 `/Rect` 重合、CJK 混排度量 | 无（独立排版，互不影响） |

正文导出链路里有一批靠实测校准的细节（见第六节），牵一发动全身；
笔记只是纯排版，混进去既无收益又有回归风险。

因此笔记走独立文件 `server/notes_pdf_export.py`，**正文导出的任何一行都不改**，
合并只用 PyMuPDF 整页搬移（`insert_pdf`）：页面内容与注释（含 Highlight / Underline
及其 `/AP` 外观流）随页面一起复制，不重新排版、不重新定位。

```
notes+marks+annotations+favorites ─> export_note_parts()
       ├─ 批注.pdf（三栏 Table，每条挂 PDF Highlight 注释）
       ├─ 重点.pdf
       ├─ 句子.pdf
       └─ 笔记全文.pdf
正文 payload ──> pdf_export.export_article_to_pdf() ─> 文章正文.pdf
       ▼
服务层按 1 批注 → 2 重点 → 3 句子 → 4 文章正文 → 5 笔记全文 排序
       ▼  merge_pdfs() 整页搬移 ──> _add_navigation() 写 5 个一级书签 ──> 最终 PDF
```

> `export_note_parts()` 只返回有内容的片段；三者全空时只导出正文（一个书签）。
> `export_notes_to_pdf()` 是命令行 / 独立使用的封装，把各片段顺序合成一份 PDF。
> 所有产物都会经过 `_add_navigation()` 重新打包以写入大纲（见「实现要点 8」），
> 因此**不再与改造前逐字节一致**；页面内容、注释与坐标不变，只是 PDF 对象层被重写。

### 笔记的存储形态

`articles.notes` 只有一种存法：**用户粘贴的纯文本生文本**（后端 `GET /api/articles/:id/notes` 原样返回，`parse_notes_blocks()` 无条件整篇排版）。旧的「特殊结构 / 题型」分支已随相关模块移除。

块切分与前端 `NotePanel.parseRaw` 同源，但后端 `BLOCK_SPLIT_RE` 额外容忍顿号「、」及数字后的空格，并非严格一致；
块内三行依次为：英文原句 / 中文释义 / 词汇行（全角括号包裹，词之间以 `\` 分隔）。

**中英混排的断行**（`_layout` 的 `body_style`）：

笔记正文在「含中文且中文字体注册成功」时启用 `wordWrap="CJK"`。原因是中文没有词间空格，
reportlab 默认只在 ASCII 空白处分行，中英混排的长句放不下时只能退回英文单词之间的空格处断开：

```
…意为“不仅……而且……”，Not        ← 只能在 "Not" 后断，行尾一大片空白
only置于句首时，其引导的分句需部分倒装（will提前）。
```

CJK 模式允许在汉字之间断行，行能被填满；英文仍优先在空格处断
（reportlab 的 `dumbSplit` 会回退寻找空格 / 汉字边界，不会把单词拆成字母）。
纯英文笔记 `cjk_ok` 为假，保持默认断行不变。

**词汇行的输出形态**（`notes_pdf_export._vocab_words` + `_layout`）：

词汇行**不再**拼成「词汇短语：a、b、c」一整段，而是去掉前缀、一个词组一行、行尾加中文句号：

```
the world's richest man。
prepare for。
infinite abundance。
```

原因：reportlab 只在 ASCII 空白处分行，中文顿号「、」不是断点，
原先唯一能换行的位置就是词组内部的空格，于是 `prepare for`、`no longer` 被从中间折断、
行尾参差不齐。逐条输出后词组天然完整；词组内部的多余空白压成单个空格，
极长词组放不下一行时仍在词与词之间折行（整行无断点时 reportlab 会退化成按字符硬拆）。
词汇行渲染成小字灰色（10pt），去掉前缀、括号与反斜杠，一个词组一行、行尾加中文句号。

### 重点词汇标红（marks）

界面里左键单击词汇项标记「重点」（`#ff1f1f` 红色 + 加粗）后，导出 PDF 时对应词组也渲染成红色：

```
PdfExportButton.handleExport()
  ├─ GET /api/articles/:id/marks  → { "0__词组": true, ... }
  └─ POST /api/export-pdf { notes, marks, ... }   → pdf_service.py 原样透传
       └─ notes_pdf_export.export_note_parts()
            ├─ _build_parts()：marks / annotations 生成「重点」「批注」片段
            └─ _layout_part()：
                 ├─ 重点 / 批注：重点词汇红色、三栏表格
                 └─ 笔记全文：_marked_vocab(marks) 逐词组比对，命中改用 vocab_marked_style（红色）
```

- **块索引**：`_layout_part()` 对 `_split_blocks()` 的结果 `enumerate`，与前端 `NotePanel.parseRaw`
  的 `noteIndex`（marks 键前缀）对应。`toggleMark` 取消标记时写的是 `false` 而非删键，
  故 `_marked_vocab()` 只保留真值键。
- **词组对齐**：marks 键里的词汇按与 `_vocab_words()` 相同的分隔符（`\` `/` `|` `｜`）
  / 空白规则展开 —— 前端只按 `\` 分隔，词组内含 `/` 时 PDF 会拆成多行，展开后每一行都能标红。
  比较前两侧都做引号归一（弯引号 / HTML 实体 → 直引号），兼容尚未清洗的旧笔记 / 旧标记。
- **只改颜色**：用 `ParagraphStyle.textColor`，不切粗体。内置 CID 中文字体 `STSong-Light`
  没有 bold 变体，强行加粗会让中英混排的词组一半粗一半细；行尾中文句号 `。` 与词组同色
  （`<font name>` 只改字体名，不影响 textColor）。
- **无 marks 时**：`_marked_vocab()` 返回空 dict，全部词汇仍按小字灰色输出，导出结果与改造前一致。

### 批注（三栏）/ 重点

**批注**是网页三栏列表在 PDF 里的对应物，排在产物最前面：

- 三列 `Table`，列优先填充（`per = ceil(N / 3)`，第 1 列 `items[0:per]`、第 2 列
  `items[per:2per]`、第 3 列 `items[2per:]`），按正文出现顺序「从上到下、从左到右」，
  与 `NotePanel.annotationColumns` 一致；列间有淡竖线，跨页自动按行拆分。
- 每格**只放被标注原文**（`underline` 类型保留 `<u>`）；页面不再铺黄色底色，
  高亮视觉统一由 PDF 注释提供，避免双层叠加。
- **注释内容全部写进 PDF 注释**：`_TaggedParagraph.draw()` 用 `canv.absolutePosition()`
  记录每个单元格的矩形与页号，`_attach_highlight_notes()` 对每条挂一条
  `add_highlight_annot()`，`set_info(content=note)` 写入 `/Contents`，
  阅读器悬停即可看到（英 / 美音标、词性、释义等）。无注释写「（暂无注释）」。
  坐标锚定比事后 `search_for` 文本可靠：重复原文、跨页表格都能各挂一条
  （实测 120 条 / 2 页全部命中，2 条同文本批注各得自己的注释）。
- **音标不再乱码**：`note` 先前被 reportlab 画到页面上，而内置 Helvetica /
  `STSong-Light` 与系统常见字体都缺 IPA 字形（实测 `Vera.ttf` 只覆盖 24 个常用 IPA
  码位中的 2 个），于是出现 `/bl■■ke■d/` 这样的黑框。改走 `/Contents` 后由阅读器
  用自身字体显示 Unicode，既不乱码也不丢字；页面文本里已不含 `note`。

| 片段 | 数据来源 | 排序 | 每条内容 |
|----|----------|------|----------|
| 批注（N） | `payload.annotations` | `paragraphIndex → startOffset → createdAt` | 三栏里只有原文；该条 `note` 在 PDF 高亮注释中 |
| 重点（N） | `payload.marks` 值为 `true` 的键 | `noteIndex` → 键插入顺序 | `#N 词汇文本`（N = noteIndex + 1，与界面徽章一致），红色 |
| 句子（N） | `payload.favorites`（收藏的笔记卡片内容拷贝） | 收藏顺序 | 英文句子 + 中文译文（不列词汇）；数据来自 `GET /api/articles/:id/note-favorites` |
| 文章正文 | `payload.content` | 原样 | `pdf_export.py` 的正文 + 原批注 |
| 笔记全文 | `payload.notes` | 原样整篇 | 原有英文 / 中文 / 词汇行排版（marks 标红） |

- 5 个片段各自是独立 PDF，服务层整页合并，因此**每个都从新的一页开始**；
  5 个一级书签按同序指向各自首页（见「实现要点 8」）。
- 只有有内容的片段才生成；`notes` 为空但有批注 / 重点时仍导出批注/重点节片段
  （`X-Include-Notes: 1`）。

### 配置（notes_pdf_export.py 的 DEFAULTS）

| 常量 | 默认 | 说明 |
|------|------|------|
| `heading_text` | `笔记` | 保留兼容；当前各片段页首直接用节标题 |
| `font_size` / `line_height` | `12` / `1.5` | 笔记正文（比正文导出的 1.6 略紧） |
| `vocab_font_size` | `11` | 词汇行 |
| `vocab_color` | `(0.42, 0.45, 0.50)` | 普通词汇灰色 |
| `vocab_marked_color` | `(1.0, 0.1216, 0.1216)` | 重点词汇红色，同界面 `#ff1f1f` |
| `annotation_bg_color` | `(1.0, 0.97, 0.65)` | 三栏条目 PDF 高亮注释颜色（淡黄色） |
| `annotation_col_gap` | `8` | 三栏表格单元格左右内边距（pt） |
| `section_font_size` | `16` | 各片段页首的节标题 |
| `block_gap` | `12` | 每条笔记之间的间距（pt） |
| `margin_x` / `margin_top` / `margin_bottom` | `56` / `64` / `60` | 与正文导出一致 |

表中 `font_size` / `line_height` / `page_size` / `show_title` 可经 HTTP 选项覆盖（与正文共用 `_ALLOWED_OPTIONS` 白名单及驼峰别名），其余常量无对外开关；前端 `EXPORT_OPTIONS` 中与笔记相关的只有 `includeNotes`，它在服务层被 `pop` 消费后不下传。

### 命令行（排错用）

```bash
python server/notes_pdf_export.py --input notes.txt --out notes.pdf
python server/notes_pdf_export.py --input article.json --out notes.pdf   # {"title","notes"}
```

### 排错：改了 `server/*.py` 但导出结果没变

服务启动时一次性导入模块，**改完必须重启 5057**；而 `start-all.py` 是按端口幂等的
（`port_up(5057)` 为真就 `print("[start] pdf-service already up")` 后跳过），
所以「跑了 start-all.py」**不等于**换成了新代码 —— 旧进程会继续用旧模块导出。

判据：`/health` 返回 `ok:true` 只能说明依赖在，**不能**说明代码是新版本。
直接看导出响应头 `X-Include-Notes` 是否存在（旧代码没有这个头）：

```bash
curl -s -D - -o out.pdf -X POST http://127.0.0.1:5057/api/export-pdf ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"T\",\"content\":\"hello world\",\"notes\":\"1. a\n中文\n（x\\y）\"}"
# 新代码：X-Include-Notes: 1 且 out.pdf 为 2 页（第 2 页是笔记）
# 旧代码：无该响应头，out.pdf 只有正文 1 页
```

确认是旧进程时：先停干净（按端口找到 PID 后结束，**注意可能有多个 `pdf_service.py`
进程在抢同一个端口**，只杀占端口的那个会留下残留），确认 5057 释放后再启动。

### 已知限制

1. **非标准编号会让重点标记错位**：`BLOCK_SPLIT_RE` 比前端 `NotePanel.parseRaw` 宽松
   （额外容忍「1、」与数字后的空格），这类笔记在前后端切出的块数可能不同，块索引即失配。
   标准「1. 」编号不受影响（见「重点词汇标红（marks）」）。
2. **笔记不做两端对齐**：笔记是短句 + 释义，左对齐更易读（`TA_LEFT`），与正文策略不同。
3. **依赖未装时整体不可用**：`pdf_service.py` 首次导入时同时 `import fitz` 与 `from pdf_export import ...`，
   PyMuPDF 缺失时 `/health` 返回 `ok:false`、导出接口返回 500，**不存在「只导出正文且不报错」的降级**；
   只有「PyMuPDF 已装、笔记模块导入失败」时才降级为只导出正文并回 `X-Include-Notes: 0`。
