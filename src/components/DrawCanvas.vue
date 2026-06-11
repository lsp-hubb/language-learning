<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'

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

const storageKey = computed(() => `_canvas_strokes_${props.articleId || 'default'}`)

const emit = defineEmits(['toggle-draw', 'toggle-tool', 'close-canvas', 'new-canvas', 'update:tool', 'update:color'])

const drawCanvas = ref(null)
const isDrawing = ref(false)
const lastX = ref(0)
const lastY = ref(0)
const rectStartX = ref(0)
const rectStartY = ref(0)
const currentPoints = ref([])
const strokes = ref([])
const savedCanvasData = ref(null)
const refCanvasW = ref(0)
const refCanvasH = ref(0)

let _resizeObserver = null

watch(
  () => props.drawMode,
  async (val) => {
    await nextTick()
    if (val) {
      _initCanvas()
      _loadStrokes()
      // 监听容器尺寸变化（侧边栏开关时重设画布大小）
      const container = drawCanvas.value?.closest('.reader-content')
      if (container && !_resizeObserver) {
        _resizeObserver = new ResizeObserver(() => {
          if (props.drawMode) { _initCanvas(); _redrawAll() }
        })
        _resizeObserver.observe(container)
      }
    } else {
      _saveCanvas()
      if (_resizeObserver) {
        _resizeObserver.disconnect()
        _resizeObserver = null
      }
    }
  },
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
  // 首次初始化时记录参考尺寸（必须在设置宽高之后）
  if (!refCanvasW.value) {
    refCanvasW.value = w
    refCanvasH.value = h
  }
}

// 切换文章时重置参考尺寸
watch(() => props.articleId, () => {
  refCanvasW.value = 0
  refCanvasH.value = 0
})
function _loadStrokes() {
  try {
    const saved = localStorage.getItem(storageKey.value)
    if (saved) strokes.value = JSON.parse(saved)
  } catch {}
  if (strokes.value.length > 0) {
    _redrawAll()
    savedCanvasData.value = drawCanvas.value?.toDataURL() || null
  } else if (savedCanvasData.value) {
    _drawImg(savedCanvasData.value)
  }
}
function _saveCanvas() {
  const c = drawCanvas.value
  if (!c) return
  savedCanvasData.value = c.toDataURL()
  try {
    localStorage.setItem(storageKey.value, JSON.stringify(strokes.value))
  } catch {}
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
    } else if (s.type === 'rect') {
      ctx.strokeRect(s.x, s.y, s.w, s.h)
    }
  }
  ctx.restore()
}
function _distSeg(px, py, ax, ay, bx, by) {
  const abx = bx - ax,
    aby = by - ay
  const apx = px - ax,
    apy = py - ay
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby || 1)))
  return Math.sqrt((px - (ax + t * abx)) ** 2 + (py - (ay + t * aby)) ** 2)
}
function _hit(x, y, s) {
  const th = 12
  if (s.type === 'pen') {
    for (let j = 1; j < s.points.length; j++)
      if (
        _distSeg(x, y, s.points[j - 1][0], s.points[j - 1][1], s.points[j][0], s.points[j][1]) < th
      )
        return true
    return false
  }
  if (s.type === 'rect') {
    const { x: rx, y: ry, w, h } = s
    for (const e of [
      [
        [rx, ry],
        [rx + w, ry],
      ],
      [
        [rx + w, ry],
        [rx + w, ry + h],
      ],
      [
        [rx + w, ry + h],
        [rx, ry + h],
      ],
      [
        [rx, ry + h],
        [rx, ry],
      ],
    ])
      if (_distSeg(x, y, e[0][0], e[0][1], e[1][0], e[1][1]) < th) return true
    return false
  }
  return false
}
function _erasePt(x, y) {
  let changed = false
  for (let i = strokes.value.length - 1; i >= 0; i--)
    if (_hit(x, y, strokes.value[i])) {
      strokes.value.splice(i, 1)
      changed = true
    }
  if (changed) {
    _redrawAll()
    savedCanvasData.value = drawCanvas.value?.toDataURL() || null
  }
}
function _eraseLine(x1, y1, x2, y2) {
  const steps = Math.max(10, Math.ceil(Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) / 5))
  let changed = false
  for (let s = 0; s <= steps; s++) {
    const t = s / steps,
      x = x1 + (x2 - x1) * t,
      y = y1 + (y2 - y1) * t
    for (let i = strokes.value.length - 1; i >= 0; i--)
      if (_hit(x, y, strokes.value[i])) {
        strokes.value.splice(i, 1)
        changed = true
      }
  }
  if (changed) {
    _redrawAll()
    savedCanvasData.value = drawCanvas.value?.toDataURL() || null
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
    lastX.value = p.x
    lastY.value = p.y
    _erasePt(p.x, p.y)
    return
  }
  isDrawing.value = true
  const p = getPos(e)
  lastX.value = p.x
  lastY.value = p.y
  currentPoints.value = [[p.x, p.y]]
  if (props.tool === 'rect') {
    rectStartX.value = p.x
    rectStartY.value = p.y
    _redrawAll()
  }
}
function draw(e) {
  if (!isDrawing.value) return
  if (props.tool === 'eraser') {
    const p = getPos(e)
    _eraseLine(lastX.value, lastY.value, p.x, p.y)
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
  currentPoints.value.push([p.x, p.y])
  _setStyle(ctx)
  ctx.beginPath()
  ctx.moveTo(lastX.value, lastY.value)
  ctx.lineTo(p.x, p.y)
  ctx.stroke()
  lastX.value = p.x
  lastY.value = p.y
}
function endDraw() {
  if (!isDrawing.value) return
  isDrawing.value = false
  if (props.tool === 'eraser') return
  if (props.tool === 'pen' && currentPoints.value.length > 1)
    strokes.value.push({ type: 'pen', color: props.color, points: [...currentPoints.value] })
  else if (props.tool === 'rect') {
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
  savedCanvasData.value = drawCanvas.value?.toDataURL() || null
}

// ===== 快捷键 =====
function onKeydown(e) {
  if (!props.drawMode) return
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  const key = e.key.toLowerCase()
  if (key === '1') { onToolClick('pen'); e.preventDefault() }
  else if (key === '2') { onToolClick('rect'); e.preventDefault() }
  else if (key === '3') { onToolClick('eraser'); e.preventDefault() }
  else if (key === 'escape') {
    emit('close-canvas')
    e.preventDefault()
  }
}
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  try { localStorage.removeItem('_canvas_strokes') } catch {} // 清理旧版全局 key
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
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
  try { localStorage.removeItem(storageKey.value) } catch {}
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
        <button class="dt-btn" :class="{ active: tool === 'pen' && drawActive }" @click="onToolClick('pen')">✏️</button>
        <button class="dt-btn" :class="{ active: tool === 'rect' && drawActive }" @click="onToolClick('rect')">⬜</button>
        <button class="dt-btn" :class="{ active: tool === 'eraser' && drawActive }" @click="onToolClick('eraser')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14.3 2l6.9 6.9L8 22.2l-2.5-2.5"/>
            <path d="m6.2 12.3 5.5 5.5"/>
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
