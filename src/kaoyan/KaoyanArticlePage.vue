<script setup>
// 考研英语试题页（第一期：完形填空 Cloze）
// 全部位于 src/kaoyan/ 下，不改动现有 src/components 的任何组件。
// 第一期范围：正文空格 [n] 渲染 + 题目选项点选 + 统一提交后判分。
// 批注 / 笔记 / 查词 / 画布等下一期接入。
import { ref, computed, onMounted, onUnmounted, watch, inject, nextTick } from 'vue'
import { fetchArticle, updateArticle } from '@/api'
import { parseExam, EXAM_TYPES, isExamArticle, examTypeLabelOf } from './parseCloze'
import { useKaoyanAnnotations } from './useKaoyanAnnotations'
import {
  getExpandedSelectionText,
  highlightMatchesInReader,
  scrollToFirstHit,
} from '@/utils/selectionText'

const props = defineProps({
  articleId: { type: String, required: true },
  // 右侧 AI / 笔记面板是否展开：展开时题目浮动栏要让位隐藏，避免与面板抢右侧空间
  panelOpen: { type: Boolean, default: false },
  // 正文字号：与 ArticleToolbar 的 A−/A+ 联动（同 ArticleReader 只作用于正文的处理方式）
  fontSize: { type: Number, default: 16 },
})
const emit = defineEmits(['back', 'editing-change', 'sidebar-change', 'exam-state'])

// ===== 笔记面板双向划词联动（与普通文章 ArticleReader 一致）=====
// 正向：正文选中文字 → 通知笔记面板查找 / 高亮
const noteSearchText = inject('noteSearchText', null)
const noteSearchNonce = inject('noteSearchNonce', null)
const showSidePanel = inject('showSidePanel', null)
const panelMode = inject('panelMode', null)
const activeSearchMode = inject('activeSearchMode', null)
// 反向：笔记面板选中文字 → 正文高亮命中词并跳转
const readerSearchText = inject('readerSearchText', null)
const readerSearchNonce = inject('readerSearchNonce', null)

// 正向联动：选中正文文本时，仅在笔记面板处于「笔记」模式才联动
function onPassageMouseUp() {
  if (!noteSearchText || !noteSearchNonce) return
  if (!showSidePanel?.value || panelMode?.value !== 'note') return
  const text = getExpandedSelectionText()
  if (!text) return
  if (activeSearchMode) activeSearchMode.value = 'forward'
  noteSearchText.value = text
  noteSearchNonce.value++
}

// 反向联动：笔记面板选中文字变化时，在正文命中词高亮并滚动到首个命中
watch(readerSearchNonce, () => {
  if (!readerSearchText || !readerSearchNonce) return
  const keyword = readerSearchText.value || ''
  nextTick(() => {
    const body = document.querySelector('.ky-passage')
    if (!body) return
    highlightMatchesInReader(body, keyword)
    if (!keyword) return
    // 滚动容器为 .ky-body（其 overflow-y:auto）
    scrollToFirstHit(body, '.ky-body')
  })
})

const loading = ref(true)
const error = ref('')
const article = ref(null)

// ===== 多题型：一篇文章（一套真题）可含多个题型，按题型分别录入 =====
// sections 形如 { 'kaoyan-cloze': { content, questions, answers }, 'kaoyan-partA-1': {...} }
const sections = ref({})
const currentType = ref(EXAM_TYPES[0].value)

// 某题型是否已录入（有原文或题目即算）
function isRecorded(t) {
  const s = sections.value[t]
  return !!(s && (s.content || s.questions))
}

// ===== 录入面板（题型 + 原文 / 题目 / 答案 三块分别录入）=====
const editing = ref(false)
const saving = ref(false)
const form = ref({ content: '', questions: '', answersText: '' })

// ===== 答题 =====
// picked：按题型分组记录所选答案，形如 { [type]: { '12': 'A' } }，落库跨会话保留
const picked = ref({})
const submitted = ref(false)
const result = ref(null) // { correct, total, wrong: number[] }
// 当前题型已选答案（便于模板/函数按题型访问）
const myPicks = computed(() => picked.value[currentType.value] || {})
// 落库：仅持久化用户选择，不影响录入内容（sections）
async function savePicked() {
  try {
    await updateArticle(props.articleId, { picked: picked.value })
  } catch (e) {
    /* 静默失败，不阻断答题 */
  }
}

// 当前题型的解析结果（正文空格 + 题目）
const curSection = computed(() => sections.value[currentType.value] || {})
const exam = computed(() =>
  parseExam({
    content: curSection.value.content || '',
    questions: curSection.value.questions || '',
  }),
)

// ===== 正文标记（高亮 / 下划线）=====
// 只做标记、不写注释：E / W 与普通文章一致，命中即切换（已有同类型标记则取消）
const kyAnn = useKaoyanAnnotations(
  computed(() => props.articleId),
  currentType,
)
// passageParts 下标 → 文本片段序号（type==='text' 的第几个），用作批注的 paragraphIndex
const textFragIndex = computed(() => {
  const m = {}
  let n = 0
  exam.value.passageParts.forEach((p, i) => {
    if (p.type === 'text') m[i] = n++
  })
  return m
})
// 一个文本片段按批注切分后的渲染段（两种标记可叠加）；每段带 fi / key 供悬停定位
function annotSegments(i) {
  const p = exam.value.passageParts[i]
  const fi = textFragIndex.value[i]
  if (!p || p.type !== 'text' || fi == null) return []
  return kyAnn.segmentsFor(fi, p.text).map((s) => ({
    ...s,
    fi,
    key: `${fi}:${s.start}:${s.end}`,
  }))
}
// 鼠标悬停在哪一段标记上：Delete / Backspace 删它（与普通文章「悬停后按 Delete」一致）
const hoverKey = ref('')
function onMarkEnter(seg) {
  if (!seg.highlight && !seg.underline) return
  hoverKey.value = seg.key
}
function onMarkLeave() {
  hoverKey.value = ''
}
// capture 阶段注册：命中 E / W 与 Delete 后 stopPropagation，避免 ArticlePage 的通用分支重复处理
// （后者靠 .reader-body .article-para 取偏移，考研页取不到，本就无事可做）
function onMarkKeydown(e) {
  if (editing.value) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const t = e.target
  if (t) {
    const tag = t.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return
    if (t.closest?.('.side-panel')) return
  }
  // 删除：优先删悬停的那条标记，否则删与选区重叠的标记
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const seg = hoverKey.value ? hoverKey.value.split(':').map(Number) : null
    const removed =
      seg && seg.length === 3 ? kyAnn.removeAt(seg[0], seg[1], seg[2]) : kyAnn.removeSelection()
    if (removed) {
      e.preventDefault()
      e.stopPropagation()
    }
    return
  }
  const k = (e.key || '').toLowerCase()
  if (k !== 'e' && k !== 'w') return
  e.preventDefault()
  e.stopPropagation()
  kyAnn.toggle(k === 'e' ? 'highlight' : 'underline')
}
onMounted(() => document.addEventListener('keydown', onMarkKeydown, true))
onUnmounted(() => document.removeEventListener('keydown', onMarkKeydown, true))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetchArticle(props.articleId)
    article.value = res?.data || null
    const a = article.value || {}
    // 兼容旧数据：早期只有单组 content/questions/answers，迁移为对应题型的一个区块
    const s = a.sections && Object.keys(a.sections).length ? a.sections : null
    if (s) {
      sections.value = s
    } else if (a.content || a.questions || Object.keys(a.answers || {}).length) {
      const t = isExamArticle(a.type) ? a.type : EXAM_TYPES[0].value
      sections.value = {
        [t]: { content: a.content || '', questions: a.questions || '', answers: a.answers || {} },
      }
    } else {
      sections.value = {}
    }
    // 当前题型：上次的最后标签 > 文章记录的 type > 第一个已录入的 > 默认第一项
    const wanted = isExamArticle(a.type) ? a.type : ''
    const lastType = localStorage.getItem('ky-last-exam-type')
    const validLast = EXAM_TYPES.some((t) => t.value === lastType) ? lastType : ''
    currentType.value =
      validLast ||
      wanted ||
      EXAM_TYPES.find((t) => isRecorded(t.value))?.value ||
      EXAM_TYPES[0].value
    // 恢复上次作答进度（按题型分组，缺省为空）
    picked.value = a.picked && typeof a.picked === 'object' ? a.picked : {}
    // 进入文章时复位判分状态，保留各题型已选
    submitted.value = false
    result.value = null
    syncForm()
    kyAnn.load() // 正文标记与普通文章同表，按题型隔离
  } catch (e) {
    error.value = '加载文章失败'
  } finally {
    loading.value = false
  }
}

// 把「当前题型」的内容回填到录入表单
function syncForm() {
  const s = sections.value[currentType.value] || {}
  const answers = s.answers || {}
  form.value = {
    content: s.content || '',
    questions: s.questions || '',
    // 答案对象 → 文本，形如 "12. A"
    answersText: Object.keys(answers).length
      ? Object.keys(answers)
          .sort((x, y) => Number(x) - Number(y))
          .map((k) => `${k}. ${answers[k]}`)
          .join('\n')
      : '',
  }
}

// 答案文本 → 对象：单行一条 "12. A" / "12 A" / "12、A"，也支持一行内多条连写
// "1.A 2.B 3.C" 或末尾带标点（如 "20.A；"），全文本扫描，遇到「题号 + 选项字母」即算一条
function parseAnswersText(text) {
  const out = {}
  // (?<!\d) 避免命中数字串内部；(?![A-Za-z]) 避免 "12.answer" 这类误判为 12.A
  const re = /(?<!\d)(\d{1,3})\s*[\.、:：]?\s*([A-Da-d])(?![A-Za-z])/gi
  for (const m of String(text || '').matchAll(re)) {
    out[String(Number(m[1]))] = m[2].toUpperCase()
  }
  return out
}

async function saveForm() {
  saving.value = true
  error.value = ''
  try {
    // 只写入当前题型对应的区块，不影响其它已录入题型
    const t = currentType.value
    const next = {
      ...sections.value,
      [t]: {
        content: form.value.content,
        questions: form.value.questions,
        answers: parseAnswersText(form.value.answersText),
      },
    }
    await updateArticle(props.articleId, {
      sections: next,
      type: t, // 记录最后编辑的题型，便于下次打开默认进入
    })
    sections.value = next
    await load()
    editing.value = false
    resetGrading()
  } catch (e) {
    error.value = e.message || '保存失败'
  } finally {
    saving.value = false
  }
}

function cancelEdit() {
  syncForm()
  editing.value = false
  error.value = ''
}

// 选项点选（提交后不可改），按题型分组记录并落库
function pick(number, key) {
  if (submitted.value) return
  picked.value = {
    ...picked.value,
    [currentType.value]: { ...(picked.value[currentType.value] || {}), [number]: key },
  }
  savePicked()
}
// 右键选项：取消该题已选（对应空格槽一并清空），并落库
function unpick(number) {
  const cur = { ...(picked.value[currentType.value] || {}) }
  if (cur[number] === undefined) return
  delete cur[number]
  picked.value = { ...picked.value, [currentType.value]: cur }
  savePicked()
}
// 右键题目：切换“存疑”标记（仅前端记忆，不入库）
const doubts = ref({})
function toggleDoubt(number) {
  doubts.value = { ...doubts.value, [number]: !doubts.value[number] }
}

// 点击文中空格槽：滚动到右侧对应题目并短暂高亮
const flashQ = ref(null)
function jumpToQuestion(number) {
  const el = document.getElementById('ky-q-' + number)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  flashQ.value = number
  // 0.667s/次 × 3 次 ≈ 2s，结束后再稍作缓冲移除高亮类
  setTimeout(() => {
    if (flashQ.value === number) flashQ.value = null
  }, 2100)
}

// 统一提交后才判分；提交前若有未作答，弹出方格提醒，确认后未作答按错误处理
const showSubmitDialog = ref(false)
function isAnswered(num) {
  return !!picked.value[currentType.value]?.[num]
}
const answeredCount = computed(
  () => exam.value.questions.filter((q) => isAnswered(q.number)).length,
)
const unansweredCount = computed(() => exam.value.questions.length - answeredCount.value)

function submit() {
  if (unansweredCount.value > 0) {
    showSubmitDialog.value = true // 有未作答：弹方格提醒
    return
  }
  doSubmit()
}
function confirmSubmit() {
  showSubmitDialog.value = false
  doSubmit()
}
function doSubmit() {
  const qs = exam.value.questions
  const answers = curSection.value.answers || {}
  let correct = 0
  const wrong = []
  for (const q of qs) {
    const std = answers[String(q.number)]
    const mine = picked.value[currentType.value]?.[q.number]
    if (std && mine && mine === std) correct++
    else wrong.push(q.number) // 选错 / 未作答 一律计入错题
  }
  result.value = { correct, total: qs.length, wrong }
  submitted.value = true
}

// 仅复位判分状态（切换题型 / 录入保存后使用），保留各题型已选
function resetGrading() {
  submitted.value = false
  result.value = null
}
// 重新作答：清空当前题型已选并复位判分，同时落库
function resetQuiz() {
  picked.value = { ...picked.value, [currentType.value]: {} }
  submitted.value = false
  result.value = null
  savePicked()
}

// 判分后选项样式：对的绿、错选的红
function optionClass(q, key) {
  const mine = picked.value[currentType.value]?.[q.number]
  if (!submitted.value) return mine === key ? 'opt-picked' : ''
  const std = curSection.value.answers?.[String(q.number)]
  if (std === key) return 'opt-correct'
  if (mine === key) return 'opt-wrong'
  return ''
}

// 空格槽样式：未选蓝色；已选（未提交）淡蓝；提交后对绿 / 错红（与右侧选项区一致）
function slotState(p) {
  const mine = picked.value[currentType.value]?.[p.number]
  if (!mine) return '' // 未选：默认蓝
  if (!submitted.value) return 'slot-picked' // 已选未提交：淡蓝
  const std = curSection.value.answers?.[String(p.number)]
  return mine === std ? 'slot-correct' : 'slot-wrong' // 提交后：对绿 / 错红
}

// 是否有右侧题目浮动栏：通知父组件统一让位，使顶栏与内容区同宽同位置，避免两层错位
const hasSidebar = computed(
  () =>
    !loading.value &&
    !!article.value &&
    !editing.value &&
    !props.panelOpen &&
    exam.value.questions.length > 0,
)
watch(hasSidebar, (v) => emit('sidebar-change', v), { immediate: true })
watch(editing, (v) => emit('editing-change', v))

// 供父组件转发 ArticleToolbar 的按钮点击
function toggleEditing() {
  editing.value = !editing.value
}
// 直接进入录入界面（不切换，仅打开面板），用于「切换至未录入题型」时自动展开
function openEditing() {
  editing.value = true
}
// 当前题型表单是否已改动（用于切换题型前拦截，避免丢失未保存录入）
function formSnapshot(t) {
  const s = sections.value[t] || {}
  const answers = s.answers || {}
  const answersText = Object.keys(answers).length
    ? Object.keys(answers)
        .sort((x, y) => Number(x) - Number(y))
        .map((k) => `${k}. ${answers[k]}`)
        .join('\n')
    : ''
  return JSON.stringify({ content: s.content || '', questions: s.questions || '', answersText })
}
function isDirty() {
  return (
    JSON.stringify({
      content: form.value.content,
      questions: form.value.questions,
      answersText: form.value.answersText,
    }) !== formSnapshot(currentType.value)
  )
}
// 切换当前题型（仅录入面板下拉调用）：编辑中若有未保存改动先确认，避免丢失；切换后回填并重置答题
function setType(t) {
  if (!t || t === currentType.value) return
  if (editing.value && isDirty()) {
    if (!window.confirm('切换题型将丢弃当前未保存的录入内容，确定继续？')) return
  }
  currentType.value = t
  localStorage.setItem('ky-last-exam-type', t)
  syncForm()
  resetGrading()
}
defineExpose({ toggleEditing, openEditing, setType })

// 同步给父组件：顶栏需要知道当前题型与各题型是否已录入（用于下拉标记与「录入 / 修改」文案）
watch(
  [currentType, sections],
  () => {
    const recorded = {}
    for (const t of EXAM_TYPES) recorded[t.value] = isRecorded(t.value)
    emit('exam-state', { currentType: currentType.value, recorded })
  },
  { immediate: true, deep: true },
)

onMounted(load)
watch(
  () => props.articleId,
  () => {
    load()
  },
)
</script>

<template>
  <!-- 顶栏已合并到 ArticlePage 的 ArticleToolbar（题型标签 + 录入 / 编辑同栏），
       这里不再自带顶栏，避免两层叠加与水平错位；右侧栏让位由父容器统一处理 -->
  <div class="kaoyan-page">
    <div class="kaoyan-inner">
      <p v-if="error" class="ky-error">{{ error }}</p>
      <p v-if="loading" class="ky-loading">加载中…</p>

      <!-- 录入面板：题型标签 + 原文 / 题目 / 答案 三块 -->
      <div v-if="editing && !loading" class="ky-editor">
        <div class="ky-field">
          <label class="ky-label">题型（保存后写入该题型的区块；已录入的标注「已录入」）</label>
          <select :value="currentType" class="ky-select" @change="setType($event.target.value)">
            <option v-for="t in EXAM_TYPES" :key="t.value" :value="t.value">
              {{ t.label }}（{{ t.desc }}）{{ isRecorded(t.value) ? '（已录入）' : '' }}
            </option>
          </select>
        </div>
        <div class="ky-field">
          <label class="ky-label">题目原文（完形填空中用 [12] 或 {12} 标记空格位置）</label>
          <textarea
            v-model="form.content"
            class="ky-textarea"
            rows="8"
            placeholder="... this [12] approach ..."
          ></textarea>
        </div>
        <div class="ky-field">
          <label class="ky-label">题目（题干 + 选项）</label>
          <textarea
            v-model="form.questions"
            class="ky-textarea"
            rows="10"
            placeholder="12. A. xxx  B. yyy  C. zzz  D. www&#10;或：&#10;12.&#10;A. xxx&#10;B. yyy&#10;C. zzz&#10;D. www"
          ></textarea>
        </div>
        <div class="ky-field">
          <label class="ky-label">答案（可选，一行一个：题号. 选项）</label>
          <textarea
            v-model="form.answersText"
            class="ky-textarea"
            rows="4"
            placeholder="12. A&#10;13. C"
          ></textarea>
        </div>
        <div class="ky-actions">
          <button class="ky-btn ky-btn-primary" :disabled="saving" @click="saveForm">
            {{ saving ? '保存中…' : '保存' }}
          </button>
          <button class="ky-btn" @click="cancelEdit">取消</button>
        </div>
      </div>

      <!-- 正文（含空格槽）：右侧浮动栏的让位由外层容器负责，正文保持正常居中 -->
      <div v-else-if="!loading && article" class="ky-body" @mouseup="onPassageMouseUp">
        <p v-if="!isRecorded(currentType)" class="ky-empty">
          当前题型「{{ examTypeLabelOf(currentType) }}」尚未录入，点右上「录入」填写原文与题目。
        </p>
        <template v-else>
          <!-- 字号跟随顶栏 A−/A+：空格槽内题号(em)与填空区(em)会随之等比缩放，无需单独处理 -->
          <div class="ky-passage" :style="{ fontSize: props.fontSize + 'px' }">
            <template v-for="(p, i) in exam.passageParts" :key="i">
              <!-- 文本片段：包一层 .ky-seg 并带 data-fi，供 E/W 量取段内偏移；内部按批注再切分 -->
              <span v-if="p.type === 'text'" class="ky-seg" :data-fi="textFragIndex[i]"
                ><span
                  v-for="(seg, k) in annotSegments(i)"
                  :key="k"
                  :class="{
                    'ky-mark-hl': seg.highlight,
                    'ky-mark-ul': seg.underline,
                    'ky-mark-hover': hoverKey === seg.key,
                  }"
                  @mouseenter="onMarkEnter(seg)"
                  @mouseleave="onMarkLeave"
                  >{{ seg.text }}</span
                ></span
              >
              <span
                v-else
                class="ky-slot"
                :class="slotState(p)"
                @click="jumpToQuestion(p.number)"
                title="点击跳转到对应题目"
              >
                <span class="ky-slot-num">{{ p.number }}</span>
                <span class="ky-slot-blank">{{ myPicks[p.number] || '' }}</span>
              </span>
            </template>
          </div>

          <p v-if="!exam.questions.length" class="ky-empty">该题型尚未录入题目。</p>
        </template>
      </div>

      <!-- 右侧浮动栏：提交判分（顶部固定） + 题目（下方滚动）。fixed 高度顶满网页 -->
      <aside
        v-if="!loading && article && !editing && !panelOpen && exam.questions.length"
        class="ky-sidebar"
      >
        <!-- 提交判分置于顶部，固定不随题目滚动 -->
        <div class="ky-submit">
          <button v-if="!submitted" class="ky-btn ky-btn-primary" @click="submit">提交答案</button>
          <button v-else class="ky-btn" @click="resetQuiz">重新作答</button>
          <span v-if="result" class="ky-score">
            得分 {{ result.correct }} / {{ result.total }}
            <span v-if="result.wrong.length" class="ky-wrong"
              >（错题：{{ result.wrong.join('、') }}）</span
            >
            <span v-else class="ky-ok">（全对）</span>
          </span>
        </div>

        <div class="ky-q-head">题目（{{ exam.questions.length }}）</div>
        <div class="ky-q-list">
          <div
            v-for="q in exam.questions"
            :key="q.number"
            :id="'ky-q-' + q.number"
            class="ky-q"
            :class="{ 'ky-q-doubt': doubts[q.number], 'ky-q-flash': flashQ === q.number }"
            @contextmenu.prevent="toggleDoubt(q.number)"
          >
            <div class="ky-q-title">
              {{ q.number }}. <span v-if="q.text">{{ q.text }}</span>
              <span v-if="doubts[q.number]" class="ky-doubt">存疑</span>
            </div>
            <div class="ky-opts">
              <button
                v-for="(text, key) in q.options"
                :key="key"
                class="ky-opt"
                :class="optionClass(q, key)"
                :disabled="submitted"
                @click="pick(q.number, key)"
                @contextmenu.prevent.stop="unpick(q.number)"
                title="左键选择 · 右键取消选择"
              >
                <b>{{ key }}.</b> {{ text }}
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- 提交前作答情况提醒：五列一行的方格，已作答蓝 / 未作答红 -->
    <Teleport to="body">
      <div v-if="showSubmitDialog" class="ky-modal-mask" @click.self="showSubmitDialog = false">
        <div class="ky-modal">
          <div class="ky-modal-title">提交前请确认作答情况</div>
          <p class="ky-modal-tip">
            共 {{ exam.questions.length }} 题，已作答
            <b class="t-done">{{ answeredCount }}</b> 题，未作答
            <b class="t-miss">{{ unansweredCount }}</b> 题（红色为未作答）。
          </p>
          <div class="ky-grid">
            <div
              v-for="q in exam.questions"
              :key="q.number"
              class="ky-cell"
              :class="isAnswered(q.number) ? 'cell-done' : 'cell-miss'"
            >
              {{ q.number }}
            </div>
          </div>
          <div class="ky-modal-actions">
            <button class="ky-btn ky-btn-primary" @click="confirmSubmit">确认提交</button>
            <button class="ky-btn" @click="showSubmitDialog = false">继续作答</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.kaoyan-page {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  justify-content: center;
  overflow: hidden;
  box-sizing: border-box;
}
.kaoyan-inner {
  /* 与普通文章页对齐：ArticlePage 的 .reader-toolbar / .reader 同为 960px，
     这里固定 960px 并禁止收缩，避免被右侧浮动栏的让位挤压而变窄 */
  width: 960px;
  flex: 0 0 960px;
  max-width: 960px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fff;
  border: 1px solid #ebeef5;
  /* 顶栏已合并到 ArticleToolbar（其自带 12px 上圆角 + 无下边框），
     这里去掉上部圆角与上边框与之平齐衔接，只保留底部圆角 */
  border-top: none;
  border-radius: 0 0 12px 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  overflow: hidden;
}
.ky-top {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid #ebeef5;
  min-height: 44px;
}
.ky-title {
  font-size: 1rem;
  font-weight: 700;
  margin: 0;
  color: #1a1a2e;
}
.ky-type {
  font-size: 0.75rem;
  color: #e6a23c;
  border: 1px solid #e6a23c;
  border-radius: 3px;
  padding: 1px 6px;
}
.ky-spacer {
  flex: 1;
}
.ky-btn {
  padding: 5px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #f8fafc;
  color: #475569;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s;
}
.ky-btn:hover {
  background: #f1f5f9;
}
.ky-btn-primary {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}
.ky-btn-primary:hover {
  background: #66b1ff;
}
.ky-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.ky-error {
  color: #e74c3c;
  font-size: 0.82rem;
  padding: 8px 16px;
  margin: 0;
}
.ky-loading {
  color: #909399;
  font-size: 0.85rem;
  padding: 16px;
}
.ky-empty {
  color: #909399;
  font-size: 0.85rem;
  padding: 16px;
}

/* 录入面板 */
.ky-editor {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ky-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ky-label {
  font-size: 0.78rem;
  color: #606266;
  font-weight: 600;
}
.ky-select,
.ky-textarea {
  width: 100%;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 0.85rem;
  font-family: inherit;
  box-sizing: border-box;
  outline: none;
}
.ky-select:focus,
.ky-textarea:focus {
  border-color: #409eff;
}
.ky-textarea {
  resize: vertical;
  line-height: 1.7;
}
.ky-actions {
  display: flex;
  gap: 8px;
}

/* 正文与题目 */
.ky-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 28px;
}
/* 右侧浮动栏：提交（顶部固定） + 题目（下方滚动）。高度顶满网页 */
.ky-sidebar {
  position: fixed;
  right: 16px;
  /* 高度撑满网页：从窗口最顶部一直到窗口底部 */
  top: 0;
  bottom: 0;
  width: 700px;
  z-index: 120;
  background: #fff;
  border: 1px solid #ebeef5;
  /* 上下都贴到窗口边，去掉圆角，作为贴边面板 */
  border-radius: 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: 14px 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* 题目列表：占满剩余高度并独立滚动，让顶部提交按钮始终可见 */
.ky-q-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.ky-passage {
  font-size: 16px;
  line-height: 2;
  color: #333;
  text-align: justify;
  white-space: pre-wrap;
  /* 与普通文章 .reader-body 对齐：正文阅读列固定 720px 并居中，
     页面卡片（.kaoyan-inner / .reader）同为 960px，视觉一致 */
  max-width: 720px;
  margin: 0 auto 20px;
}
/* 正文标记：E 高亮 / W 下划线，与普通文章取色一致；只做标记，不弹注释卡片 */
.ky-seg {
  /* 仅作偏移计量的容器，不引入任何视觉变化 */
  display: inline;
}
.ky-mark-hl {
  padding: 1px 0;
  border-radius: 2px;
  background: #ffeb3b;
}
.ky-mark-ul {
  text-decoration: underline;
  text-decoration-color: #e74c3c;
  text-decoration-thickness: 2px;
  text-underline-offset: 5px;
  text-decoration-skip-ink: none;
}
/* 鼠标悬停中的标记：按 Delete / Backspace 即删（描边仅作视觉提示，不弹卡片、不弹提示） */
.ky-mark-hover {
  outline: 2px solid #409eff;
  border-radius: 2px;
}
/* 反向联动高亮：笔记选中 → 正文命中词。mark 由 selectionText.js 动态插入，
   须用 :deep() 才能命中 scoped 编译期拿不到的动态元素（与普通 ArticleReader 一致） */
:deep(.reader-hit) {
  background: #409eff;
  color: #fff;
  border-radius: 2px;
  box-shadow: 0 0 0 1px #409eff;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
:deep(.reader-hit.reader-hit-current) {
  background: #0d47a1;
  box-shadow: 0 0 0 1px #0d47a1;
}
/* 完形填空空格槽：题号置于横线下划线之前 + 固定宽度填空区（不撑开正文） */
.ky-slot {
  display: inline-flex;
  align-items: baseline;
  vertical-align: baseline;
  margin: 0 1px;
  white-space: nowrap;
  cursor: pointer;
}
/* 题号：横线之前的左前方，固定小字号，不占额外行高 */
.ky-slot-num {
  font-size: 0.95em;
  line-height: 1;
  font-weight: 700;
  color: #409eff;
  margin-right: 1px;
}
/* 填空区：固定宽度，字母出现也不改变尺寸，避免正文重排 */
.ky-slot-blank {
  display: inline-block;
  width: 1.4em;
  text-align: center;
  border-bottom: 2px solid #409eff;
  color: #409eff;
  font-weight: 700;
  line-height: 1.5;
}
/* 已选（未提交）：整槽转淡蓝 */
.ky-slot.slot-picked .ky-slot-blank {
  border-bottom-color: #409eff;
  background: #ecf5ff;
  color: #1f6ea8;
}
.ky-slot.slot-picked .ky-slot-num {
  color: #1f6ea8;
}
/* 提交后正确：整槽绿色 */
.ky-slot.slot-correct .ky-slot-blank {
  border-bottom-color: #67c23a;
  background: #f0f9eb;
  color: #529b2e;
}
.ky-slot.slot-correct .ky-slot-num {
  color: #529b2e;
}
/* 提交后错误：整槽红色 */
.ky-slot.slot-wrong .ky-slot-blank {
  border-bottom-color: #f56c6c;
  background: #fef0f0;
  color: #c45656;
}
.ky-slot.slot-wrong .ky-slot-num {
  color: #c45656;
}
.ky-q-head {
  font-size: 0.85rem;
  font-weight: 700;
  color: #303133;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid #ebeef5;
}
/* 每题独立容器：带颜色外边框 + 间距隔离；未选蓝、已选紫 */
.ky-q {
  position: relative;
  margin-bottom: 16px;
  padding: 10px 12px;
  border: 1px solid #409eff;
  border-radius: 6px;
  background: #fff;
}
/* 点击文中空格槽跳转后，对应题目用金色光环覆盖边框并呼吸闪烁（2s/次 × 3 次） */
@keyframes ky-breathe {
  0%,
  100% {
    outline-color: rgba(255, 211, 77, 0);
  }
  50% {
    outline-color: rgba(255, 211, 77, 1);
  }
}
.ky-q.ky-q-flash {
  outline: 3px solid #ffd34d;
  outline-offset: -3px;
  animation: ky-breathe 0.667s ease-in-out 3; /* 每次约 0.667s × 3 = 2s 内结束 */
}
/* 存疑标记：浅琥珀底 + 左侧橙色条（叠加在蓝/紫边框之上，不影响布局） */
.ky-q-doubt {
  background: #fdf6ec;
  border-left: 3px solid #e6a23c;
}
.ky-doubt {
  display: inline-block;
  margin-left: 6px;
  font-size: 0.7rem;
  line-height: 1.4;
  color: #fff;
  background: #e6a23c;
  border-radius: 3px;
  padding: 0 5px;
}
.ky-q-title {
  font-size: 0.9rem;
  color: #303133;
  margin-bottom: 6px;
  display: flex;
  align-items: center; /* 题号/题干与「存疑」徽标始终垂直居中，兼容单行与多行 */
}
.ky-opts {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ky-opt {
  text-align: left;
  padding: 6px 10px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background: #fff;
  font-size: 0.85rem;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s;
}
.ky-opt:hover:not(:disabled) {
  background: #f5f7fa;
}
.ky-opt:disabled {
  cursor: default;
}
.ky-opt b {
  color: #909399;
  margin-right: 4px;
}
.opt-picked {
  border-color: #409eff;
  background: #ecf5ff;
  color: #1f6ea8;
}
.opt-correct {
  border-color: #67c23a;
  background: #f0f9eb;
  color: #529b2e;
}
.opt-wrong {
  border-color: #f56c6c;
  background: #fef0f0;
  color: #c45656;
}
.ky-submit {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap; /* 分数换行显示，避免与按钮挤在一行变乱 */
  align-items: center;
  gap: 10px;
  min-height: 34px; /* 提交前后高度基本稳定，避免跳动 */
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #ebeef5;
}
.ky-score {
  flex: 1 1 100%; /* 独占一行，长错题列表换行不挤压按钮 */
  min-width: 0;
  font-size: 0.85rem;
  line-height: 1.5;
  color: #475569;
  word-break: break-word;
}
/* 提交前作答情况提醒弹窗 */
.ky-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.ky-modal {
  background: #fff;
  border-radius: 10px;
  padding: 20px 22px;
  width: 360px;
  max-width: 90vw;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
}
.ky-modal-title {
  font-size: 1rem;
  font-weight: 700;
  margin: 0 0 8px;
  color: #303133;
}
.ky-modal-tip {
  font-size: 0.82rem;
  color: #606266;
  margin: 0 0 4px;
}
.ky-modal-tip .t-done {
  color: #1f6ea8;
}
.ky-modal-tip .t-miss {
  color: #c45656;
}
.ky-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr); /* 五列一行 */
  gap: 8px;
  margin: 14px 0 6px;
}
.ky-cell {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid;
  font-weight: 700;
  font-size: 0.9rem;
}
.ky-cell.cell-done {
  /* 已作答：蓝 */
  background: #ecf5ff;
  border-color: #409eff;
  color: #1f6ea8;
}
.ky-cell.cell-miss {
  /* 未作答：红 */
  background: #fef0f0;
  border-color: #f56c6c;
  color: #c45656;
}
.ky-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
}
.ky-wrong {
  color: #e74c3c;
}
.ky-ok {
  color: #67c23a;
}
</style>
