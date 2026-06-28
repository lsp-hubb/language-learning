<script setup>
import { useRoute, useRouter } from 'vue-router'
import { useFileExplorerStore } from '@/stores/fileExplorer'
import { ref, computed, inject, onMounted, onUnmounted, watch } from 'vue'
import { fetchArticle, lookupWord, updateAnnotation } from '@/api'
import { useTimer } from '@/composables/useTimer'
import { useCanvas } from '@/composables/useCanvas'
import { useWordLookup } from '@/composables/useWordLookup'
import { useAnnotations } from '@/composables/useAnnotations'
import ArticleToolbar from '@/components/ArticleToolbar.vue'
import ArticleReader from '@/components/ArticleReader.vue'
import ArticleEditor from '@/components/ArticleEditor.vue'
import AnnotToolbar from '@/components/AnnotToolbar.vue'
import WordCard from '@/components/WordCard.vue'
import ManualWordCard from '@/components/ManualWordCard.vue'
import AnnotationCard from '@/components/AnnotationCard.vue'

const route = useRoute()
const router = useRouter()
const store = useFileExplorerStore()

// ===== 手动查词卡片选中自动填充 =====
const manualQueryText = ref('')

// ===== 翻译 =====
const showTransDialog = ref(false)
const transInput = ref('')
const translations = ref([])
const visibleTrans = ref(new Set())
const transEnabled = ref(false)
const highlightedTransSents = ref(new Map()) // Map<paraIndex, sentIdx>

function openTransDialog() {
  transInput.value = translations.value.join('\n')
  showTransDialog.value = true
}

async function importTranslation() {
  const lines = transInput.value.split('\n').filter((l) => l.trim())
  translations.value = lines
  visibleTrans.value = new Set()
  transEnabled.value = true
  showTransDialog.value = false
  // 持久化到数据库
  if (article.value) {
    await store.updateArticle(article.value.id, { translation: lines.join('\n') })
  }
}

function toggleTrans(index) {
  const set = new Set(visibleTrans.value)
  if (set.has(index)) set.delete(index)
  else set.add(index)
  visibleTrans.value = set
}

function clearTranslations() {
  translations.value = []
  visibleTrans.value = new Set()
  transEnabled.value = false
}

// ===== 翻译句子高亮 =====
function getSelectionParaOffset() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  let node = sel.anchorNode
  while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode
  const paraEl = node?.closest('.article-para')
  if (!paraEl) return null
  const paraEls = document.querySelectorAll('.reader-body .article-para')
  const paraIndex = Array.from(paraEls).indexOf(paraEl)
  if (paraIndex < 0) return null
  let absoluteStart = 0
  const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT, null, false)
  let textNode = walker.nextNode()
  while (textNode) {
    if (textNode === range.startContainer) { absoluteStart += range.startOffset; break }
    absoluteStart += textNode.textContent.length
    textNode = walker.nextNode()
  }
  return { paraIndex, offset: absoluteStart }
}

function findSentenceIndex(paraText, startOffset) {
  const dotPositions = []
  let dotIdx = -1
  while ((dotIdx = paraText.indexOf('.', dotIdx + 1)) !== -1) dotPositions.push(dotIdx)
  let sentIdx = 0, sentStart = 0
  for (let i = 0; i < dotPositions.length; i++) {
    if (startOffset >= sentStart && startOffset <= dotPositions[i]) { sentIdx = i; break }
    sentStart = dotPositions[i] + 1
    sentIdx = i + 1
  }
  return sentIdx
}

function updateTransHighlight() {
  if (!transEnabled.value) { highlightedTransSents.value = new Map(); return }
  const info = getSelectionParaOffset()
  if (!info) return
  const { paraIndex, offset } = info
  const paraText = paragraphs.value[paraIndex]
  if (!paraText || !translations.value[paraIndex]) return
  const sentIdx = findSentenceIndex(paraText, offset)
  const map = new Map()
  map.set(paraIndex, sentIdx)
  highlightedTransSents.value = map
}

// ===== 基本信息 =====
const article = computed(() => store.articles[route.params.id])
const loadingArticle = ref(true)

const paragraphs = computed(() => {
  if (!article.value?.content) return []
  return article.value.content.split('\n').filter((l) => l.trim())
})

const wordCount = computed(() => {
  if (!article.value?.content) return 0
  return article.value.content.split(/\s+/).filter((w) => w.length > 0).length
})

// ===== Composables =====
const { wordLookupEnabled, selectedWord, wordResult, wordCardPos, showManualCard, showWordCard, onTextSelection, closeWordCard, cleanupLookup } = useWordLookup()
const { timerRunning, timerDisplay, toggleTimer } = useTimer()
const {
  annotations, annotToolbarVisible, annotToolbarPos, annotCardVisible, annotCardPos,
  activeAnnotation, immediateEdit, isMouseOnCard, isAnnotEditing,
  pendingSelection, lastSelection, pendingNoteFill,
  loadAnnotations, getSelectionOffsets, buildParagraphSegments, buildNoteFromLookup,
  createAnnotation, onMouseUp, hideAnnotToolbar,
  onAnnotMouseEnter, onAnnotMouseLeave, onAnnotCardMouseEnter, onAnnotCardMouseLeave,
  onAnnotClick, showAnnotCardForAnnotation, closeAnnotationCard,
  saveAnnotationNote, deleteAnnotation, onGlobalClick,
  cleanupAnnotTimers,
} = useAnnotations(route, wordResult, closeWordCard, onTextSelection)
const { drawMode, drawActive, drawTool, drawColor, drawColors, closeCanvas } = useCanvas(closeWordCard, closeAnnotationCard, hideAnnotToolbar)

// ===== 批注工具栏开关 =====
const annotToolbarEnabled = ref(false)

// ===== 段落渲染片段 =====
const paragraphSegments = computed(() => buildParagraphSegments(paragraphs))

const fontSize = ref(16)
function changeFontSize(delta) { fontSize.value = Math.max(12, Math.min(32, fontSize.value + delta)) }

// ===== 编辑状态 =====
const isEditing = ref(false)
const editTitle = ref('')
const editContent = ref('')
const saving = ref(false)
const canSave = computed(() => !saving.value && editTitle.value.trim())

function normalizeContent(text) {
  const paras = text.split('\n').filter((l) => l.trim())
  return paras.join('\n\n')
}

function startEdit() {
  if (!article.value) return
  closeWordCard()
  closeAnnotationCard()
  editTitle.value = article.value.title || ''
  editContent.value = normalizeContent(article.value.content || '')
  isEditing.value = true
}

async function saveEdit() {
  if (!article.value) return
  saving.value = true
  const ok = await store.updateArticle(article.value.id, {
    title: editTitle.value, content: editContent.value,
  })
  saving.value = false
  if (ok) isEditing.value = false
  else alert('保存失败')
}

function cancelEdit() { isEditing.value = false }

// ===== 导航 =====
const showLeftPanel = inject('showSidePanel')
function toggleLink() { showLeftPanel.value = !showLeftPanel.value }

async function goBack() {
  showLeftPanel.value = false
  if (article.value) await store.navigateTo(article.value.folderId)
  router.push('/')
}

// ===== 填写批注注释（查词结果返回后）=====
watch(() => wordResult.value.word, (newWord) => {
  if (newWord && pendingNoteFill.value) {
    const note = buildNoteFromLookup()
    if (note) {
      const ann = annotations.value.find((a) => a.id === pendingNoteFill.value)
      if (ann) { ann.note = note; updateAnnotation(pendingNoteFill.value, note) }
    }
    pendingNoteFill.value = null
  }
})

// ===== 监听文章切换 =====
watch(() => route.params.id, () => {
  annotations.value = []
  loadAnnotations()
  closeAnnotationCard()
}, { immediate: true })

// ===== 滚动关闭卡片 =====
function onReaderScrollAway() { closeWordCard(); hideAnnotToolbar(); closeAnnotationCard() }

// ===== 快捷键 =====
function onAnnotShortcut(e) {
  if (isEditing.value) return
  if (e.key === 'Escape') {
    window.getSelection()?.removeAllRanges(); closeWordCard(); closeAnnotationCard()
    hideAnnotToolbar(); return
  }

  if (e.ctrlKey && e.shiftKey && (e.key === 'Z' || e.key === 'z')) {
    e.preventDefault(); showManualCard.value = !showManualCard.value; return
  }
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  const isR = e.ctrlKey && (e.code === 'KeyR' || e.key === 'r' || e.key === 'R')
  const isL = e.code === 'KeyL' || e.key === 'l' || e.key === 'L'

  if (isR) { e.preventDefault(); drawMode.value ? closeCanvas() : (drawMode.value = true, drawActive.value = true, drawTool.value = 'pen'); return }
  if (isL) { e.preventDefault(); showLeftPanel.value = !showLeftPanel.value; return }
  // 画布画笔/矩形模式下，空格键依次切换颜色
  if (drawActive.value && (drawTool.value === 'pen' || drawTool.value === 'rect') && (e.key === ' ' || e.code === 'Space')) {
    e.preventDefault()
    const idx = drawColors.indexOf(drawColor.value)
    drawColor.value = drawColors[(idx + 1) % drawColors.length]
    return
  }
  if (drawActive.value) return

  const isE = e.code === 'KeyE' || e.key === 'e' || e.key === 'E'
  const isW = e.code === 'KeyW' || e.key === 'w' || e.key === 'W'
  const isT = e.code === 'KeyT' || e.key === 't' || e.key === 'T'
  // 长难句标注：r（不含修饰键）
  const isSentence = !e.ctrlKey && !e.shiftKey && !e.altKey && (e.code === 'KeyR' || e.key === 'r')
  if (!isE && !isW && !isT && !isSentence) return

  e.preventDefault()
  if (isT) { wordLookupEnabled.value = !wordLookupEnabled.value; if (!wordLookupEnabled.value && showWordCard.value) closeWordCard(); return }

  const sel = window.getSelection()
  const hasActiveSel = sel && !sel.isCollapsed
  const offsets = getSelectionOffsets(paragraphs) || (hasActiveSel ? lastSelection.value : null)
  if (!offsets) return
  pendingSelection.value = offsets

  if (isSentence) {
    // 自动扩展到整句（按 "." 定位起止）
    const paraText = paragraphs.value[offsets.paragraphIndex] || ''
    const transText = translations.value[offsets.paragraphIndex] || ''
    const dotPositions = []
    let dotIdx = -1
    while ((dotIdx = paraText.indexOf('.', dotIdx + 1)) !== -1) dotPositions.push(dotIdx)
    let sentIdx = 0, sentStart = 0, sentEnd = paraText.length
    for (let i = 0; i < dotPositions.length; i++) {
      if (offsets.startOffset >= sentStart && offsets.startOffset <= dotPositions[i]) {
        sentIdx = i; sentEnd = dotPositions[i] + 1; break
      }
      sentStart = dotPositions[i] + 1
      sentIdx = i + 1
    }
    if (dotPositions.length > 0 && sentIdx < dotPositions.length) sentEnd = dotPositions[sentIdx] + 1
    // 更新选区为整句
    offsets.startOffset = sentStart
    offsets.endOffset = sentEnd
    offsets.text = paraText.slice(sentStart, sentEnd)
    pendingSelection.value = offsets
    // 取中文对应句
    const cnSents = transText.split('。').filter(Boolean)
    const cnNote = cnSents[sentIdx] ? cnSents[sentIdx].trim() + '。' : transText
    createAnnotation('sentence', '#2980b9', false, cnNote, true)
    return
  }

  if (!wordLookupEnabled.value) {
    const word = offsets.text.toLowerCase().replace(/[^a-z\s-]/g, '').trim()
    if (word) { wordResult.value = {}; lookupWord(word).then((r) => { wordResult.value = r }).catch(() => {}) }
  }

  createAnnotation(isE ? 'highlight' : 'underline', isE ? '#FFEB3B' : '#e74c3c', true)
}

// ===== 生命周期 =====
onMounted(() => { document.addEventListener('keydown', onAnnotShortcut) })

onMounted(async () => {
  const id = route.params.id
  localStorage.setItem('lastPage', `article:${id}`)
  // 始终从 API 获取完整数据（含 translation）
  try {
    const res = await fetchArticle(id)
    if (res.status === 'ok') store.articles[id] = res.data
    else console.error('获取文章失败:', res)
  } catch (err) {
    console.error('获取文章异常:', err)
  }
  loadingArticle.value = false
  // 加载翻译
  const art = store.articles[id]
  if (art?.translation) {
    translations.value = art.translation.split('\n').filter((l) => l.trim())
    transEnabled.value = true
  } else {
    translations.value = []
    transEnabled.value = false
  }
  loadAnnotations()
  document.addEventListener('mouseup', onMouseUpHandler)
  document.addEventListener('mousedown', onClearSelection)
  document.addEventListener('click', onGlobalClick)
  document.addEventListener('click', onGlobalWordCardClick)
})

function onMouseUpHandler(e) {
  onMouseUp(e, paragraphs)
  updateTransHighlight()
  // 手动查词卡片开启时，选中文本自动填充查询
  if (showManualCard.value) {
    const selection = window.getSelection()
    const raw = selection?.toString()
    if (raw) {
      let text = raw.split('\n').join(' ').trim()
      const punc = '.,;:!?"\'，。！？；：、·…`()（）[]{}<>《》【】'
      while (punc.includes(text[0])) text = text.slice(1).trim()
      while (punc.includes(text[text.length - 1])) text = text.slice(0, -1).trim()
      if (text && /[a-zA-Z]{2,}/.test(text) && !/^\d+$/.test(text)) {
        manualQueryText.value = text.toLowerCase()
      }
    }
  }
}
function onGlobalWordCardClick(e) { if (showWordCard.value && !e.target.closest('.word-card')) closeWordCard() }

// 点击已选中的文本时清除选中（用 mousedown，此时选中来自上次鼠标事件，不是本次刚创建的）
function onClearSelection(e) {
  const curSel = window.getSelection()
  if (curSel && !curSel.isCollapsed && curSel.containsNode(e.target, true)) {
    curSel.removeAllRanges()
    closeWordCard()
    hideAnnotToolbar()
  }
}

onUnmounted(() => {
  document.removeEventListener('keydown', onAnnotShortcut)
  document.removeEventListener('mouseup', onMouseUpHandler)
  document.removeEventListener('mousedown', onClearSelection)
  document.removeEventListener('click', onGlobalClick)
  document.removeEventListener('click', onGlobalWordCardClick)
  cleanupLookup()
  cleanupAnnotTimers()
})
</script>

<template>
  <div class="page" :class="{ 'page-fixed': isEditing }">
    <div class="page-inner" :class="{ shifted: showLeftPanel }">
      <ArticleToolbar
        :is-editing="isEditing"
        :saving="saving"
        :can-save="canSave"
        :timer-display="timerDisplay"
        :timer-running="timerRunning"
        :word-count="wordCount"
        :show-left-panel="showLeftPanel"
        :font-size="fontSize"
        @back="goBack"
        @start-edit="startEdit"
        @cancel-edit="cancelEdit"
        @save-edit="saveEdit"
        @toggle-timer="toggleTimer"
        @toggle-link="toggleLink"
        @change-font-size="changeFontSize"
        @import-translation="openTransDialog"
        :annot-toolbar-enabled="annotToolbarEnabled"
        @toggle-annot-toolbar="annotToolbarEnabled = !annotToolbarEnabled"
        @highlight="createAnnotation('highlight', '#FFEB3B')"
        @underline="createAnnotation('underline', '#e74c3c')"
      />
      <template v-if="article">
        <ArticleReader
          v-if="!isEditing"
          :article="article"
          :paragraph-segments="paragraphSegments"
          :draw-mode="drawMode"
          :draw-active="drawActive"
          :draw-tool="drawTool"
          :draw-color="drawColor"
          :draw-colors="drawColors"
          :article-id="route.params.id"
          :panel-open="showLeftPanel"
          :font-size="fontSize"
          :translations="translations"
          :visible-trans="visibleTrans"
          :highlighted-trans-sents="highlightedTransSents"
          @annot-mouse-enter="onAnnotMouseEnter"
          @annot-mouse-leave="onAnnotMouseLeave"
          @annot-click="onAnnotClick"
          @scroll-away="onReaderScrollAway"
          @toggle-tool="drawActive = !drawActive"
          @toggle-draw="drawActive = !drawActive"
          @close-canvas="closeCanvas"
          @new-canvas="closeCanvas"
          @update:tool="drawTool = $event"
          @update:color="drawColor = $event"
          @toggle-trans="toggleTrans"
        />
        <ArticleEditor
          v-else
          :title="editTitle"
          :content="editContent"
          :saving="saving"
          @update:title="editTitle = $event"
          @update:content="editContent = $event"
          @save="saveEdit"
          @cancel="cancelEdit"
        />
      </template>
      <div v-else-if="loadingArticle" class="not-found">加载中...</div>
      <div v-else class="not-found">Article not found.</div>
    </div>
    <AnnotToolbar
      :visible="annotToolbarVisible && annotToolbarEnabled"
      :position="annotToolbarPos"
      @highlight="createAnnotation('highlight', '#FFEB3B')"
      @underline="createAnnotation('underline', '#e74c3c')"
    />
    <WordCard :word="selectedWord" :result="wordResult" :visible="showWordCard" :position="wordCardPos" @close="closeWordCard" />
    <ManualWordCard :visible="showManualCard" :auto-query-text="manualQueryText" @close="showManualCard = false" @auto-query-consumed="manualQueryText = ''" />
    <Teleport to="body">
      <div v-if="showTransDialog" class="trans-dialog-overlay" @click.self="showTransDialog = false">
        <div class="trans-dialog">
          <div class="trans-dialog-title">导入中文翻译</div>
          <p class="trans-dialog-hint">粘贴中文翻译，每个段落占一行，与英文段落一一对应（共 {{ paragraphs.length }} 段）</p>
          <textarea v-model="transInput" class="trans-dialog-textarea" spellcheck="false" placeholder="粘贴中文翻译..."></textarea>
          <div class="trans-dialog-actions">
            <button class="btn btn-cancel" @click="showTransDialog = false">取消</button>
            <button class="btn btn-accent" @click="importTranslation">确认导入 ({{ transInput.split('\n').filter(l => l.trim()).length }} 段)</button>
          </div>
        </div>
      </div>
    </Teleport>
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
.page { height: 100vh; overflow: hidden; background: #f8f5f0; display: flex; flex-direction: column; align-items: center; padding: 10px 0 0; position: relative; }
.page-inner { flex: 1; min-height: 0; width: 100%; display: flex; flex-direction: column; align-items: center; transition: margin-right 0.4s ease; }
.page-inner.shifted { width: 54vw; align-self: flex-start; }
.page-inner.shifted :deep(.page-width), .page-inner.shifted :deep(.reader) { max-width: none; width: 100%; }
.page-fixed { height: 100vh; overflow: hidden; padding-bottom: 0; }
.not-found { color: #999; font-size: 16px; margin-top: 60px; }

/* ===== 翻译导入对话框 ===== */
.trans-dialog-overlay {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0,0,0,0.4); display: flex;
  align-items: center; justify-content: center;
}
.trans-dialog {
  background: #fff; border-radius: 14px; padding: 28px;
  width: 600px; max-width: 90vw; max-height: 85vh;
  display: flex; flex-direction: column; box-shadow: 0 12px 40px rgba(0,0,0,0.2);
}
.trans-dialog-title { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
.trans-dialog-hint { font-size: 12px; color: #888; margin-bottom: 14px; }
.trans-dialog-textarea {
  flex: 1; min-height: 300px; padding: 12px;
  border: 1px solid #d0d0d0; border-radius: 8px;
  font-size: 14px; line-height: 1.8; resize: vertical;
  font-family: 'Georgia', 'Times New Roman', serif;
  outline: none; box-sizing: border-box;
}
.trans-dialog-textarea:focus { border-color: #4b6cb7; box-shadow: 0 0 0 3px rgba(75,108,183,0.1); }
.trans-dialog-actions {
  display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;
}
.trans-dialog-actions .btn {
  border: none; border-radius: 6px; padding: 8px 16px;
  font-size: 13px; cursor: pointer; transition: all 0.15s;
}
.trans-dialog-actions .btn-cancel { background: #e8e8e8; color: #333; }
.trans-dialog-actions .btn-cancel:hover { background: #d4d4d4; }
.trans-dialog-actions .btn-accent { background: #4b6cb7; color: #fff; }
.trans-dialog-actions .btn-accent:hover { background: #3a5a9f; }
</style>
