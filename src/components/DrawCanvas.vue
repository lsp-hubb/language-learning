<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { fetchCanvasStrokes, saveCanvasStrokes, sendCanvasStrokesBeacon } from '@/api'
import { createStrokeWriter, mergeLoadedStrokes } from '@/utils/canvasPersist'
import { notifySuccess, notifyError } from '@/utils/feedback'

const props = defineProps({
  drawMode: Boolean,
  drawActive: Boolean,
  tool: { type: String, default: 'eraser' },
  // 仅作历史笔迹颜色兜底；新笔迹固定 RED_WAVY_COLOR，不再由上层指定样式
  color: { type: String, default: '#f08200' },
  articleId: { type: String, default: '' },
  // ArticlePage 正文/批注/滚动恢复全部落地后递增，用于重算画布尺寸与段落锚点
  contentReadyTick: { type: Number, default: 0 },
  panelOpen: { type: Boolean, default: false },
  autoAddLines: { type: Boolean, default: false }, // 选中文本是否自动添加线（右键开/关，默认关）
})

const emit = defineEmits([
  'toggle-draw', 'toggle-tool', 'close-canvas', 'new-canvas',
  'update:tool', 'update:autoAddLines',
])

const drawCanvas = ref(null)
const isDrawing = ref(false)
const lastX = ref(0)
const lastY = ref(0)
const eraseStartX = ref(0) // 橡皮擦虚线框选起点
const eraseStartY = ref(0)
const strokes = ref([])
const savedCanvasData = ref(null)
const refCanvasW = ref(0)
const refCanvasH = ref(0)

let _resizeObserver = null
let _observedBody = null // 当前被观察的 .reader-body，切换文章后 DOM 会换新
let _autoAddMsg = null // 右键「自动添加线」提示实例，便于再次切换时先关闭上一条
let _saveErrorShown = false // 保存失败提示去重，避免重试期间反复弹窗
let _loadToken = 0 // 加载序号：丢弃过期的异步加载结果
let _switchSeq = 0 // 切换序号：连续跳转时只有最新一轮能收尾
let _switching = false
let _loading = false // 笔迹加载在途：期间不整幅覆盖写库，避免抹掉服务端已有笔迹
let _suppressedCommit = false // 切换 / 加载窗口内发生的笔迹变更，收尾时补一次入库
let _loadFailed = false // 加载失败时不写库，避免整幅覆盖抹掉服务端已有笔迹
let _loadFailureNotified = false // 加载失败提示去重
let _disposed = false // 组件已卸载：所有在途异步回调立即退出

// 即时入库（无防抖）：每画一笔 / 擦除一笔 / 清空都立刻写库。
// 后端是整幅快照覆盖，写入器负责串行化，避免旧请求后到把新笔迹抹掉；
// commit 时冻结 articleId，文章切换后在途请求不会串写到新文章。
const strokeWriter = createStrokeWriter({
  save: async (articleId, data) => {
    await saveCanvasStrokes(articleId, data)
    _saveErrorShown = false
  },
  onError: (err) => {
    console.error('保存画布笔迹失败:', err)
    if (!_saveErrorShown) {
      _saveErrorShown = true
      notifyError('画布笔迹保存失败，请检查网络后重试（笔迹仍保留在当前页面）')
    }
  },
})

function _commitStrokes() {
  if (_disposed) return
  // 切文章（正文替换中）或笔迹加载在途时不整幅覆盖写库：
  // 记一个标记，等窗口结束、加载结果与本地新笔迹合并后按最终状态补一次入库。
  if (_switching || _loading) {
    _suppressedCommit = true
    return
  }
  if (_loadFailed) {
    // 加载失败时本页笔迹不完整，整幅覆盖会抹掉服务端已有笔迹，只提示不写库
    if (!_loadFailureNotified) {
      _loadFailureNotified = true
      notifyError('画布加载未成功，暂不写入以免覆盖已有笔迹，请刷新页面后重试')
    }
    return
  }
  strokeWriter.commit(props.articleId, strokes.value)
}

// 窗口结束后的补偿提交：只提交「已合并加载结果」的最终快照
function _flushSuppressedCommit() {
  if (_disposed || _switching || _loading || _loadFailed || !_suppressedCommit) return
  _suppressedCommit = false
  strokeWriter.commit(props.articleId, strokes.value)
}

// 加载恢复成功后解除写入保护（例如用户切到别篇文章再切回来）
function _clearLoadFailure() {
  _loadFailed = false
  _loadFailureNotified = false
}

// 页面隐藏 / 关闭兜底：把尚未确认落库的最新快照交给浏览器投递
function _beaconPendingStrokes() {
  const pending = strokeWriter.pending()
  if (pending) sendCanvasStrokesBeacon(pending.articleId, pending.strokes)
}

// 观察容器和正文内容：.reader-content 是固定视口，文章变长只改 .reader-body 的高度，
// 只观察容器会漏掉「切文章 / 批注渲染 / 字号变化」导致的尺寸与锚点变化。
function _bindResizeObserver() {
  const c = drawCanvas.value
  if (!c || _disposed) return
  const container = c.closest('.reader-content')
  if (!container) return
  const body = container.querySelector('.reader-body')
  if (_resizeObserver && _observedBody === body) return
  if (_resizeObserver) _resizeObserver.disconnect()
  _resizeObserver = new ResizeObserver(() => {
    if (props.drawMode && !_disposed) { _initCanvas(); _redrawAll() }
  })
  _resizeObserver.observe(container)
  if (body) _resizeObserver.observe(body)
  _observedBody = body || null
}

// 正文稳定后重算画布尺寸并按新文章段落锚点重绘
function _relayout() {
  if (_disposed || !props.drawMode || !drawCanvas.value) return
  _initCanvas()
  _redrawAll()
  _saveCanvas()
  _bindResizeObserver()
}

watch(
  () => props.drawMode,
  async (val) => {
    await nextTick()
    if (_disposed) return
    if (val) {
      // 组件可能是随 v-if="article" 重建的新实例（书签跳到未缓存文章），
      // 走 immediate 分支，需自己初始化并加载该文章笔迹
      _initCanvas()
      await _loadStrokes()
      _bindResizeObserver()
    } else {
      // 每笔已即时入库，关闭画布只需等待在途写入结束
      await strokeWriter.flush()
      _beaconPendingStrokes()
      if (_resizeObserver) {
        _resizeObserver.disconnect()
        _resizeObserver = null
        _observedBody = null
      }
    }
  },
  { immediate: true },
)

// ArticlePage 正文 / 批注 / 滚动恢复都落地后递增：此刻 _initCanvas 才能拿到
// 正确的 scrollHeight 与 .para-block，笔迹锚点才不会串段或错位。
watch(() => props.contentReadyTick, async () => {
  if (!props.drawMode || _disposed) return
  await nextTick()
  if (!props.drawMode || _disposed || !drawCanvas.value) return
  refCanvasW.value = 0
  refCanvasH.value = 0
  _relayout()
}, { immediate: true })

function _initCanvas() {
  const c = drawCanvas.value
  if (!c) return
  const container = c.closest('.reader-content')
  if (!container) return
  // 用 clientWidth（不含滚动条）而非 getBoundingClientRect().width（含滚动条），
  // 否则开启画布、正文出现纵向滚动条后，画布比内容宽约 15px，触发 .reader-content 横向滚动条
  const w = container.clientWidth
  const h = container.scrollHeight
  c.width = w
  c.height = h
  c.style.width = w + 'px'
  c.style.height = h + 'px'
  c.style.left = '0'
  c.style.top = '0'
  if (!refCanvasW.value) {
    refCanvasW.value = w
    refCanvasH.value = h
  }
}

// 切换文章（含书签跳转）：用序号串行化，连续跳转 A→B→C 时只有 C 能重置状态并收尾。
// 旧文章笔迹已逐笔入库，写入器又冻结了旧 articleId，不会串写。
watch(() => props.articleId, async () => {
  const seq = ++_switchSeq
  _switching = true
  _suppressedCommit = false
  _loadFailed = false
  _loadToken++
  try {
    // 旧文章的在途写入必须真正结束，再清空内存
    await strokeWriter.flush()
    if (_disposed || seq !== _switchSeq) return
    refCanvasW.value = 0
    refCanvasH.value = 0
    strokes.value = []
    savedCanvasData.value = null
    if (!props.drawMode) return
    // canvas 带 :key="articleId"，切文章会重建 DOM，需等下一帧
    await nextTick()
    if (_disposed || seq !== _switchSeq || !props.drawMode) return
    _initCanvas()
    await _loadStrokes()
    if (_disposed || seq !== _switchSeq) return
    _relayout()
  } finally {
    // 只有最新一轮能复位并补提交，避免旧回调把 _switching 提前放开
    if (seq === _switchSeq) {
      _switching = false
      _flushSuppressedCommit()
    }
  }
})

async function _loadStrokes() {
  const articleId = props.articleId
  const token = ++_loadToken
  _loading = true
  let loaded = []
  let ok = false
  try {
    // 一次自动重试：书签跳转时后端偶发抖动不该让用户丢画布
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        const res = await fetchCanvasStrokes(articleId)
        loaded = Array.isArray(res.data) ? res.data : []
        ok = true
      } catch (e) {
        if (attempt === 1) console.error('加载画布笔迹失败，回退 localStorage:', e)
      }
    }
    if (!ok) {
      try {
        const saved = localStorage.getItem(`_canvas_strokes_${articleId}`)
        if (saved) loaded = JSON.parse(saved)
      } catch {}
    }
    // 期间又切了文章 / 组件已卸载：丢弃过期结果，避免把旧文章笔迹画到新文章上
    if (_disposed || token !== _loadToken || articleId !== props.articleId) return
    if (!ok && !loaded.length) {
      // 加载失败时不能用空数组整幅覆盖服务端已有笔迹
      _loadFailed = true
      _loadFailureNotified = false
      notifyError('画布笔迹加载失败，已暂停写入以免覆盖已有笔迹，请刷新重试')
      return
    }
    _clearLoadFailure()
    // 加载在途期间用户可能已画出新笔迹，合并而不是覆盖，避免丢失
    strokes.value = mergeLoadedStrokes(loaded, strokes.value)
    if (strokes.value.length > 0) {
      _redrawAll()
      _saveCanvas()
    } else if (savedCanvasData.value) {
      _drawImg(savedCanvasData.value)
    }
  } finally {
    // 只解除「本次加载」标志：连续加载时旧回调不得提前放开窗口
    if (token === _loadToken) _loading = false
    _flushSuppressedCommit()
  }
}
// 只保存内存快照用于重绘；落库由每次笔迹变更的 _commitStrokes() 负责
function _saveCanvas() {
  const c = drawCanvas.value
  if (!c) return
  savedCanvasData.value = c.toDataURL()
}
function _drawImg(url) {
  const c = drawCanvas.value
  if (!c) return
  const img = new Image()
  img.onload = () => c.getContext('2d').drawImage(img, 0, 0)
  img.src = url
}
// ===== 布局锚点：笔迹绑定到所在段落，侧栏开/关导致正文列平移 / 重排后仍跟随文字 =====
// 画布原点固定在 .reader-content 左上角，而正文是居中的定宽列；面板让位会让整列
// 水平平移（窄窗口还会重排）。若按画布宽高整体等比缩放，笔迹就会与文字错位。
function _blocks() {
  const container = drawCanvas.value?.closest('.reader-content')
  if (!container) return []
  return Array.from(container.querySelectorAll('.reader-title, .para-block'))
}
// 内容坐标 → 锚点（段落序号 + 段内横向比例 + 段内纵向偏移）
function _anchorAt(x, y) {
  const c = drawCanvas.value
  const blocks = _blocks()
  if (!c || !blocks.length) return null
  const cr = c.getBoundingClientRect()
  let nearest = null
  let nearestDist = Infinity
  for (let i = 0; i < blocks.length; i++) {
    const r = blocks[i].getBoundingClientRect()
    const top = r.top - cr.top
    const bottom = r.bottom - cr.top
    const left = r.left - cr.left
    const width = r.width || 1
    if (y >= top && y <= bottom) return { pIdx: i, rx: (x - left) / width, dy: y - top }
    const d = y < top ? top - y : y - bottom
    if (d < nearestDist) {
      nearestDist = d
      nearest = { pIdx: i, rx: (x - left) / width, dy: y - top }
    }
  }
  return nearest
}
// 锚点 → 当前内容坐标；还原不出来返回 null（回退等比缩放）
function _pointAt(a) {
  const c = drawCanvas.value
  if (!a || !c) return null
  const b = _blocks()[a.pIdx]
  if (!b) return null
  const cr = c.getBoundingClientRect()
  const r = b.getBoundingClientRect()
  return { x: r.left - cr.left + (a.rx || 0) * (r.width || 1), y: r.top - cr.top + (a.dy || 0) }
}
// 生成笔迹时附带首尾锚点
function _anchored(stroke, x1, y1, x2, y2) {
  stroke.a1 = _anchorAt(x1, y1)
  stroke.a2 = _anchorAt(x2, y2)
  return stroke
}
// ===== 文本区间锚点：像批注一样按「段落 + 字符起止」记忆位置 =====
// 像素锚点 dy 不随字号变化；这里给选中自动线额外记下它在段落纯文本中的字符区间，
// 重绘时用 Range 重新量出该行矩形，字号 / 换行 / 侧栏变化都能跟随。
function _offsetInBlock(block, node, offset) {
  const pre = document.createRange()
  pre.selectNodeContents(block)
  try {
    pre.setEnd(node, offset)
    return pre.toString().length
  } catch {
    return null
  }
}
// 选区逐字符量矩形，得到每字符在段落纯文本中的起止与屏幕位置
function _selectionCharRects(range, blocks, cr) {
  const chars = []
  // 超长选区跳过逐字符测量，避免卡顿（回退像素锚点）
  if (range.toString().length > 2000) return chars
  for (let pIdx = 0; pIdx < blocks.length; pIdx++) {
    const block = blocks[pIdx]
    if (!range.intersectsNode(block)) continue
    const total = block.textContent.length
    let s = 0
    let e = total
    if (block === range.startContainer || block.contains(range.startContainer)) {
      const v = _offsetInBlock(block, range.startContainer, range.startOffset)
      if (v != null) s = v
    }
    if (block === range.endContainer || block.contains(range.endContainer)) {
      const v = _offsetInBlock(block, range.endContainer, range.endOffset)
      if (v != null) e = v
    }
    if (e <= s) continue
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null, false)
    const charRange = document.createRange()
    let node
    let nodeStart = 0
    while ((node = walker.nextNode())) {
      const len = node.nodeValue.length
      const from = Math.max(0, s - nodeStart)
      const to = Math.min(len, e - nodeStart)
      if (to > from) {
        for (let i = from; i < to; i++) {
          charRange.setStart(node, i)
          charRange.setEnd(node, i + 1)
          const r = charRange.getBoundingClientRect()
          if (r.width < 0.5 || r.height < 0.5) continue
          chars.push({
            pIdx, start: nodeStart + i, end: nodeStart + i + 1,
            top: r.top - cr.top, bottom: r.bottom - cr.top,
            left: r.left - cr.left, right: r.right - cr.left,
          })
        }
      }
      nodeStart += len
    }
  }
  return chars
}
// 按视觉行聚合字符（top 3px 内视为同一行），与 collectSelectionLines 的行拆分保持一致
function _groupCharRects(chars) {
  const groups = []
  for (const c of chars) {
    let g = groups.find((x) => x.pIdx === c.pIdx && Math.abs(x.top - c.top) <= 3)
    if (!g) {
      g = { pIdx: c.pIdx, top: c.top, start: c.start, end: c.end, x1: c.left, x2: c.right, y: c.bottom }
      groups.push(g)
    } else {
      g.start = Math.min(g.start, c.start)
      g.end = Math.max(g.end, c.end)
      g.x1 = Math.min(g.x1, c.left)
      g.x2 = Math.max(g.x2, c.right)
      g.y = Math.max(g.y, c.bottom)
    }
  }
  return groups
}
// 文本区间 → 当前布局下的行矩形；字号变大折行时取文本顺序的首行
function _textLineGeom(t) {
  const c = drawCanvas.value
  if (!t || !c || t.start == null || t.end == null) return null
  const block = _blocks()[t.pIdx]
  if (!block) return null
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null, false)
  let node
  let nodeStart = 0
  let startNode
  let startOff
  let endNode
  let endOff
  while ((node = walker.nextNode())) {
    const len = node.nodeValue.length
    if (!len) continue
    if (!startNode && t.start >= nodeStart && t.start <= nodeStart + len) {
      startNode = node
      startOff = t.start - nodeStart
    }
    if (t.end >= nodeStart && t.end <= nodeStart + len) {
      endNode = node
      endOff = t.end - nodeStart
      break
    }
    nodeStart += len
  }
  if (!startNode || !endNode) return null
  const r = document.createRange()
  try {
    r.setStart(startNode, startOff)
    r.setEnd(endNode, endOff)
  } catch {
    return null
  }
  const rects = Array.from(r.getClientRects()).filter((x) => x.width >= 0.5 && x.height >= 0.5)
  if (!rects.length) return null
  const rect = rects[0]
  const cr = c.getBoundingClientRect()
  return {
    x1: rect.left - cr.left,
    x2: rect.right - cr.left,
    y: rect.bottom - cr.top + LINE_GAP,
    h: rect.height,
  }
}
// 笔迹在「当前布局」下的实际显示坐标：有锚点按锚点还原，否则按画布比例缩放（旧数据）
function _strokeGeom(s) {
  const c = drawCanvas.value
  const sx = c ? c.width / (refCanvasW.value || c.width) : 1
  const sy = c ? c.height / (refCanvasH.value || c.height) : 1
  const p1 = s.a1 ? _pointAt(s.a1) : null
  const p2 = s.a2 ? _pointAt(s.a2) : null
  if (s.type === 'pen') {
    if (p1 && p2) return { points: [[p1.x, p1.y], [p2.x, p2.y]] }
    return { points: (s.points || []).map(([x, y]) => [x * sx, y * sy]) }
  }
  if (s.type === 'wavy' || s.type === 'double') {
    // 文本区间锚点优先：字号 / 换行 / 侧栏变化后由 Range 重新量出该行真实位置
    const tg = s.t ? _textLineGeom(s.t) : null
    if (tg) return { x1: tg.x1, y1: tg.y, x2: tg.x2, y2: tg.y, h: tg.h }
    if (p1 && p2) return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p1.y, h: s.h }
    return {
      x1: (s.x1 ?? s.points?.[0]?.[0] ?? 0) * sx,
      y1: (s.y1 ?? s.points?.[0]?.[1] ?? 0) * sy,
      x2: (s.x2 ?? s.points?.[s.points.length - 1]?.[0] ?? 0) * sx,
      y2: (s.y1 ?? s.points?.[0]?.[1] ?? 0) * sy,
      h: s.h,
    }
  }
  return null
}
function _redrawAll() {
  const c = drawCanvas.value
  if (!c) return
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 2
  for (const s of strokes.value) {
    ctx.strokeStyle = s.color
    const g = _strokeGeom(s)
    if (!g) continue // 历史矩形笔迹等已移除类型：不渲染
    if (s.type === 'pen') {
      if (!g.points.length) continue
      ctx.beginPath()
      ctx.moveTo(g.points[0][0], g.points[0][1])
      for (let i = 1; i < g.points.length; i++) ctx.lineTo(g.points[i][0], g.points[i][1])
      ctx.stroke()
    } else if (s.type === 'wavy' || s.type === 'double') {
      if (s.style === 'redWavyBg') {
        _drawWavyBg(ctx, g.x1, g.y1, g.x2, s.color || RED_WAVY_COLOR, g.h ?? s.h)
      } else {
        // 无 style 的历史橙色手绘笔迹：按原样渲染，不改写已存数据
        const { amp, wavelen } = _sketchParams(s)
        _drawSketch(ctx, g.x1, g.y1, g.x2, g.y1, s.color || props.color, amp, wavelen)
      }
    }
  }
  ctx.restore()
}

// ===== 下划线样式：红色波浪线 + 红色背景 =====
// 参考 下划线.html 的 .wavy-bg（波浪线 + 背景色），改为全红系；无切换控件 / 快捷键。
// 画布覆盖在正文之上（pointer-events:none），背景只能用半透明填充让文字透出；
// 新笔迹固定带 style:'redWavyBg' / h，重绘、橡皮擦命中与落库都按样式区分。
// 历史橙色手绘风笔迹（无 style，参考 下划线1.html 的 .ul-sketch）仍按 _drawSketch 原样渲染。
const SKETCH_AMP = 3 // 手绘风波幅（px）
const SKETCH_WAVELEN = 50 // 手绘风波长（px），与 .ul-sketch 的 viewBox 比例相近
const WAVY_AMP = 2 // 红底样式波幅：细密波浪，接近 CSS `underline wavy`
const WAVY_WAVELEN = 12 // 红底样式波长
const RED_WAVY_COLOR = '#cf222e' // 与 下划线.html 的 .wavy-error / .wavy-bg 同色
const RED_WAVY_BG = 'rgba(207, 34, 46, 0.16)' // 淡红半透明底，避免盖住正文文字
const DEFAULT_LINE_H = 24 // 历史笔迹没有行高时的兜底值

// 笔迹使用的波浪参数：橡皮擦采样必须与绘制轨迹一致
function _sketchParams(s) {
  return s?.style === 'redWavyBg'
    ? { amp: WAVY_AMP, wavelen: WAVY_WAVELEN }
    : { amp: SKETCH_AMP, wavelen: SKETCH_WAVELEN }
}

function _drawSketch(ctx, x1, y1, x2, y2, color, amp = SKETCH_AMP, wavelen = SKETCH_WAVELEN) {
  // 从 x1 到 x2 绘制一条波浪线，围绕 y1 上下波动
  const xFrom = Math.min(x1, x2)
  const xTo = Math.max(x1, x2)
  if (xTo - xFrom < 1) return
  ctx.save() // 隔离 lineWidth / lineCap，避免污染后续笔迹绘制
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  let first = true
  for (let x = xFrom; x <= xTo; x++) {
    const y = y1 + amp * Math.cos((2 * Math.PI * (x - xFrom)) / wavelen)
    if (first) { ctx.moveTo(x, y); first = false }
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.restore()
}

// 红色波浪线 + 红色背景：背景覆盖被选中文字所在行盒（h 为行高），波浪线落在其下方 LINE_GAP 处
function _drawWavyBg(ctx, x1, y1, x2, color, h) {
  const xFrom = Math.min(x1, x2) - 2
  const xTo = Math.max(x1, x2) + 2
  if (xTo - xFrom < 1) return
  const lineH = h || DEFAULT_LINE_H
  const bottom = y1 - LINE_GAP
  ctx.save() // 隔离 fillStyle，避免污染后续笔迹绘制
  ctx.fillStyle = RED_WAVY_BG
  ctx.fillRect(xFrom, bottom - lineH, xTo - xFrom, lineH)
  ctx.restore()
  _drawSketch(ctx, x1, y1, x2, y1, color, WAVY_AMP, WAVY_WAVELEN)
}
function _segSegIntersect(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y) {
  const d1x = p1x - p0x, d1y = p1y - p0y
  const d2x = p3x - p2x, d2y = p3y - p2y
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < 1e-10) return false
  const t = ((p2x - p0x) * d2y - (p2y - p0y) * d2x) / denom
  const u = ((p2x - p0x) * d1y - (p2y - p0y) * d1x) / denom
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}
function _segIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
  return (
    _segSegIntersect(x1, y1, x2, y2, rx, ry, rx, ry + rh) ||
    _segSegIntersect(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh) ||
    _segSegIntersect(x1, y1, x2, y2, rx, ry, rx + rw, ry) ||
    _segSegIntersect(x1, y1, x2, y2, rx, ry + rh, rx + rw, ry + rh)
  )
}
function _eraseRect(rx, ry, rw, rh) {
  // 切文章窗口内正文正在替换，此处产生的锚点不可靠，直接忽略操作
  if (_switching || _disposed) return
  if (rw === 0 && rh === 0) return
  if (rw < 0) { rx += rw; rw = -rw }
  if (rh < 0) { ry += rh; rh = -rh }
  let changed = false
  const eraseGroups = new Set() // 命中同组任意一行 → 整组一起擦除
  const eraseSingles = new Set() // 旧数据无 groupId：逐条擦除
  for (const s of strokes.value) {
    let hit = false
    // 用笔迹在当前布局下的显示坐标判断命中，避免正文让位后橡皮与所见笔迹错位
    const g = _strokeGeom(s)
    if (!g) continue // 历史矩形笔迹等已移除类型：跳过
    if (s.type === 'pen') {
      const pts = g.points
      // 点在矩形内
      for (const [px, py] of pts) {
        if (px >= rx && px <= rx + rw && py >= ry && py <= ry + rh) {
          hit = true
          break
        }
      }
      // 线段与矩形边相交
      if (!hit) {
        for (let j = 1; j < pts.length; j++) {
          if (_segIntersectsRect(pts[j-1][0], pts[j-1][1], pts[j][0], pts[j][1], rx, ry, rw, rh)) {
            hit = true
            break
          }
        }
      }
    } else if (s.type === 'wavy' || s.type === 'double') {
      const xFrom = Math.min(g.x1, g.x2)
      const xTo = Math.max(g.x1, g.x2)
      if (xTo - xFrom < 1) continue
      // 沿波动轨迹采样，任一点落在橡皮矩形内即命中（两种样式波形不同，参数随笔迹取）
      const { amp, wavelen } = _sketchParams(s)
      for (let x = xFrom; x <= xTo; x += 2) {
        const py = g.y1 + amp * Math.cos((2 * Math.PI * (x - xFrom)) / wavelen)
        if (x >= rx && x <= rx + rw && py >= ry && py <= ry + rh) { hit = true; break }
      }
      // 红底样式另有覆盖文字行的背景块：框选只落在文字行（不含下方波浪线）时也应命中
      if (!hit && s.style === 'redWavyBg') {
        const lineH = s.h || DEFAULT_LINE_H
        const bottom = g.y1 - LINE_GAP
        hit = xFrom - 2 < rx + rw && xTo + 2 > rx && bottom - lineH < ry + rh && bottom > ry
      }
    }
    if (hit) {
      if (s.origin === 'selection' && s.groupId) eraseGroups.add(s.groupId)
      else eraseSingles.add(s)
      changed = true
    }
  }
  if (changed) {
    strokes.value = strokes.value.filter(
      (s) => !eraseSingles.has(s) && !(s.groupId && eraseGroups.has(s.groupId)),
    )
    _redrawAll()
    _saveCanvas()
    _commitStrokes() // 删一笔立即入库
  }
}
function getPos(e) {
  const c = drawCanvas.value
  if (!c) return { x: 0, y: 0 }
  const r = c.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}
// 画布不再支持手画：canvas 上的鼠标拖拽只用于橡皮擦框选，笔迹一律由「选中文本」生成。
function startDraw(e) {
  if (e.button !== 0 || props.tool !== 'eraser') return
  isDrawing.value = true
  const p = getPos(e)
  eraseStartX.value = p.x
  eraseStartY.value = p.y
  lastX.value = p.x
  lastY.value = p.y
}
function draw(e) {
  if (!isDrawing.value || props.tool !== 'eraser') return
  const c = drawCanvas.value
  if (!c) return
  const p = getPos(e)
  _redrawAll()
  const ctx = c.getContext('2d')
  ctx.save()
  ctx.strokeStyle = 'rgba(100, 180, 255, 0.7)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([6, 4])
  ctx.strokeRect(
    eraseStartX.value,
    eraseStartY.value,
    p.x - eraseStartX.value,
    p.y - eraseStartY.value,
  )
  ctx.restore()
  lastX.value = p.x
  lastY.value = p.y
}
function endDraw() {
  if (!isDrawing.value || props.tool !== 'eraser') return
  isDrawing.value = false
  _eraseRect(eraseStartX.value, eraseStartY.value, lastX.value - eraseStartX.value, lastY.value - eraseStartY.value)
  _redrawAll()
  _saveCanvas()         // 仅更新内存快照；命中删除已由 _eraseRect 即时入库
}

// ===== 选中文本 → 自动在该行文字下方加线 =====
// 选中即触发（见下方 document mousedown/mouseup 监听）：复用手动绘制的同一种笔迹
// （wavy / pen）与同一套段落锚点 a1/a2，只把「鼠标拖出的水平线」换成「由选区矩形算出的水平线」。
// 样式固定为红色细密波浪线 + 红色半透明背景（参考 下划线.html 的 .wavy-bg），
// 不新增快捷键、无切换控件；历史橙色手绘笔迹仍在 _redrawAll 里按原样渲染。
// 正文被 .annotated / <mark> 切成多个 span，getClientRects() 会返回碎片，
// 需按所在段落 + 行 top 合并后逐行处理；两端锚点必须落在同一块内
// （_strokeGeom 强制 y=p1.y、终点 x=p2.x，跨块会错位）。
// 返回 { lines, cr, blockRects }，供 applySelectionLines() 做重合判断与落库。
function collectSelectionLines() {
  const c = drawCanvas.value
  if (!props.drawMode || props.drawActive || !props.autoAddLines || !c) return null
  const sel = window.getSelection?.()
  if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.toString().trim()) return null
  const range = sel.getRangeAt(0)
  const root = range.commonAncestorContainer
  const rootEl = root?.nodeType === 1 ? root : root?.parentElement
  if (!rootEl?.closest('.reader-content') || rootEl.closest('.side-panel, .note-root')) return

  const cr = c.getBoundingClientRect()
  const blocks = _blocks()
  if (!blocks.length) return
  const blockRects = blocks.map((b) => b.getBoundingClientRect())
  // 行矩形 → 所属段落：优先取纵向覆盖该行的块，否则取 top 最近的块
  const blockIndexFor = (rect) => {
    let idx = blockRects.findIndex((r) => rect.top >= r.top - 2 && rect.bottom <= r.bottom + 2)
    if (idx < 0) {
      let best = Infinity
      blockRects.forEach((r, i) => {
        const d = Math.abs(rect.top - r.top)
        if (d < best) {
          best = d
          idx = i
        }
      })
    }
    return idx
  }

  // 先逐字符量出选区覆盖的文本区间（与批注同款锚点），再与视觉行对齐
  const textGroups = _groupCharRects(_selectionCharRects(range, blocks, cr))
  // 按段落收集、按行 top 排序，3px 内视为同一行合并（跨行选区生成多条水平线）
  const rowsByBlock = new Map()
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.width < 1 || rect.height < 1) continue
    const pIdx = blockIndexFor(rect)
    if (pIdx < 0 || !blockRects[pIdx]) continue
    if (!rowsByBlock.has(pIdx)) rowsByBlock.set(pIdx, [])
    const top = rect.top - cr.top
    const tg = textGroups.find((g) => g.pIdx === pIdx && Math.abs(g.top - top) <= 3)
    rowsByBlock.get(pIdx).push({
      pIdx,
      top,
      x1: rect.left - cr.left,
      x2: rect.right - cr.left,
      y: rect.bottom - cr.top,
      textStart: tg ? tg.start : null,
      textEnd: tg ? tg.end : null,
    })
  }
  const lines = []
  for (const rows of rowsByBlock.values()) {
    rows.sort((a, b) => a.top - b.top)
    for (const row of rows) {
      const cur = lines[lines.length - 1]
      if (cur && cur.pIdx === row.pIdx && Math.abs(row.top - cur.top) <= 3) {
        cur.x1 = Math.min(cur.x1, row.x1)
        cur.x2 = Math.max(cur.x2, row.x2)
        cur.y = Math.max(cur.y, row.y)
        if (row.textStart != null) {
          cur.textStart = cur.textStart == null ? row.textStart : Math.min(cur.textStart, row.textStart)
          cur.textEnd = cur.textEnd == null ? row.textEnd : Math.max(cur.textEnd, row.textEnd)
        }
      } else {
        lines.push({ ...row })
      }
    }
  }
  if (!lines.length) return null
  return { lines, cr, blockRects }
}

// 与已有的「选中自动线」（origin:'selection'）按「组」比较：
// 同一次选区跨行产生的多条线共用一个 groupId，是一个整体，不能各自为营：
//   · 组内任意一行被重新画 / 部分重合 → 整组一起删除，再按本次选区整组重画
//   · 本次选区与某个组完全重合 → 整组删除、不添加（再次选中同一处即取消整组）
//   · 不重合 → 直接添加一个新组
// 旧数据没有 groupId：每条线自成一组（用对象引用做键），保持逐条行为。
// 手绘笔迹（无 origin 标记）不参与重合判断，仍只能用橡皮擦擦除。
const LINE_GAP = 5 // 波浪中心相对文字行盒底部的距离（px）：原 3px + 文字底部增加 2px
const TOL_X = 4 // 完全重合的横向容差（px）
const TOL_Y = 5 // 同一行的纵向容差（px）
let _selectionGroupSeq = 0
function _newSelectionGroupId() {
  return `sel-${Date.now().toString(36)}-${++_selectionGroupSeq}`
}
function _groupKey(s) {
  return s.groupId || s
}
function applySelectionLines() {
  // 切文章窗口内正文正在替换，锚点会算错；onReaderMouseUp 的 setTimeout 可能
  // 恰好落在窗口里，必须在这里再挡一次
  if (_switching || _disposed) return
  const data = collectSelectionLines()
  if (!data) return
  const { lines, cr, blockRects } = data

  // 1) 逐行计算几何，并找出与该行重合的已有选中线
  const rows = []
  for (const line of lines) {
    const br = blockRects[line.pIdx]
    if (!br) continue
    const left = br.left - cr.left
    const top = br.top - cr.top
    const width = br.width || 1
    const x1 = line.x1
    const x2 = line.x2
    if (x2 - x1 < 1) continue
    const y = line.y + LINE_GAP

    const geomOf = (s) => {
      const tg = s.t ? _textLineGeom(s.t) : null
      if (tg) return { x1: tg.x1, x2: tg.x2, y: tg.y }
      return {
        x1: left + s.a1.rx * width,
        x2: left + s.a2.rx * width,
        y: top + s.a1.dy,
      }
    }
    const overlapping = strokes.value.filter((s) => {
      if (s.origin !== 'selection' || !s.a1 || !s.a2 || s.a1.pIdx !== line.pIdx) return false
      const g = geomOf(s)
      if (Math.abs(g.y - y) > TOL_Y) return false
      return Math.max(g.x1, x1) < Math.min(g.x2, x2) - 1
    })
    const exact = overlapping.find((s) => {
      const g = geomOf(s)
      return Math.abs(g.x1 - x1) <= TOL_X && Math.abs(g.x2 - x2) <= TOL_X
    })
    rows.push({ line, left, top, width, x1, x2, y, overlapping, exact })
  }
  if (!rows.length) return

  // 2) 触及的组整组删除：组内未被本次选区直接重合的行也一起变动
  const touched = new Set()
  for (const r of rows) for (const s of r.overlapping) touched.add(_groupKey(s))
  const toRemove = new Set()
  for (const key of touched) {
    for (const s of strokes.value) if (_groupKey(s) === key) toRemove.add(s)
  }

  // 3) 整组完全重合 → 取消：每行都命中同一组的对应线，且组内线数与本次行数一致
  const exactList = rows.map((r) => r.exact)
  let cancel = false
  if (exactList.every(Boolean) && touched.size === 1) {
    const key = [...touched][0]
    const group = strokes.value.filter((s) => _groupKey(s) === key)
    if (group.length === rows.length) cancel = true
  }

  if (toRemove.size) strokes.value = strokes.value.filter((s) => !toRemove.has(s))
  if (!cancel) {
    // 4) 按本次选区整组重画，全部行共用同一个 groupId
    const groupId = _newSelectionGroupId()
    for (const r of rows) {
      const dy = r.y - r.top
      const a1 = { pIdx: r.line.pIdx, rx: (r.x1 - r.left) / r.width, dy }
      const a2 = { pIdx: r.line.pIdx, rx: (r.x2 - r.left) / r.width, dy }
      strokes.value.push({
        type: 'double', origin: 'selection', groupId,
        style: 'redWavyBg',
        color: RED_WAVY_COLOR,
        h: r.line.y - r.line.top, // 文字行盒高度：红底背景块用它定位（旧数据回退用）
        x1: r.x1, y1: r.y, x2: r.x2, y2: r.y, a1, a2,
        t: r.line.textStart != null
          ? { pIdx: r.line.pIdx, start: r.line.textStart, end: r.line.textEnd }
          : null,
      })
    }
  }
  _redrawAll()
  _saveCanvas()
  _commitStrokes() // 画一笔（或取消一组）立即入库
  // 清除选区：::selection 的粉色只覆盖字形区，与 canvas 红底（整行盒）几何不一致，
  // 两者叠加会视觉割裂。线已记下文本锚点，选区只是触发动作，无需保留。
  window.getSelection?.()?.removeAllRanges()
}

// 只响应「从正文段落左键按下开始」的一次选择，避免点工具条按钮 / 右键批注浮栏时重复触发；
// setTimeout(0) 排在 ArticlePage.onMouseUpHandler 的 applyExpandedSelection() 之后，
// 取到扩展后（即用户看到的蓝色区域）的最终选区。
let _selectFromReader = false
function onReaderMouseDown(e) {
  _selectFromReader = !!(
    props.drawMode && !props.drawActive && e.button === 0 &&
    e.target instanceof Element && e.target.closest('.reader-content .article-para')
  )
}
function onReaderMouseUp() {
  if (!_selectFromReader) return
  _selectFromReader = false
  setTimeout(applySelectionLines, 0)
}

// ===== 快捷键 =====
function onKeydown(e) {
  if (!props.drawMode) return
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  const key = e.key.toLowerCase()
  // `1` 激活 / 关闭橡皮擦（再按一次关闭工具）
  if (key === '1') { onToolClick('eraser'); e.preventDefault() }
}
// ===== 右键：画布开启、正文面板内且无选中文本时，开/关「选中文本自动添加线」=====
// 只切换组件内的 autoAddLines，不动 drawActive / drawMode；橡皮擦工具仍由 2 或工具条按钮激活。
function onCanvasContextMenu(e) {
  if (!props.drawMode) return // 未开启画布：右键完全交还原手动注释功能
  const t = e.target
  if (!(t instanceof Element)) return
  // 只接管正文面板；侧面板（笔记 / AI）、重点集中卡片、输入区、画布工具条、左侧工具栏一律不干涉
  if (!t.closest('.reader-content')) return
  if (
    t.closest(
      '.side-panel, .note-root, .marked-panel, .input-section, .reader-left-tools',
    )
  ) return
  if (t.closest('input, textarea, [contenteditable]')) return
  // 有选中文本 / 已被正文右键批注处理 → 走原「右键手动注释」，不切换开关
  const sel = window.getSelection?.()
  if (e.defaultPrevented || (sel && !sel.isCollapsed && sel.toString().trim())) return
  e.preventDefault() // 阻止系统右键菜单
  emit('update:autoAddLines', !props.autoAddLines)
  // 8 秒后自动消失；再次右键先关掉上一条，避免堆叠
  if (_autoAddMsg) _autoAddMsg.close()
  if (!props.autoAddLines) _autoAddMsg = notifySuccess('已开启：选中文本自动添加线', { duration: 3000 })
  else _autoAddMsg = notifyError('已关闭：选中文本不再添加线', { duration: 3000 })
}
function onVisibilityHidden() {
  if (document.visibilityState === 'hidden') _beaconPendingStrokes()
}
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('contextmenu', onCanvasContextMenu)
  document.addEventListener('mousedown', onReaderMouseDown)
  document.addEventListener('mouseup', onReaderMouseUp)
  window.addEventListener('pagehide', _beaconPendingStrokes)
  document.addEventListener('visibilitychange', onVisibilityHidden)
})
onUnmounted(() => {
  // 先标记卸载：切文章（v-if="article"）时旧实例仍在途的 flush / 加载回调必须立即退出
  _disposed = true
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('contextmenu', onCanvasContextMenu)
  document.removeEventListener('mousedown', onReaderMouseDown)
  document.removeEventListener('mouseup', onReaderMouseUp)
  window.removeEventListener('pagehide', _beaconPendingStrokes)
  document.removeEventListener('visibilitychange', onVisibilityHidden)
  // 每笔已即时入库；卸载时把在途/未确认的快照交给浏览器兜底投递
  _beaconPendingStrokes()
  if (_resizeObserver) {
    _resizeObserver.disconnect()
    _resizeObserver = null
    _observedBody = null
  }
})

function onToolClick(t) {
  if (props.drawActive && props.tool === t) {
    emit('toggle-tool') // 关闭当前工具
  } else {
    emit('update:tool', t)
    if (!props.drawActive) emit('toggle-tool') // 开启工具
  }
}
function doNew() {
  // 切文章窗口内清空会把「旧文章清空」误写到新文章上
  if (_switching || _disposed) return
  const c = drawCanvas.value
  if (!c) return
  c.getContext('2d').clearRect(0, 0, c.width, c.height)
  savedCanvasData.value = null
  strokes.value = []
  _commitStrokes() // 清空立即入库（写入空数组）
}
// 暴露给 ArticleReader 左侧栏「新画布」按钮，复用清空逻辑
defineExpose({ clearCanvas: doNew })
</script>

<template>
  <div class="draw-container">
    <canvas
      :key="articleId"
      ref="drawCanvas"
      v-show="drawMode"
      class="draw-canvas-el"
      :class="{ active: drawActive }"
      @mousedown="startDraw"
      @mousemove="draw"
      @mouseup="endDraw"
      @mouseleave="endDraw"
    ></canvas>

  </div>
</template>

<style scoped>
.draw-container {
  display: contents;
}
.draw-canvas-el {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 900;
  /* 笔形光标：热点落在笔尖（约 2,21），兜底 crosshair */
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath fill='%231f1f1f' stroke='%23fff' stroke-width='1' d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z'/%3E%3C/svg%3E") 2 21, crosshair;
}
.draw-canvas-el.active {
  pointer-events: auto;
}


</style>
