<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { fetchCanvasStrokes, saveCanvasStrokes } from '@/api'
import { notifySuccess, notifyError } from '@/utils/feedback'

const props = defineProps({
  drawMode: Boolean,
  drawActive: Boolean,
  tool: { type: String, default: 'eraser' },
  color: { type: String, default: '#f08200' },
  articleId: { type: String, default: '' },
  panelOpen: { type: Boolean, default: false },
})

const emit = defineEmits(['toggle-draw', 'toggle-tool', 'close-canvas', 'new-canvas', 'update:tool'])

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
const autoAddLines = ref(true) // 右键开/关：选中文本是否自动添加线

let _resizeObserver = null
let _saveDebounceTimer = null

// 防抖保存到服务端（500ms）
function _scheduleSave() {
  if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer)
  _saveDebounceTimer = setTimeout(() => _persistStrokes(), 500)
}
async function _persistStrokes() {
  if (!props.articleId) return
  try {
    await saveCanvasStrokes(props.articleId, strokes.value)
  } catch (e) {
    console.error('保存画布笔迹失败:', e)
  }
}
async function _persistStrokesSync() {
  if (_saveDebounceTimer) {
    clearTimeout(_saveDebounceTimer)
    _saveDebounceTimer = null
  }
  if (!props.articleId) return
  try {
    await saveCanvasStrokes(props.articleId, strokes.value)
  } catch (e) {
    console.error('保存画布笔迹失败:', e)
  }
}

watch(
  () => props.drawMode,
  async (val) => {
    await nextTick()
    if (val) {
      _initCanvas()
      await _loadStrokes()
      const container = drawCanvas.value?.closest('.reader-content')
      if (container && !_resizeObserver) {
        _resizeObserver = new ResizeObserver(() => {
          if (props.drawMode) { _initCanvas(); _redrawAll() }
        })
        _resizeObserver.observe(container)
      }
    } else {
      if (_resizeObserver) {
        await _persistStrokesSync()
        _resizeObserver.disconnect()
        _resizeObserver = null
      }
    }
  },
  { immediate: true },
)

function _initCanvas() {
  const c = drawCanvas.value
  if (!c) return
  const container = c.closest('.reader-content')
  if (!container) return
  const w = container.getBoundingClientRect().width
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

// 切换文章时：保存旧文章笔迹到服务端，重置状态
watch(() => props.articleId, async (_newId, oldId) => {
  if (oldId && oldId !== 'default') {
    await _persistStrokesSync()
  }
  refCanvasW.value = 0
  refCanvasH.value = 0
  strokes.value = []
  savedCanvasData.value = null
})

async function _loadStrokes() {
  try {
    const res = await fetchCanvasStrokes(props.articleId)
    strokes.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('加载画布笔迹失败，回退 localStorage:', e)
    try {
      const saved = localStorage.getItem(`_canvas_strokes_${props.articleId}`)
      if (saved) strokes.value = JSON.parse(saved)
    } catch {}
  }
  if (strokes.value.length > 0) {
    _redrawAll()
    _saveCanvas()
    _persistStrokesSync()
  } else if (savedCanvasData.value) {
    _drawImg(savedCanvasData.value)
  }
}
function _saveCanvas() {
  const c = drawCanvas.value
  if (!c) return
  savedCanvasData.value = c.toDataURL()
  _scheduleSave()
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
    if (p1 && p2) return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p1.y }
    return {
      x1: (s.x1 ?? s.points?.[0]?.[0] ?? 0) * sx,
      y1: (s.y1 ?? s.points?.[0]?.[1] ?? 0) * sy,
      x2: (s.x2 ?? s.points?.[s.points.length - 1]?.[0] ?? 0) * sx,
      y2: (s.y1 ?? s.points?.[0]?.[1] ?? 0) * sy,
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
      _drawSketch(ctx, g.x1, g.y1, g.x2, g.y1, s.color)
    }
  }
  ctx.restore()
}

// 手绘风下划线：单条手写感波浪线，参考 下划线1.html 的 .ul-sketch（橙色 #f08200 的 SVG 波浪路径）；
// 颜色跟随 color prop（默认 #f08200），橡皮擦命中判断要覆盖波动范围。
const SKETCH_AMP = 3 // 波幅（px）
const SKETCH_WAVELEN = 50 // 波长（px），与 .ul-sketch 的 viewBox 比例相近

function _drawSketch(ctx, x1, y1, x2, y2, color) {
  // 从 x1 到 x2 绘制一条手绘感波浪线，围绕 y1 上下波动
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
    const y = y1 + SKETCH_AMP * Math.cos((2 * Math.PI * (x - xFrom)) / SKETCH_WAVELEN)
    if (first) { ctx.moveTo(x, y); first = false }
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.restore()
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
  if (rw === 0 && rh === 0) return
  if (rw < 0) { rx += rw; rw = -rw }
  if (rh < 0) { ry += rh; rh = -rh }
  let changed = false
  for (let i = strokes.value.length - 1; i >= 0; i--) {
    const s = strokes.value[i]
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
      // 沿波动轨迹采样，任一点落在橡皮矩形内即命中
      for (let x = xFrom; x <= xTo; x += 2) {
        const py = g.y1 + SKETCH_AMP * Math.cos((2 * Math.PI * (x - xFrom)) / SKETCH_WAVELEN)
        if (x >= rx && x <= rx + rw && py >= ry && py <= ry + rh) { hit = true; break }
      }
    }
    if (hit) {
      strokes.value.splice(i, 1)
      changed = true
    }
  }
  if (changed) {
    _redrawAll()
    _saveCanvas()
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
  _saveCanvas()         // 防抖 500ms 保存
  _persistStrokesSync() // 立即同步保存，防止 HMR 卸载时丢失数据
}

// ===== 选中文本 → 自动在该行文字下方加线 =====
// 选中即触发（见下方 document mousedown/mouseup 监听）：复用手动绘制的同一种笔迹
// （wavy / pen）与同一套段落锚点 a1/a2，只把「鼠标拖出的水平线」换成「由选区矩形算出的水平线」。
// 样式固定为手绘风下划线（单条波浪线，参考 下划线1.html 的 .ul-sketch），颜色取 color prop（默认 #f08200），不新增快捷键。
// 正文被 .annotated / <mark> 切成多个 span，getClientRects() 会返回碎片，
// 需按所在段落 + 行 top 合并后逐行处理；两端锚点必须落在同一块内
// （_strokeGeom 强制 y=p1.y、终点 x=p2.x，跨块会错位）。
// 返回 { lines, cr, blockRects }，供 applySelectionLines() 做重合判断与落库。
function collectSelectionLines() {
  const c = drawCanvas.value
  if (!props.drawMode || props.drawActive || !autoAddLines.value || !c) return null
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

  // 按段落收集、按行 top 排序，3px 内视为同一行合并（跨行选区生成多条水平线）
  const rowsByBlock = new Map()
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.width < 1 || rect.height < 1) continue
    const pIdx = blockIndexFor(rect)
    if (pIdx < 0 || !blockRects[pIdx]) continue
    if (!rowsByBlock.has(pIdx)) rowsByBlock.set(pIdx, [])
    rowsByBlock.get(pIdx).push({
      pIdx,
      top: rect.top - cr.top,
      x1: rect.left - cr.left,
      x2: rect.right - cr.left,
      y: rect.bottom - cr.top,
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
      } else {
        lines.push({ ...row })
      }
    }
  }
  if (!lines.length) return null
  return { lines, cr, blockRects }
}

// 与已有的「选中自动线」（origin:'selection'）按同一段落、同一行比较：
//   · 完全重合 → 删除原线、不添加（再次选中同一处即取消）
//   · 部分重合 → 删除所有重叠的原线，按本次选区添加
//   · 不重合   → 直接添加
// 手绘笔迹（无 origin 标记）不参与重合判断，仍只能用橡皮擦擦除。
const LINE_GAP = 5 // 波浪中心相对文字行盒底部的距离（px）：原 3px + 文字底部增加 2px
const TOL_X = 4 // 完全重合的横向容差（px）
const TOL_Y = 5 // 同一行的纵向容差（px）
function applySelectionLines() {
  const data = collectSelectionLines()
  if (!data) return
  const { lines, cr, blockRects } = data
  const toRemove = new Set()
  const toAdd = []
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

    const geomOf = (s) => ({
      x1: left + s.a1.rx * width,
      x2: left + s.a2.rx * width,
      y: top + s.a1.dy,
    })
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
    for (const s of overlapping) toRemove.add(s)
    if (exact && overlapping.length === 1) continue // 完全重合：只删不加

    const dy = y - top
    const a1 = { pIdx: line.pIdx, rx: (x1 - left) / width, dy }
    const a2 = { pIdx: line.pIdx, rx: (x2 - left) / width, dy }
    toAdd.push(
      { type: 'double', origin: 'selection', color: props.color, x1, y1: y, x2, y2: y, a1, a2 },
    )
  }
  if (!toRemove.size && !toAdd.length) return
  if (toRemove.size) strokes.value = strokes.value.filter((s) => !toRemove.has(s))
  if (toAdd.length) strokes.value.push(...toAdd)
  _redrawAll()
  _saveCanvas()
  _persistStrokesSync()
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
      '.side-panel, .note-root, .marked-panel, .input-section, .draw-toolbar, .reader-left-tools',
    )
  ) return
  if (t.closest('input, textarea, [contenteditable]')) return
  // 有选中文本 / 已被正文右键批注处理 → 走原「右键手动注释」，不切换开关
  const sel = window.getSelection?.()
  if (e.defaultPrevented || (sel && !sel.isCollapsed && sel.toString().trim())) return
  e.preventDefault() // 阻止系统右键菜单
  autoAddLines.value = !autoAddLines.value
  if (autoAddLines.value) notifySuccess('已开启：选中文本自动添加线')
  else notifyError('已关闭：选中文本不再添加线')
}
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('contextmenu', onCanvasContextMenu)
  document.addEventListener('mousedown', onReaderMouseDown)
  document.addEventListener('mouseup', onReaderMouseUp)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('contextmenu', onCanvasContextMenu)
  document.removeEventListener('mousedown', onReaderMouseDown)
  document.removeEventListener('mouseup', onReaderMouseUp)
  _persistStrokesSync()
  if (_resizeObserver) {
    _resizeObserver.disconnect()
    _resizeObserver = null
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
function doClose() {
  emit('close-canvas')
}
function doNew() {
  const c = drawCanvas.value
  if (!c) return
  c.getContext('2d').clearRect(0, 0, c.width, c.height)
  savedCanvasData.value = null
  strokes.value = []
  _persistStrokesSync()
}
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

    <!-- 画布工具栏 -->
    <div
      v-if="drawMode"
      class="draw-toolbar"
      :class="{ inactive: !drawActive }"
      :style="panelOpen ? { transform: 'translateX(calc(-50% - 23vw))' } : {}"
    >
      <div class="draw-tools">
        <button class="dt-btn" :class="{ active: tool === 'eraser' && drawActive }" @click="onToolClick('eraser')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
            <line x1="18" y1="6" x2="6" y2="18"/>
          </svg>
        </button>
      </div>
      <button class="dt-btn dt-primary" @click="doClose">✓ 完成</button>
      <button class="dt-btn" @click="doNew">新画布</button>
    </div>
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
.draw-toolbar {
  position: fixed;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 999;
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 12px;
  padding: 10px 18px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}
.draw-tools {
  display: flex;
  gap: 4px;
  padding-right: 8px;
  border-right: 1px solid #e4e7ed;
}
.dt-btn {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.15s;
  line-height: 1;
}
.dt-btn:hover {
  background: #f0f0f0;
}
.dt-btn.active {
  background: #e6f0ff;
  color: #409eff;
}
.dt-primary {
  background: #409eff;
  color: #fff;
  border-radius: 6px;
  padding: 4px 12px;
}
.dt-primary:hover {
  background: #3a8ee6;
}
/* drawActive=false 是「选中即自动加线」的常态，工具条保持清晰可用 */
.draw-toolbar.inactive { opacity: 0.9; }


</style>
