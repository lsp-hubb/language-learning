<script setup>
import { useRoute, useRouter } from 'vue-router'
import { useFileExplorerStore } from '@/stores/fileExplorer'
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import {
  lookupWord,
  fetchArticle,
  fetchAnnotations,
  createAnnotation as apiCreateAnnotation,
  updateAnnotation,
  deleteAnnotation as apiDeleteAnnotation,
} from '@/api'
import WordCard from '@/components/WordCard.vue'
import AnnotationCard from '@/components/AnnotationCard.vue'
import DrawCanvas from '@/components/DrawCanvas.vue'

const route = useRoute()
const router = useRouter()
const store = useFileExplorerStore()

const article = computed(() => store.articles[route.params.id])

// 按换行符拆分段落
const paragraphs = computed(() => {
  if (!article.value?.content) return []
  return article.value.content.split('\n').filter((l) => l.trim())
})

// 英文单词数统计
const wordCount = computed(() => {
  if (!article.value?.content) return 0
  return article.value.content.split(/\s+/).filter((w) => w.length > 0).length
})

// ===== 编辑状态 =====
const isEditing = ref(false)
const editTitle = ref('')
const editContent = ref('')
const saving = ref(false)

function startEdit() {
  if (!article.value) return
  closeWordCard()
  closeAnnotationCard()
  editTitle.value = article.value.title || ''
  editContent.value = normalizeContent(article.value.content || '')
  isEditing.value = true
}

// 编辑框内段落之间插入空行，方便编辑
function normalizeContent(text) {
  const paras = text.split('\n').filter((l) => l.trim())
  return paras.join('\n\n')
}

async function saveEdit() {
  if (!article.value) return
  saving.value = true
  const ok = await store.updateArticle(article.value.id, {
    title: editTitle.value,
    content: editContent.value,
  })
  saving.value = false
  if (ok) isEditing.value = false
  else alert('保存失败')
}

function cancelEdit() {
  isEditing.value = false
}

// ===== 单词查询 =====
const wordLookupEnabled = ref(true) // T 键全局开关
const selectedWord = ref('')
const wordResult = ref({})
const wordCardPos = ref({ x: 0, y: 0 })
const showWordCard = ref(false)
let lookupTimer = null
let lookupAbortController = null

function goBack() {
  if (article.value) store.navigateTo(article.value.folderId)
  router.push('/')
}

function onTextSelection() {
  if (!wordLookupEnabled.value) return
  const selection = window.getSelection()
  const raw = selection?.toString()
  if (!raw) return

  let text = raw.split('\n').join(' ').trim()
  if (!text) return

  const punc = '.,;:!?"\'，。！？；：、·…`()（）[]{}<>《》【】'
  while (punc.includes(text[0])) text = text.slice(1).trim()
  while (punc.includes(text[text.length - 1])) text = text.slice(0, -1).trim()
  if (!text) return

  if (/[/\\]/.test(text)) return
  if (
    text
      .split('.')
      .pop()
      ?.match(/^(png|jpg|jpeg|gif|txt|exe|pdf|py|js|ts|css|html|json)$/i)
  )
    return
  if (/^\d+$/.test(text)) return
  if (!/[a-zA-Z]{2,}/.test(text)) return

  const word = text.toLowerCase()
  if (word === selectedWord.value) return

  selectedWord.value = word

  const range = selection.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  wordCardPos.value = { x: rect.left, y: rect.bottom }

  clearTimeout(lookupTimer)
  wordResult.value = {} // 立即清除旧结果，避免快捷键注释读到过期数据
  lookupTimer = setTimeout(async () => {
    if (lookupAbortController) lookupAbortController.abort()
    lookupAbortController = new AbortController()
    showWordCard.value = true
    try {
      const res = await lookupWord(word, lookupAbortController.signal)
      wordResult.value = res
    } catch (err) {
      if (err.name === 'AbortError') return
    }
  }, 0)
}

function closeWordCard() {
  showWordCard.value = false
  selectedWord.value = ''
  wordResult.value = {} // 清空旧数据，避免后续注释自动填入时使用过时结果
  clearTimeout(lookupTimer)
  if (lookupAbortController && !lookupAbortController.signal.aborted) {
    lookupAbortController.abort()
  }
  lookupAbortController = null
}

// ===== 右侧外链面板 =====
const showLeftPanel = ref(false)

// ===== 阅读计时器 =====
const timerRunning = ref(false)
const timerSeconds = ref(0)
let timerInterval = null
const timerDisplay = computed(() => {
  const m = String(Math.floor(timerSeconds.value / 60)).padStart(2, '0')
  const s = String(timerSeconds.value % 60).padStart(2, '0')
  return `${m}:${s}`
})
function toggleTimer() {
  if (timerRunning.value) {
    // 运行中 → 暂停
    timerRunning.value = false
    clearInterval(timerInterval)
    timerInterval = null
  } else if (timerSeconds.value > 0) {
    // 已暂停且有计时 → 归零
    timerSeconds.value = 0
  } else {
    // 归零状态 → 开始
    timerRunning.value = true
    timerInterval = setInterval(() => { timerSeconds.value++ }, 1000)
  }
}

// ===== 画布 =====
const drawMode = ref(false)
const drawActive = ref(false)
const drawTool = ref('pen')
const drawColor = ref('#e74c3c')
const drawColors = ['#e74c3c', '#2c3e50', '#3498db', '#27ae60', '#f39c12', '#9b59b6']

// 画布工具激活时关闭所有注释/查词卡片并取消选中
watch(drawActive, (val) => {
  if (val) {
    closeWordCard()
    closeAnnotationCard()
    hideAnnotToolbar()
    window.getSelection()?.removeAllRanges()
  }
})

// ===== 批注功能 =====
const annotations = ref([])
const annotToolbarVisible = ref(false)
const annotToolbarPos = ref({ x: 0, y: 0 })
const annotCardVisible = ref(false)
const annotCardPos = ref({ x: 0, y: 0 })
const activeAnnotation = ref(null)
const immediateEdit = ref(false) // 工具栏创建批注后直接进入编辑模式
let annotHoverTimer = null
let annotLeaveTimer = null
let annotToolbarTimer = null
const isMouseOnCard = ref(false)
const isAnnotEditing = ref(false)

// 选中区域的段落索引和偏移量（用于创建批注）
const pendingSelection = ref(null)
const lastSelection = ref(null)
const pendingNoteFill = ref(null) // 等待查词结果后填入注释的批注 ID

async function loadAnnotations() {
  try {
    const res = await fetchAnnotations(route.params.id)
    annotations.value = res.data || []
  } catch {
    annotations.value = []
  }
}

// 监听文章变化，加载批注（先清空防止串数据）
watch(
  () => route.params.id,
  () => {
    annotations.value = []
    loadAnnotations()
    closeAnnotationCard()
  },
  { immediate: true },
)

// 查词结果返回后，补填快捷键批注的注释内容
watch(
  () => wordResult.value.word,
  (newWord) => {
    if (newWord && pendingNoteFill.value) {
      const note = buildNoteFromLookup()
      if (note) {
        const ann = annotations.value.find((a) => a.id === pendingNoteFill.value)
        if (ann) {
          ann.note = note
          updateAnnotation(pendingNoteFill.value, note)
        }
      }
      pendingNoteFill.value = null
    }
  },
)

// 每个段落的渲染片段（文本 + 批注标记）
const paragraphSegments = computed(() => {
  return paragraphs.value.map((text, paraIdx) => {
    const anns = annotations.value
      .filter((a) => a.paragraphIndex === paraIdx)
      .sort((a, b) => a.startOffset - b.startOffset)

    if (!anns.length) return [{ type: 'text', text }]

    const segments = []
    let cursor = 0
    for (const ann of anns) {
      if (ann.startOffset > cursor) {
        segments.push({ type: 'text', text: text.slice(cursor, ann.startOffset) })
      }
      segments.push({
        type: 'annotation',
        text: text.slice(ann.startOffset, ann.endOffset),
        annotation: ann,
      })
      cursor = Math.max(cursor, ann.endOffset)
    }
    if (cursor < text.length) {
      segments.push({ type: 'text', text: text.slice(cursor) })
    }
    return segments
  })
})

// 获取选中文本在段落中的偏移（修复：使用 TreeWalker 精确计算偏移，避免 indexOf 重复匹配）
function getSelectionOffsets() {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return null

  const range = selection.getRangeAt(0)
  const text = selection.toString().trim()
  if (!text) return null

  // 找到选中文本所在的段落元素
  let node = selection.anchorNode
  while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode
  const paraEl = node?.closest('.article-para')
  if (!paraEl) return null

  // 段落索引：按 DOM 顺序
  const paraEls = document.querySelectorAll('.reader-body .article-para')
  const paraIndex = Array.from(paraEls).indexOf(paraEl)

  const paraText = paragraphs.value[paraIndex]
  if (!paraText) return null

  // 遍历段落内所有文本节点，计算选中文本的绝对偏移量
  let absoluteStart = 0
  const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT, null, false)
  let textNode = walker.nextNode()
  while (textNode) {
    if (textNode === range.startContainer) {
      absoluteStart += range.startOffset
      break
    }
    absoluteStart += textNode.textContent.length
    textNode = walker.nextNode()
  }

  // 从绝对偏移位置开始搜索（避免匹配到段落中更早出现的相同文本）
  const matchStart = paraText.indexOf(text, absoluteStart)
  if (matchStart < 0) {
    // 兜底：从开头搜索
    const fallback = paraText.indexOf(text)
    if (fallback < 0) return null
    return {
      paragraphIndex: paraIndex,
      startOffset: fallback,
      endOffset: fallback + text.length,
      text,
    }
  }

  return {
    paragraphIndex: paraIndex,
    startOffset: matchStart,
    endOffset: matchStart + text.length,
    text,
  }
}

// 扩展选区到完整单词边界（Adobe Acrobat 风格）
function expandRangeToWords() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  const text = sel.toString()
  // 仅当选中有内部空格（非首尾空格）时才扩展单词边界
  // 避免双击选中单词（可能带尾随空格）误触发
  if (text.length < 2 || !/\S\s+\S/.test(text)) return
  const range = sel.getRangeAt(0)
  // 扩展起始点到单词开头
  let node = range.startContainer
  let offset = range.startOffset
  if (node.nodeType === Node.TEXT_NODE) {
    while (offset > 0 && !/\s/.test(node.textContent[offset - 1])) offset--
    range.setStart(node, offset)
  }
  // 扩展结束点到单词结尾
  node = range.endContainer
  offset = range.endOffset
  if (node.nodeType === Node.TEXT_NODE) {
    while (offset < node.textContent.length && !/\s/.test(node.textContent[offset])) offset++
    range.setEnd(node, offset)
  }
  sel.removeAllRanges()
  sel.addRange(range)
}

// 选中文本后显示批注工具栏
function onMouseUp(e) {
  // 选中多词时自动扩展到完整单词
  expandRangeToWords()
  // 点击已有批注文本时，不触发单词查询
  if (!e.target.closest('.annotated')) {
    onTextSelection()
  }

  // 显示批注工具栏
  clearTimeout(annotToolbarTimer)
  annotToolbarTimer = setTimeout(() => {
    const offsets = getSelectionOffsets()
    if (!offsets || offsets.text.length < 1) {
      annotToolbarVisible.value = false
      return
    }

    // 选中区域与已有批注重叠时，不显示工具栏
    const overlaps = annotations.value.some(
      (a) =>
        a.paragraphIndex === offsets.paragraphIndex &&
        a.startOffset < offsets.endOffset &&
        a.endOffset > offsets.startOffset,
    )
    if (overlaps) {
      annotToolbarVisible.value = false
      return
    }

    pendingSelection.value = offsets
    lastSelection.value = offsets

    const selection = window.getSelection()
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()

    annotToolbarPos.value = {
      x: rect.left + rect.width / 2,
      y: rect.top - 12,
    }
    annotToolbarVisible.value = true
  }, 0)
}

// 将查词卡片结果格式化为注释文本
function buildNoteFromLookup() {
  if (!wordResult.value.word) return ''
  const r = wordResult.value
  const isLong = r.word.split(/\s+/).length > 5
  // 长句不包含原文，仅保留翻译
  const lines = isLong ? [] : [r.word]
  if (r.phonetic_uk) lines.push(`英 ${r.phonetic_uk}`)
  if (r.phonetic_us) lines.push(`美 ${r.phonetic_us}`)
  if (r.definitions?.length) {
    for (const d of r.definitions) {
      lines.push(d.part_of_speech ? `${d.part_of_speech} ${d.translation}` : d.translation)
    }
  } else if (r.translation) {
    lines.push(r.translation)
  }
  return lines.join('\n')
}

async function createAnnotation(type, color = '#FFEB3B', autoFill = false) {
  if (!pendingSelection.value) return

  const sel = pendingSelection.value
  const articleId = route.params.id

  const overlaps = annotations.value.some(
    (a) =>
      a.paragraphIndex === sel.paragraphIndex &&
      a.startOffset < sel.endOffset &&
      a.endOffset > sel.startOffset,
  )
  if (overlaps) {
    annotToolbarVisible.value = false
    pendingSelection.value = null
    return
  }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const newAnn = {
    id,
    articleId,
    paragraphIndex: sel.paragraphIndex,
    startOffset: sel.startOffset,
    endOffset: sel.endOffset,
    text: sel.text,
    type,
    color,
    note: (() => {
      if (!autoFill) return ''
      const note = buildNoteFromLookup()
      if (!note) pendingNoteFill.value = id
      return note
    })(),
    createdAt: new Date().toISOString(),
  }

  annotations.value.push(newAnn)
  annotToolbarVisible.value = false
  if (!autoFill) closeWordCard() // 快捷键创建时保留查词结果以自动填入
  pendingSelection.value = null
  window.getSelection().removeAllRanges()

  // 保存到后端
  await apiCreateAnnotation(newAnn)

  // 手动点击工具栏时直接进入编辑模式（快捷键自动填入则保持查看模式）
  immediateEdit.value = !autoFill

  // 创建后立即显示注释卡片
  setTimeout(() => {
    showAnnotCardForAnnotation(newAnn)
  }, 100)
}

function hideAnnotToolbar() {
  annotToolbarVisible.value = false
  pendingSelection.value = null
}

// 处理批注 hover
function onAnnotMouseEnter(event, annotation) {
  clearTimeout(annotLeaveTimer)
  clearTimeout(annotHoverTimer)

  annotHoverTimer = setTimeout(() => {
    if (activeAnnotation.value === annotation && annotCardVisible.value) return
    annotCardVisible.value = false
    nextTick(() => {
      activeAnnotation.value = annotation
      const rect = event.target.getBoundingClientRect()
      annotCardPos.value = { x: rect.left, y: rect.bottom }
      annotCardVisible.value = true
    })
  }, 200)
}

function onAnnotMouseLeave() {
  clearTimeout(annotHoverTimer)
  annotLeaveTimer = setTimeout(() => {
    if (!isMouseOnCard.value && !isAnnotEditing.value) {
      annotCardVisible.value = false
      activeAnnotation.value = null
    }
  }, 150)
}

function onAnnotCardMouseEnter() {
  isMouseOnCard.value = true
  clearTimeout(annotLeaveTimer)
}

function onAnnotCardMouseLeave() {
  isMouseOnCard.value = false
  if (isAnnotEditing.value) return
  clearTimeout(annotLeaveTimer)
  annotLeaveTimer = setTimeout(() => {
    annotCardVisible.value = false
    activeAnnotation.value = null
  }, 150)
}

function onAnnotClick(event, annotation) {
  clearTimeout(annotHoverTimer)
  clearTimeout(annotLeaveTimer)
  activeAnnotation.value = annotation
  const rect = event.target.getBoundingClientRect()
  annotCardPos.value = { x: rect.left, y: rect.bottom }
  annotCardVisible.value = true
}

function showAnnotCardForAnnotation(annotation) {
  // 查找对应的 span 元素
  const spans = document.querySelectorAll('.annotated')
  for (const span of spans) {
    if (span.dataset.annotId === annotation.id) {
      activeAnnotation.value = annotation
      const rect = span.getBoundingClientRect()
      annotCardPos.value = { x: rect.left, y: rect.bottom }
      annotCardVisible.value = true
      // 强制进入编辑模式
      break
    }
  }
}

function closeAnnotationCard() {
  annotCardVisible.value = false
  activeAnnotation.value = null
  isMouseOnCard.value = false
  isAnnotEditing.value = false
}

async function saveAnnotationNote(annotationId, note) {
  const ann = annotations.value.find((a) => a.id === annotationId)
  if (ann) {
    ann.note = note
    await updateAnnotation(annotationId, note)
  }
}

async function deleteAnnotation(annotationId) {
  annotations.value = annotations.value.filter((a) => a.id !== annotationId)
  annotCardVisible.value = false
  activeAnnotation.value = null
  await apiDeleteAnnotation(annotationId)
}

// 全局点击
function onGlobalClick(e) {
  // 关闭单词卡片
  if (showWordCard.value) {
    const card = e.target.closest('.word-card')
    if (!card) closeWordCard()
  }

  // 关闭批注工具栏（点击工具栏外部）
  if (annotToolbarVisible.value) {
    const toolbar = e.target.closest('.annot-toolbar')
    const card = e.target.closest('.annot-card')
    if (!toolbar && !card) hideAnnotToolbar()
  }

  // 关闭批注卡片（点击批注文本和卡片外部）
  if (annotCardVisible.value) {
    const annotated = e.target.closest('.annotated')
    const card = e.target.closest('.annot-card')
    if (!annotated && !card) closeAnnotationCard()
  }
}

function onAnnotShortcut(e) {
  if (isEditing.value) return
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  // e.code（物理键位）兼容输入法，e.key（字符）兼容旧浏览器
  const isR = e.code === 'KeyR' || e.key === 'r' || e.key === 'R'
  const isL = e.code === 'KeyL' || e.key === 'l' || e.key === 'L'

  // R 键：开关画布功能
  if (isR) {
    e.preventDefault()
    if (drawMode.value) {
      // 画布已开启：再次按 R 完全关闭
      drawMode.value = false
      drawActive.value = false
    } else {
      drawMode.value = true
      drawActive.value = true
      drawTool.value = 'pen'
    }
    return
  }

  // L 键：开关链接面板
  if (isL) {
    e.preventDefault()
    showLeftPanel.value = !showLeftPanel.value
    return
  }

  // 画布激活时禁用注释快捷键
  if (drawActive.value) return

  const isE = e.code === 'KeyE' || e.key === 'e' || e.key === 'E'
  const isW = e.code === 'KeyW' || e.key === 'w' || e.key === 'W'
  const isT = e.code === 'KeyT' || e.key === 't' || e.key === 'T'
  if (!isE && !isW && !isT) return

  e.preventDefault()

  // T 键：全局开关查词功能（关闭时隐藏卡片且不触发查询）
  if (isT) {
    wordLookupEnabled.value = !wordLookupEnabled.value
    if (!wordLookupEnabled.value && showWordCard.value) {
      closeWordCard()
    }
    return
  }

  const offsets = getSelectionOffsets() || lastSelection.value
  if (!offsets) return

  pendingSelection.value = offsets

  // 查词关闭时仍然发起查词，供注释自动填入使用
  if (!wordLookupEnabled.value) {
    const word = offsets.text
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .trim()
    if (word) {
      lookupWord(word)
        .then((res) => {
          wordResult.value = res
        })
        .catch(() => {})
    }
  }

  if (isE) {
    createAnnotation('highlight', '#FFEB3B', true)
  } else {
    createAnnotation('underline', '#e74c3c', true)
  }
}

onMounted(() => {
  document.addEventListener('keydown', onAnnotShortcut)
})

onMounted(async () => {
  const id = route.params.id
  localStorage.setItem('lastPage', `article:${id}`)
  if (!store.articles[id]) {
    const res = await fetchArticle(id)
    if (res.status === 'ok') store.articles[id] = res.data
  }
  loadAnnotations()
  document.addEventListener('mouseup', onMouseUp)
  document.addEventListener('click', onGlobalClick)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onAnnotShortcut)
  document.removeEventListener('mouseup', onMouseUp)
  document.removeEventListener('click', onGlobalClick)
  clearTimeout(lookupTimer)
  clearTimeout(annotHoverTimer)
  clearTimeout(annotLeaveTimer)
  clearTimeout(annotToolbarTimer)
  clearInterval(timerInterval)
  timerInterval = null
  if (lookupAbortController) {
    lookupAbortController.abort()
    lookupAbortController = null
  }
})
</script>

<template>
  <div class="page" :class="{ 'page-fixed': isEditing }">
    <div class="page-inner" :class="{ shifted: showLeftPanel }">
      <div class="page-width">
        <div class="tb-left">
          <button class="back-btn" @click="goBack"><span class="back-arrow">←</span> Back</button>
          <template v-if="!isEditing">
            <button class="act-btn act-edit" @click="startEdit">✎ Edit</button>
          </template>
          <template v-else>
            <button class="act-btn act-cancel" @click="cancelEdit">Cancel</button>
            <button
              class="act-btn act-save"
              :disabled="saving || !editTitle.trim()"
              @click="saveEdit"
            >
              {{ saving ? 'Saving...' : '✓ Save' }}
            </button>
          </template>
        </div>
        <span class="reading-timer" :class="{ running: timerRunning }" @click="toggleTimer"
          >阅读计时：{{ timerDisplay }}</span
        >
        <span class="word-count">{{ wordCount }} words</span>
        <button
          class="link-toggle"
          :class="{ active: showLeftPanel }"
          @click="showLeftPanel = !showLeftPanel"
        >
          链接
        </button>
      </div>
      <template v-if="article">
        <div class="reader">
          <div class="reader-top-bar"></div>
          <div
            class="reader-content"
            @wheel="closeWordCard(); hideAnnotToolbar(); closeAnnotationCard()"
          >
            <h1 v-if="!isEditing" class="reader-title">{{ article.title }}</h1>
            <input v-else v-model="editTitle" class="editor-title" type="text" />
            <div v-if="!isEditing" class="reader-body">
              <p v-for="(segments, i) in paragraphSegments" :key="i" class="article-para">
                <template v-for="(seg, j) in segments" :key="j">
                  <span v-if="seg.type === 'text'">{{ seg.text }}</span>
                  <span
                    v-else
                    :ref="
                      (el) => {
                        if (el) el.dataset.annotId = seg.annotation.id
                      }
                    "
                    class="annotated"
                    :class="[seg.annotation.type]"
                    :style="
                      seg.annotation.type === 'highlight'
                        ? { backgroundColor: seg.annotation.color }
                        : {}
                    "
                    :data-annot-id="seg.annotation.id"
                    @mouseenter="onAnnotMouseEnter($event, seg.annotation)"
                    @mouseleave="onAnnotMouseLeave"
                    @click.stop="onAnnotClick($event, seg.annotation)"
                    >{{ seg.text }}</span
                  >
                </template>
              </p>
            </div>
            <textarea
              v-else
              v-model="editContent"
              class="editor-textarea"
              spellcheck="false"
            ></textarea>

            <!-- 画布（限于阅读容器内） -->
            <DrawCanvas
              :draw-mode="drawMode"
              :draw-active="drawActive"
              :tool="drawTool"
              :color="drawColor"
              :colors="drawColors"
              :article-id="route.params.id"
              :panel-open="showLeftPanel"
              @toggle-tool="drawActive = !drawActive"
              @toggle-draw="drawActive = !drawActive"
              @close-canvas="drawMode = false; drawActive = false"
              @new-canvas="drawMode = false; drawActive = false"
              @update:tool="drawTool = $event"
              @update:color="drawColor = $event"
            />
          </div>
        </div>
      </template>
      <div v-else class="not-found">Article not found.</div>
    </div>
    <!-- 右侧外链面板 -->
    <div class="side-panel" :class="{ visible: showLeftPanel }">
      <iframe
        class="panel-iframe"
        src="https://yuanbao.tencent.com/chat/naQivTmsDa"
        title="腾讯元宝"
      ></iframe>
    </div>

    <!-- 批注工具栏 -->
    <Teleport to="body">
      <div
        v-if="annotToolbarVisible"
        class="annot-toolbar"
        :style="{ left: annotToolbarPos.x + 'px', top: annotToolbarPos.y + 'px' }"
        @click.stop
        @wheel.prevent.stop
      >
        <button
          class="tb-btn tb-highlight"
          title="黄色高亮"
          @click="createAnnotation('highlight', '#FFEB3B')"
        >
          <span class="tb-icon" style="background: #fff3b0"></span>
        </button>
        <div class="tb-divider"></div>
        <button
          class="tb-btn tb-underline"
          title="红色下划线"
          @click="createAnnotation('underline', '#e74c3c')"
        >
          <span class="tb-icon tb-icon-underline">U̲</span>
        </button>
      </div>
    </Teleport>

    <!-- 单词查询卡片 -->
    <WordCard
      :word="selectedWord"
      :result="wordResult"
      :visible="showWordCard"
      :position="wordCardPos"
      @close="closeWordCard"
    />

    <!-- 批注卡片 -->
    <AnnotationCard
      :annotation="activeAnnotation || {}"
      :visible="annotCardVisible"
      :position="annotCardPos"
      :start-editing="immediateEdit"
      @close="closeAnnotationCard"
      @save="saveAnnotationNote"
      @delete="deleteAnnotation"
      @edit-started="immediateEdit = false"
      @mouseenter="onAnnotCardMouseEnter"
      @mouseleave="onAnnotCardMouseLeave"
      @editing-changed="isAnnotEditing = $event"
    />
  </div>
</template>

<style scoped>
.page {
  height: 100vh;
  overflow: hidden;
  background: #f8f5f0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 0 0;
  position: relative;
}
.page-inner {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: margin-right 0.4s ease;
}
.page-inner.shifted {
  width: 54vw;
  align-self: flex-start;
}
.page-inner.shifted .page-width,
.page-inner.shifted .reader {
  max-width: none;
  width: 100%;
}
.page-width {
  width: 100%;
  max-width: 1080px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  margin-bottom: 10px;
  box-sizing: border-box;
}
.tb-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.word-count {
  font-size: 12px;
  color: #8a7a66;
  white-space: nowrap;
  user-select: none;
}
.reading-timer {
  font-size: 12px;
  color: #8a7a66;
  white-space: nowrap;
  user-select: none;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  transition: all 0.2s;
  font-variant-numeric: tabular-nums;
}
.reading-timer:hover {
  background: #f0ebe4;
  color: #5a4a36;
}
.reading-timer.running {
  color: #e74c3c;
  font-weight: 500;
}
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #d4c5b0;
  background: transparent;
  color: #6b5a3e;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 6px 16px;
  border-radius: 20px;
  transition: all 0.2s ease;
}
.back-arrow {
  font-size: 15px;
  transition: transform 0.2s ease;
}
.back-btn:hover {
  background: #fcf9f4;
  border-color: #c4a87c;
  color: #8b3a2a;
}
.back-btn:hover .back-arrow {
  transform: translateX(-3px);
}
.reader {
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 1080px;
  background: #fcf9f4;
  border-radius: 12px;
  border: 1px solid #e8e0d4;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.reader-top-bar {
  display: none;
}
.reader-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 0 40px;
}
.reader-title,
.reader-body {
  width: 100%;
  max-width: 800px;
  padding: 0 40px;
  box-sizing: border-box;
}
.reader-title {
  font-size: 28px;
  font-weight: 700;
  color: #1a1a2e;
  line-height: 1.3;
  margin: 0 0 8px;
  letter-spacing: -0.5px;
}
.reader-body {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 20px;
  color: #333;
  line-height: 1.8;
  text-align: justify;
  text-justify: inter-ideograph;
  user-select: text;
  cursor: text;
}
.reader-body ::selection {
  background: #fce4ec;
  color: #333;
}
.article-para {
  margin: 0 0 16px;
  white-space: pre-wrap;
}
.not-found {
  color: #999;
  font-size: 16px;
  margin-top: 60px;
}

/* ===== 批注样式 ===== */
.annotated {
  cursor: pointer;
  transition: opacity 0.15s;
}
.annotated:hover {
  opacity: 0.75;
}
.annotated.highlight {
  padding: 1px 0;
  border-radius: 2px;
}
.annotated.underline {
  text-decoration: underline;
  text-decoration-color: #e74c3c;
  text-decoration-thickness: 2px;
  text-underline-offset: 5px;
  text-decoration-skip-ink: none;
}
.annotated.underline:hover {
  text-decoration-color: #c0392b;
}

/* ===== 批注工具栏 ===== */
.annot-toolbar {
  position: fixed;
  z-index: 9997;
  display: flex;
  align-items: center;
  gap: 4px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  padding: 6px 8px;
  transform: translate(-50%, -100%);
  user-select: none;
}
.tb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1.5px solid transparent;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  padding: 0;
  transition: all 0.15s;
}
.tb-btn:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}
.tb-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 3px;
  font-size: 13px;
  line-height: 1;
}
.tb-icon-underline {
  font-weight: 700;
  font-size: 13px;
  color: #e74c3c;
  background: none !important;
}
.tb-divider {
  width: 1px;
  height: 20px;
  background: #e2e8f0;
  margin: 0 2px;
}

/* ===== 编辑模式 ===== */
.editor-title {
  width: 100%;
  max-width: 800px;
  padding: 10px 12px;
  box-sizing: border-box;
  border: 1px solid #d4c5b0;
  border-radius: 4px;
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 28px;
  font-weight: 700;
  color: #1a1a1a;
  background: #fff;
  outline: none;
  flex-shrink: 0;
  box-sizing: border-box;
}
.editor-title:focus {
  border-color: #8b3a2a;
  box-shadow: 0 0 0 3px rgba(139, 58, 42, 0.1);
}
.page-fixed {
  height: 100vh;
  overflow: hidden;
  padding-bottom: 0;
}
.editor-textarea {
  width: 100%;
  max-width: 800px;
  flex: 1;
  min-height: 0;
  padding: 12px;
  border: 1px solid #d4c5b0;
  border-radius: 4px;
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 16px;
  line-height: 1.9;
  color: #2a2a2a;
  background: #fff;
  text-align: justify;
  outline: none;
  resize: vertical;
  box-sizing: border-box;
}
.editor-textarea:focus {
  border-color: #8b3a2a;
  box-shadow: 0 0 0 3px rgba(139, 58, 42, 0.1);
}

.act-btn {
  border: none;
  border-radius: 6px;
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.act-edit {
  background: transparent;
  color: #6b5a3e;
}
.act-edit:hover {
  background: rgba(139, 58, 42, 0.06);
  color: #8b3a2a;
}
.act-cancel {
  background: #e8e8e8;
  color: #555;
}
.act-cancel:hover {
  background: #d4d4d4;
}
.act-save {
  background: #8b3a2a;
  color: #fff;
}
.act-save:hover:not(:disabled) {
  background: #6b2a1a;
}
.act-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ===== 链接切换按钮 ===== */
.link-toggle {
  border: 1px solid #d4c5b0;
  background: transparent;
  color: #6b5a3e;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  padding: 5px 14px;
  border-radius: 20px;
  white-space: nowrap;
  transition: all 0.2s;
}
.link-toggle:hover {
  background: #f0e8d8;
  border-color: #8b3a2a;
}
.link-toggle.active {
  background: #8b3a2a;
  color: #fff;
  border-color: #8b3a2a;
}

/* ===== 右侧外链面板 ===== */
.side-panel {
  position: fixed;
  right: 0;
  top: 0;
  width: 0;
  height: 100vh;
  overflow: hidden;
  opacity: 0;
  background: #fff;
  border-left: 1px solid #e8e0d4;
  display: flex;
  flex-direction: column;
  box-shadow: -2px 0 12px rgba(0, 0, 0, 0.08);
  transition:
    width 0.4s ease,
    opacity 0.3s ease 0.05s;
  z-index: 9000;
}
.side-panel.visible {
  width: 46vw;
  opacity: 1;
}
.side-panel .panel-iframe {
  flex: 1;
  width: 100%;
  border: none;
}
</style>
