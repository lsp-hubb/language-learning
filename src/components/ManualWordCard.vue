<script setup>
import { ref, watch, nextTick } from 'vue'
import { lookupWord, fetchSuggestions } from '@/api'

const props = defineProps({
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

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
  await preloadAudio(result.value.word)
  playAudio('uk')
}

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

function onKeydown(e) {
  if (e.key === 'Escape') emit('close')
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
  sugIndex.value = suggestions.value.length > 0 ? 0 : -1
  if (suggestions.value.length > 0 && inputRef.value) {
    const r = inputRef.value.getBoundingClientRect()
    sugPos.value = { x: r.left, y: r.bottom, w: r.width }
  }
}

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
    if (sugIndex.value >= 0) {
      selectSuggestion(sugIndex.value)
    } else {
      doLookup()
    }
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
    @wheel.prevent.stop
  >
    <div class="card-drag" @mousedown="onDragStart" :class="{ dragging }">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm8 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM8 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm8 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM8 16a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm8 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>
    </div>
    <button class="card-close" @click="emit('close')">✕</button>

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
        {{ loading ? '...' : '查' }}
      </button>
    </div>

    <!-- 联想词浮层（fixed 定位，脱离卡片裁剪） -->
    <div
      v-if="suggestions.length > 0"
      class="suggest-fixed"
      :style="{ left: sugPos.x + 'px', top: sugPos.y + 'px', width: sugPos.w + 'px' }"
    >
      <div
        v-for="(s, i) in suggestions"
        :key="i"
        class="suggest-item"
        :class="{ active: i === sugIndex }"
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
      <div class="card-word">{{ result.word }}</div>
      <div v-if="result.phonetic_uk || result.phonetic_us" class="card-phonetic">
        <span v-if="result.phonetic_uk" class="phone clickable" @mouseenter="playAudio('uk')">🔊 英 {{ result.phonetic_uk }}</span>
        <span v-if="result.phonetic_us" class="phone clickable" @mouseenter="playAudio('us')">🔊 美 {{ result.phonetic_us }}</span>
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

      <button class="card-copy" @click="doCopy">
        {{ copied ? '✓ 已复制' : '📋 复制全部' }}
      </button>
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
.card-close {
  position: absolute;
  top: 6px;
  right: 10px;
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
.card-drag {
  position: absolute;
  top: 6px;
  left: 8px;
  cursor: grab;
  color: #cbd5e1;
  padding: 2px;
  border-radius: 4px;
  line-height: 1;
  user-select: none;
  transition: color 0.15s, background 0.15s;
}
.card-drag:hover,
.card-drag.dragging {
  color: #475569;
  background: #f1f5f9;
  cursor: grabbing;
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
  background: #4b6cb7;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
  align-self: flex-start;
  white-space: nowrap;
}
.card-go:hover { background: #3a5a9f; }
.card-go:disabled { opacity: 0.5; cursor: default; }

/* 联想词浮层（fixed，脱离卡片裁剪） */
.suggest-fixed {
  position: fixed;
  z-index: 10000;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 6px 16px rgba(0,0,0,0.12);
  max-height: 200px;
  overflow-y: auto;
}
.suggest-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 10px;
  cursor: pointer;
  transition: background 0.1s;
  font-size: 13px;
}
.suggest-item:hover,
.suggest-item.active {
  background: #e8f0fe;
}
.sug-entry {
  font-weight: 600;
  color: #1e293b;
}
.sug-explain {
  color: #64748b;
  font-size: 12px;
  margin-left: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
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
.card-copy {
  margin-top: 10px;
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
</style>
