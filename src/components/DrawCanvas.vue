<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { fetchCanvasStrokes, saveCanvasStrokes } from '@/api'

const props = defineProps({
  drawMode: Boolean,
  drawActive: Boolean,
  tool: { type: String, default: 'pen' },
  color: { type: String, default: '#e74c3c' },
  colors: {
    type: Array,
    default: () => ['#e74c3c', '#1c2833', '#1f6ea8', '#1a7a42', '#b9770e', '#76448a'],
  },
  articleId: { type: String, default: '' },
  panelOpen: { type: Boolean, default: false },
})

const emit = defineEmits(['toggle-draw', 'toggle-tool', 'close-canvas', 'new-canvas', 'update:tool', 'update:color'])

const drawCanvas = ref(null)
const isDrawing = ref(false)
const lastX = ref(0)
const lastY = ref(0)
const rectStartX = ref(0)
const rectStartY = ref(0)
const currentPoints = ref([])
const wavyStartX = ref(0)
const wavyStartY = ref(0)
const strokes = ref([])
const savedCanvasData = ref(null)
const refCanvasW = ref(0)
const refCanvasH = ref(0)
const penStyle = ref('straight') // 'straight' | 'wavy'，仅画笔生效

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
function _setStyle(ctx) {
  ctx.strokeStyle = props.color
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
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
  if (s.type === 'wavy') {
    if (p1 && p2) return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p1.y }
    return {
      x1: (s.x1 ?? s.points?.[0]?.[0] ?? 0) * sx,
      y1: (s.y1 ?? s.points?.[0]?.[1] ?? 0) * sy,
      x2: (s.x2 ?? s.points?.[s.points.length - 1]?.[0] ?? 0) * sx,
      y2: (s.y1 ?? s.points?.[0]?.[1] ?? 0) * sy,
    }
  }
  if (p1 && p2) {
    return {
      x: Math.min(p1.x, p2.x),
      y: Math.min(p1.y, p2.y),
      w: Math.abs(p2.x - p1.x),
      h: Math.abs(p2.y - p1.y),
    }
  }
  return { x: (s.x || 0) * sx, y: (s.y || 0) * sy, w: (s.w || 0) * sx, h: (s.h || 0) * sy }
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
    if (s.type === 'pen') {
      if (!g.points.length) continue
      ctx.beginPath()
      ctx.moveTo(g.points[0][0], g.points[0][1])
      for (let i = 1; i < g.points.length; i++) ctx.lineTo(g.points[i][0], g.points[i][1])
      ctx.stroke()
    } else if (s.type === 'wavy') {
      _drawCosSegment(ctx, g.x1, g.y1, g.x2, g.y1, s.color, 2)
    } else if (s.type === 'rect') {
      ctx.strokeRect(g.x, g.y, g.w, g.h)
    }
  }
  ctx.restore()
}

function _drawCosSegment(ctx, x1, y1, x2, y2, color, lineWidth) {
  // 从 x1 到 x2 绘制一段水平 cos 波，y 固定在 y1 高度
  const xFrom = Math.min(x1, x2)
  const xTo = Math.max(x1, x2)
  if (xTo - xFrom < 1) return
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth || 2
  ctx.beginPath()
  const amp = 3           // 振幅
  const freq = 0.06       // 频率（每像素弧度）
  let first = true
  for (let x = xFrom; x <= xTo; x++) {
    const y = y1 + amp * Math.cos(x * freq * Math.PI * 2)
    if (first) { ctx.moveTo(x, y); first = false }
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
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
function _rectsOverlap(a, b, c, d, e, f, g, h) {
  if (c < 0) { a += c; c = -c }
  if (d < 0) { b += d; d = -d }
  if (g < 0) { e += g; g = -g }
  if (h < 0) { f += h; h = -h }
  return a < e + g && a + c > e && b < f + h && b + d > f
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
    } else if (s.type === 'wavy') {
      const wx1 = g.x1
      const wy1 = g.y1
      const wx2 = g.x2
      const xFrom = Math.min(wx1, wx2)
      const xTo = Math.max(wx1, wx2)
      if (xTo - xFrom < 1) continue
      for (let x = xFrom; x <= xTo; x += 2) {
        const py = wy1 + 3 * Math.cos(x * 0.06 * Math.PI * 2)
        if (x >= rx && x <= rx + rw && py >= ry && py <= ry + rh) {
          hit = true
          break
        }
      }
    } else if (s.type === 'rect') {
      if (_rectsOverlap(g.x, g.y, g.w, g.h, rx, ry, rw, rh)) {
        hit = true
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
function startDraw(e) {
  if (props.tool === 'eraser') {
    isDrawing.value = true
    const p = getPos(e)
    rectStartX.value = p.x
    rectStartY.value = p.y
    lastX.value = p.x
    lastY.value = p.y
    return
  }
  isDrawing.value = true
  const p = getPos(e)
  lastX.value = p.x
  lastY.value = p.y
  currentPoints.value = [[p.x, p.y]]
  wavyStartX.value = p.x
  wavyStartY.value = p.y
  if (props.tool === 'rect') {
    rectStartX.value = p.x
    rectStartY.value = p.y
    _redrawAll()
  } else if (props.tool === 'pen' && penStyle.value === 'wavy') {
    // 先渲染所有已有笔画，为后续增量绘制打好底
    _redrawAll()
  }
}
function draw(e) {
  if (!isDrawing.value) return
  if (props.tool === 'eraser') {
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
      rectStartX.value,
      rectStartY.value,
      p.x - rectStartX.value,
      p.y - rectStartY.value,
    )
    ctx.restore()
    lastX.value = p.x
    lastY.value = p.y
    return
  }
  const c = drawCanvas.value
  if (!c) return
  const ctx = c.getContext('2d')
  const p = getPos(e)
  if (props.tool === 'rect') {
    _redrawAll()
    _setStyle(ctx)
    ctx.strokeRect(
      rectStartX.value,
      rectStartY.value,
      p.x - rectStartX.value,
      p.y - rectStartY.value,
    )
    lastX.value = p.x
    lastY.value = p.y
    return
  }
  if (penStyle.value === 'wavy') {
    // 从头绘制到当前位置：右拉揭示，左拉擦除
    _redrawAll()
    _drawCosSegment(ctx, wavyStartX.value, wavyStartY.value, p.x, wavyStartY.value, props.color, 2)
  } else {
    // 直线画笔：和波浪线一样水平揭示/擦除
    _redrawAll()
    _setStyle(ctx)
    ctx.beginPath()
    ctx.moveTo(wavyStartX.value, wavyStartY.value)
    ctx.lineTo(p.x, wavyStartY.value)
    ctx.stroke()
  }
  lastX.value = p.x
  lastY.value = p.y
}
function endDraw() {
  if (!isDrawing.value) return
  isDrawing.value = false
  if (props.tool === 'eraser') {
    _eraseRect(rectStartX.value, rectStartY.value, lastX.value - rectStartX.value, lastY.value - rectStartY.value)
    _redrawAll()
    _saveCanvas()
    _persistStrokesSync()
    return
  }
  if (props.tool === 'pen') {
    const x1 = wavyStartX.value
    const y1 = wavyStartY.value
    const x2 = lastX.value
    if (penStyle.value === 'wavy') {
      strokes.value.push(_anchored({ type: 'wavy', color: props.color, x1, y1, x2, y2: y1 }, x1, y1, x2, y1))
    } else {
      strokes.value.push(_anchored({ type: 'pen', color: props.color, points: [[x1, y1], [x2, y1]] }, x1, y1, x2, y1))
    }
  } else if (props.tool === 'rect') {
    const c = drawCanvas.value
    if (c) {
      _redrawAll()
      const ctx = c.getContext('2d')
      _setStyle(ctx)
      ctx.strokeRect(
        rectStartX.value,
        rectStartY.value,
        lastX.value - rectStartX.value,
        lastY.value - rectStartY.value,
      )
      strokes.value.push(
        _anchored(
          {
            type: 'rect',
            color: props.color,
            x: rectStartX.value,
            y: rectStartY.value,
            w: lastX.value - rectStartX.value,
            h: lastY.value - rectStartY.value,
          },
          rectStartX.value,
          rectStartY.value,
          lastX.value,
          lastY.value,
        ),
      )
    }
  }
  currentPoints.value = []
  _redrawAll()
  _saveCanvas()     // 防抖 500ms 保存（用于后续连续绘制）
  _persistStrokesSync() // 立即同步保存，防止 HMR 卸载时丢失数据
}

// ===== 快捷键 =====
function onKeydown(e) {
  if (!props.drawMode) return
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  const key = e.key.toLowerCase()
  if (key === '1') { onToolClick('pen'); e.preventDefault() }
  else if (key === '2') { onToolClick('rect'); e.preventDefault() }
  else if (key === '3') { onToolClick('eraser'); e.preventDefault() }
  else if (key === 'q' && props.tool === 'pen') {
    penStyle.value = penStyle.value === 'wavy' ? 'straight' : 'wavy'
    e.preventDefault()
  }
}
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
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

    <!-- 画笔工具栏 -->
    <div
      v-if="drawMode"
      class="draw-toolbar"
      :class="{ inactive: !drawActive }"
      :style="panelOpen ? { transform: 'translateX(calc(-50% - 23vw))' } : {}"
    >
      <div class="draw-tools">
        <button class="dt-btn" :class="{ active: tool === 'pen' && drawActive }" @click="onToolClick('pen')">
          {{ penStyle === 'wavy' ? '〰️' : '✏️' }}
        </button>
        <button class="dt-btn" :class="{ active: tool === 'rect' && drawActive }" @click="onToolClick('rect')">⬜</button>
        <button class="dt-btn" :class="{ active: tool === 'eraser' && drawActive }" @click="onToolClick('eraser')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
            <line x1="18" y1="6" x2="6" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="draw-colors">
        <button v-for="c in colors" :key="c" class="draw-color-btn"
          :class="{ active: color === c }" :style="{ background: c }"
          @click="emit('update:color', c)"
        ></button>
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
.draw-colors {
  display: flex;
  gap: 6px;
}
.draw-color-btn {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
  outline: none;
}
.draw-color-btn.active {
  border-color: #409eff;
  transform: scale(1.2);
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
.draw-toolbar.inactive { opacity: 0.5; }


</style>
