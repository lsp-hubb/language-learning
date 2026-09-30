<script setup>
import { ref, watch, nextTick, onUnmounted } from 'vue'
import { lookupWord, fetchSuggestions } from '@/api'

const props = defineProps({
  visible: { type: Boolean, default: false },
  autoQueryText: { type: String, default: '' },
})

const emit = defineEmits(['close', 'auto-query-consumed'])

// ===== 发音功能（预下载 + Blob 缓存，点击即播） =====
const audioCache = {}
let lastCachedWord = ''

function ttsUrl(word, accent) {
  return `/api/tts?word=${encodeURIComponent(word)}&accent=${accent}`
}

async function preloadAudio(word) {
  if (!word) return
  // 同一个词不重复下载
  if (word === lastCachedWord && audioCache.uk && audioCache.us) return
  // 清空旧缓存
  for (const key of Object.keys(audioCache)) {
    URL.revokeObjectURL(audioCache[key])
    delete audioCache[key]
  }
  lastCachedWord = word
  // 并行下载英式和美式发音
  await Promise.all(['uk', 'us'].map(async (accent) => {
    try {
      const resp = await fetch(ttsUrl(word, accent))
      if (!resp.ok) return
      const blob = await resp.blob()
      audioCache[accent] = URL.createObjectURL(blob)
    } catch {}
  }))
}

function playAudio(accent) {
  const url = audioCache[accent]
  if (url) {
    new Audio(url).play().catch(() => {})
  }
}

async function autoPlayAudio() {
  if (!result.value.phonetic_uk && !result.value.phonetic_us) return
  await preloadAudio(result.value.word)
  playAudio('uk')
}

// 组件卸载时回收 Blob URL，防止内存泄漏
onUnmounted(() => {
  for (const key of Object.keys(audioCache)) {
    URL.revokeObjectURL(audioCache[key])
    delete audioCache[key]
  }
})

const cardRef = ref(null)
const inputRef = ref(null)
const query = ref('')
const result = ref({})
const loading = ref(false)
const copied = ref(false)
const dragging = ref(false)
const cardPos = ref(calcPosition())
// 联想词
const suggestions = ref([])
const sugIndex = ref(-1)  // -1 表示无选中
const sugPos = ref({ x: 0, y: 0, w: 0 })
const sugListRef = ref(null)  // 联想词浮层容器，用于键盘上下键时滚动高亮项
let sugTimer = null

let dragStartX = 0, dragStartY = 0, dragOrigX = 0, dragOrigY = 0
let abortController = null

watch(() => props.visible, async (val) => {
  if (val) {
    query.value = ''
    result.value = {}
    loading.value = false
    copied.value = false
    suggestions.value = []
    sugIndex.value = -1
    cardPos.value = calcPosition()
    await nextTick()
    inputRef.value?.focus()
  } else {
    if (cardRef.value) {
      const r = cardRef.value.getBoundingClientRect()
      savePos(r.left, r.top)
    }
  }
})

// 选中文本自动填充查询（相同单词跳过，避免 mouseup 重复触发清空 result）
watch(() => props.autoQueryText, (text) => {
  if (!props.visible || !text) return
  if (text === query.value && result.value.word) return
  query.value = text
  hideSuggestions()
  doLookup().finally(() => {
    emit('auto-query-consumed')
  })
})

const POS_KEY = '_manual_word_card_pos'

function loadSavedPos() {
  try {
    const saved = localStorage.getItem(POS_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return null
}
function savePos(x, y) {
  try { localStorage.setItem(POS_KEY, JSON.stringify({ x, y })) } catch {}
}

function calcPosition() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const margin = 16
  const saved = loadSavedPos()
  let x, y
  if (saved) {
    x = saved.x
    y = saved.y
  } else {
    x = (vw - 360) / 2
    y = Math.max(margin, (vh - 300) / 2)
  }
  if (x < margin) x = margin
  if (x + 360 > vw - margin) x = vw - margin - 360
  if (y < margin) y = margin
  if (y + 200 > vh - margin) y = vh - margin - 200
  return { x, y }
}

async function doLookup() {
  const word = query.value.trim()
  if (!word) return
  hideSuggestions()
  if (abortController) abortController.abort()
  abortController = new AbortController()
  loading.value = true
  result.value = {}
  try {
    const res = await lookupWord(word, abortController.signal)
    result.value = res
    nextTick(() => autoPlayAudio())
  } catch (err) {
    if (err.name === 'AbortError') return
    result.value = { error: err.message || '查询失败' }
  }
  loading.value = false
}

function doCopy() {
  const parts = []
  if (result.value.word) parts.push(result.value.word)
  if (result.value.phonetic_uk || result.value.phonetic_us) {
    const p = []
    if (result.value.phonetic_uk) p.push('英 ' + result.value.phonetic_uk)
    if (result.value.phonetic_us) p.push('美 ' + result.value.phonetic_us)
    parts.push(p.join('  '))
  }
  if (result.value.definitions?.length) {
    result.value.definitions.forEach((d) => {
      parts.push(d.part_of_speech + ' ' + d.translation)
    })
  }
  if (result.value.translation) parts.push(result.value.translation)
  navigator.clipboard.writeText(parts.join('\n')).then(() => {
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  })
}

// 清空输入内容与查询结果：中断进行中的请求、清联想词与复制态，并把焦点交还输入框
function clearAll() {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
  if (sugTimer) clearTimeout(sugTimer)
  query.value = ''
  result.value = {}
  loading.value = false
  copied.value = false
  hideSuggestions()
  // 通知父组件消费掉自动填充文本，避免清空后又被旧文本回填
  emit('auto-query-consumed')
  nextTick(() => inputRef.value?.focus())
}

function onKeydown(e) {
  if (e.key === 'Escape' && suggestions.value.length > 0) {
    hideSuggestions()
  }
}

// ===== 联想词 =====
async function doSuggest() {
  const q = query.value.trim()
  if (!q || !/[a-zA-Z]/.test(q)) {
    suggestions.value = []
    sugIndex.value = -1
    return
  }
  try {
    const res = await fetchSuggestions(q)
    suggestions.value = res.data || []
  } catch (e) {
    suggestions.value = []
  }
  // 默认不高亮任何一项（-1），高亮由悬停或方向键显式产生，鼠标移出浮层即熄灭
  sugIndex.value = -1
  if (suggestions.value.length > 0 && inputRef.value) {
    const r = inputRef.value.getBoundingClientRect()
    const c = cardRef.value?.getBoundingClientRect()
    // 浮层左对齐输入框，右缘扩展到卡片内容区（+约 80px），给释义更多横向空间
    const w = c ? Math.max(r.width, c.right - 14 - r.left) : r.width
    sugPos.value = { x: r.left, y: r.bottom, w }
    // 新一轮联想词：列表滚回顶部（此时无高亮项，sugIndex 的 watch 不会触发）
    nextTick(() => { if (sugListRef.value) sugListRef.value.scrollTop = 0 })
  }
}

// 方向键切换选中项时，把高亮项自动滚入可视区（只改浮层自身 scrollTop，不触发页面滚动）
watch(sugIndex, async (idx) => {
  if (idx < 0) return
  await nextTick()
  const box = sugListRef.value
  const el = box?.querySelector('.suggest-item.active')
  if (!box || !el) return
  const top = el.offsetTop
  const bottom = top + el.offsetHeight
  if (top < box.scrollTop) {
    box.scrollTop = top
  } else if (bottom > box.scrollTop + box.clientHeight) {
    box.scrollTop = bottom - box.clientHeight
  }
})

function onInput() {
  if (sugTimer) clearTimeout(sugTimer)
  if (!query.value.trim()) {
    suggestions.value = []
    sugIndex.value = -1
    return
  }
  sugTimer = setTimeout(doSuggest, 200)
}

function onInputKeydown(e) {
  if (suggestions.value.length === 0) {
    if (e.key === 'Enter') doLookup()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (sugTimer) clearTimeout(sugTimer)
    sugIndex.value = Math.min(sugIndex.value + 1, suggestions.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (sugTimer) clearTimeout(sugTimer)
    sugIndex.value = Math.max(sugIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    // 未高亮时保持原有行为：回车取首条联想词
    selectSuggestion(sugIndex.value >= 0 ? sugIndex.value : 0)
  } else if (e.key === 'Escape') {
    hideSuggestions()
  }
}

function selectSuggestion(idx) {
  if (idx < 0 || idx >= suggestions.value.length) return
  const word = suggestions.value[idx].entry
  query.value = word
  hideSuggestions()
  doLookup()
}

function hideSuggestions() {
  suggestions.value = []
  sugIndex.value = -1
}

// 滚轮：只让光标下真正可滚动的容器滚动（联想词优先，其次卡片本体），
// 容器滚到边界或不可滚时再阻断，避免滚动穿透到下层文章页面
function onCardWheel(e) {
  const scroller = e.target?.closest?.('.suggest-fixed') || cardRef.value
  if (scroller && scroller.scrollHeight > scroller.clientHeight) {
    const atTop = scroller.scrollTop <= 0
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
    const canScrollFurther = (e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)
    if (canScrollFurther) {
      e.stopPropagation()  // 不 preventDefault，保留原生滚动
      return
    }
  }
  e.preventDefault()
  e.stopPropagation()
}

// 拖动
function onDragStart(e) {
  dragging.value = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragOrigX = cardPos.value.x
  dragOrigY = cardPos.value.y
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}
function onDragMove(e) {
  if (!dragging.value) return
  cardPos.value = {
    x: dragOrigX + e.clientX - dragStartX,
    y: dragOrigY + e.clientY - dragStartY,
  }
}
function onDragEnd() {
  dragging.value = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  savePos(cardPos.value.x, cardPos.value.y)
}
</script>

<template>
  <div
    v-show="visible"
    ref="cardRef"
    class="manual-word-card"
    :style="{ left: cardPos.x + 'px', top: cardPos.y + 'px' }"
    tabindex="-1"
    @keydown="onKeydown"
    @wheel="onCardWheel"
  >
    <div class="card-drag" @mousedown="onDragStart" :class="{ dragging }">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm8 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM8 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm8 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM8 16a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm8 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>
      <span class="drag-spacer"></span>
      <button class="card-close" @mousedown.stop @click="emit('close')">✕</button>
    </div>

    <div class="card-input-row">
      <input
        ref="inputRef"
        v-model="query"
        class="card-input"
        placeholder="输入要查的单词..."
        spellcheck="false"
        @input="onInput"
        @keydown="onInputKeydown"
      />
      <button class="card-go" @click="doLookup" :disabled="loading || !query.trim()">
        {{ loading ? '...' : '🔍' }}
      </button>
    </div>

    <!-- 联想词浮层（fixed 定位，脱离卡片裁剪） -->
    <div
      v-if="suggestions.length > 0"
      ref="sugListRef"
      class="suggest-fixed"
      :style="{ left: sugPos.x + 'px', top: sugPos.y + 'px', width: sugPos.w + 'px' }"
      @mouseleave="sugIndex = -1"
    >
      <div
        v-for="(s, i) in suggestions"
        :key="i"
        class="suggest-item"
        :class="{ active: i === sugIndex }"
        @mouseenter="sugIndex = i"
        @mousedown.prevent="selectSuggestion(i)"
      >
        <span class="sug-entry">{{ s.entry }}</span>
        <span class="sug-explain">{{ s.explain }}</span>
      </div>
    </div>

    <div v-if="loading" class="card-loading">
      <div class="spinner"></div>
      <span>查询中...</span>
    </div>

    <div v-else-if="result.error" class="card-error">{{ result.error }}</div>

    <div v-else-if="result.word" class="card-body">
      <template v-if="query.split(/\s+/).length <= 8">
        <div class="card-word">{{ result.word }}</div>
        <div v-if="result.phonetic_uk || result.phonetic_us" class="card-phonetic">
          <span v-if="result.phonetic_uk" class="phone clickable" @mouseenter="playAudio('uk')" @click="playAudio('uk')">🔊 英 {{ result.phonetic_uk }}</span>
          <span v-if="result.phonetic_us" class="phone clickable" @mouseenter="playAudio('us')" @click="playAudio('us')">🔊 美 {{ result.phonetic_us }}</span>
        </div>
        <div v-if="result.definitions?.length" class="card-defs">
          <div v-for="(def, i) in result.definitions" :key="i" class="card-def">
            <span class="def-pos">{{ def.part_of_speech }}</span>
            <span class="def-text">{{ def.translation }}</span>
          </div>
        </div>
        <div v-else-if="result.translation" class="card-translation">
          {{ result.translation }}
        </div>
      </template>
      <div v-else-if="result.translation" class="card-translation">
        {{ result.translation }}
      </div>

      <div class="card-btn-row">
        <button class="card-copy" @click="doCopy">
          {{ copied ? '✓ 已复制' : '📋 复制全部' }}
        </button>
        <button class="card-clear" @click="clearAll" title="清空输入内容和查询结果">🧹 清空</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.manual-word-card {
  position: fixed;
  z-index: 9999;
  width: 360px;
  max-height: 70vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
  padding: 14px;
  font-size: 13px;
  color: #1e293b;
  box-sizing: border-box;
  outline: none;
  animation: card-fade-in 0.15s ease-out;
}
@keyframes card-fade-in {
  from { opacity: 0; transform: translateY(4px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.card-drag {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  padding: 6px 20px 6px 8px;
  color: #cbd5e1;
  user-select: none;
  transition: color 0.15s, background 0.15s;
}
.drag-spacer {
  flex: 1;
}
.card-close {
  border: none;
  background: none;
  font-size: 16px;
  color: #94a3b8;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.15s;
  line-height: 1;
}
.card-close:hover {
  color: #475569;
  background: #f1f5f9;
}
.card-drag:hover,
.card-drag.dragging {
  color: #475569;
  background: #f1f5f9;
}
.card-input-row {
  display: flex;
  gap: 8px;
  margin-top: 24px;
  margin-bottom: 10px;
  padding-right: 24px;
}
.card-input {
  flex: 1;
  padding: 8px 10px;
  border: 1.5px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  color: #1e293b;
  background: #fff;
}
.card-input:focus {
  border-color: #4b6cb7;
  box-shadow: 0 0 0 3px rgba(75, 108, 183, 0.1);
}
.card-go {
  padding: 8px 14px;
  border: none;
  border-radius: 8px;
  background: #90caf9;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
  align-self: flex-start;
  white-space: nowrap;
}
.card-go:hover { background: #7eb8e0; }
.card-go:disabled { opacity: 0.5; cursor: default; }

/* 联想词浮层（fixed，脱离卡片裁剪） */
.suggest-fixed {
  position: fixed;
  z-index: 10000;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 6px 16px rgba(0,0,0,0.12);
  max-height: 260px;  /* 条目改为两行后同步调高，保证一屏可见约 5 条 */
  overflow-y: auto;
  overscroll-behavior: contain;
}
.suggest-item {
  /* 两行堆叠：单词一行、释义一行，释义超长时换行展示，不做任何截断 */
  display: block;
  padding: 7px 10px;
  cursor: pointer;
  transition: background 0.1s;
  font-size: 13px;
}
/* 高亮只由 .active（sugIndex）驱动，不再叠加 :hover，避免出现两条同时点亮 */
.suggest-item.active {
  background: #e8f0fe;
}
.sug-entry {
  display: block;
  font-weight: 600;
  color: #1e293b;
  overflow-wrap: break-word;  /* 极端长单词也完整折行，不截断 */
}
.sug-explain {
  display: block;
  color: #64748b;
  font-size: 12px;
  margin-top: 2px;
  line-height: 1.45;
  white-space: normal;        /* 释义完整展示 */
  overflow-wrap: break-word;
}

.card-word {
  font-size: 1.2rem;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 4px;
}
.card-phonetic {
  display: flex;
  gap: 12px;
  margin-bottom: 10px;
}
.phone {
  font-size: 0.8rem;
  color: #64748b;
  font-family: 'Segoe UI', Arial, sans-serif;
}
.phone.clickable {
  cursor: pointer;
  transition: color 0.15s;
}
.phone.clickable:hover {
  color: #1a73e8;
}
.card-defs {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.card-def {
  font-size: 0.85rem;
  line-height: 1.5;
}
.def-pos {
  display: inline-block;
  color: #4b6cb7;
  font-weight: 600;
  margin-right: 6px;
  font-size: 0.75rem;
}
.def-text {
  color: #334155;
}
.card-translation {
  font-size: 0.85rem;
  line-height: 1.6;
  color: #334155;
  margin-top: 6px;
}
.card-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #64748b;
  font-size: 0.9rem;
  padding: 8px 0;
}
.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid #e2e8f0;
  border-top-color: #4b6cb7;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.card-error {
  color: #e74c3c;
  font-size: 0.9rem;
  padding: 8px 0;
}
.card-btn-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.card-copy {
  padding: 6px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #f8fafc;
  color: #475569;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.card-copy:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}
/* 清空按钮：与复制并排，清空当前输入内容与查询结果 */
.card-clear {
  padding: 6px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #f8fafc;
  color: #64748b;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.card-clear:hover {
  background: #fef2f2;
  border-color: #fecaca;
  color: #dc2626;
}
</style>
