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
    default: () => ['#e74c3c', '#2c3e50', '#3498db', '#27ae60', '#f39c12', '#9b59b6'],
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
  ctx.lineWidth = 1
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}
function _redrawAll() {
  const c = drawCanvas.value
  if (!c) return
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  const sx = c.width / (refCanvasW.value || c.width)
  const sy = c.height / (refCanvasH.value || c.height)
  ctx.save()
  ctx.scale(sx, sy)
  const lw = 1 / Math.min(sx, sy)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const s of strokes.value) {
    ctx.strokeStyle = s.color
    ctx.lineWidth = lw
    if (s.type === 'pen') {
      ctx.beginPath()
      ctx.moveTo(s.points[0][0], s.points[0][1])
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i][0], s.points[i][1])
      ctx.stroke()
    } else if (s.type === 'wavy') {
      const wx1 = s.x1 ?? s.points?.[0]?.[0] ?? 0
      const wy1 = s.y1 ?? s.points?.[0]?.[1] ?? 0
      const wx2 = s.x2 ?? s.points?.[s.points.length - 1]?.[0] ?? 0
      _drawCosSegment(ctx, wx1, wy1, wx2, wy1, s.color, lw)
    } else if (s.type === 'rect') {
      ctx.strokeRect(s.x, s.y, s.w, s.h)
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
  ctx.lineWidth = lineWidth || 1
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
    if (s.type === 'pen') {
      // 点在矩形内
      for (const [px, py] of s.points) {
        if (px >= rx && px <= rx + rw && py >= ry && py <= ry + rh) {
          hit = true
          break
        }
      }
      // 线段与矩形边相交
      if (!hit) {
        for (let j = 1; j < s.points.length; j++) {
          if (_segIntersectsRect(s.points[j-1][0], s.points[j-1][1], s.points[j][0], s.points[j][1], rx, ry, rw, rh)) {
            hit = true
            break
          }
        }
      }
    } else if (s.type === 'wavy') {
      // 兼容新旧格式
      const wx1 = s.x1 ?? s.points?.[0]?.[0] ?? 0
      const wy1 = s.y1 ?? s.points?.[0]?.[1] ?? 0
      const wx2 = s.x2 ?? s.points?.[s.points.length - 1]?.[0] ?? 0
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
      if (_rectsOverlap(s.x, s.y, s.w, s.h, rx, ry, rw, rh)) {
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
    _drawCosSegment(ctx, wavyStartX.value, wavyStartY.value, p.x, wavyStartY.value, props.color, 1)
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
    return
  }
  if (props.tool === 'pen') {
    if (penStyle.value === 'wavy') {
      strokes.value.push({ type: 'wavy', color: props.color, x1: wavyStartX.value, y1: wavyStartY.value, x2: lastX.value, y2: wavyStartY.value })
    } else {
      strokes.value.push({ type: 'pen', color: props.color, points: [[wavyStartX.value, wavyStartY.value], [lastX.value, wavyStartY.value]] })
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
      strokes.value.push({
        type: 'rect',
        color: props.color,
        x: rectStartX.value,
        y: rectStartY.value,
        w: lastX.value - rectStartX.value,
        h: lastY.value - rectStartY.value,
      })
    }
  }
  currentPoints.value = []
  _redrawAll()
  _saveCanvas()
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
  cursor: crosshair;
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
