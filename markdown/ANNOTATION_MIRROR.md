# 正文与笔记英文行的批注镜像关系

> 本文分析 `ArticleReader.vue`（正文批注渲染）与 `NotePanel.vue`（笔记英文行批注渲染）两处的功能、代码关联，以及二者必须共同遵守的渲染不变量。
> 关键位置：`ArticleReader.vue` 的 `displayParagraphs` 模板渲染、`NotePanel.vue` 的 `.english-text` 模板渲染。
> 本文统一用「组件 + 方法名」定位，不写死代码行号，避免代码调整后引用漂移。

---

## 一、两处各自是什么、各自功能

### 1. `ArticleReader.vue` — 正文批注渲染

这是**文章正文**的渲染模板（普通阅读页）。外层 `v-for` 遍历 computed `displayParagraphs`（由 `buildDisplayParagraphs(paragraphSegments, readerSearchText)` 生成，原 seg 的 `key` / 批注元数据通过展开保留），内层按「边界点」把每段切成片段：

- `seg.type === 'text'` → 纯文本 `<span>`
- 否则 → `.annotated` 标注 span，挂三样东西：
  - `:class` = 该段覆盖批注的类型并集（highlight/underline，可叠加）
  - `:style` = 若有 highlight 则用其 `color` 作背景色
  - `:data-annot-id` = 覆盖本段**全部批注 id**（空格分隔，含 `seg.annotations`）
  - 鼠标事件：`@mouseenter/@mouseleave/@click` → 本地 `onAnnotEnter/Leave/Click`，只做 `emit('annotMouseEnter'…)` 上抛给 `ArticlePage` → `useAnnotations` 的同名函数

相关引用：
- `paragraphSegments` prop 与 `displayParagraphs` computed：`ArticleReader.vue`
- inject 的联动通道：`noteSearchText` / `noteSearchNonce` / `readerSearchText` / `readerSearchNonce` / `readerHit`
- `buildParagraphSegments`：`useAnnotations.js`

### 2. `NotePanel.vue` — 笔记英文行批注渲染

这是**笔记面板**里每张卡片英文行的渲染（`english-text` 容器）。`englishSegments(n)` 把英文行切成片段，模板结构与正文**完全一致**：

- 空片段：`v-html="pieceHtml(seg)"`（命中搜索词时内层包 `<mark class="note-hit">`）
- 有批注片段：`.annotated` span，挂：
  - `:class="annotClasses(seg.anns)"`（类型并集）
  - `:style="annotStyle(seg.anns)"`（高亮色）
  - `:data-annot-id="annotIds(seg.anns)"`（空格分隔全 id）
  - `@mouseenter/@mouseleave/@click` → `onAnnotEnter/Leave/Click`，它们**直接调用批注桥** `bridge.onAnnotMouseEnter/Leave/Click`
- 容器还有 `@mouseup="onEnglishMouseUp"`（触发反向联动 + 查词）与 `@contextmenu="onEnglishContextMenu"`（弹出笔记侧批注工具栏）

> 渲染要点：`englishSegments` 先在**整行**用 `noteSearch` 算好搜索命中区间 `matchRanges`，再与批注边界合并统一切分；每个片段携带 `anns`（覆盖批注）与 `match`（是否命中搜索）两个标志。`pieceHtml(seg)` 只做「转义原文 + 命中则包 `<mark>`」，不再对各片段单独 `indexOf`（`highlight()` 仍用于中文行 / 词汇项）。详见文末「已知修复」。

相关引用（均位于 `NotePanel.vue`）：
- `englishSegments` 投影 + 搜索命中合并算法（`lineAnchor` 负责把英文行定位到正文落点；文本匹配回退见 `englishSegments` 内 `if (!hits.length)` 分支）
- `annotPrimary` 主批注优先级
- `doAnnotate`（E/W 快捷键、右键工具栏建批注）
- `locateCard`（卡片定位，用 `[data-annot-id~="id"]`）

### 3. `NotePanel.vue` — 集中卡片的三栏批注列表（只读消费点，不参与镜像渲染）

顶部「重点」按钮打开的全屏集中卡片默认视图（`markedView === 'annotations'`）是同一份 `annotations` 的第三个消费点：`annotationItems` 按正文坐标排序、`annotationColumns` 切成三列，每格只显示 `a.text`（用 `annotClasses / annotStyle` 保留黄底 / 下划线）。它不做 `lineAnchor` 投影、也不切片段，因此不属于本文讨论的「镜像渲染」；且该视图**只读**：悬停整行由 `onAnnotCellEnter` 立即弹出 NotePanel 自管的 `AnnotationCard`（`:readonly="true"`），**不再走** `onAnnotEnter / onAnnotLeave` → 桥的 `onAnnotMouseEnter/Leave`（那条链路弹出的是可编辑卡片）。格子不挂 `data-annot-id`，避免 `showAnnotCardForAnnotation` / `locateCard` 把可编辑卡片定位到只读面板里；点击编辑、Delete/Backspace 删除均被 `readonly` 拦住，不会回写 `annotations`。

---

## 二、两处在项目中的所有关联

核心关系：**NotePanel 的英文行批注是 ArticleReader 正文批注的「镜像」**，二者展示的是同一份 `articles.annotations` 数据，复用同一套卡片交互。

### 关联 1：共享数据源（批注只存一份）

批注只存一份在 `useAnnotations` 的 `annotations`（`ref([])`），键为精确坐标 `(paragraphIndex, startOffset, endOffset)`。

- 正文直接用坐标渲染（`buildParagraphSegments`）
- 笔记英文行通过 `lineAnchor(text)` **把英文行定位到正文中的落点**，再把批注区间投影到行内偏移（`englishSegments`）——主路径是纯坐标投影，因此「同一文本多处出现 / 叠加 / 包含」天然正确；仅当定位不到时才回退到按完整词边界的文本匹配（见第八节）。

### 关联 2：共享的批注桥 `annotationBridge`（`ArticlePage.vue`）

`NotePanel` 通过 `inject` 拿到它。桥把正文侧的实现**原样暴露**给笔记：

- `annotations` / `recentAnnotId` / `paragraphs` / `findTextInParagraphs`
- `annotateRange` → `annotateAt`（统一落点，复用 `createAnnotation`）
- `annotateText`（文本匹配回退）
- `showCardAt`、`onTextSelection`、`onAnnotMouseEnter/Leave/Click`

于是：

- 笔记里悬停/点击一条标注，走的是与正文**完全相同**的 `useAnnotations.onAnnotMouseEnter/Leave/Click`；
- 在笔记英文行按 E/W 或右键工具栏标注，经 `doAnnotate` → `bridge.annotateRange` → 直接在**正文**对应坐标建批注，建完后正文与笔记英文行**同步出现**该标注。

### 关联 3：相同的主批注优先级

正文 `buildParagraphSegments`（`pMap={highlight:3, underline:2}`）与笔记 `annotPrimary` 都遵循「最近新建优先，否则 highlight > underline」。

### 关联 4：相同的卡片定位协议

`useAnnotations.showAnnotCardForAnnotation` 和 `deleteAnnotation` 都用 `[data-annot-id~="id"]`（空格分隔取其一）查找 DOM；笔记侧 `locateCard` 同样用 `~=`。所以两处都必须把**全部覆盖批注 id** 写进 `data-annot-id`。

### 关联 5：联动通道共用

正文 `ArticleReader` inject `noteSearchText` / `noteSearchNonce` / `readerSearchText` / `readerSearchNonce` / `readerHit`；笔记侧 `noteSearch` / `noteSearchNonce` 是 **props**（由 `App.vue` 传入），`readerHit` 为 inject，反向联动通过 `emit('reverse-select')` 交 `App.onReverseSelect` 写入 `readerSearchText`。正文选中 → 笔记高亮（`englishSegments` 在整行算 `matchRanges` 后由 `pieceHtml` 包 `<mark>`）、笔记选中 → 正文高亮，是双向联动的两侧。

---

## 三、关键共享不变量（两处必须一致，否则出 bug）

| 不变量 | 正文（`ArticleReader` 模板 / `buildParagraphSegments`） | 笔记（`NotePanel.englishSegments`） |
|---|---|---|
| `key` 用**片段起点偏移**而非数组索引 | `seg.key`（由 `buildParagraphSegments` 生成 `'a'+start+'_'+ids`） | `'a'+start+'_'+coveringIds.join(',')` + 命中搜索时追加 `'_m'` |
| `data-annot-id` 写**全部覆盖 id**（空格分隔） | 用 `Set([seg.annotation.id, ...seg.annotations.map(id)])` | 用 `annotIds(seg.anns)` |
| 主批注 = 最近新建 ∨ highlight>underline | `seg.annotation` | `annotPrimary(seg.anns)` |

**`key` 用偏移量的原因**（两处注释都写明）：新增/删除批注会改变片段划分，若用数组索引 Vue 会按位置复用旧节点，导致高亮样式不刷新（要刷新页面才显示）。

**`data-annot-id` 写全部 id 的原因**：只写主批注时，被压在下面的那条在 DOM 无落点，`showAnnotCardForAnnotation` / `locateCard` 按 id 找不到元素，卡片不弹或跑到兜底位置。

**两端标点裁剪也是共用的，不是各自实现**：正文侧直接调用 `useAnnotations.createAnnotation`，笔记英文行经 `ArticlePage.annotateAt` 换算成正文坐标后落到同一个 `createAnnotation`；创建时由 `trimAnnotationEdges` 统一裁掉选区首尾标点并同步收缩 `(startOffset, endOffset)`，因此两处看到的标注范围一致，且不会与 `text` / PDF 偏移定位错位。

---

## 四、两处差异

- **字段命名**：正文片段用 `seg.annotation`（主）+ `seg.annotations`（全）；笔记片段用 `seg.anns`（全数组合）。
- **样式类生成**：正文在模板里内联 `new Set([...])`；笔记抽成 `annotClasses` / `annotStyle` / `annotIds` / `annotPrimary` 四个方法（便于复用）。
- **搜索高亮实现**：正文由 `buildDisplayParagraphs` 计算命中 parts、`ArticleReader` 模板（Vue）渲染 `<mark class="reader-hit">`；笔记英文行由 `englishSegments` 算 `match` 标志 + `pieceHtml` 包 `<mark class="note-hit">`（中文行 / 词汇项仍用 `highlight()`）。
- **标注叠加限制已完全移除**：笔记侧 `NotePanel.doAnnotate` 的「下划线禁止落在已有高亮区域内」检查（`hasHighlightOverlap`）与临时开关均已删除，笔记与正文规则一致 —— 不同类型自由叠加，仅 `useAnnotations.createAnnotation` 保留「同种类型不可重叠」。
- **回退路径**：仅当 `lineAnchor()` 定位不到本行时（`if (!anchor && !hits.length)`）才退回文本匹配，并用 `findWholeWordMatches` 按完整词边界取全部命中；本行定位成功但无覆盖批注时不回退（否则 `heir` 会误挂到 `their`，见第八节）。正文无此回退（本身就在正文里）。
- **附加交互**：笔记英文行 `onEnglishMouseUp` 额外触发反向联动（`emit('reverse-select')`）+ 查词；正文 `onReaderMouseUp` 触发正向联动（`noteSearchText`）→ 笔记高亮。
- **标注建入位置**：笔记侧标注最终落在**正文**坐标（`annotateAt` 复用正文逻辑），笔记英文行只是镜像展示，自身不参与存储决策。

---

## 五、小结

两处是同一份批注在「正文」与「笔记英文行」两个视图里的**同源镜像渲染**，通过 `annotationBridge` 共享一套创建/卡片/删除逻辑，并以「`key=起点偏移` + `data-annot-id=全id` + `主批注=highlight>underline`」三个不变量保证两侧行为一致。

---

## 六、已知修复：跨批注边界的选中词漏高亮

**症状**：正文选中文本 → 笔记高亮联动生效，但笔记英文行**带有批注内容**的那一段不显示高亮。

**根因**（旧实现）：`englishSegments` 先把英文行**按批注边界**切成片段，再对**每个片段单独**调用 `highlight(seg.text)` 用整句选中词 `q` 做 `indexOf`。当正文选中的词**跨批注边界**（如选中 `"apple pie"`，而笔记里 `"apple"` 已标高亮）时，整词被拆到两个片段，任一段的 `seg.text` 都不含完整 `"apple pie"`，`indexOf` 返回 -1 → 两段都不生成 `<mark>`，高亮整段丢失。

**修复**（`NotePanel.vue` 的 `englishSegments` 与 `pieceHtml`）：
1. 搜索命中区间 `matchRanges` 改在**整行**上计算（`noteSearch` 经 `normKey` 归一后 `indexOf` 取全部命中），与批注边界**相互独立**；
2. 把「批注边界」与「搜索命中边界」**合并**成统一切分点，每个片段同时携带 `anns`（覆盖批注）与 `match`（是否命中搜索）两个标志；
3. 模板改用 `pieceHtml(seg)`：仅「转义原文 + `match` 为真则包 `<mark class="note-hit">`」，**不再对各片段单独匹配**；
4. `key` 追加 `_m` 命中标记，保证搜索词变化时强制重渲染。

**效果**：选中词完全落在某批注内 → 该批注片段内出现 `<mark>`（与旧行为一致）；选中词跨批注边界 → 拆出的每段各自命中，`<mark>` 完整覆盖整词，不再漏高亮；未选中时行为不变；中文行 / 词汇项仍走原 `highlight()`。

---

## 七、已知修复：笔记选中 → 正文高亮时标注被"扩充"/匹配后批注渲染丢失

**症状（旧方案）**：
1. 笔记选中文字 → 正文高亮联动生效。若命中区**包含**一处标注，标注范围被**扩充到整个搜索区**（点击/悬停命中整段、底色与下划线覆盖搜索区全文）。
2. 更严重：匹配结束（选区消失、高亮清除）后，黄色高亮 / 下划线批注**渲染丢失**，文字仍在，需**刷新页面**才恢复。

**根因（旧方案）**：`ArticleReader.vue` 的 watcher 调 `highlightMatchesInReader`，对 Vue 托管的正文 DOM 做 `splitText` + `<mark>` 包裹；`mergeAdjacentHitMarks` 再用 `range.extractContents()` 把同一次命中的相邻 mark 之间的内容搬进首个 mark —— 批注 `.annotated` span 内的文本被搬离原父节点、span 被掏空。清除时又把 mark 换成纯文本节点，这些文本不再受 `.annotated` 的 `class`/`:style` 作用。同时 Vue 的 vnode 仍持有旧节点引用且 `seg.key` 未变，后续响应式更新不会重建节点或重新应用批注样式 → 只有整页刷新（按 `paragraphSegments` 从零重建 DOM）才恢复。早期"跨标注边界不合并"的守卫（`getAnnotAncestor` / `hasAnnotatedBetween`）只能缓解症状 1，无法根治 DOM 改写与 vdom 失配。

**修复（现行方案：数据驱动、零 DOM 改写）**：
- `src/utils/selectionText.js` 新增纯函数 `buildDisplayParagraphs(paragraphSegments, keyword)`：把每段所有 seg 的 `text` 拼成段落逻辑全文，`indexOf` 找所有不重叠命中（跨行关键词按 `\n` 拆段并裁首尾空白），再投影回各 seg 切成 `parts`（命中 part 带全局 `hitIdx`）。**不碰 DOM、不改 seg 原始字段**，批注元数据原样保留。
- `ArticleReader.vue` 用 computed `displayParagraphs` + 模板 `<mark class="reader-hit" :data-hit-index="part.hitIdx">` 由 **Vue 渲染**命中；`.annotated` 的 class/:style 与命中 mark 同属一棵 vnode 树，DOM 不再被外部改写。删除整套 `highlightMatchesInReader` / `mergeAdjacentHitMarks` / `getAnnotAncestor` / `hasAnnotatedBetween` / `scrollToFirstHit`。
- `scrollToReaderHit` 只按 `data-hit-index` 找锚点滚动，**不再增删 `.reader-hit-current`**；当前命中的深蓝由 Vue 依据 `readerHit.index` 渲染（App 以 `reactive` 对象 provide 共享，`NotePanel.nextReaderHit` 回车翻页写入）。
- 命中期间**临时隐藏批注视觉**：正文侧 `buildDisplayParagraphs` 给 seg 加 `hasHit`，`ArticleReader.annotSegClass/annotSegStyle` 据此去掉 `highlight`/`underline` 类与 inline 背景色；笔记侧 `englishSegments` 每段带 `seg.match`，模板按 `seg.match` 决定是否调用 `annotClasses/annotStyle`。只隐藏视觉，`data-annot-id` 与卡片交互保留，选区消失（`clearActiveSearch`）后随 Vue 渲染自动恢复。
- `.reader-hit` / `.note-hit` 只留**半透明蓝底**（`rgba(64,158,255,0.4)`），去掉 `box-shadow` 描边与圆角：命中短语跨 seg 时会渲染成多个相邻 `<mark>`，四周描边在接缝处画竖线造成割裂，去掉后融成连续一条；当前命中仍以深蓝底色区分（不描边）。

**效果**：搜索区包含标注时标注范围不被扩充、高亮清除后批注也不会丢失；跨 seg 短语的同一次命中多个 `<mark>` 共享 `data-hit-index`，视觉上仍是连续高亮。`selectionText.spec.js` 已改为覆盖 `buildDisplayParagraphs` 与「只滚动」的 `scrollToReaderHit`。

---

## 八、已知修复：批注文本被按子串镜像到别的单词里（`heir` → `their`）

**症状**：正文里只标注了 `heir`（"and presumed heir, has"），笔记面板另一行 "guns on their hips" 中 `their` 的后四个字母 `heir` 却被挂上黄色高亮（首字母 `t` 没底色）。

**根因**：`NotePanel.englishSegments` 的主路径是坐标投影（精确），但旧回退条件是 `if (!hits.length)` —— 它把两种完全不同的情况混为一谈：① 本行在正文中定位不到（笔记改写 / 跨段 / 正文改动）；② 本行定位成功、本来就没有覆盖批注。情况 ② 也会触发回退，用 `normKey(a.text)` 在整行做裸 `indexOf`，无词边界，于是 `heir` 命中 `their` 的子串；切分点为 9 / 13，正好切出 `"guns on t"` / `"heir"` / `" hips"` 三段。同一函数里计算搜索命中区间 `matchRanges` 的 `indexOf` 也有同类问题（正文选中 `heir` → `their` 里的 `heir` 被蓝底命中）。

**修复**：
1. 回退条件收紧为 `if (!anchor && !hits.length)`：只有 `lineAnchor()` 真正定位不到时才按文本兜底；投影为空就是本行无批注，不做任何文本匹配。
2. `src/utils/selectionText.js` 新增 `findWholeWordMatches(haystack, needle)`：大小写不敏感地找出**所有**「完整词」命中区间，左右紧邻字符只要有一侧是词内字符（Unicode 字母 / 数字 / `_` / 撇号）就判为子串并丢弃；空白、标点、引号、连字符 / 破折号视为词边界，与 `WORD_BREAK_RE` 的选区语义一致（`don't` 是一个词，`well-known` 的 `-` 是边界）。
3. 回退分支与 `matchRanges` 都改用它：回退取全部命中（旧实现只取 `indexOf` 第一处），黄底镜像与蓝底查找不再误命中子串。
4. `src/utils/__tests__/selectionText.spec.js` 增加 `heir` / `their`、大小写、标点、短语、撇号、多命中回归用例。

**未改动**：正文查找高亮 `buildDisplayParagraphs`、笔记中文行 / 词汇项的 `highlight()`、`ArticlePage.findTextInParagraphs` / `annotateText` 仍是裸 `indexOf`——它们不属于本次批注镜像链路；若要把「完整词」规则推广到全站，统一接入 `findWholeWordMatches` 即可。

**效果**：本行无覆盖批注时不再把别处批注按子串挂过来；定位不到而确实需要文本兜底时，也只匹配完整词 / 短语。
