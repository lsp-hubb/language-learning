<script setup>
import { useRoute, useRouter } from 'vue-router'
import { useFileExplorerStore } from '@/stores/fileExplorer'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { lookupWord, fetchArticle, fetchAnnotations, createAnnotation as apiCreateAnnotation, updateAnnotation, deleteAnnotation as apiDeleteAnnotation } from '@/api'
import WordCard from '@/components/WordCard.vue'
import AnnotationCard from '@/components/AnnotationCard.vue'

const route = useRoute()
const router = useRouter()
const store = useFileExplorerStore()

const article = computed(() => store.articles[route.params.id])

// 按换行符拆分段落
const paragraphs = computed(() => {
  if (!article.value?.content) return []
  return article.value.content.split('\n').filter((l) => l.trim())
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
  editContent.value = article.value.content || ''
  isEditing.value = true
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
  const selection = window.getSelection()
  const raw = selection?.toString()
  if (!raw) return

  let text = raw.split('\n').join(' ').trim()
  if (!text) return

  const punc = ".,;:!?\"'，。！？；：、·…`()（）[]{}<>《》【】"
  while (punc.includes(text[0])) text = text.slice(1).trim()
  while (punc.includes(text[text.length - 1])) text = text.slice(0, -1).trim()
  if (!text) return

  if (/[/\\]/.test(text)) return
  if (text.split('.').pop()?.match(/^(png|jpg|jpeg|gif|txt|exe|pdf|py|js|ts|css|html|json)$/i)) return
  if (/^\d+$/.test(text)) return
  if (!/[a-zA-Z]{2,}/.test(text)) return

  const word = text.toLowerCase()
  if (word === selectedWord.value) return

  selectedWord.value = word

  const range = selection.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  wordCardPos.value = { x: rect.left, y: rect.bottom }

  clearTimeout(lookupTimer)
  lookupTimer = setTimeout(async () => {
    if (lookupAbortController) lookupAbortController.abort()
    lookupAbortController = new AbortController()
    showWordCard.value = true
    wordResult.value = {}
    try {
      const res = await lookupWord(word, lookupAbortController.signal)
      wordResult.value = res
    } catch (err) {
      if (err.name === 'AbortError') return
    }
  }, 300)
}

function closeWordCard() {
  showWordCard.value = false
  selectedWord.value = ''
  clearTimeout(lookupTimer)
  if (lookupAbortController && !lookupAbortController.signal.aborted) {
    lookupAbortController.abort()
  }
  lookupAbortController = null
}

// ===== 批注功能 =====
const annotations = ref([])
const annotToolbarVisible = ref(false)
const annotToolbarPos = ref({ x: 0, y: 0 })
const annotCardVisible = ref(false)
const annotCardPos = ref({ x: 0, y: 0 })
const activeAnnotation = ref(null)
let annotHoverTimer = null
let annotLeaveTimer = null
let annotToolbarTimer = null
const isMouseOnCard = ref(false)

// 选中区域的段落索引和偏移量（用于创建批注）
const pendingSelection = ref(null)

async function loadAnnotations() {
  try {
    const res = await fetchAnnotations(route.params.id)
    annotations.value = res.data || []
  } catch {
    annotations.value = []
  }
}

// 监听文章变化，加载批注（先清空防止串数据）
watch(() => route.params.id, () => {
  annotations.value = []
  loadAnnotations()
  closeAnnotationCard()
}, { immediate: true })

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

  const paraEls = document.querySelectorAll('.reader-body .article-para')
  const paraIndex = Array.from(paraEls).indexOf(paraEl)
  if (paraIndex < 0) return null

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

// 选中文本后显示批注工具栏
function onMouseUp(e) {
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
        a.endOffset > offsets.startOffset
    )
    if (overlaps) {
      annotToolbarVisible.value = false
      return
    }

    pendingSelection.value = offsets

    const selection = window.getSelection()
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()

    annotToolbarPos.value = {
      x: rect.left + rect.width / 2,
      y: rect.top - 12,
    }
    annotToolbarVisible.value = true
  }, 50)
}

async function createAnnotation(type, color = '#FFEB3B') {
  if (!pendingSelection.value) return

  const sel = pendingSelection.value
  const articleId = route.params.id

  // 检查是否与已有批注重叠
  const overlaps = annotations.value.some(
    (a) =>
      a.paragraphIndex === sel.paragraphIndex &&
      a.startOffset < sel.endOffset &&
      a.endOffset > sel.startOffset
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
    note: '',
    createdAt: new Date().toISOString(),
  }

  annotations.value.push(newAnn)
  annotToolbarVisible.value = false
  pendingSelection.value = null
  window.getSelection().removeAllRanges()

  // 保存到后端
  await apiCreateAnnotation(newAnn)

  // 创建后立即显示注释卡片（编辑模式）
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
    activeAnnotation.value = annotation
    const rect = event.target.getBoundingClientRect()
    annotCardPos.value = { x: rect.left, y: rect.bottom }
    annotCardVisible.value = true
  }, 200)
}

function onAnnotMouseLeave() {
  clearTimeout(annotHoverTimer)
  annotLeaveTimer = setTimeout(() => {
    if (!isMouseOnCard.value) {
      annotCardVisible.value = false
      activeAnnotation.value = null
    }
  }, 300)
}

function onAnnotCardMouseEnter() {
  isMouseOnCard.value = true
  clearTimeout(annotLeaveTimer)
}

function onAnnotCardMouseLeave() {
  isMouseOnCard.value = false
  annotCardVisible.value = false
  activeAnnotation.value = null
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
  document.addEventListener('keydown', onKeydown)
})

function onKeydown(e) {
  if (isEditing.value) return
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (!pendingSelection.value) return

  if (e.key === 'e' || e.key === 'E') {
    e.preventDefault()
    createAnnotation('highlight', '#FFEB3B')
  } else if (e.key === 'w' || e.key === 'W') {
    e.preventDefault()
    createAnnotation('underline', '#e74c3c')
  }
}

onUnmounted(() => {
  document.removeEventListener('mouseup', onMouseUp)
  document.removeEventListener('click', onGlobalClick)
  document.removeEventListener('keydown', onKeydown)
  clearTimeout(lookupTimer)
  clearTimeout(annotHoverTimer)
  clearTimeout(annotLeaveTimer)
  clearTimeout(annotToolbarTimer)
  if (lookupAbortController) {
    lookupAbortController.abort()
    lookupAbortController = null
  }
})
</script>

<template>
  <div class="page" :class="{ 'page-fixed': isEditing }">
    <div class="page-width">
      <button class="back-btn" @click="goBack">
        <span class="back-arrow">←</span> Back
      </button>
    </div>
    <div v-if="article" class="reader">
      <div class="reader-top-bar"></div>
      <div class="reader-content">
        <h1 v-if="!isEditing" class="reader-title">{{ article.title }}</h1>
        <input v-else v-model="editTitle" class="editor-title" type="text" />
        <div v-if="!isEditing" class="reader-body">
          <p v-for="(segments, i) in paragraphSegments" :key="i" class="article-para">
            <template v-for="(seg, j) in segments" :key="j">
              <span v-if="seg.type === 'text'">{{ seg.text }}</span>
              <span
                v-else
                :ref="(el) => { if (el) el.dataset.annotId = seg.annotation.id }"
                class="annotated"
                :class="[seg.annotation.type]"
                :style="seg.annotation.type === 'highlight' ? { backgroundColor: seg.annotation.color } : {}"
                :data-annot-id="seg.annotation.id"
                :title="seg.annotation.note || undefined"
                @mouseenter="onAnnotMouseEnter($event, seg.annotation)"
                @mouseleave="onAnnotMouseLeave"
                @click.stop="onAnnotClick($event, seg.annotation)"
              >{{ seg.text }}</span>
            </template>
          </p>
        </div>
        <textarea
          v-else
          v-model="editContent"
          class="editor-textarea"
          spellcheck="false"
        ></textarea>
      </div>
      <div class="reader-actions">
        <template v-if="!isEditing">
          <button class="act-btn act-edit" @click="startEdit">✎ Edit</button>
        </template>
        <template v-else>
          <button class="act-btn act-cancel" @click="cancelEdit">Cancel</button>
          <button class="act-btn act-save" :disabled="saving || !editTitle.trim()" @click="saveEdit">
            {{ saving ? 'Saving...' : '✓ Save' }}
          </button>
        </template>
      </div>
    </div>
    <div v-else class="not-found">Article not found.</div>

    <!-- 批注工具栏 -->
    <Teleport to="body">
      <div
        v-if="annotToolbarVisible"
        class="annot-toolbar"
        :style="{ left: annotToolbarPos.x + 'px', top: annotToolbarPos.y + 'px' }"
        @click.stop
      >
        <button class="tb-btn tb-highlight" title="黄色高亮" @click="createAnnotation('highlight', '#FFEB3B')">
          <span class="tb-icon" style="background:#FFEB3B"></span>
        </button>
        <div class="tb-divider"></div>
        <button class="tb-btn tb-underline" title="红色下划线" @click="createAnnotation('underline', '#e74c3c')">
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
      @close="closeAnnotationCard"
      @save="saveAnnotationNote"
      @delete="deleteAnnotation"
      @mouseenter="onAnnotCardMouseEnter"
      @mouseleave="onAnnotCardMouseLeave"
    />
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f8f5f0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px 80px;
}
.page-width {
  width: 100%;
  max-width: 720px;
  margin-bottom: 20px;
  flex-shrink: 0;
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
.back-arrow { font-size: 15px; transition: transform 0.2s ease; }
.back-btn:hover { background: #fcf9f4; border-color: #c4a87c; color: #8b3a2a; }
.back-btn:hover .back-arrow { transform: translateX(-3px); }
.reader {
  background: #fcf9f4;
  width: 100%;
  max-width: 720px;
  border-radius: 6px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  flex: 1;
  display: flex;
  flex-direction: column;
}
.reader-top-bar {
  height: 4px;
  background: linear-gradient(90deg, #8b3a2a 0%, #c49a6c 60%, #5a7a5a 100%);
}
.reader-content {
  flex: 1;
  padding: 48px 56px 20px;
  display: flex;
  flex-direction: column;
}
.reader-title {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 28px;
  font-weight: 700;
  color: #1a1a1a;
  line-height: 1.3;
  letter-spacing: -0.5px;
  margin: 0 0 28px;
  padding-bottom: 20px;
  border-bottom: 2px solid #e8e0d4;
}
.reader-body {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 16px;
  color: #2a2a2a;
  line-height: 1.9;
  text-align: justify;
  user-select: text;
}
.article-para {
  margin: 0 0 1.2em;
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
  padding: 10px 12px;
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
.page-fixed { height: 100vh; overflow: hidden; padding-bottom: 0; }
.editor-textarea {
  width: 100%;
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

/* ===== 底部操作栏 ===== */
.reader-actions {
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
  gap: 8px;
  padding: 12px 56px 16px;
  border-top: 1px solid #eee;
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
.act-edit { background: transparent; color: #6b5a3e; }
.act-edit:hover { background: rgba(139, 58, 42, 0.06); color: #8b3a2a; }
.act-cancel { background: #e8e8e8; color: #555; }
.act-cancel:hover { background: #d4d4d4; }
.act-save { background: #8b3a2a; color: #fff; }
.act-save:hover:not(:disabled) { background: #6b2a1a; }
.act-save:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
