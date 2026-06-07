<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'

const props = defineProps({
  paragraphs: { type: Array, default: () => [] },
  paragraphSegments: { type: Array, default: () => [] },
  title: { type: String, default: '' },
})

// ===== 分页逻辑 =====
const currentSpread = ref(0)
const containerRef = ref(null)
const pageHeight = ref(600)
let _pageObserver = null

const pages = computed(() => {
  const paras = props.paragraphs
  if (!paras.length) return [[]]
  const charsPerLine = 72, lineH = 30.4, margin = 19
  const pageH = Math.max(300, pageHeight.value - 60)
  const result = []
  let remaining = pageH, current = []
  for (let i = 0; i < paras.length; i++) {
    const h = Math.max(1, Math.ceil(paras[i].length / charsPerLine)) * lineH + margin
    if (h <= remaining || current.length === 0) { current.push(i); remaining -= h }
    else { result.push(current); current = [i]; remaining = pageH - h }
  }
  if (current.length) result.push(current)
  return result.length ? result : [[0]]
})

const pageSpreads = computed(() => {
  const all = pages.value
  const spreads = []
  for (let i = 0; i < all.length; i += 3) spreads.push({ left: all[i] || [], middle: all[i + 1] || [], right: all[i + 2] || [] })
  return spreads
})

const totalSpreads = computed(() => Math.max(1, pageSpreads.value.length))
const spreadPercent = computed(() => 100 / totalSpreads.value)
const spreadTranslateX = computed(() => -(currentSpread.value * spreadPercent.value))

function spreadPageSegments(indices) {
  if (!indices?.length) return []
  return props.paragraphSegments.filter((_, i) => indices.includes(i))
}

function prevPage() { if (currentSpread.value > 0) currentSpread.value-- }
function nextPage() { if (currentSpread.value < totalSpreads.value - 1) currentSpread.value++ }

function updatePageHeight() {
  if (!containerRef.value) return
  pageHeight.value = containerRef.value.getBoundingClientRect().height
}

// ===== 滚轮 & 键盘翻页 =====
function onWheel(e) {
  e.preventDefault()
  if (e.deltaY > 5) nextPage()
  else if (e.deltaY < -5) prevPage()
}

function onKeydown(e) {
  if (['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) return
  const map = {
    ArrowLeft: prevPage, ArrowRight: nextPage,
    PageUp: prevPage, PageDown: nextPage,
    Home: () => { currentSpread.value = 0 },
    End: () => { currentSpread.value = totalSpreads.value - 1 },
  }
  if (map[e.key]) { e.preventDefault(); map[e.key]() }
}

// ===== 生命周期 =====
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  if (containerRef.value) {
    _pageObserver = new ResizeObserver(() => updatePageHeight())
    _pageObserver.observe(containerRef.value)
  }
  nextTick(() => updatePageHeight())
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  if (_pageObserver) { _pageObserver.disconnect(); _pageObserver = null }
})

// 内容变化时重置
watch(() => props.paragraphSegments, () => {
  currentSpread.value = 0
  nextTick(() => updatePageHeight())
})
</script>

<template>
  <div class="dp-reader">
    <div class="dp-title-bar"><h1 class="dp-title">{{ title }}</h1></div>
    <div ref="containerRef" class="dp-container" @wheel="onWheel">
      <div
        class="dp-pages"
        :style="{
          width: totalSpreads * 100 + '%',
          transform: 'translateX(' + spreadTranslateX + '%)',
          transition: 'transform 0.15s ease-out',
        }"
      >
        <div
          v-for="(spread, si) in pageSpreads"
          :key="si"
          class="dp-spread"
          :style="{ width: spreadPercent + '%' }"
        >
          <div class="dp-page dp-left">
            <div class="dp-content">
              <p v-for="(segments, i) in spreadPageSegments(spread.left)" :key="i" class="dp-para">
                <template v-for="(seg, j) in segments" :key="j">
                  <span v-if="seg.type === 'text'">{{ seg.text }}</span>
                  <span
                    v-else
                    class="annotated" :class="[seg.annotation.type]"
                    :style="seg.annotation.type === 'highlight' ? { backgroundColor: seg.annotation.color } : {}"
                    :data-annot-id="seg.annotation.id"
                  >{{ seg.text }}</span>
                </template>
              </p>
            </div>
            <span v-if="spread.left.length" class="dp-num">{{ si * 3 + 1 }}</span>
          </div>
          <div class="dp-page dp-mid">
            <div class="dp-content">
              <p v-for="(segments, i) in spreadPageSegments(spread.middle)" :key="i" class="dp-para">
                <template v-for="(seg, j) in segments" :key="j">
                  <span v-if="seg.type === 'text'">{{ seg.text }}</span>
                  <span
                    v-else
                    class="annotated" :class="[seg.annotation.type]"
                    :style="seg.annotation.type === 'highlight' ? { backgroundColor: seg.annotation.color } : {}"
                    :data-annot-id="seg.annotation.id"
                  >{{ seg.text }}</span>
                </template>
              </p>
            </div>
            <span v-if="spread.middle.length" class="dp-num">{{ si * 3 + 2 }}</span>
          </div>
          <div class="dp-page dp-right">
            <div class="dp-content">
              <p v-for="(segments, i) in spreadPageSegments(spread.right)" :key="i" class="dp-para">
                <template v-for="(seg, j) in segments" :key="j">
                  <span v-if="seg.type === 'text'">{{ seg.text }}</span>
                  <span
                    v-else
                    class="annotated" :class="[seg.annotation.type]"
                    :style="seg.annotation.type === 'highlight' ? { backgroundColor: seg.annotation.color } : {}"
                    :data-annot-id="seg.annotation.id"
                  >{{ seg.text }}</span>
                </template>
              </p>
            </div>
            <span v-if="spread.right.length" class="dp-num">{{ si * 3 + 3 }}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="dp-nav">
      <button class="dp-nav-btn" :disabled="currentSpread <= 0" @click="prevPage">← Prev</button>
      <span class="dp-nav-info">{{ currentSpread + 1 }} / {{ totalSpreads }}</span>
      <button class="dp-nav-btn" :disabled="currentSpread >= totalSpreads - 1" @click="nextPage">Next →</button>
    </div>
  </div>
</template>

<style scoped>
.dp-reader {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
}
.dp-title-bar {
  padding: 12px 48px 4px; flex-shrink: 0; text-align: center;
}
.dp-title {
  font-family: 'Georgia','Times New Roman',serif; font-size: 22px;
  font-weight: 700; color: #1a1a1a; margin: 0; padding: 0;
}
.dp-container {
  flex: 1; min-height: 0; overflow: hidden; position: relative;
}
.dp-pages {
  display: flex; height: 100%;
}
.dp-spread {
  display: flex; height: 100%; position: relative;
}
.dp-page {
  width: 33.333%; height: 100%; overflow-y: auto; position: relative;
  background: #fcf9f4; padding: 24px 24px 36px;
}
.dp-left {
  border-right: 1px solid #e0d8cc;
  box-shadow: inset -8px 0 12px -12px rgba(0,0,0,0.1);
}
.dp-mid {
  border-right: 1px solid #e0d8cc;
}
.dp-right {
  box-shadow: inset 8px 0 12px -12px rgba(0,0,0,0.1);
}
.dp-para {
  font-family: 'Georgia','Times New Roman',serif; font-size: 16px;
  color: #2a2a2a; line-height: 1.9; text-align: justify;
  white-space: pre-wrap; margin: 0 0 1.2em;
}
.dp-num {
  position: absolute; bottom: 14px; font-size: 0.85rem; color: #b5a58e;
  font-family: 'Georgia','Times New Roman',serif;
}
.dp-left .dp-num { right: 14px; }
.dp-mid .dp-num { right: 14px; }
.dp-right .dp-num { left: 14px; }

.dp-nav {
  display: flex; justify-content: center; align-items: center; gap: 14px;
  padding: 6px 0 12px; flex-shrink: 0; border-top: 1px solid #eee;
}
.dp-nav-btn {
  border: 1px solid #d4c5b0; background: transparent; color: #6b5a3e;
  font-size: 12px; cursor: pointer; padding: 4px 14px; border-radius: 16px; transition: all 0.2s;
}
.dp-nav-btn:hover:not(:disabled) { background: #f0e8d8; border-color: #8b3a2a; }
.dp-nav-btn:disabled { opacity: 0.3; cursor: default; }
.dp-nav-info {
  font-size: 12px; color: #8b7355; min-width: 60px; text-align: center; font-variant-numeric: tabular-nums;
}

/* 批注样式 - 与本组件隔离 */
.annotated { cursor: pointer; transition: opacity 0.15s; }
.annotated:hover { opacity: 0.75; }
.annotated.highlight { padding: 1px 0; border-radius: 2px; }
.annotated.underline {
  text-decoration: underline; text-decoration-color: #e74c3c;
  text-decoration-thickness: 2px; text-underline-offset: 5px; text-decoration-skip-ink: none;
}
</style>
