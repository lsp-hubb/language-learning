<script setup>
import DrawCanvas from './DrawCanvas.vue'
import AudioStatusPanel from './AudioStatusPanel.vue'

import { ref, inject, watch, onMounted, onUnmounted, nextTick, computed } from 'vue'
import {
  getExpandedSelectionText,
  buildDisplayParagraphs,
  buildWordRanges,
  applyReadingHighlight,
  scrollToReaderHit,
} from '@/utils/selectionText'
import {
  useReadAloud,
  abortReadTts,
  READ_VOICES,
  currentVoice,
  setVoice,
} from '@/composables/useReadAloud'
import { notifySuccess, notifyError, notifyWarning, notifyInfo } from '@/utils/feedback'

const props = defineProps({
  article: { type: Object, required: true },
  paragraphSegments: { type: Array, required: true },
  drawMode: Boolean,
  drawActive: Boolean,
  drawTool: String,
  drawColor: String,
  articleId: String,
  // 正文渲染完成计数：文章数据/批注/滚动恢复落地后由 ArticlePage 递增
  contentReadyTick: { type: Number, default: 0 },
  // 编辑保存标记：=1 表示正文段落文本已变，需重新预热（只下载新文本 / 失败段）
  audioForceTick: { type: Number, default: 0 },
  // 批注章节横版（仅影响 PDF 中「批注」一节），开关在本组件左侧工具条
  annotationsLandscape: { type: Boolean, default: true },
  panelOpen: Boolean,
  fontSize: { type: Number, default: 16 },
  scrollTop: { type: Number, default: 0 },
})

const emit = defineEmits([
  'annotMouseEnter',
  'annotMouseLeave',
  'annotClick',
  'scrollAway',
  'toggleTool',
  'toggleDraw',
  'closeCanvas',
  'newCanvas',
  'update:tool',
  'toggleBookmarks',
  'toggleAnnotationsLandscape',
])

const hoveredPara = ref(-1)
const drawCanvasRef = ref(null)
// 选中文本自动添加线（右键开/关），单源状态，下传 DrawCanvas 并在左下控件显示
const autoAddLines = ref(false) // 默认关闭：进入文章不自动加线，需右键或点状态按钮开启

// 左下状态按钮切换：提示方式与画布右键一致（开启绿 / 关闭红，3 秒消失，先关上一条避免堆叠）
let autoAddMsg = null
function toggleAutoAddLines() {
  autoAddLines.value = !autoAddLines.value
  if (autoAddMsg) autoAddMsg.close()
  if (autoAddLines.value) autoAddMsg = notifySuccess('已开启：选中文本自动添加线', { duration: 3000 })
  else autoAddMsg = notifyError('已关闭：选中文本不再添加线', { duration: 3000 })
}

// 朗读音色切换：在「音频准备情况」面板点选 Andrew / Emma / Ryan（原工具条循环按钮已移除）。
// 切换时停止当前朗读（避免旧音色音频继续播），新音色缓存已随文章预热下载好，可直接点播。
let voiceMsg = null
function selectVoice(id) {
  if (!READ_VOICES.some((v) => v.id === id) || id === currentVoice.value) return
  const next = READ_VOICES.find((v) => v.id === id)
  setVoice(id)
  stopReading()
  voiceMsg?.close()
  voiceMsg = notifySuccess(`朗读音色已切换为 ${next.name}（${next.desc}）`, { duration: 2800 })
}

// 逐句默写总开关：默认关闭，必须开启后左键点当前高亮卡片英文行 / Enter 才能进默写。
// 状态放 sentenceState（App provide），NotePanel 的 startDictation 统一守卫。
let dictationMsg = null
function toggleDictation() {
  sentenceState.dictationEnabled = !sentenceState.dictationEnabled
  dictationMsg?.close()
  dictationMsg = sentenceState.dictationEnabled
    ? notifySuccess('已开启：默写可用（左键点当前高亮英文行 / Enter 进入）', { duration: 3000 })
    : notifyError('已关闭：默写不可用', { duration: 3000 })
}

// 音频准备情况查看器：左侧工具条按钮开 / 关面板（按钮高亮表示面板处于打开态）
const audioStatusVisible = ref(false)
const audioStatusPanelRef = ref(null)
function toggleAudioStatus() {
  audioStatusVisible.value = !audioStatusVisible.value
}
function closeAudioStatus() {
  audioStatusVisible.value = false
}
// 面板里点「立即准备」：触发全文预热。刷新由 warmupAll 完成分支统一负责，避免重复请求。
async function onAudioRewarm() {
  await warmupAll()
}

function onParaEnter(i) {
  hoveredPara.value = i
}
function onParaLeave() {
  hoveredPara.value = -1
}

// ===== 笔记面板搜索联动：正文选中文本 → 通知笔记面板查找高亮 =====
const noteSearchText = inject('noteSearchText', null)
const noteSearchNonce = inject('noteSearchNonce', null)
const showSidePanel = inject('showSidePanel', null)
const panelMode = inject('panelMode', null)
const activeSearchMode = inject('activeSearchMode', null)

// ===== 反向联动：笔记面板中选中文字 → 在正文高亮命中词并跳转 =====
const readerSearchText = inject('readerSearchText', null)
const readerSearchNonce = inject('readerSearchNonce', null)
// 当前定位到的命中下标（App 用 provide 共享，NotePanel 回车翻页写入）
const readerHit = inject('readerHit', { index: -1 })

// ===== 逐句朗读数据源 =====
// 批注桥由 ArticlePage 注册（含 findTextInParagraphs：笔记英文行 → 正文落点）；
// noteSentences 由 NotePanel 解析笔记后写入（{text, noteIndex}[]，noteIndex 为原笔记卡片下标）。
// setup 中 inject 的 ref 保持 .value 形态，不会像 Options API 那样自动解包。
const annotationBridge = inject('annotationBridge', null)
const noteSentences = inject('noteSentences', null)
// 逐句朗读共享状态：noteIndex 给 NotePanel 定位卡片；dictating 表示默写输入框正聚焦，
// 此时每句重播的开播回调不能清原生选区（清选区会连带抢走输入框焦点）。
// dictationEnabled 为默写功能总开关（左侧工具栏按钮切换），关闭时左键 / Enter 不进默写。
const sentenceState = inject('sentenceState', { noteIndex: -1, dictating: false, dictationEnabled: false })

// 数据驱动正文高亮：按关键词把每个段落片段切成 parts（命中 part 带全局 hitIdx），
// 由模板渲染 <mark class="reader-hit">；批注 .annotated 的 class/:style 始终由 Vue 托管，
// 不再有 JS 改写 DOM 造成的批注丢失 / vnode 失配。
const displayParagraphs = computed(() =>
  buildDisplayParagraphs(props.paragraphSegments, readerSearchText ? readerSearchText.value : ''),
)

// ===== 逐段朗读（Edge TTS / Andrew，服务端合成缓存 + 音频播放 + 词级高亮）=====
// 旧实现用浏览器 Web Speech API，音频无法缓存、每次播放/跳转都在线合成，慢；且 charIndex
// 词边界不准（数字与相邻词的分组反复出问题）。改为服务端 edge-tts 合成整段 mp3 并缓存，
// 前端一次下载、本地 <audio> 播放，用 WordBoundary 时间戳（Edge 原生把 "since 2015"
// 当一个词单元）驱动高亮 —— 音色仍是 Andrew，且高亮与音频完全同步。
// 高亮仍走 applyReadingHighlight 数据驱动投影到 renderParts，不改 DOM。
const readingPara = ref(-1) // 当前朗读段下标，-1 为无
const readingRange = ref(null) // 当前词在段全文的 [start, end)
const readingAll = ref(false) // 全文播放中（标题左侧按钮切换）
const readStart = ref(null) // 正文选区起点 { para, offset(段内字符偏移) }，点朗读按钮时消费
const loopPara = ref(-1) // 循环播放当前段的下标（-1 为无）
let loopSelRange = null // 点循环按钮时已有的选区 {para,start,end}（整段全文坐标）；null=循环整段
let draggingSelection = false // 正在正文拖拽选词：冻结朗读高亮，避免 DOM 重排打断选区
let readEpoch = 0 // 朗读代次：切段 / 停止 / 重读时自增，使进行中的 async 合成失效
const readAloud = useReadAloud()
const renderParagraphs = computed(() =>
  applyReadingHighlight(displayParagraphs.value, readingPara.value, readingRange.value),
)

// ===== 逐句朗读（笔记英文行 → 正文句子）=====
// 把 NotePanel 共享的笔记英文行用批注桥的 findTextInParagraphs 定位到正文：
// { text, noteIdx, para, start, end }。定位不到正文的（笔记改写过 / 正文改过）保留 text 但
// para=-1，排到末尾，左右切句时不参与（无法朗读）。
const sentenceList = computed(() => {
  const bridge = annotationBridge && annotationBridge.value
  const find = bridge && bridge.findTextInParagraphs
  const texts = (noteSentences && noteSentences.value) || []
  const list = []
  texts.forEach((entry, i) => {
    // noteSentences 现为 {text, noteIndex}[]，noteIndex 保留原笔记卡片下标；
    // 兼容旧 string[] 形态时退回数组下标。
    const text = typeof entry === 'string' ? entry : entry && entry.text
    const noteIdx = typeof entry === 'string' ? i : entry && entry.noteIndex
    if (!text) return
    const pos = find ? find(text) : null
    list.push({
      text,
      noteIdx,
      para: pos ? pos.paragraphIndex : -1,
      start: pos ? pos.startOffset : 0,
      end: pos ? pos.endOffset : 0,
    })
  })
  // 按正文出现顺序（段 → 段内偏移）排序；定位不到的按笔记原始序号排在末尾
  list.sort((a, b) => {
    if (a.para < 0 || b.para < 0) {
      if (a.para < 0 && b.para < 0) return a.noteIdx - b.noteIdx
      return a.para < 0 ? 1 : -1
    }
    return a.para - b.para || a.start - b.start
  })
  return list
})
// 当前逐句模式下的句子下标（-1 为未在逐句朗读）。复用 readingPara/readingRange 做高亮，
// 句子区间用 loopSelRange 承载，供 speakParagraph 的子段播放路径使用。
const sentenceIdx = ref(-1)

function clearReading() {
  readingPara.value = -1
  readingRange.value = null
  readingAll.value = false
}

function stopReading() {
  readEpoch++ // 使进行中的 async 合成失效，完成后不会覆盖停止后的状态
  readAloud.stop()
  loopPara.value = -1
  loopSelRange = null
  sentenceIdx.value = -1
  sentenceState.noteIndex = -1 // 停止朗读：撤销笔记卡片的高亮定位
  clearReading()
}

// 仅当朗读词不在滚动容器可视区内才滚动（瞬时，不用 smooth 连续动画导致页面持续漂移）。
// 视口内则完全不动，用户可稳定地拖拽选区。
function scrollReadingWord() {
  nextTick(() => {
    const el = document.querySelector('.reader .reading-current')
    if (!el || !el.scrollIntoView) return
    const scroller = document.querySelector('.reader .reader-content')
    if (!scroller) return
    const er = el.getBoundingClientRect()
    const sr = scroller.getBoundingClientRect()
    const margin = 24
    if (er.top >= sr.top + margin && er.bottom <= sr.bottom - margin) return
    el.scrollIntoView({ block: 'center', behavior: 'auto' })
  })
}

// 选区是否落在正文内：朗读期间用户选词时冻结高亮，避免 <mark> 重建打断选区
function selectionInReader() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false
  const node = (n) => (n && n.nodeType === 3 ? n.parentElement : n)
  const a = node(sel.anchorNode)
  return !!(a && a.closest && a.closest('.reader-body'))
}

// 记录选区起点（段索引 + 段内词首偏移），供点朗读按钮时从选中处开始。
// 用 Range 从段首量到选区起点得字符偏移，再对齐到 \S+ 词区间的词首（避免从半个词开始读）。
function captureReadStart() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount || !selectionInReader()) {
    readStart.value = null
    return
  }
  const range = sel.getRangeAt(0)
  const node = (n) => (n && n.nodeType === 3 ? n.parentElement : n)
  const paraEl = node(range.startContainer)?.closest?.('.para-block')
  const blocks = document.querySelectorAll('.reader .reader-body .para-block')
  const i = paraEl ? Array.prototype.indexOf.call(blocks, paraEl) : -1
  if (i < 0) {
    readStart.value = null
    return
  }
  // 以 <p> 为基准量偏移（.para-block 还含朗读按钮，无文本但避免歧义）
  const pEl = paraEl.querySelector('.article-para') || paraEl
  const pre = document.createRange()
  pre.selectNodeContents(pEl)
  try {
    pre.setEnd(range.startContainer, range.startOffset)
  } catch {
    readStart.value = null
    return
  }
  const charOffset = pre.toString().length
  // 对齐到词首，避免从半个词开始朗读（Edge TTS 按切片文本合成）
  const segs = props.paragraphSegments[i] || []
  const ranges = buildWordRanges(segs.map((s) => s.text || '').join(''))
  const word = ranges.find(([s, e]) => s <= charOffset && charOffset < e) || ranges.find(([s]) => s >= charOffset)
  readStart.value = { para: i, offset: word ? word[0] : charOffset }
}

// 循环播放时读取当前选区（必须仍在正被循环的段落里），对齐到词首 / 词尾，
// 返回整段全文坐标 {para,start,end}；无有效选区返回 null。
function captureLoopSelection(i) {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount || !selectionInReader()) return null
  const range = sel.getRangeAt(0)
  const node = (n) => (n && n.nodeType === 3 ? n.parentElement : n)
  const paraEl = node(range.startContainer)?.closest?.('.para-block')
  const blocks = document.querySelectorAll('.reader .reader-body .para-block')
  if (!paraEl || Array.prototype.indexOf.call(blocks, paraEl) !== i) return null
  const pEl = paraEl.querySelector('.article-para') || paraEl
  const offsetAt = (container, offset) => {
    const r = document.createRange()
    r.selectNodeContents(pEl)
    try { r.setEnd(container, offset) } catch { return -1 }
    return r.toString().length
  }
  let start = offsetAt(range.startContainer, range.startOffset)
  let end = offsetAt(range.endContainer, range.endOffset)
  if (start < 0 || end < 0 || end <= start) return null
  const segs = props.paragraphSegments[i] || []
  const fullText = segs.map((s) => s.text || '').join('')
  // 选区可能跨出本段（结束容器在后一段），夹到本段全文范围内再对齐词边界
  start = Math.max(0, Math.min(start, fullText.length))
  end = Math.max(0, Math.min(end, fullText.length))
  if (end <= start) return null
  const words = buildWordRanges(fullText)
  const sw = words.find(([s, e]) => s <= start && start < e) || words.find(([s]) => s >= start)
  // 词尾对齐取「起点在 end 之前」的最后一个词：选区尾部常带空格 / 标点，
  // 若改用「起点 >= end 的第一个词」会把紧随其后的那个词也算进选中范围，多念一词。
  const ew = [...words].reverse().find(([s]) => s < end) || words[0]
  start = sw ? sw[0] : start
  end = ew ? ew[1] : end
  if (end <= start) end = Math.min(start + 1, fullText.length)
  return { para: i, start, end }
}

// 计算第 i 段送合成的朗读参数。start = 段内起始偏移（选区重读时 > 0）。
// 返回 null 表示空段。预取与 prepare 共用，保证两者 text 完全一致、能命中同一缓存 key。
function paraSpeechInfo(i, start = 0) {
  const segments = props.paragraphSegments[i]
  if (!segments || !segments.length) return null
  const fullText = segments.map((s) => s.text || '').join('')
  if (!fullText.trim()) return null
  const text = start > 0 ? fullText.slice(start) : fullText
  return { text, fullText, startOffset: start }
}

// 查看器查询用的段落文本：与预热 / 预取完全相同的送合成文本，保证缓存 key 一致。
const audioStatusTexts = computed(() => {
  const texts = []
  for (let i = 0; i < props.paragraphSegments.length; i++) {
    const info = paraSpeechInfo(i, 0)
    if (info && info.text.trim()) texts.push(info.text)
  }
  return texts
})
// 切文章 / 正文变化后面板若开着，自动重新查询（否则会显示上一篇文章的统计）
watch(audioStatusTexts, () => {
  if (audioStatusVisible.value) nextTick(() => audioStatusPanelRef.value?.refresh())
})

// 全文朗读的并发预取窗口：播放当前段时，提前把后面若干段一次并发合成进缓存，
// 切到下一段时 prepare 直接命中、消除段落间的在线合成等待。（窗口过大反而拖慢首段，
// 取 4 段：覆盖一次连续朗读的提前量，又不至于首次请求太重。）
const PREFETCH_WINDOW = 4
function prefetchAhead(currentIndex) {
  const items = []
  const total = props.paragraphSegments.length
  for (let i = currentIndex + 1; i < total && items.length < PREFETCH_WINDOW; i++) {
    const info = paraSpeechInfo(i, 0)
    if (info && info.text.trim()) items.push(info)
  }
  if (items.length) readAloud.prefetch(items, currentVoice.value)
}

// 文章就绪后后台预热全文音频。edge-tts 单段有约 7s 的远程建连固定开销，无法在点朗读的
// 瞬间消除；利用用户打开文章到点朗读之间的浏览时间提前合成，点播 / 切段即命中缓存秒开。
// 每批 ≤20 段（对齐后端 /api/tts/read/batch 上限）串行推进，不阻塞任何交互；
// 缓存 key 含文本，所以预热天然只下载「未缓存 / 失败」的段：成功段直接命中缓存，不重复下载。
// 切文章 / 重新就绪时 warmupToken 自增，中断旧文章的预热循环。
// 预热提示只作短暂告知：延迟 600ms 弹一条自动关闭的消息（全命中缓存时转瞬完成、不闪提示），
// 逐段进度 / 缓存来源等详情一律到左侧「音频准备情况」面板查看，消息不再常驻。
let warmupToken = 0
let warmupStartTimer = 0

function cancelWarmupStartMsg() {
  if (warmupStartTimer) { clearTimeout(warmupStartTimer); warmupStartTimer = 0 }
}
function showWarmupStartMsg() {
  warmupStartTimer = 0
  notifyInfo('正在后台准备朗读音频，进度可在左侧「音频准备情况」面板查看', { duration: 3000 })
}

async function warmupAll() {
  const token = ++warmupToken
  cancelWarmupStartMsg() // 先清掉上一次可能还在等待的「正在准备」提示
  const total = props.paragraphSegments.length
  const BATCH = 20
  // 先收集所有段文本（每个音色复用），避免重复遍历
  const allItems = []
  for (let i = 0; i < total; i++) {
    const info = paraSpeechInfo(i, 0)
    if (info && info.text.trim()) allItems.push(info)
  }
  const planned = allItems.length
  if (!planned) return

  // 统计三类结果（跨所有音色汇总）：cache 来自后端（MISS=本次下载；HIT/DISK/DEDUP=已有缓存命中）
  let downloaded = 0
  let cached = 0
  let failed = 0

  // 开始提示：延迟 600ms 弹一条自动关闭的短消息（详情去面板看，不常驻进度）。
  warmupStartTimer = setTimeout(showWarmupStartMsg, 600)

  // 音色串行预热：默认音色（Andrew）优先，完成后再 Emma → Ryan。
  // 必须串行而非并发：避免一次性对 Edge 服务发起三倍请求拖慢默认音色；默认音色先就绪才能点播秒开。
  for (const voice of READ_VOICES) {
    if (token !== warmupToken) { cancelWarmupStartMsg(); return }
    for (let start = 0; start < planned; start += BATCH) {
      if (token !== warmupToken) { cancelWarmupStartMsg(); return }
      const items = allItems.slice(start, start + BATCH)
      let results = []
      try {
        results = (await readAloud.prefetch(items, voice.id)) || []
      } catch {
        failed += items.length
      }
      if (token !== warmupToken) { cancelWarmupStartMsg(); return }
      results.forEach((r) => {
        if (!r) failed++ // 失败段：下次预热仍会重试（缓存未写入）
        else if (r.cache === 'MISS') downloaded++ // 本次真正合成下载的段
        else cached++ // HIT / DISK / DEDUP：已成功的段直接复用，不再重复下载
      })
    }
  }
  cancelWarmupStartMsg()
  if (token !== warmupToken) return

  // 只弹一条自动关闭的汇总（不再常驻）；详细统计 / 逐段来源到「音频准备情况」面板查看。
  const parts = []
  if (downloaded) parts.push(`新下载 ${downloaded} 段`)
  if (cached) parts.push(`${downloaded || failed ? '已缓存' : '全部命中缓存'} ${cached} 段`)
  if (failed) parts.push(`失败 ${failed} 段`)
  const detail = parts.length ? `（${parts.join('，')}）` : ''
  if (failed) {
    notifyWarning(`朗读音频准备完成${detail} · 详情见面板，失败段下次打开会重试`, { duration: 3200 })
  } else {
    notifySuccess(`朗读音频已就绪 · 3 种音色${detail} · 详情见面板`, { duration: 2800 })
  }
  // 后台预热是进入文章即启动的，用户此时打开面板看到的是那一刻的静态快照；
  // 预热完成后若面板仍开着，自动刷新一次，让统计跟上真实缓存状态。
  if (audioStatusVisible.value) nextTick(() => audioStatusPanelRef.value?.refresh())
}

// 朗读第 i 段的底层实现。start = 段内起始偏移；onDone = 本段读完的回调（全文模式串下一段）。
// Edge TTS：先 prepare（服务端合成 + 缓存，首次在线、之后本地），再本地 <audio> 播放；
// onWord 用 Edge 词单元已定位好的段全文 [start,end) 直接写 readingRange，高亮与音频同步。
async function speakParagraph(i, start, onDone, opts = {}) {
  const { end = 0, range = null } = opts
  const segs = props.paragraphSegments[i]
  if (!segs || !segs.length) {
    if (onDone) onDone()
    return
  }
  const fullText = segs.map((s) => s.text || '').join('')
  if (!fullText.trim()) {
    if (onDone) onDone()
    return
  }
  // 整段用【同一个 key = fullText】合成/取缓存：与预热/预取完全一致，跳转选中位置秒命中，
  // 不再用 fullText.slice(start)（那会生成新 key、必然 miss、在线等 ~6s）。
  // start 只决定播放起点：定位到覆盖该偏移的词，取其 timeMs 交给 play 做时间戳 seek。
  let startMs = 0
  let endMs = 0
  const epoch = ++readEpoch
  readAloud.stop()
  readingPara.value = i

  let payload
  try {
    payload = await readAloud.prepare(fullText, fullText, 0, currentVoice.value)
  } catch (err) {
    if (epoch !== readEpoch) return // 已被新请求取代
    notifyError('朗读音频生成失败：' + (err?.message || '未知错误'))
    if (onDone) onDone(err)
    else clearReading()
    return
  }
  if (epoch !== readEpoch) return // 合成期间用户点了别处 / 停止，丢弃这次结果

  if (start > 0) {
    const words = payload.timedWords || []
    // 找第一个覆盖 start 的词（start 已由 captureReadStart 对齐到词首）；
    // 找不到（如选区在非词字符）则取起点 >= start 的最近词。
    const w = words.find((x) => x.start <= start && start < x.end) || words.find((x) => x.start >= start)
    if (w) startMs = w.timeMs
  }
  if (end > start) {
    const words = payload.timedWords || []
    // 选区子段：播到选区内最后一个词结束即回调（复用整段音频，不另合成）
    const w = [...words].reverse().find((x) => x.start < end)
    if (w) endMs = w.timeMs + (w.durMs || 0)
  }

  readAloud.play(payload, {
    startMs,
    endMs,
    // 真正开播后才清原生选区：合成/加载等待期间保留选中背景。
    // 默写中不清：每句循环重播都会走到这里，removeAllRanges 会连带抢走默写输入框的焦点，
    // 导致逐句朗读时无法持续打字（中途打字正常、一到重播就丢焦点）。
    onStart: () => {
      if (!sentenceState.dictating) window.getSelection()?.removeAllRanges()
    },
    onWord: (w) => {
      // 选中子段只高亮选区内的词
      if (range && (w.start < range.start || w.start >= range.end)) return
      // 正文有选区 / 正在拖选时冻结高亮：<mark> 重建或滚动都会打断选区，导致选不中文字。
      // 循环播放也一样——无选区时正常跟随高亮；一旦用户开始选词就让位给选区。
      if (draggingSelection || selectionInReader()) return
      readingRange.value = [w.start, w.end]
      scrollReadingWord()
    },
    onEnd: (err) => {
      if (epoch !== readEpoch) return
      if (err) {
        notifyError('朗读播放失败：' + (err?.message || '未知错误'))
      }
      if (onDone) onDone(err)
      else clearReading()
    },
  })
}

// 全文串行朗读：从第 i 段（段内 start 偏移）起，每段读完自动读下一段，读完末尾收尾。
function readFullFrom(i, start = 0) {
  const total = props.paragraphSegments.length
  if (i >= total) {
    clearReading()
    return
  }
  // 空段直接跳到下一段
  if (!paraSpeechInfo(i, start)) {
    readFullFrom(i + 1)
    return
  }
  // 播放当前段的同时，并发预取后续窗口内的段（提前量，切段时零等待）
  prefetchAhead(i)
  speakParagraph(i, start, () => readFullFrom(i + 1))
}

// 单段朗读按钮：再点当前段 = 停止；选区起点仅在同段时生效、消费后清空。
function onReadParagraph(i, fromSelection = false) {
  // 逐句模式下点「朗读本段」= 退出逐句；点的是当前句所在段也视为停止
  if (sentenceIdx.value >= 0) {
    stopReading()
    return
  }
  // 循环模式下点本段 = 退出循环；点其它段 = 先退出循环再朗读目标段
  if (loopPara.value === i) {
    stopReading()
    return
  }
  if (loopPara.value >= 0) stopReading()
  if (!fromSelection && readingPara.value === i && !readingAll.value) {
    stopReading()
    return
  }
  const start = readStart.value && readStart.value.para === i ? readStart.value.offset : 0
  readStart.value = null
  // 全文播放中选词重读：保持全文模式，从选处继续往后读；否则退出全文、只读本段。
  if (fromSelection && readingAll.value) {
    readFullFrom(i, start)
    return
  }
  readingAll.value = false
  if (!fromSelection) clearReading()
  speakParagraph(i, start, null)
}

// 单段循环播放（带词级高亮）：点按钮时若正文已有选区，则循环该选中的子段；否则循环整段。
// 选区在启动时就清掉，避免高亮重建 / 滚动抢占选区。
function playLoop(i) {
  if (loopPara.value !== i) return
  const sel = loopSelRange
  const onDone = (err) => {
    if (err || loopPara.value !== i) {
      stopReading()
      return
    }
    playLoop(i)
  }
  if (sel) speakParagraph(i, sel.start, onDone, { end: sel.end, range: sel })
  else speakParagraph(i, 0, onDone)
}

function onLoopParagraph(i) {
  // 先记录选区：点按钮本身会让浏览器收起选区，stopReading 也会清状态
  const sel = captureLoopSelection(i)
  // 同一段且没有新选区 = 再点一次停止；有选区则（重新）启动为「循环选中的子段」
  if (loopPara.value === i && !sel) {
    stopReading()
    return
  }
  stopReading()
  if (!paraSpeechInfo(i, 0)) return
  loopPara.value = i
  loopSelRange = sel
  readingAll.value = false
  readStart.value = null
  // 选区已转成子段范围：立即清掉原生选区，高亮正常更新且不再抢选中
  window.getSelection()?.removeAllRanges()
  playLoop(i)
}

// ===== 逐句循环朗读 =====
// 循环播放当前句：复用 speakParagraph 的子区间播放（整段音频不重复合成），
// 读完自动重播同一句，直到用户按 ← / → 切句或点按钮 / 其它朗读操作停止。
function playSentence(idx) {
  const s = sentenceList.value[idx]
  if (!s || s.para < 0 || s.end <= s.start) return
  // 首次启动 / ← → 切句才通知笔记面板定位到对应卡片；同一句的循环重播不重复滚动，
  // 避免打断用户在笔记面板里的手动浏览。
  if (sentenceIdx.value !== idx) sentenceState.noteIndex = s.noteIdx
  sentenceIdx.value = idx
  // 注意：speakParagraph 每次调用都会 ++readEpoch，故外层不能用自己的 epoch 比对——
  // 它的 onEnd 已用内部 epoch 挡掉被打断 / 切句后的过期回调，能走到这里就是本句正常读完。
  // 只需再确认仍是当前句（极端竞态下旧句回调不会重播），然后重播同一句形成循环。
  const onDone = (err) => {
    if (sentenceIdx.value !== idx) return
    if (err) {
      stopReading() // 错误提示已由 speakParagraph 发出，避免残留高亮
      return
    }
    playSentence(idx)
  }
  speakParagraph(s.para, s.start, onDone, { end: s.end, range: { para: s.para, start: s.start, end: s.end } })
}

// 「逐句朗读本段」按钮：定位本段第一句（按正文顺序）开始循环；
// 已在逐句模式且当前句就在本段 = 停止；否则从本段第一句重新开始。
function onSentenceLoop(i) {
  const first = sentenceList.value.findIndex((s) => s.para === i)
  if (sentenceIdx.value >= 0 && sentenceList.value[sentenceIdx.value]?.para === i) {
    stopReading()
    return
  }
  if (first < 0) {
    notifyInfo('本段没有可朗读的笔记句子')
    return
  }
  stopReading()
  loopSelRange = null
  readingAll.value = false
  readStart.value = null
  window.getSelection()?.removeAllRanges()
  playSentence(first)
}

// 左右方向键切句：在当前全局句子序列里跨段移动，到头/到尾循环回绕；
// 切完立即循环朗读新句（stopReading 清掉旧状态与在途合成，再启动新句）。
function switchSentence(delta) {
  const list = sentenceList.value
  if (!list.length) return
  let idx = sentenceIdx.value
  if (idx < 0) idx = delta > 0 ? -1 : 0
  let next = idx + delta
  if (next < 0) next = list.length - 1
  if (next >= list.length) next = 0
  // 定位不到正文的句子无法朗读，跳过（最多找一圈）
  for (let n = 0; n < list.length && list[next].para < 0; n++) {
    next = (next + delta + list.length) % list.length
  }
  if (list[next].para < 0) return
  stopReading()
  playSentence(next)
}

// 朗读中按键：空格暂停 / 继续；逐句模式下左右键切句（输入框等不拦截）。
function onReadingKeydown(e) {
  if (readingPara.value < 0) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  // 逐句模式：← 上一句 / → 下一句
  if (sentenceIdx.value >= 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault()
    switchSentence(e.key === 'ArrowRight' ? 1 : -1)
    return
  }
  if (e.code !== 'Space' && e.key !== ' ') return
  e.preventDefault()
  readAloud.togglePause()
}

// 标题左侧「朗读全文」按钮：从第 0 段开始连续朗读；再点则停止。
function onReadFull() {
  if (loopPara.value >= 0 || sentenceIdx.value >= 0) stopReading()
  if (readingAll.value) {
    stopReading()
    return
  }
  readingAll.value = true
  readStart.value = null
  readFullFrom(0)
}

// 命中期间临时隐藏批注的视觉样式（黄色高亮底色 / 红色下划线），避免与命中蓝底叠加
// 产生割裂感；只影响视觉，data-annot-id 与悬停/点击卡片交互保留，批注数据不变。
// 选区消失 → readerSearchText 清空 → hasHit 变 false → 批注样式随 Vue 渲染自动恢复。
function annotSegClass(seg) {
  if (seg.hasHit) return []
  return [...new Set([seg.annotation.type, ...(seg.annotations || []).map((a) => a.type)])]
}
function annotSegStyle(seg) {
  if (seg.hasHit) return {}
  const h = seg.annotations?.find((a) => a.type === 'highlight')
  // 黄色高亮用纯色（取原荧光笔渐变 #fff9b0→#fff176 的中段色，观感基本一致）。
  // 高亮 span 绝不能有左右 padding / 圆角：::selection 只覆盖字形区，
  // padding 区既不会被粉色选区覆盖，又可能露出底色，把连续选区切成一段段。
  return h ? { background: '#fff593' } : {}
}

// readerSearchText 变化后，<mark> 由 Vue 渲染完成；这里只负责滚动定位到当前命中
watch(readerSearchNonce, () => {
  const keyword = readerSearchText ? readerSearchText.value : ''
  if (!keyword) return
  nextTick(() => {
    const body = document.querySelector('.reader .reader-body')
    if (!body) return
    scrollToReaderHit(body, Math.max(0, readerHit.index), '.reader .reader-content')
  })
})

function onReaderMouseDown(e) {
  // 点击朗读 / 循环按钮不算选词（且不能清空刚记录的选区起点）
  if (e.target && e.target.closest && e.target.closest('.para-read-btn, .para-loop-btn, .para-sentence-btn')) return
  // 正文内按下即视为开始选词：冻结朗读高亮，避免选区被 <mark> 重建打断
  if (e.target && e.target.closest && e.target.closest('.reader-body')) {
    draggingSelection = true
  }
}

function onReaderMouseUp(e) {
  draggingSelection = false
  // 点朗读 / 循环按钮时保留此前记录的选区起点（mouseup 早于 click，不能被清空）
  if (e && e.target && e.target.closest && e.target.closest('.para-read-btn, .para-loop-btn, .para-sentence-btn')) return
  // 循环模式下不在 mouseup 时改子段：只在点循环按钮那一刻取选区（见 onLoopParagraph）。
  // 这里只清掉 readStart，避免停止循环后误用过期选区；非循环时照常记录朗读起点。
  if (loopPara.value >= 0) readStart.value = null
  else captureReadStart()
  // 朗读中选中文字 → 立即从选中位置重新朗读（而非冻结高亮干等）；循环 / 逐句模式不打断。
  // 选区无效时 captureReadStart 已把 readStart 清空，故这里只在有有效选区时重读。
  if (loopPara.value < 0 && sentenceIdx.value < 0 && readingPara.value >= 0 && readStart.value) {
    onReadParagraph(readStart.value.para, true)
    return
  }
  // 仅当笔记面板打开时联动
  if (!noteSearchText || !noteSearchNonce) return
  if (!showSidePanel?.value || panelMode?.value !== 'note') return
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return
  // 仅处理落在正文 DOM 内的选区，避免与笔记侧（反向联动）互相干扰
  const inReader = (node) => {
    const el = node && node.nodeType === 3 ? node.parentElement : node
    return !!(el && el.closest && el.closest('.reader-body'))
  }
  if (!inReader(sel.anchorNode) || !inReader(sel.focusNode)) return
  // 用单词边界补全后的完整文本作为查找关键词（而非未完全选中的划取内容）
  const text = getExpandedSelectionText()
  if (!text) return
  // 标记当前激活的是正向联动（正文选中 → 笔记高亮），选区消失时按此清除
  if (activeSearchMode) activeSearchMode.value = 'forward'
  noteSearchText.value = text
  noteSearchNonce.value++
}

onMounted(() => {
  // 恢复至编辑前的滚动位置
  if (props.scrollTop) {
    nextTick(() => {
      const el = document.querySelector('.reader .reader-content')
      if (el) el.scrollTop = props.scrollTop
    })
  }
  // 正向联动：正文选中 → 笔记高亮（全局监听，仅在笔记面板打开且选区落在正文内时触发）
  document.addEventListener('mouseup', onReaderMouseUp)
  // 朗读状态下空格暂停 / 继续
  document.addEventListener('keydown', onReadingKeydown)
})
// 中断后台预热：代次自增让循环在下一个检查点退出，取消在途 fetch 避免离开文章后仍写缓存。
// 切文章 / 卸载都调用——卸载时尤其关键，否则预热会继续合成完并弹「已就绪」提示。
function abortWarmup() {
  warmupToken++
  cancelWarmupStartMsg()
  abortReadTts()
}
// 切换文章 / 卸载时停止朗读，避免残留朗读与旧词高亮；同时中断旧文章的后台预热与其提示消息
watch(() => props.articleId, () => {
  abortWarmup()
  stopReading()
})
// 正文数据 / 批注 / 滚动恢复落地后（contentReadyTick 递增）才预热，确保段落文本已就绪
watch(() => props.contentReadyTick, (v) => {
  if (v > 0) warmupAll()
})
// 编辑保存后重新预热：仅当正文段落文本变化时 ArticlePage 才置 1（只改标题不触发）。
// 编辑期间本组件被 v-if 卸载、保存后重新挂载，故用 immediate 在挂载时读取最新值；
// 值 <= 0 表示无需预热（含「进入编辑又取消」时被归零的场景）。
// 不清缓存、也不 force：key 含文本，未变段落直接命中缓存，只下载新文本 / 失败段，把带宽让给它们。
watch(() => props.audioForceTick, (v) => {
  if (v <= 0) return
  stopReading()
  nextTick(() => warmupAll())
}, { immediate: true })
onUnmounted(() => {
  document.removeEventListener('mouseup', onReaderMouseUp)
  document.removeEventListener('keydown', onReadingKeydown)
  abortWarmup()
  stopReading()
})

function onAnnotEnter(e, annotation) {
  emit('annotMouseEnter', e, annotation)
}
function onAnnotLeave() {
  emit('annotMouseLeave')
}
function onAnnotClick(e, annotation) {
  emit('annotClick', e, annotation)
}
// 橡皮擦开关：工具已激活就关闭，不依赖 drawTool 的值（状态不一致时也能关掉）
function onEraserClick() {
  if (props.drawActive) {
    emit('toggleTool')
  } else {
    emit('update:tool', 'eraser')
    emit('toggleTool')
  }
}
// 「新画布」清空当前画布（保留开启态），复用 DrawCanvas 暴露的 clearCanvas
function onNewCanvas() {
  drawCanvasRef.value?.clearCanvas?.()
}
function onWheel() {
  emit('scrollAway')
}


</script>

<template>
  <div class="reader">
    <div class="reader-top-bar"></div>
    <div class="reader-content" @wheel="onWheel">
      <div class="reader-left-tools">
        <div class="lt-handle" title="左侧工具">▶</div>
        <div class="lt-buttons">
          <button class="lt-btn" title="书签" @click="emit('toggleBookmarks')">
            <img class="lt-icon" src="/list.png" alt="书签" width="20" height="20" />
          </button>
          <button
            class="lt-btn"
            :class="{ active: sentenceState.dictationEnabled }"
            :title="sentenceState.dictationEnabled ? '关闭默写控件（关闭后左键 / Enter 不能进入默写）' : '开启默写控件（开启后左键点当前高亮英文行 / Enter 可进入默写）'"
            @click="toggleDictation"
          >
            <svg class="lt-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 20h16" />
              <path d="M6 16V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8" />
              <path d="M9 11h6M12 8v10" />
            </svg>
          </button>
          <button
            class="lt-btn"
            :class="{ active: audioStatusVisible }"
            :title="audioStatusVisible ? '关闭音频准备情况面板' : '查看音频准备情况'"
            @click="toggleAudioStatus"
          >
            <svg class="lt-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 20V10" />
              <path d="M10 20V4" />
              <path d="M16 20v-7" />
              <path d="M22 20H2" />
            </svg>
          </button>
          <button class="lt-btn" :class="{ active: drawMode }" title="启动/关闭画布 (Ctrl+R)" @click="emit('toggleCanvas')">
            <svg class="lt-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
          <button
            class="lt-btn"
            :class="{ active: annotationsLandscape }"
            :title="`批注章节横版排版（PDF）：当前${annotationsLandscape ? '开启' : '关闭'}，点击切换`"
            @click="emit('toggleAnnotationsLandscape')"
          >
            <svg class="lt-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M6 10h8M6 14h5" />
            </svg>
          </button>
        </div>
      </div>
      <!-- 画布控件：开启后左下贴边，独立于左侧工具条 -->
      <div v-if="drawMode" class="canvas-tools">
        <!-- 右键「选中文本自动添加线」开关状态指示 -->
        <button
          class="lt-status"
          :class="autoAddLines ? 'on' : 'off'"
          :title="`右键开关「选中文本自动添加线」：当前${autoAddLines ? '开启' : '关闭'}`"
          @click="toggleAutoAddLines"
        >
          <svg class="lt-switch" viewBox="0 0 1024 1024" width="20" height="20" fill="currentColor">
            <path d="M661.3504 195.1744H362.6496A313.8048 313.8048 0 0 0 48.896 508.9792a313.8048 313.8048 0 0 0 313.7536 313.7536h298.7008a313.8048 313.8048 0 0 0 313.7536-313.7536 313.8048 313.8048 0 0 0-313.7536-313.8048zM372.3776 744.96a235.9808 235.9808 0 1 1 235.9296-235.9808 235.9808 235.9808 0 0 1-235.9296 235.9808z" />
          </svg>
          <b>{{ autoAddLines ? '开' : '关' }}</b>
        </button>
        <button
          class="lt-cbtn"
          :class="{ active: drawActive && drawTool === 'eraser' }"
          title="橡皮擦"
          @click="onEraserClick"
        >
          <svg viewBox="0 0 1024 1024" width="18" height="18" fill="currentColor">
            <path d="M567.494 765.551L270.292 557.448c-22.62-15.839-28.117-47.016-12.278-69.636l234.648-335.113c15.84-22.62 47.017-28.118 69.637-12.28L859.5 348.524c22.62 15.839 28.118 47.016 12.28 69.636L637.13 753.272c-15.839 22.62-47.016 28.118-69.636 12.28zM382.44 861.973L242.979 764.32c-45.241-31.678-56.236-94.032-24.558-139.273l22.28-31.82 303.294 212.369-22.28 31.82c-31.678 45.24-94.033 56.235-139.273 24.557z" />
          </svg>
        </button>
        <button class="lt-cbtn lt-cbtn-primary" title="完成并关闭画布" @click="emit('closeCanvas')">
          <svg viewBox="0 0 1024 1024" width="18" height="18" fill="currentColor">
            <path d="M512 64A448 448 0 1 1 64 512 448 448 0 0 1 512 64m0-64a512 512 0 1 0 512 512A512 512 0 0 0 512 0z" />
            <path d="M790.4 304.96a32 32 0 0 0-22.72 9.28L428.16 653.76l-160-160a32 32 0 0 0-42.56 0l-1.6 2.88a32 32 0 0 0 0 42.88l182.4 182.08a28.8 28.8 0 0 0 21.12 8.96 29.44 29.44 0 0 0 21.44-8.96L812.8 359.68a32 32 0 0 0 0-45.12 32 32 0 0 0-22.4-9.28z" />
          </svg>
        </button>
        <button class="lt-cbtn" title="清空当前画布" @click="onNewCanvas">
          <svg viewBox="0 0 1024 1024" width="18" height="18" fill="currentColor">
            <path d="M66.56 66.56v890.88h890.88V66.56H66.56z m827.24352 827.24352H130.18624V130.19648h763.6224v763.60704z" />
            <path d="M480.23552 480.25088H311.13728c-17.5616 0-32.01024 14.208-32.01024 31.74912 0 17.65888 14.33088 31.75936 32.01024 31.75936h169.09824v169.09824c0 17.5616 14.22336 32.01024 31.75936 32.01024 17.664 0 31.75936-14.33088 31.75936-32.01024v-169.09824h169.10848c17.5616 0 32-14.21824 32-31.75936 0-17.65888-14.32064-31.74912-32-31.74912h-169.10848V311.1424c0-17.56672-14.21312-32.02048-31.75936-32.02048-17.65376 0-31.75936 14.34112-31.75936 32.02048v169.10848z" />
          </svg>
        </button>
      </div>
      <div class="reader-title-row">
        <button
          class="para-read-btn title-read-btn"
          :class="{ 'is-reading': readingAll }"
          :title="readingAll ? '停止朗读全文' : '朗读全文'"
          @click.stop="onReadFull"
        >
          <svg v-if="readingAll" viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor">
            <rect x="240" y="240" width="544" height="544" rx="60" />
          </svg>
          <svg v-else viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor">
            <path d="M288 160l576 352-576 352z" />
          </svg>
        </button>
        <h1 class="reader-title">{{ article.title }}</h1>
      </div>
      <div
        class="reader-body"
        :style="{ fontSize: props.fontSize + 'px' }"
      >
        <div
          v-for="(segments, i) in renderParagraphs"
          :key="i"
          class="para-block"
          :class="{ 'para-hovered': hoveredPara === i }"
          @mouseenter="onParaEnter(i)"
          @mouseleave="onParaLeave"
        >
          <button
            class="para-read-btn"
            :class="{ 'is-reading': readingPara === i }"
            :title="readingPara === i ? '停止朗读' : '朗读本段'"
            @click.stop="onReadParagraph(i)"
          >
            <svg v-if="readingPara === i" viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor">
              <rect x="240" y="240" width="544" height="544" rx="60" />
            </svg>
            <svg v-else viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor">
              <path d="M288 160l576 352-576 352z" />
            </svg>
          </button>
          <button
            class="para-loop-btn"
            :class="{ 'is-looping': loopPara === i }"
            :title="loopPara === i ? '停止循环播放（有选中内容时点击则改为循环选中内容）' : '循环播放本段（先选中文字则循环选中内容）'"
            @mousedown.prevent.stop="() => {}"
            @click.stop="onLoopParagraph(i)"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 2l4 4-4 4" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <path d="M7 22l-4-4 4-4" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </button>
          <button
            class="para-sentence-btn"
            :class="{ 'is-looping': sentenceIdx >= 0 && sentenceList[sentenceIdx]?.para === i }"
            :title="sentenceIdx >= 0 && sentenceList[sentenceIdx]?.para === i ? '停止逐句朗读（← 上一句 / → 下一句）' : '逐句朗读本段的笔记句子（← 上一句 / → 下一句）'"
            @mousedown.prevent.stop="() => {}"
            @click.stop="onSentenceLoop(i)"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 6h16M4 12h12M4 18h8" />
            </svg>
          </button>
          <p class="article-para">
            <!-- key 用片段起点偏移而非数组索引：新增/删除批注会改变片段划分，
                 索引 key 会让 Vue 按位置复用旧节点，导致高亮样式不刷新（刷新页面才显示）。 -->
            <!-- 命中高亮由 buildDisplayParagraphs 计算、Vue 渲染 <mark>，纯数据驱动；
                 .annotated 批注的 class/:style 始终由 Vue 托管，不会被 JS 改写 DOM 破坏。 -->
            <template v-for="seg in segments" :key="seg.key">
              <span v-if="seg.type === 'text'"><template v-for="(part, pi) in seg.renderParts" :key="pi"><mark v-if="part.hitIdx >= 0" class="reader-hit" :class="{ 'reader-hit-current': part.hitIdx === readerHit.index, 'reading-current': part.reading }" :data-hit-index="part.hitIdx">{{ part.text }}</mark><mark v-else-if="part.reading" class="reading-current">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
              <span
                v-else
                class="annotated"
                :class="annotSegClass(seg)"
                :style="annotSegStyle(seg)"
                :data-annot-id="
                  [
                    ...new Set([seg.annotation.id, ...(seg.annotations || []).map((a) => a.id)]),
                  ].join(' ')
                "
                @mouseenter="onAnnotEnter($event, seg.annotation)"
                @mouseleave="onAnnotLeave()"
                @click.stop="onAnnotClick($event, seg.annotation)"
                ><template v-for="(part, pi) in seg.renderParts" :key="pi"><mark v-if="part.hitIdx >= 0" class="reader-hit" :class="{ 'reader-hit-current': part.hitIdx === readerHit.index, 'reading-current': part.reading }" :data-hit-index="part.hitIdx">{{ part.text }}</mark><mark v-else-if="part.reading" class="reading-current">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
            </template>
          </p>
        </div>
      </div>
      <DrawCanvas
        ref="drawCanvasRef"
        :draw-mode="drawMode"
        :draw-active="drawActive"
        :tool="drawTool"
        :color="drawColor"
        :article-id="articleId"
        :content-ready-tick="contentReadyTick"
        :panel-open="panelOpen"
        :auto-add-lines="autoAddLines"
        @toggle-tool="emit('toggleTool')"
        @toggle-draw="emit('toggleDraw')"
        @close-canvas="emit('closeCanvas')"
        @new-canvas="emit('newCanvas')"
        @update:tool="emit('update:tool', $event)"
        @update:auto-add-lines="autoAddLines = $event"
      />
      <AudioStatusPanel
        ref="audioStatusPanelRef"
        :visible="audioStatusVisible"
        :texts="audioStatusTexts"
        :current-voice-id="currentVoice"
        @close="closeAudioStatus"
        @rewarm="onAudioRewarm"
        @select-voice="selectVoice"
      />

    </div>
  </div>
</template>

<style scoped>
.reader {
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 960px;
  background: #fff;
  border-radius: 0 0 12px 12px;
  border: 1px solid #ebeef5;
  border-top: none;
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
  padding: 20px 32px 40px;
}
.reader-title,
.reader-body {
  width: 100%;
  max-width: 720px;
  padding: 0;
  box-sizing: border-box;
}
/* 标题行：左侧「朗读全文」按钮 + 标题同行。
   .reader-content 是 align-items:center，必须显式给宽度，否则整行按内容收缩被居中。 */
.reader-title-row {
  position: relative;
  width: 100%;
  max-width: 720px;
  box-sizing: border-box;
  margin-bottom: 8px;
}
.reader-title {
  font-size: 28px;
  font-weight: 700;
  color: #1a1a2e;
  line-height: 1.3;
  margin: 0;
  letter-spacing: -0.5px;
}
.reader-body {
  counter-reset: para;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 16px;
  color: #333;
  line-height: 1.8;
  text-align: justify;
  user-select: text;
  cursor: text;
}
.reader-body ::selection {
  background: #fce4ec;
  color: #333;
}
/* 高亮 span 内被选中的文字同样用粉色覆盖，避免黄色渐变从字形区透出 */
.reader-body .annotated.highlight::selection {
  background: #fce4ec;
  color: #333;
}
.article-para {
  margin: 0 0 16px;
  white-space: pre-wrap;
}
.annotated {
  cursor: pointer;
  transition: opacity 0.15s;
}
.annotated:hover {
  opacity: 0.75;
}
/* 黄色高亮紧贴文字，不占用任何额外盒空间：
   一旦有左右 padding / 圆角，::selection 只画在字形区，padding 区
   既盖不上粉色又可能露出底色，连续选区会被切成一段段。 */
.annotated.highlight {
  padding: 0;
  border-radius: 0;
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
/* 笔记面板选中文字 → 正文命中词高亮：<mark> 由本组件模板（Vue）渲染，
   命中片段由 buildDisplayParagraphs 计算；保留 :deep() 写法即可命中。 */
:deep(.reader-hit) {
  /* 半透明蓝底（不用实心，避免盖住正文；批注底色在命中期间已临时隐藏）。
     命中短语常跨多个 seg/Vue span，会被渲染成多个相邻 <mark>；四周描边与圆角会在
     接缝处画出竖线、把连续命中切成多块（割裂感），故只保留底色、不描边、不圆角，
     相邻 mark 自然融成一整条连续高亮，也不会撑宽内联盒导致重排。 */
  background: rgba(64, 158, 255, 0.4);
  color: inherit;
  border-radius: 0;
  box-shadow: none;
  /* 跨行命中时各行的背景片段保持完整 */
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
/* 回车定位到的当前命中：更深蓝，区别于其他浅蓝命中（同样不描边，避免接缝竖线） */
:deep(.reader-hit.reader-hit-current) {
  background: rgba(13, 71, 161, 0.55);
  color: inherit;
  box-shadow: none;
}
/* 逐段朗读：当前词高亮（参考 read.html 的黄底深字）。
   放在命中样式之后且选择器更具体 —— 朗读词若正好落在命中段上，朗读色覆盖命中蓝底。
   圆角 / box-decoration-break 仅在单词词间出现，跨行时各片段保持完整。 */
:deep(.reading-current),
:deep(.reader-hit.reading-current),
:deep(.reader-hit.reader-hit-current.reading-current) {
  background: #fde047;
  color: #111;
  border-radius: 3px;
  box-shadow: none;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

.para-block {
  margin-bottom: 4px;
  position: relative;
  counter-increment: para;
}
.para-hovered::before {
  content: '第' counter(para) '段';
  position: absolute;
  left: 8px;
  top: -4px;
  font-size: 10px;
  color: #bbb;
  white-space: nowrap;
  font-family: 'Consolas', 'Courier New', monospace;
  line-height: inherit;
  user-select: none;
  pointer-events: none;
  animation: hintFade 0.2s ease-out;
}
.para-hovered {
  position: relative;
  background: #fafafa;
  border-radius: 6px;
  box-shadow: 0 0 0 8px #fafafa;
  margin: 0;
  padding: 0;
}
.para-block {
  position: relative;
}
/* 每段朗读按钮：默认隐藏，悬停该段显现；朗读中的段常驻显示。
   放在段首左侧（与「第N段」提示同侧），不随正文选区高亮，避免干扰选取文本。 */
.para-read-btn {
  position: absolute;
  left: -22px;
  top: 2px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: #b36b5e;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, transform 0.15s;
  line-height: 1;
}
.para-block:hover .para-read-btn,
.para-read-btn.is-reading {
  opacity: 1;
}
.para-read-btn:hover {
  color: #8c4a3f;
  transform: scale(1.15);
}
/* 单段循环播放按钮：位于朗读按钮正下方，默认隐藏、悬停该段或循环中常驻 */
.para-loop-btn {
  position: absolute;
  left: -22px;
  top: 22px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: #8aa0b0;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, transform 0.15s;
  line-height: 1;
}
.para-block:hover .para-loop-btn,
.para-loop-btn.is-looping {
  opacity: 1;
}
.para-loop-btn.is-looping {
  color: #409eff;
}
.para-loop-btn:hover {
  color: #3C78AA;
  transform: scale(1.15);
}
/* 逐句朗读按钮：位于循环按钮下方，默认隐藏、悬停该段或逐句朗读该段时常驻 */
.para-sentence-btn {
  position: absolute;
  left: -22px;
  top: 42px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: #b08a5e;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, transform 0.15s;
  line-height: 1;
}
.para-block:hover .para-sentence-btn,
.para-sentence-btn.is-looping {
  opacity: 1;
}
.para-sentence-btn.is-looping {
  color: #409eff;
}
.para-sentence-btn:hover {
  color: #8c6a3f;
  transform: scale(1.15);
}
/* 标题左侧朗读全文按钮：复用 .para-read-btn 图标样式，覆盖为常驻显示。
   绝对定位到标题左侧空白区（不占布局空间，避免把标题挤右）；垂直居中于标题行。
   必须定义在 .para-read-btn 之后，否则 opacity:0 / left / top 会被后者覆盖。 */
.title-read-btn {
  /* 与 .para-read-btn 用相同的 left 和尺寸，使全文/单段朗读按钮水平对齐
     （两者定位基准 .reader-title-row 与 .para-block 左边界一致，都是 720px 正文区）。 */
  left: -22px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 1;
  width: 18px;
  height: 18px;
}
.title-read-btn:hover {
  transform: translateY(-50%) scale(1.15);
}
.reader-left-tools {
  position: fixed;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  /* 必须高于画布 canvas 的 900：橡皮激活时 canvas 变为 pointer-events:auto，
     层级低会被它盖住，导致按钮点不到（尤其开启橡皮后无法再点按钮关闭） */
  z-index: 1000;
  display: flex;
  flex-direction: row;
  align-items: center;
}
/* hover 判定仅基于本容器（半圆钮宽度）；按钮组绝对定位脱离流，不占宽、不扩大 hover 区域 */
.reader-left-tools:hover .lt-buttons,
.reader-left-tools:has(.lt-buttons:hover) .lt-buttons {
  visibility: visible;
  opacity: 1;
}
/* 画布控件：开启后左下贴边，独立于左侧工具条。
   z-index 必须高于 canvas 的 900，否则橡皮激活（pointer-events:auto）后整组按钮被画布拦截 */
.canvas-tools {
  position: fixed;
  left: 8px;
  bottom: 8px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* 自动添加线开关：开=绿、关=红，清晰显示右键状态 */
.lt-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid #d4c5b0;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  font-size: 11px;
  line-height: 1.1;
  flex-direction: column;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  transition: all 0.15s;
}
.lt-status b {
  font-size: 13px;
}
/* 开关图标：开启时旋转 180°，拨钮从左侧移到右侧，直观表示开/关 */
.lt-switch {
  transition: transform 0.15s;
}
.lt-status.on .lt-switch {
  transform: rotate(180deg);
}
.lt-status.on {
  background: #e6f7e6;
  border-color: #52c41a;
  color: #389e0d;
}
.lt-status.off {
  background: #fff1f0;
  border-color: #ffa39e;
  color: #cf1322;
}
/* 小半圆钮：默认贴左缘，悬停展开按钮 */
.lt-handle {
  flex: 0 0 auto;
  width: 14px;
  height: 64px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-left: none;
  border-radius: 0 10px 10px 0;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: #909399;
  cursor: pointer;
  user-select: none;
}
/* 按钮组：绝对定位脱离流，不占宽；默认隐藏，容器（半圆钮）悬停时展开 */
.lt-buttons {
  position: absolute;
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 8px 8px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-left: none;
  border-radius: 0 10px 10px 0;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.06);
  margin-left: -1px;
  visibility: hidden;
  opacity: 0;
  transition: opacity 0.3s ease;
}
.lt-btn {
  width: 36px;
  height: 36px;
  border: 1px solid #d4c5b0;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  transition: all 0.15s;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}
.lt-btn:hover {
  background: #f0e8d8;
  border-color: #8b3a2a;
  transform: scale(1.08);
}
.lt-btn.active {
  background: #e6f0ff;
  color: #409eff;
  border-color: #409eff;
}
/* 画布控件按钮（橡皮/完成/新画布），与 .lt-btn 同尺寸 */
.lt-cbtn {
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid #d4c5b0;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}
.lt-cbtn:hover {
  background: #f0e8d8;
  border-color: #8b3a2a;
}
.lt-cbtn.active {
  background: #e6f0ff;
  color: #409eff;
  border-color: #409eff;
}
.lt-cbtn-primary {
  background: #fff;
  color: inherit;
  border-color: #d4c5b0;
}
.lt-cbtn-primary:hover {
  background: #f0e8d8;
  border-color: #8b3a2a;
}
</style>
