# PDF 导出功能

把「文章正文 + 阅读器批注」导出为 PDF：正文是**可选中、可搜索、可复制的真实文本**，
阅读器里的高亮/下划线批注以 **PDF 标准标记注释**（Highlight / Underline）写入，
在 Acrobat / Edge / Firefox 中悬浮即可看到批注内容。

---

## 一、架构

```
┌──────────────────────────────────────────┐
│  ArticleToolbar.vue                      │
│    └─ PdfExportButton.vue   [●] 📄 PDF    │
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
| `server/pdf_export.py` | **核心**：reportlab 排版 + PyMuPDF 写注释（两阶段） |
| `server/pdf_service.py` | FastAPI 服务，端口 **5057** |
| `src/components/PdfExportButton.vue` | 前端导出按钮，含服务状态指示灯 |

接入点：
- `src/components/ArticleToolbar.vue` — 工具栏「笔记」按钮后挂载 `PdfExportButton`
- `src/views/ArticlePage.vue` — 向工具栏传 `:article` 与 `:annotations`
- `scripts/start-all.py` / `scripts/stop-all.py` — 拉起 / 停止 5057

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
# {"ok":true,"engine":"pymupdf","version":"1.26.7"}
```

`ok:false` 表示 PyMuPDF 未安装（此时导出接口返回 500）。

### `POST /api/export-pdf`

```json
{
  "title": "文章标题",
  "content": "正文纯文本（\\n 分段）",
  "annotations": [
    {
      "paragraphIndex": 0,
      "startOffset": 4,
      "endOffset": 26,
      "type": "highlight",
      "color": "#FFEB3B",
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

**选项白名单**（未在列内的键会被丢弃）：

| 前端（驼峰） | 后端（下划线） | 默认 | 说明 |
|-------------|---------------|------|------|
| `markHighlight` | `mark_highlight` | `true` | 高亮批注 → Highlight 注释 |
| `markUnderline` | `mark_underline` | `true` | 下划线批注 → Underline 注释 |
| `withContents` | `with_contents` | `true` | 把 `note` 写进注释内容 |
| `showTitle` | `show_title` | `true` | 是否输出标题 |
| `fontSize` | `font_size` | `11` | 正文字号（pt） |
| `lineHeight` | `line_height` | `1.6` | 行高倍数 |
| `pageSize` | `page_size` | `a4` | `a4` / `letter` |
| `underlineWidth` | `underline_width` | `0.6` | 下划线线宽（pt），见「实现要点 3b」 |

> ⚠️ 前端用驼峰、后端用下划线，**必须**经 `_OPTION_ALIASES` 映射，
> 否则选项会被白名单静默丢弃，表现为「开关无效但导出正常」。
> 新增选项时记得同步 `_ALLOWED_OPTIONS` 与 `_OPTION_ALIASES`。

**响应**：`200` + `application/pdf`

```
Content-Disposition: attachment; filename="___.pdf"; filename*=UTF-8''%E4%B8%AD...
X-Export-Engine: pymupdf
```

失败：

| 状态码 | body | 场景 |
|--------|------|------|
| `400` | `{"ok":false,"error":"正文为空"}` | content 缺失或空白 |
| `400` | `{"ok":false,"error":"请求体必须是 JSON 对象"}` | 格式错误 |
| `500` | `{"ok":false,"error":"PyMuPDF 未安装：..."}` | 依赖缺失 |
| `500` | `{"ok":false,"error":"导出失败：..."}` | 导出异常 |

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

1. rect 只作热区，固定在基线下方 1~4pt（3pt 高，不与相邻行冲突）；
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
| `UNDERLINE_WIDTH_PT` | `0.6` | 线宽（pt） |
| `UNDERLINE_GAP_PT` | `3.0` | 线中心相对基线的偏移（pt） |

实测线覆盖**基线下方 2.7~3.3pt**，而 11pt 字号的下伸部约 2.31pt，
线与下伸部之间留有约 **0.4pt** 间隙 —— 既不会压到 `p`/`g`/`y`，
也不会因为离文字太远而显得脱节。

也可通过选项 `underlineWidth` 覆盖（见「接口」一节的选项表）。

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

### 6. HTTP 头只能承载 latin-1

中文标题直接放进 `Content-Disposition: filename=` 会抛 `UnicodeEncodeError` → 500。
用 RFC 5987 双写：ASCII 回退名 + `filename*=UTF-8''<percent-encoded>`。
前端优先解析 `filename*`。

### 7. `pythonw.exe` 会让 uvicorn 静默崩溃

`pythonw` 下 `sys.stdout` / `sys.stderr` 均为 `None`，uvicorn 配置 logging 时崩溃，
而异常无处输出 —— 表现为**进程静默退出、端口不通**。

两处防护：
- `pdf_service.py` 顶部检测并兜底重定向到 `os.devnull`
- `start-all.py` 用 `python.exe` + `CREATE_NO_WINDOW`（既无窗口又保留可重定向的输出）

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
| 内容流线宽 | `0.6 w`（用户反馈原 1.2pt 太粗且贴字，已减半） |
| 线相对基线 | **+3.04pt**（期望 +3.0），覆盖基线下方 2.7~3.3pt |
| 下伸字母 | 11pt 字号下伸部约 2.31pt，与线上缘留有 **~0.4pt** 间隙，不接触文字底部 |
| 热区 | 3.38pt 高，不与相邻行冲突 |
| 像素实测 | 采样列连续红色段约 5px ≈ 0.9pt（含抗锯齿），无断裂 |
| 线宽可调 | `underlineWidth` 传 `0.6` / `1.0` / `2.0` 均准确生效 |

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

- 改 `pdf_export.py` 后，务必跑一遍**跨行批注**用例（最容易回归的点）。
- 新增导出选项时，同步 `pdf_service.py` 的 `_ALLOWED_OPTIONS` 与 `_OPTION_ALIASES`。
- 若改了 `_normalize_text()`，确认正文与批注文本都走同一套清洗。
- 端口 5057 需与 `scripts/start-all.py` / `stop-all.py` 保持一致。
- **改下划线粗细**：调 `UNDERLINE_WIDTH_PT` / `UNDERLINE_GAP_PT`，或传 `underlineWidth`
  选项；**不要试图改 rect 高度**来调线宽（见「实现要点 3b」）。
- 改了 `pdf_export.py` 后需**重启 5057 服务**才生效（服务启动时会导入模块）。
