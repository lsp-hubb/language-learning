<script setup>
import { useRoute, useRouter } from 'vue-router'
import { useFileExplorerStore } from '@/stores/fileExplorer'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
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

// ===== 基本信息 =====
const article = computed(() => store.articles[route.params.id])

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
const showLeftPanel = ref(true)
function toggleLink() { showLeftPanel.value = !showLeftPanel.value }

async function goBack() {
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
  const isR = e.code === 'KeyR' || e.key === 'r' || e.key === 'R'
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
  if (!isE && !isW && !isT) return

  e.preventDefault()
  if (isT) { wordLookupEnabled.value = !wordLookupEnabled.value; if (!wordLookupEnabled.value && showWordCard.value) closeWordCard(); return }

  const offsets = getSelectionOffsets(paragraphs) || lastSelection.value
  if (!offsets) return
  pendingSelection.value = offsets

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
  if (!store.articles[id]) {
    const res = await fetchArticle(id)
    if (res.status === 'ok') store.articles[id] = res.data
  }
  loadAnnotations()
  document.addEventListener('mouseup', onMouseUpHandler)
  document.addEventListener('click', onGlobalClick)
  document.addEventListener('click', onGlobalWordCardClick)
})

function onMouseUpHandler(e) {
  onMouseUp(e, paragraphs)
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

onUnmounted(() => {
  document.removeEventListener('keydown', onAnnotShortcut)
  document.removeEventListener('mouseup', onMouseUpHandler)
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
      <div v-else class="not-found">Article not found.</div>
    </div>
    <div class="side-panel" :class="{ visible: showLeftPanel }">
      <iframe class="panel-iframe" src="https://yuanbao.tencent.com/chat/naQivTmsDa" title="腾讯元宝"></iframe>
    </div>
    <AnnotToolbar
      :visible="annotToolbarVisible"
      :position="annotToolbarPos"
      @highlight="createAnnotation('highlight', '#FFEB3B')"
      @underline="createAnnotation('underline', '#e74c3c')"
    />
    <WordCard :word="selectedWord" :result="wordResult" :visible="showWordCard" :position="wordCardPos" @close="closeWordCard" />
    <ManualWordCard :visible="showManualCard" :auto-query-text="manualQueryText" @close="showManualCard = false" @auto-query-consumed="manualQueryText = ''" />
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
.side-panel { position: fixed; right: 0; top: 0; width: 0; height: 100vh; overflow: hidden; opacity: 0; background: #fff; border-left: 1px solid #e8e0d4; display: flex; flex-direction: column; box-shadow: -2px 0 12px rgba(0,0,0,0.08); transition: width 0.4s ease, opacity 0.3s ease 0.05s; z-index: 9000; }
.side-panel.visible { width: 46vw; opacity: 1; }
.side-panel .panel-iframe { flex: 1; width: 100%; border: none; }
</style>
