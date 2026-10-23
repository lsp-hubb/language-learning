<script setup>
import { useRoute, useRouter } from 'vue-router'
import { useFileExplorerStore } from '@/stores/fileExplorer'
import { ref, computed, inject, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { fetchArticle, fetchArticles, lookupWord, updateAnnotation, runPythonScript } from '@/api'
import { normalizeQuotes } from '@/utils/normalizeQuotes'
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
// 考研英语试题页（组件全部在 src/kaoyan/ 下，不影响现有 components）
import KaoyanArticlePage from '@/kaoyan/KaoyanArticlePage.vue'
import { isExamArticle, examTypeLabelOf, EXAM_TYPES } from '@/kaoyan/parseCloze'
import { TYPE_SPAN } from '@/kaoyan/useKaoyanAnnotations'

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
  // 输出侧清洗：展示前归一弯引号（库里已清洗，此处兜底）
  return normalizeQuotes(article.value.content)
    .split('\n')
    .filter((l) => l.trim())
})

// 已入库数据清洗：旧文章正文若仍含弯引号，清洗后静默回写（不影响编辑态、不弹提示）
watch(
  () => article.value?.content,
  (content) => {
    if (!article.value?.id || typeof content !== 'string') return
    const cleaned = normalizeQuotes(content)
    if (cleaned === content) return
    store.updateArticle(article.value.id, { content: cleaned })
  },
  { immediate: true },
)

const wordCount = computed(() => {
  if (!article.value?.content) return 0
  return article.value.content.split(/\s+/).filter((w) => w.length > 0).length
})

// ===== Composables =====
const {
  wordLookupEnabled,
  selectedWord,
  wordResult,
  wordCardPos,
  showManualCard,
  showWordCard,
  onTextSelection,
  closeWordCard,
  cleanupLookup,
} = useWordLookup()
const { timerRunning, timerDisplay, toggleTimer } = useTimer()
const {
  annotations,
  annotToolbarVisible,
  annotToolbarPos,
  annotCardVisible,
  annotCardPos,
  activeAnnotation,
  immediateEdit,
  isMouseOnCard,
  isAnnotEditing,
  pendingSelection,
  lastSelection,
  pendingNoteFill,
  annotCardScope,
  recentAnnotId,
  loadAnnotations,
  getSelectionOffsets,
  buildParagraphSegments,
  buildNoteFromLookup,
  createAnnotation,
  onMouseUp,
  hideAnnotToolbar,
  onAnnotMouseEnter,
  onAnnotMouseLeave,
  onAnnotCardMouseEnter,
  onAnnotCardMouseLeave,
  onAnnotClick,
  showAnnotCardForAnnotation,
  closeAnnotationCard,
  saveAnnotationNote,
  deleteAnnotation,
  onGlobalClick,
  lockCard,
  cleanupAnnotTimers,
} = useAnnotations(route, wordResult, closeWordCard, onTextSelection)
const { drawMode, drawActive, drawTool, drawColor, drawColors, closeCanvas } = useCanvas(
  closeWordCard,
  closeAnnotationCard,
  hideAnnotToolbar,
)

// ===== 批注工具栏开关 =====
const annotToolbarEnabled = ref(false)

// ===== 段落渲染片段 =====
// 用 watch（deep）显式驱动，而非纯 computed：ref 数组的 push 不会触发 ref 自身的 .value 槽，
// 只有 deep 才能捕获数组内部 mutation；否则叠加 / 删除批注后 computed 不重算，
// 需刷新页面正文才显示正常。
const paragraphSegments = ref(buildParagraphSegments(paragraphs))
watch(
  () => [annotations.value, recentAnnotId.value, paragraphs.value],
  () => {
    paragraphSegments.value = buildParagraphSegments(paragraphs)
  },
  { deep: true },
)

// ===== 批注桥：向常驻的笔记面板开放批注能力 =====
// 归一化仅用于「文本匹配」：忽略大小写与弯 / 直角引号差异。
// 只做等长替换（小写转换与 1:1 引号替换），否则偏移量会对不上。
function normKey(s) {
  // 双引号同样归一：正文里可能是 “ ”，笔记里已归一为 "，不归一则匹配不上
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
}
// 文本 → 正文位置：在正文各段中找第一处命中，换算成批注所需的段落索引 + 字符偏移
function findTextInParagraphs(text) {
  const key = normKey(text)
  if (!key) return null
  const list = paragraphs.value || []
  for (let i = 0; i < list.length; i++) {
    const idx = normKey(list[i]).indexOf(key)
    if (idx !== -1) {
      return {
        paragraphIndex: i,
        startOffset: idx,
        endOffset: idx + key.length,
        text: list[i].slice(idx, idx + key.length),
      }
    }
  }
  return null
}
// 笔记侧标注的统一落点：拿到「正文坐标」后直接复用正文的创建逻辑。
// 笔记英文行只负责给出坐标（该行在正文的落点 + 选区在行内的偏移），
// 标注本身一律发生在正文里 —— 笔记侧不参与匹配，只是正文的镜像。
async function annotateAt(pos, type, color, autoFill = false) {
  if (!pos) return null
  const para = paragraphs.value[pos.paragraphIndex]
  if (para == null) return null
  // 夹到段落范围内：行内偏移换算出来的坐标有可能越界
  const startOffset = Math.max(0, Math.min(pos.startOffset, para.length))
  const endOffset = Math.max(startOffset, Math.min(pos.endOffset, para.length))
  if (endOffset <= startOffset) return null
  const sel = {
    paragraphIndex: pos.paragraphIndex,
    startOffset,
    endOffset,
    text: para.slice(startOffset, endOffset),
  }
  // 与正文快捷键一致：自动填充前先按选中词查词，
  // 供 createAnnotation 内的 buildNoteFromLookup() 生成批注内容
  if (autoFill) {
    const word = String(sel.text || '')
      .toLowerCase()
      .replace(/[^a-z\s-]/g, '')
      .trim()
    if (word) {
      wordResult.value = {}
      lookupWord(word)
        .then((r) => {
          wordResult.value = r
        })
        .catch(() => {})
    }
  }
  const before = annotations.value.length
  pendingSelection.value = sel
  // showCard = false：不在这里弹卡片，交由笔记侧定位到刚标注的词旁
  await createAnnotation(type, color, autoFill, null, false)
  const ok = annotations.value.length > before
  return ok ? annotations.value[annotations.value.length - 1] : null
}
const annotationBridge = inject('annotationBridge', null)
if (annotationBridge) {
  annotationBridge.value = {
    annotations,
    recentAnnotId,
    paragraphs,
    findTextInParagraphs,
    // 首选入口：笔记侧已把选区换算成正文坐标，直接在正文标注（无文本匹配）
    annotateRange(pos, type, color, autoFill = false) {
      return annotateAt(pos, type, color, autoFill)
    },
    // 回退入口：只有英文行在正文中定位不到时才按文本搜（保留 oldId 以缩小范围）
    annotateText(text, type, color, autoFill = false, outerId = '') {
      let pos = null
      if (outerId) {
        const outer = annotations.value.find((a) => a.id === outerId)
        const para = outer ? paragraphs.value[outer.paragraphIndex] : null
        if (para != null) {
          const k = normKey(text)
          // 在高亮/下划线所在整段里定位，而不是在其小区间内（整句比批注区间长，
          // 在小区间内 indexOf 必为 -1，等于失效）。限定同一段落可与行内坐标同源
          const idx = normKey(para).indexOf(k)
          if (idx !== -1) {
            pos = {
              paragraphIndex: outer.paragraphIndex,
              startOffset: idx,
              endOffset: idx + k.length,
              text: para.slice(idx, idx + k.length),
            }
          }
        }
      }
      if (!pos) pos = findTextInParagraphs(text)
      return annotateAt(pos, type, color, autoFill)
    },
    // 供笔记侧在指定坐标弹出批注卡片（笔记面板里那个词的下方）
    showCardAt(annotation, x, y, autoFill = false) {
      // 锁定：否则鼠标停在英文行上会在 200ms 后把卡片切回主批注
      // （「在高亮中标下划线」时主批注仍是高亮，会看不到刚建的下划线的注释框）
      lockCard()
      activeAnnotation.value = annotation
      annotCardPos.value = { x, y }
      annotCardVisible.value = true
      // 与正文工具栏标注一致：autoFill=false（右键 / 工具栏）时立即进入编辑并聚焦输入框；
      // autoFill=true（e / w 快捷键已自动填充内容）时不强制聚焦
      immediateEdit.value = !autoFill
    },
    // 查词（与正文选中一致）与批注卡片交互
    onTextSelection: (x, y) => onTextSelection(x, y),
    onAnnotMouseEnter: (e, a) => onAnnotMouseEnter(e, a),
    onAnnotMouseLeave: () => onAnnotMouseLeave(),
    onAnnotClick: (e, a) => onAnnotClick(e, a),
  }
}
onUnmounted(() => {
  if (annotationBridge) annotationBridge.value = null
})

// ===== 考研英语分流：type 为 kaoyan-*（在试题页录入题型标签时写入）→ 走试题页 =====
const isKaoyan = computed(() => isExamArticle(article.value?.type))
// 试题页 ref 与联动状态：顶栏（ArticleToolbar）与试题页共用同一层，需同步编辑态与右侧栏让位
const kaoyanRef = ref(null)
const examEditing = ref(false)
const kaoyanSidebar = ref(false)
// 试题页回传的多题型状态：当前题型 + 各题型是否已录入
const examState = ref({ currentType: '', recorded: {}, content: '' })
const examCurrentType = computed(() => examState.value.currentType || EXAM_TYPES[0].value)
const examTypeLabel = computed(() => examTypeLabelOf(examCurrentType.value))
const examRecordedMap = computed(() => examState.value.recorded || {})
function changeExamType(t) {
  kaoyanRef.value?.setType(t)
  // 切换到未录入的题型：直接进入录入界面，无需再点「录入」按钮
  if (!examRecordedMap.value[t]) kaoyanRef.value?.openEditing()
}
function toggleExamEdit() {
  kaoyanRef.value?.toggleEditing()
}

// 把当前考研题型（节）同步给 App，供笔记面板按节拆分 / 切换时自动重载
const sharedExamType = inject('currentExamType', null)
watch(
  [isKaoyan, examCurrentType],
  () => {
    if (sharedExamType) sharedExamType.value = isKaoyan.value ? examCurrentType.value : ''
  },
  { immediate: true },
)

// ===== PDF 导出用的文章视图 =====
// 考研真题内多题型并存，正文存在 sections[type].content；顶层 content 只是最早录入时
// 留下的旧字段，直接导出会永远拿到同一个题型（kaoyan-cloze）。这里按当前节取正文。
const exportArticle = computed(() => {
  const a = article.value
  if (!a || !isKaoyan.value) return a
  // 优先用试题页回传的「当前节」正文（已含旧数据迁移）；
  // store 里的 sections 可能不是最新，而顶层 content 恒为最早录入的那一节，不能直接拿去导出
  const fromPage = examState.value.content
  // 导出同属输出侧：正文归一弯引号后再交给 PDF
  if (fromPage) return { ...a, content: normalizeQuotes(fromPage) }
  const sec = (a.sections || {})[examCurrentType.value]
  if (sec?.content) return { ...a, content: normalizeQuotes(sec.content) }
  // 当前节确实未录入：已分节的文章按空处理（导出时提示正文为空），旧数据沿用顶层 content
  const hasSections = a.sections && Object.keys(a.sections).length > 0
  return hasSections ? { ...a, content: '' } : { ...a, content: normalizeQuotes(a.content || '') }
})
// 批注按题型隔离：paragraphIndex = 题型序号 * TYPE_SPAN + 片段序号。
// 只取落在当前题型区间内的，避免其它题型的批注串到本次导出的正文上。
const exportAnnotations = computed(() => {
  if (!isKaoyan.value) return annotations.value
  const ti = EXAM_TYPES.findIndex((t) => t.value === examCurrentType.value)
  const lo = ti * TYPE_SPAN
  return annotations.value.filter(
    (a) =>
      typeof a.paragraphIndex === 'number' &&
      a.paragraphIndex >= lo &&
      a.paragraphIndex < lo + TYPE_SPAN,
  )
})

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
  // 选择题面板随 ArticleReader 一起卸载，让位状态需同步复位
  quizPanelOpen.value = false
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

// ===== 正文滚动位置记忆：刷新 / 重进后自动回到上次阅读位置 =====
const readerScrollKey = computed(() => `readerScroll:${route.params.id || ''}`)
function readReaderScroll() {
  try {
    return Number(localStorage.getItem(readerScrollKey.value) || 0) || 0
  } catch (e) {
    return 0
  }
}
function saveReaderScroll(top) {
  try {
    localStorage.setItem(readerScrollKey.value, String(Math.round(top || 0)))
  } catch (e) {
    /* 忽略 */
  }
}
// 恢复：既写入 prop（阅读器挂载时据此恢复），也直接落到 DOM（DOM 已渲染时立即生效）
function applyReaderScroll() {
  const top = readReaderScroll()
  if (!top) return
  savedScrollPos.value = top
  const el = document.querySelector('.reader .reader-content')
  if (el) el.scrollTop = top
}
// 滚动即记忆：scroll 事件不冒泡，故用捕获阶段监听并识别正文滚动容器
let _readerScrollTimer = null
function onReaderScrollPersist(e) {
  const t = e.target
  if (!t || !t.classList || !t.classList.contains('reader-content')) return
  clearTimeout(_readerScrollTimer)
  _readerScrollTimer = setTimeout(() => saveReaderScroll(t.scrollTop), 200)
}

async function saveEdit() {
  if (!article.value) return
  saving.value = true
  // 保存编辑器的滚动位置（在切回阅读器前读取 DOM）
  const editorContent = document.querySelector('.reader .reader-content')
  savedScrollPos.value = editorContent ? editorContent.scrollTop : 0
  const html = editorRef.value?.getContent?.() || ''
  const div = document.createElement('div')
  div.innerHTML = html
  // 输入侧清洗：落库前归一弯引号（弯单引号 → '，弯双引号 → "）
  const plainText = normalizeQuotes(
    Array.from(div.children)
      .map((el) => el.textContent)
      .filter(Boolean)
      .join('\n\n'),
  )
  const ok = await store.updateArticle(article.value.id, {
    title: editTitle.value,
    content: plainText || html,
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
  // 选择题面板（K 键）：开关自身，并收起侧栏（笔记 / AI），与 r / l 走同一套互斥 / 置顶 / 开关逻辑
  if (mode === 'quiz') {
    if (quizPanelOpen.value) quizPanelOpen.value = false
    else {
      quizPanelOpen.value = true
      if (showLeftPanel.value) showLeftPanel.value = false
    }
    return
  }
  if (showLeftPanel.value && panelMode.value === mode) {
    showLeftPanel.value = false
  } else {
    panelMode.value = mode
    showLeftPanel.value = true
    // 打开侧栏（笔记 / AI）时收起选择题面板，实现 r / l / k 三者互斥、被按键者置顶
    if (quizPanelOpen.value) quizPanelOpen.value = false
  }
}

// 工具栏「AI」开关
function toggleLink() {
  togglePanel('link')
}
// 工具栏「笔记」开关
function toggleNote() {
  togglePanel('note')
}
// 工具栏「查词」开关：与 Ctrl+Shift+Z 等价，切换手动查词卡片
function toggleManualWord() {
  showManualCard.value = !showManualCard.value
}

// ===== 选择题面板（普通文章）=====
// K 键由 ArticleReader 内部处理，这里只负责：内容区让位 + 与 AI / 笔记面板互斥
// （两者都贴右侧，同时展开会互相遮挡）
const quizPanelOpen = ref(false)
// K 键经 ArticleReader 上抛，统一交给 togglePanel('quiz') 处理（与 r / l 一致）
function onQuizToggle() {
  togglePanel('quiz')
}

async function goBack() {
  showLeftPanel.value = false
  if (article.value) await store.navigateTo(article.value.folderId)
  router.push('/')
}

// ===== 填写批注注释（查词结果返回后）=====
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
  // 正文渲染完成后回到上次阅读位置（刷新 / 重进）
  await nextTick()
  applyReaderScroll()
}

// 立即加载文章（setup 期间执行，不依赖任何生命周期）
const articleId = route.params.id
if (articleId) {
  loadArticle(articleId)
}

// 文章切换时重新加载
watch(
  () => route.params.id,
  async (newId) => {
    if (newId) await loadArticle(newId)
  },
)

// ===== 滚动关闭卡片 =====
function onReaderScrollAway() {
  closeWordCard()
  hideAnnotToolbar()
  closeAnnotationCard()
}

// ===== 快捷键 =====
function onAnnotShortcut(e) {
  // 分两段：① 控制类（开关查词卡片 / 画布 / 各侧栏）不依赖正文选区，且在侧栏（笔记 / AI 面板）内也要能用，
  //          故统一前置处理，不参与下方的侧栏 / 笔记选区让位；
  //        ② 正文标注类（e / w）依赖正文选区，保留让位逻辑，侧栏与笔记英文行内交给 NotePanel。
  if (isEditing.value) {
    if (e.ctrlKey && (e.key === 'Enter' || e.key === 's' || e.key === 'S')) {
      e.preventDefault()
      saveEdit()
    }
    return
  }
  if (e.key === 'Escape') {
    window.getSelection()?.removeAllRanges()
    closeWordCard()
    closeAnnotationCard()
    hideAnnotToolbar()
    return
  }

  if (e.ctrlKey && e.shiftKey && (e.key === 'Z' || e.key === 'z')) {
    e.preventDefault()
    showManualCard.value = !showManualCard.value
    return
  }
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  const isR = e.ctrlKey && (e.code === 'KeyR' || e.key === 'r' || e.key === 'R')
  const isL =
    !e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'KeyL' || e.key === 'l' || e.key === 'L')

  if (isR) {
    e.preventDefault()
    drawMode.value
      ? closeCanvas()
      : ((drawMode.value = true), (drawActive.value = true), (drawTool.value = 'pen'))
    return
  }
  // l 键：切换 AI 助手面板（与点击工具栏 AI 按钮等价）
  if (isL) {
    e.preventDefault()
    togglePanel('link')
    return
  }
  // b 键由 ArticleReader 内部处理并 emit('toggleNote')
  // 画布画笔/矩形模式下，空格键依次切换颜色
  if (
    drawActive.value &&
    (drawTool.value === 'pen' || drawTool.value === 'rect') &&
    (e.key === ' ' || e.code === 'Space')
  ) {
    e.preventDefault()
    const idx = drawColors.indexOf(drawColor.value)
    drawColor.value = drawColors[(idx + 1) % drawColors.length]
    return
  }
  if (drawActive.value) return

  // r 键：切换笔记面板（无修饰键，避免与 Ctrl+R 画布快捷键冲突）
  const isNoteKey =
    !e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'KeyR' || e.key === 'r' || e.key === 'R')
  if (isNoteKey) {
    e.preventDefault()
    togglePanel('note')
    return
  }

  // i 键：开关书签索引面板（与点击左侧书签按钮等价）。
  // 要求无修饰键：Ctrl+I 已由 vite-plugin-vue-devtools 用作组件检查器开关。
  const isBookmarkKey =
    !e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'KeyI' || e.key === 'i' || e.key === 'I')
  if (isBookmarkKey) {
    e.preventDefault()
    toggleBookmarks()
    return
  }

  // t 键：全局开关自动查词（纯开关，不依赖选区，故归入控制类并在此前置处理）
  const isT = e.code === 'KeyT' || e.key === 't' || e.key === 'T'
  if (isT) {
    e.preventDefault()
    wordLookupEnabled.value = !wordLookupEnabled.value
    if (!wordLookupEnabled.value && showWordCard.value) closeWordCard()
    return
  }

  // ===== ② 正文标注类（e / w）：依赖正文选区，侧栏 / 笔记选区内让位给 NotePanel =====
  const isE = e.code === 'KeyE' || e.key === 'e' || e.key === 'E'
  const isW = e.code === 'KeyW' || e.key === 'w' || e.key === 'W'
  if (!isE && !isW) return
  // 焦点在侧面板（笔记 / AI）内时不处理：那里的 e / w 由 NotePanel 处理
  if (e.target.closest && e.target.closest('.side-panel')) return
  // 选区落在笔记面板（含笔记英文行）内时同样让位。
  // 否则会沿用正文陈旧的 pendingSelection（创建后即被置空），
  // 表现为只能标注一次、且反复标到同一处内容上
  const _sel = window.getSelection && window.getSelection()
  if (_sel && _sel.anchorNode) {
    const _n = _sel.anchorNode
    const _el = _n.nodeType === 1 ? _n : _n.parentElement
    if (_el && _el.closest && _el.closest('.note-root')) return
  }

  e.preventDefault()
  const sel = window.getSelection()
  const hasActiveSel = sel && !sel.isCollapsed
  const offsets = getSelectionOffsets(paragraphs) || (hasActiveSel ? lastSelection.value : null)
  if (!offsets) return
  pendingSelection.value = offsets

  if (!wordLookupEnabled.value) {
    const word = offsets.text
      .toLowerCase()
      .replace(/[^a-z\s-]/g, '')
      .trim()
    if (word) {
      wordResult.value = {}
      lookupWord(word)
        .then((r) => {
          wordResult.value = r
        })
        .catch(() => {})
    }
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
  document.addEventListener('scroll', onReaderScrollPersist, true)
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
function onGlobalWordCardClick(e) {
  if (showWordCard.value && !e.target.closest('.word-card')) closeWordCard()
}

// 点击已选中的文本时清除选中（用 mousedown，此时选中来自上次鼠标事件，不是本次刚创建的）
// 仅处理左键：右键用于打开浮动批注栏，不能在此清除选区
function onClearSelection(e) {
  if (e.button !== 0) return
  const curSel = window.getSelection()
  if (curSel && !curSel.isCollapsed && curSel.containsNode(e.target, true)) {
    curSel.removeAllRanges()
    closeWordCard()
    hideAnnotToolbar()
  }
}

// 正文右键选中文本时打开浮动批注栏（启用并定位到光标处的现有工具栏逻辑）
function onReaderContextMenu(e) {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return // 无选区：保留系统右键菜单
  e.preventDefault() // 有选区：阻止系统菜单，改用自己的浮动栏
  annotToolbarEnabled.value = true // 打开浮动批注栏
  onMouseUp(e, paragraphs) // 复用现有定位/显示逻辑（同步 pendingSelection 与位置）
}

onUnmounted(() => {
  document.removeEventListener('keydown', onAnnotShortcut)
  document.removeEventListener('mouseup', onMouseUpHandler)
  document.removeEventListener('mousedown', onClearSelection)
  document.removeEventListener('click', onGlobalClick)
  document.removeEventListener('click', onGlobalWordCardClick)
  document.removeEventListener('scroll', onReaderScrollPersist, true)
  if (_readerScrollTimer) clearTimeout(_readerScrollTimer)
  cleanupLookup()
  cleanupAnnotTimers()
})
</script>

<template>
  <div class="page" :class="{ 'page-fixed': isEditing }">
    <div
      class="page-inner"
      :class="{
        shifted: showLeftPanel,
        'kaoyan-shift': isKaoyan && kaoyanSidebar,
        'quiz-shifted': quizPanelOpen,
      }"
    >
      <ArticleToolbar
        :is-editing="isEditing"
        :is-kaoyan="isKaoyan"
        :exam-type-label="examTypeLabel"
        :exam-editing="examEditing"
        :exam-types="EXAM_TYPES"
        :exam-current-type="examCurrentType"
        :exam-recorded-map="examRecordedMap"
        @change-exam-type="changeExamType"
        @toggle-exam-edit="toggleExamEdit"
        :saving="saving"
        :can-save="canSave"
        :timer-display="timerDisplay"
        :timer-running="timerRunning"
        :word-count="wordCount"
        :show-left-panel="showLeftPanel"
        :manual-card-visible="showManualCard"
        :panel-mode="panelMode"
        :font-size="fontSize"
        :article="exportArticle"
        :annotations="exportAnnotations"
        @back="goBack"
        @start-edit="startEdit"
        @cancel-edit="cancelEdit"
        @save-edit="saveEdit"
        @toggle-timer="toggleTimer"
        @toggle-link="toggleLink"
        @toggle-note="toggleNote"
        @toggle-manual-word="toggleManualWord"
        @change-font-size="changeFontSize"
        :annot-toolbar-enabled="annotToolbarEnabled"
        @highlight="createAnnotation('highlight', '#FFEB3B')"
        @underline="createAnnotation('underline', '#e74c3c')"
      />
      <template v-if="article">
        <KaoyanArticlePage
          v-if="!isEditing && isKaoyan"
          ref="kaoyanRef"
          :article-id="route.params.id"
          :panel-open="showLeftPanel"
          :font-size="fontSize"
          @back="goBack"
          @editing-change="examEditing = $event"
          @sidebar-change="kaoyanSidebar = $event"
          @exam-state="examState = $event"
        />
        <ArticleReader
          v-else-if="!isEditing"
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
          :quiz-open="quizPanelOpen"
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
          @quiz-toggle="onQuizToggle"
          @toggle-bookmarks="toggleBookmarks"
          @run-script="onRunScript"
          @contextmenu="onReaderContextMenu"
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
    <WordCard
      :word="selectedWord"
      :result="wordResult"
      :visible="showWordCard"
      :position="wordCardPos"
      @close="closeWordCard"
    />
    <ManualWordCard
      :visible="showManualCard"
      :auto-query-text="manualQueryText"
      @close="showManualCard = false"
      @auto-query-consumed="manualQueryText = ''"
    />
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
.page {
  height: 100vh;
  overflow: hidden;
  background: #f8f5f0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
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
/* r/l（AI / 笔记面板）与 k（选择题面板）展开时，正文均靠左并填满变窄区域（移动样式一致） */
.page-inner.shifted,
.page-inner.quiz-shifted {
  align-self: flex-start;
}
.page-inner.shifted {
  width: 54vw;
}
.page-inner.quiz-shifted {
  width: calc(100% - 46vw);
}
.page-inner.shifted :deep(.reader-toolbar),
.page-inner.shifted :deep(.reader),
.page-inner.quiz-shifted :deep(.reader-toolbar),
.page-inner.quiz-shifted :deep(.reader) {
  max-width: none;
  width: 100%;
}
/* 考研正文需自适应，否则固定 960px 会溢出导致排版混乱 */
.page-inner.shifted :deep(.kaoyan-inner),
.page-inner.quiz-shifted :deep(.kaoyan-inner) {
  width: 100%;
  max-width: none;
  flex: 1 1 auto;
}
.page-fixed {
  height: 100vh;
  overflow: hidden;
  padding-bottom: 0;
}
/* 考研页有右侧题目浮动栏时与内容区统一让位，保证顶栏与正文同宽同位置（避免错位） */
.page-inner.kaoyan-shift {
  padding-right: 534px;
}
.not-found {
  color: #999;
  font-size: 16px;
  margin-top: 60px;
}
</style>
