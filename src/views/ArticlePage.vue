<script setup>
import { useRoute, useRouter } from 'vue-router'
import { useFileExplorerStore } from '@/stores/fileExplorer'
import { ref, computed, inject, onMounted, onUnmounted, watch } from 'vue'
import { fetchArticle, fetchArticles, lookupWord, updateAnnotation, runPythonScript } from '@/api'
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
import BookmarksPanel from '@/components/BookmarksPanel.vue'

const route = useRoute()
const router = useRouter()
const store = useFileExplorerStore()

// ===== 手动查词卡片选中自动填充 =====
const manualQueryText = ref('')

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

const fontSize = ref(+(localStorage.getItem('fontSize') || 16))
function changeFontSize(delta) {
  fontSize.value = Math.max(12, Math.min(32, fontSize.value + delta))
  localStorage.setItem('fontSize', fontSize.value)
}

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
  // 保存阅读器的滚动位置
  const readerContent = document.querySelector('.reader .reader-content')
  savedScrollPos.value = readerContent ? readerContent.scrollTop : 0
  editTitle.value = article.value.title || ''
  editContent.value = normalizeContent(article.value.content || '')
  isEditing.value = true
}

const editorRef = ref(null)
const savedScrollPos = ref(0)

async function saveEdit() {
  if (!article.value) return
  saving.value = true
  // 保存编辑器的滚动位置（在切回阅读器前读取 DOM）
  const editorContent = document.querySelector('.reader .reader-content')
  savedScrollPos.value = editorContent ? editorContent.scrollTop : 0
  const html = editorRef.value?.getContent?.() || ''
  const div = document.createElement('div')
  div.innerHTML = html
  const plainText = Array.from(div.children)
    .map((el) => el.textContent)
    .filter(Boolean)
    .join('\n\n')
    // 弯引号/HTML实体 → 直引号
    .replace(/[\u2018\u2019]|&lsquo;|&rsquo;|&#8216;|&#8217;/g, "'")
    .replace(/[\u201C\u201D]|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
  const ok = await store.updateArticle(article.value.id, {
    title: editTitle.value, content: plainText || html,
  })
  saving.value = false
  if (ok) isEditing.value = false
  else alert('保存失败')
}

function cancelEdit() {
  // 保存编辑器的滚动位置
  const editorContent = document.querySelector('.reader .reader-content')
  savedScrollPos.value = editorContent ? editorContent.scrollTop : 0
  isEditing.value = false
}

// ===== 导航 —— 右侧面板（AI / 笔记 互斥切换）=====
const showLeftPanel = inject('showSidePanel')
const panelMode = inject('panelMode')

// 打开并切换到指定面板；已在该面板且面板已展开则收起
function togglePanel(mode) {
  if (showLeftPanel.value && panelMode.value === mode) {
    showLeftPanel.value = false
  } else {
    panelMode.value = mode
    showLeftPanel.value = true
  }
}

// 工具栏「AI」开关
function toggleLink() { togglePanel('link') }
// 工具栏「笔记」开关
function toggleNote() { togglePanel('note') }

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

// ===== 书签（同文件夹文章导航）=====
const showBookmarksPanel = ref(false)
const folderArticles = ref([])

function toggleBookmarks() {
  showBookmarksPanel.value = !showBookmarksPanel.value
}

async function loadFolderArticles() {
  if (!article.value?.folderId) return
  try {
    const res = await fetchArticles(article.value.folderId)
    if (res.status === 'ok') {
      // 按标题数字排序
      folderArticles.value = res.data.sort((a, b) => {
        const ma = a.title?.match(/^(\d+)/)
        const mb = b.title?.match(/^(\d+)/)
        const na = ma ? parseInt(ma[1]) : a.title || ''
        const nb = mb ? parseInt(mb[1]) : b.title || ''
        if (typeof na === 'number' && typeof nb === 'number') return na - nb
        return String(na).localeCompare(String(nb))
      })
    }
  } catch (err) {
    console.error('加载同文件夹文章失败:', err)
  }
}

function goToArticle(articleId) {
  showBookmarksPanel.value = false
  router.push(`/article/${articleId}`)
}

async function onRunScript() {
  try {
    const res = await runPythonScript('clipboard_to_txt')
    if (res.status === 'ok') {
      console.log('Python 脚本已启动:', res.message)
    }
  } catch (err) {
    console.error('启动 Python 脚本失败:', err)
  }
}

async function loadArticle(id) {
  showBookmarksPanel.value = false
  loadingArticle.value = true
  localStorage.setItem('lastPage', `article:${id}`)
  try {
    const res = await fetchArticle(id)
    if (res.status === 'ok') {
      store.articles[id] = res.data
    } else console.error('获取文章失败:', res)
  } catch (err) {
    console.error('获取文章异常:', err)
  }
  loadingArticle.value = false
  loadAnnotations()
  loadFolderArticles()
}

// 立即加载文章（setup 期间执行，不依赖任何生命周期）
const articleId = route.params.id
if (articleId) {
  loadArticle(articleId)
}

// 文章切换时重新加载
watch(() => route.params.id, async (newId) => {
  if (newId) await loadArticle(newId)
})

// ===== 滚动关闭卡片 =====
function onReaderScrollAway() { closeWordCard(); hideAnnotToolbar(); closeAnnotationCard() }

// ===== 快捷键 =====
function onAnnotShortcut(e) {
  // 焦点在侧面板（笔记等）内时不处理文章快捷键，避免与 NoteEditor 冲突
  if (e.target.closest('.side-panel')) return
  if (isEditing.value) {
    if (e.ctrlKey && (e.key === 'Enter' || e.key === 's' || e.key === 'S')) {
      e.preventDefault(); saveEdit()
    }
    return
  }
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
  const isL = !e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'KeyL' || e.key === 'l' || e.key === 'L')

  if (isR) { e.preventDefault(); drawMode.value ? closeCanvas() : (drawMode.value = true, drawActive.value = true, drawTool.value = 'pen'); return }
  // l 键：切换 AI 助手面板（与点击工具栏 AI 按钮等价）
  if (isL) { e.preventDefault(); togglePanel('link'); return }
  // b 键由 ArticleReader 内部处理并 emit('toggleNote')
  // 画布画笔/矩形模式下，空格键依次切换颜色
  if (drawActive.value && (drawTool.value === 'pen' || drawTool.value === 'rect') && (e.key === ' ' || e.code === 'Space')) {
    e.preventDefault()
    const idx = drawColors.indexOf(drawColor.value)
    drawColor.value = drawColors[(idx + 1) % drawColors.length]
    return
  }
  if (drawActive.value) return

  // r 键：切换笔记面板（无修饰键，避免与 Ctrl+R 画布快捷键冲突）
  const isNoteKey = !e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'KeyR' || e.key === 'r' || e.key === 'R')
  if (isNoteKey) { e.preventDefault(); togglePanel('note'); return }

  const isE = e.code === 'KeyE' || e.key === 'e' || e.key === 'E'
  const isW = e.code === 'KeyW' || e.key === 'w' || e.key === 'W'
  const isT = e.code === 'KeyT' || e.key === 't' || e.key === 'T'
  if (!isE && !isW && !isT) return

  e.preventDefault()
  if (isT) { wordLookupEnabled.value = !wordLookupEnabled.value; if (!wordLookupEnabled.value && showWordCard.value) closeWordCard(); return }

  const sel = window.getSelection()
  const hasActiveSel = sel && !sel.isCollapsed
  const offsets = getSelectionOffsets(paragraphs) || (hasActiveSel ? lastSelection.value : null)
  if (!offsets) return
  pendingSelection.value = offsets

  if (!wordLookupEnabled.value) {
    const word = offsets.text.toLowerCase().replace(/[^a-z\s-]/g, '').trim()
    if (word) { wordResult.value = {}; lookupWord(word).then((r) => { wordResult.value = r }).catch(() => {}) }
  }

  createAnnotation(isE ? 'highlight' : 'underline', isE ? '#FFEB3B' : '#e74c3c', true)
}

// ===== 生命周期 =====
onMounted(() => {
  document.addEventListener('keydown', onAnnotShortcut)
  document.addEventListener('mouseup', onMouseUpHandler)
  document.addEventListener('mousedown', onClearSelection)
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
        :panel-mode="panelMode"
        :font-size="fontSize"
        :article="article"
        :annotations="annotations"
        @back="goBack"
        @start-edit="startEdit"
        @cancel-edit="cancelEdit"
        @save-edit="saveEdit"
        @toggle-timer="toggleTimer"
        @toggle-link="toggleLink"
        @toggle-note="toggleNote"
        @change-font-size="changeFontSize"
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
          :scroll-top="savedScrollPos"
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
          @toggle-bookmarks="toggleBookmarks"
          @run-script="onRunScript"
        />
        <ArticleEditor
          v-else
          ref="editorRef"
          :title="editTitle"
          :content="editContent"
          :saving="saving"
          :scroll-top="savedScrollPos"
          :font-size="fontSize"
          @update:title="editTitle = $event"
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
    <!-- 书签左侧面板 -->
    <BookmarksPanel
      :visible="showBookmarksPanel"
      :articles="folderArticles"
      :current-article-id="route.params.id"
      @close="showBookmarksPanel = false"
      @select="goToArticle"
    />
  </div>
</template>

<style scoped>
.page { height: 100vh; overflow: hidden; background: #f8f5f0; display: flex; flex-direction: column; align-items: center; padding: 0; position: relative; }
.page-inner { flex: 1; min-height: 0; width: 100%; display: flex; flex-direction: column; align-items: center; transition: margin-right 0.4s ease; }
.page-inner.shifted { width: 54vw; align-self: flex-start; }
.page-inner.shifted :deep(.reader-toolbar), .page-inner.shifted :deep(.reader) { max-width: none; width: 100%; }
.page-fixed { height: 100vh; overflow: hidden; padding-bottom: 0; }
.not-found { color: #999; font-size: 16px; margin-top: 60px; }
</style>
