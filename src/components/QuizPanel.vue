<script setup>
// 普通文章的「选择题面板」——K 键开关，固定置于右侧。
//
// 复用考研试题页的选择题能力（解析 + 点选 + 统一提交判分）：
//   · 题目解析  parseQuestions()        —— src/kaoyan/parseCloze.js
//   · 答案解析  parseAnswersText()       —— 同上（考研页与普通文章共用）
//   · 整段拆分  splitQuizSections()      —— 按「一、题目 / 二、答案与解析」切块
//   · 答案解析  parseAnswersExplanations() —— 答案 + 解析一行「1. C —— 解析」一起解析
// 数据落在 articles 字段上（与考研同源）：
//   · questions     题目区原文（题干 + 选项）
//   · answers       正确答案对象 { "1": "A" }
//   · explanations  每题解析文本 { "1": "..." }（可选，普通文章选择题面板的解析导入入口）
//   · picked        用户所选 { "1": "A" }（考研按题型分组，普通文章直接用题号作键）
//
// 与考研页的差异：普通文章正文没有 [n] 空格槽，所以不做「点空格跳题」，
// 只在面板内完成作答；面板顶部提供整段导入入口（题目 + 答案与解析一次粘贴）。
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchArticle, updateArticle } from '@/api'
import {
  parseQuestions,
  parseAnswersText,
  splitQuizSections,
  parseAnswersExplanations,
} from '@/kaoyan/parseCloze'
import { normalizeQuotes } from '@/utils/normalizeQuotes'

const props = defineProps({
  articleId: { type: String, required: true },
})
const emit = defineEmits(['close'])

const loading = ref(true)
const questionsText = ref('')
const answers = ref({})
const explanations = ref({})
const picked = ref({})
const submitted = ref(false)
const result = ref(null) // { correct, total, wrong: number[] }
const doubts = ref({}) // 存疑标记（仅前端记忆，不入库）
const showExplanation = ref(false) // 提交判分后，是否展开每题解析

// ===== 顶部导入区（题目 + 答案 + 解析，整段粘贴）=====
const editing = ref(false)
const saving = ref(false)
const form = ref({ combined: '' })

const questions = computed(() => parseQuestions(questionsText.value))
const answeredCount = computed(() => questions.value.filter((q) => picked.value[q.number]).length)
const unansweredCount = computed(() => questions.value.length - answeredCount.value)

/**
 * picked 归一：普通文章形如 { "1": "A" }。
 * 只接受字符串值 —— 考研是 { [题型]: {...} } 的两层结构，
 * 万一文章类型被来回改过，过滤掉非字符串可避免界面拿到对象而错乱。
 */
function normalizePicked(raw) {
  const out = {}
  for (const [k, v] of Object.entries(raw || {})) {
    if (typeof v === 'string' && v) out[k] = v.toUpperCase()
  }
  return out
}

async function load() {
  loading.value = true
  try {
    const res = await fetchArticle(props.articleId)
    const a = res?.data || {}
    // 输出侧清洗：题干归一弯引号后再展示
    const rawQuestions = a.questions || ''
    const cleanedQuestions = normalizeQuotes(rawQuestions)
    questionsText.value = cleanedQuestions
    answers.value = a.answers && typeof a.answers === 'object' ? a.answers : {}
    // 解析文本同样归一（输出侧兜底）
    const rawExp = a.explanations && typeof a.explanations === 'object' ? a.explanations : {}
    const cleanedExp = {}
    Object.keys(rawExp).forEach((k) => { cleanedExp[k] = normalizeQuotes(rawExp[k]) })
    explanations.value = cleanedExp
    // 已入库迁移：旧题目 / 解析若含弯引号，清洗后静默回写（不弹提示、不影响编辑态）
    const questionsChanged = !!rawQuestions && cleanedQuestions !== rawQuestions
    const expChanged = Object.keys(rawExp).some((k) => cleanedExp[k] !== rawExp[k])
    if (questionsChanged || expChanged) {
      updateArticle(props.articleId, {
        ...(questionsChanged ? { questions: cleanedQuestions } : {}),
        ...(expChanged ? { explanations: cleanedExp } : {}),
      }).catch(() => {})
    }
    picked.value = normalizePicked(a.picked)
    form.value = { combined: '' }
    // 已提交判分的状态已落库，刷新 / 重新进入后恢复「已提交」并复算得分
    if (a.quiz_submitted) {
      submitted.value = true
      result.value = computeResult()
    } else {
      submitted.value = false
      result.value = null
    }
    doubts.value = {}
  } catch {
    questionsText.value = ''
    answers.value = {}
    picked.value = {}
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => props.articleId, load)

// ===== 作答 =====
async function savePicked() {
  try {
    await updateArticle(props.articleId, { picked: picked.value })
  } catch {
    /* 静默失败，不阻断作答 */
  }
}
// 记录「是否已提交判分」（0/1），使刷新 / 重新进入后保持已提交状态
async function saveSubmitted(v) {
  try {
    await updateArticle(props.articleId, { quiz_submitted: v ? 1 : 0 })
  } catch {
    /* 静默失败，不阻断判分状态记录 */
  }
}
function pick(number, key) {
  if (submitted.value) return
  picked.value = { ...picked.value, [number]: key }
  savePicked()
}
// 右键选项：取消该题已选
function unpick(number) {
  if (submitted.value) return
  if (picked.value[number] === undefined) return
  const next = { ...picked.value }
  delete next[number]
  picked.value = next
  savePicked()
}
// 右键题目：切换「存疑」
function toggleDoubt(number) {
  doubts.value = { ...doubts.value, [number]: !doubts.value[number] }
}

// 统一提交后才判分；提交前若有未作答，弹出方格提醒，确认后未作答按错误处理（与考研页一致）
const showSubmitDialog = ref(false)
function submit() {
  if (unansweredCount.value > 0) {
    showSubmitDialog.value = true
    return
  }
  doSubmit()
}
function confirmSubmit() {
  showSubmitDialog.value = false
  doSubmit()
}
function computeResult() {
  const qs = questions.value
  let correct = 0
  const wrong = []
  for (const q of qs) {
    const std = answers.value[String(q.number)]
    const mine = picked.value[q.number]
    if (std && mine && mine === std) correct++
    else wrong.push(q.number)
  }
  return { correct, total: qs.length, wrong }
}
function doSubmit() {
  result.value = computeResult()
  submitted.value = true
  showSubmitDialog.value = false
  saveSubmitted(true)
}
function resetQuiz() {
  picked.value = {}
  submitted.value = false
  result.value = null
  showExplanation.value = false
  savePicked()
  saveSubmitted(false)
}

// 判分后的选项样式：对的绿、错选的红（与考研页一致）
function optionClass(q, key) {
  const mine = picked.value[q.number]
  if (!submitted.value) return mine === key ? 'opt-picked' : ''
  const std = answers.value[String(q.number)]
  if (std === key) return 'opt-correct'
  if (mine === key) return 'opt-wrong'
  return ''
}

// ===== 导入 =====
function toggleEdit() {
  if (editing.value) {
    cancelEdit()
    return
  }
  // 打开导入框时不再预填已有文本，保持空白待粘贴
  form.value = { combined: '' }
  editing.value = true
}
function cancelEdit() {
  form.value = { combined: '' }
  editing.value = false
}
async function saveForm() {
  saving.value = true
  try {
    // 整段粘贴：按「一、题目 / 二、答案与解析」拆分，再解析答案与解析
    const { questionsText: qs, answersText: ans } = splitQuizSections(form.value.combined)
    const parsedQuestions = parseQuestions(qs)
    const { answers: ansObj, explanations: expObj } = parseAnswersExplanations(ans)
    const qCount = parsedQuestions.length
    const aCount = Object.keys(ansObj).length
    const expCount = Object.keys(expObj).length
    if (qCount === 0) {
      ElMessage.warning('未解析到任何题目，请检查「一、题目」格式')
      saving.value = false
      return
    }
    if (aCount === 0) {
      ElMessage.warning(`已解析 ${qCount} 道题目，但未解析到答案，请检查「二、答案与解析」格式`)
      saving.value = false
      return
    }
    // 输入侧清洗：题干 / 解析落库前归一弯引号（弯单引号 → '，弯双引号 → "）
    const cleanedQuestions = normalizeQuotes(qs)
    const cleanedExplanations = {}
    Object.keys(expObj || {}).forEach((k) => { cleanedExplanations[k] = normalizeQuotes(expObj[k]) })
    await updateArticle(props.articleId, {
      questions: cleanedQuestions,
      answers: ansObj,
      explanations: cleanedExplanations,
    })
    editing.value = false
    await load()
    // 解析结果提示：题目 / 答案 / 解析各自条数，并核对答案数与题目数是否一致
    let tip = `解析成功：题目 ${qCount} 道、答案 ${aCount} 条、解析 ${expCount} 条`
    if (aCount !== qCount) tip += '（答案数与题目数不一致，请核对）'
    ElMessage.success(tip)
  } catch (e) {
    ElMessage.error('保存失败：' + ((e && e.message) || e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <aside class="quiz-panel">
    <div class="quiz-head">
      <span class="quiz-title">选择题（{{ questions.length }}）</span>
      <!-- 提交 / 重新作答 / 得分：与顶部栏同一行 -->
      <template v-if="questions.length">
        <button v-if="!submitted" class="q-btn q-btn-primary" @click="submit">
          提交答案（未答 {{ unansweredCount }}）
        </button>
        <button v-else class="q-btn" @click="resetQuiz">重新作答</button>
        <span v-if="result" class="q-score">
          得分 {{ result.correct }} / {{ result.total }}
          <span v-if="result.wrong.length" class="q-wrong"
            >（错题：{{ result.wrong.join('、') }}）</span
          >
          <span v-else class="q-ok">（全对）</span>
        </span>
        <button v-if="submitted" class="q-btn" @click="showExplanation = !showExplanation">
          {{ showExplanation ? '隐藏解析' : '查看解析' }}
        </button>
      </template>
      <button class="q-btn q-btn-primary" @click="toggleEdit">
        {{ editing ? '收起导入' : '导入题目/答案' }}
      </button>
      <button class="q-btn q-close" title="关闭（K）" @click="emit('close')">✕</button>
    </div>

    <!-- 顶部导入：题目 + 答案与解析，整段粘贴，按一级标题分块 -->
    <div v-if="editing" class="quiz-editor">
      <textarea
        v-model="form.combined"
        class="q-textarea"
        rows="18"
        placeholder="整段粘贴，按一级标题分块：&#10;一、题目&#10;1. 题干…&#10;A. …&#10;二、答案与解析&#10;1. A —— 解析…"
      ></textarea>
      <div class="q-actions">
        <button class="q-btn q-btn-primary" :disabled="saving" @click="saveForm">
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <button class="q-btn" @click="cancelEdit">取消</button>
      </div>
    </div>

    <div class="quiz-list">
      <p v-if="loading" class="q-empty">加载中…</p>
      <p v-else-if="!questions.length" class="q-empty">
        暂无题目，点顶部「导入题目/答案」整段粘贴题干、选项、答案与解析。
      </p>
      <div
        v-for="q in questions"
        :key="q.number"
        class="q-item"
        :class="{ 'q-doubt': doubts[q.number] }"
        @contextmenu.prevent="toggleDoubt(q.number)"
      >
        <div class="q-title">
          <span class="q-num">{{ q.number }}.</span>
          <span v-if="q.text" class="q-stem">{{ q.text }}</span>
          <span v-if="doubts[q.number]" class="q-doubt-tag">存疑</span>
        </div>
        <div class="q-opts">
          <button
            v-for="(text, key) in q.options"
            :key="key"
            class="q-opt"
            :class="optionClass(q, key)"
            :disabled="submitted"
            title="左键选择 · 右键取消选择"
            @click="pick(q.number, key)"
            @contextmenu.prevent.stop="unpick(q.number)"
          >
            <b>{{ key }}.</b> {{ text }}
          </button>
        </div>
        <div v-if="showExplanation && explanations[q.number]" class="q-exp">
          <span class="q-exp-label">解析：</span>{{ explanations[q.number] }}
        </div>
      </div>
    </div>
  </aside>

  <!-- 提交前作答情况提醒：方格弹窗，已作答蓝 / 未作答红（与考研页一致） -->
  <Teleport to="body">
    <div v-if="showSubmitDialog" class="quiz-modal-mask" @click.self="showSubmitDialog = false">
      <div class="quiz-modal">
        <div class="quiz-modal-title">提交前请确认作答情况</div>
        <p class="quiz-modal-tip">
          共 {{ questions.length }} 题，已作答
          <b class="t-done">{{ answeredCount }}</b> 题，未作答
          <b class="t-miss">{{ unansweredCount }}</b> 题（红色为未作答）。
        </p>
        <div class="quiz-grid">
          <div
            v-for="q in questions"
            :key="q.number"
            class="quiz-cell"
            :class="picked[q.number] ? 'cell-done' : 'cell-miss'"
          >
            {{ q.number }}
          </div>
        </div>
        <div class="quiz-modal-actions">
          <button class="q-btn q-btn-primary" @click="confirmSubmit">确认提交</button>
          <button class="q-btn" @click="showSubmitDialog = false">继续作答</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 固定贴右侧，高度顶满窗口；大小与笔记页面（.side-panel 46vw）一致，四周倒角 */
.quiz-panel {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 46vw;
  z-index: 130;
  background: #fff;
  border-left: 1px solid #ebeef5;
  border-radius: 12px 0 0 12px;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
  padding: 14px 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.quiz-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid #ebeef5;
  flex-wrap: wrap;
}
.quiz-title {
  flex: 1;
  min-width: 0;
  font-size: 0.9rem;
  font-weight: 700;
  color: #303133;
}
.quiz-editor {
  flex: 0 0 auto;
  max-height: 45%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 0;
  border-bottom: 1px solid #ebeef5;
}
.quiz-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-top: 10px;
}
.q-empty {
  color: #909399;
  font-size: 0.82rem;
  line-height: 1.6;
  padding: 8px 0;
}
.q-item {
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid #409eff;
  border-radius: 6px;
  background: #fff;
}
.q-doubt {
  background: #fdf6ec;
  border-left: 3px solid #e6a23c;
}
.q-title {
  font-size: 0.88rem;
  color: #303133;
  margin-bottom: 6px;
  display: flex;
  align-items: flex-start;
}
.q-num {
  flex: 0 0 auto;
  white-space: nowrap;
}
.q-stem {
  flex: 1 1 auto;
  min-width: 0;
}
.q-doubt-tag {
  display: inline-block;
  margin-left: 6px;
  font-size: 0.7rem;
  line-height: 1.4;
  color: #fff;
  background: #e6a23c;
  border-radius: 3px;
  padding: 0 5px;
}
.q-opts {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.q-opt {
  text-align: left;
  padding: 6px 10px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background: #fff;
  font-size: 1rem;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s;
}
.q-opt:hover:not(:disabled) {
  background: #f5f7fa;
}
.q-opt:disabled {
  cursor: default;
}
.q-opt b {
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
.q-label {
  font-size: 0.95rem;
  color: #606266;
  font-weight: 600;
}
.q-textarea {
  width: 100%;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 0.85rem;
  font-family: inherit;
  line-height: 1.7;
  resize: vertical;
  box-sizing: border-box;
  outline: none;
}
.q-textarea:focus {
  border-color: #409eff;
}
.q-actions {
  display: flex;
  gap: 8px;
}
.q-exp {
  margin-top: 8px;
  padding: 8px 10px;
  border-top: 1px dashed #e4e7ed;
  font-size: 0.82rem;
  line-height: 1.6;
  color: #606266;
  background: #fafafa;
  border-radius: 0 0 6px 6px;
}
.q-exp-label {
  font-weight: 600;
  color: #409eff;
}
.q-btn {
  padding: 5px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #f8fafc;
  color: #475569;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s;
}
.q-btn:hover {
  background: #f1f5f9;
}
.q-btn-primary {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}
.q-btn-primary:hover {
  background: #66b1ff;
}
.q-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.q-close {
  padding: 5px 9px;
}
.q-score {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 0.85rem;
  line-height: 1.5;
  color: #475569;
  word-break: break-word;
}
.q-wrong {
  color: #e74c3c;
}
.q-ok {
  color: #67c23a;
}
/* 提交前作答情况提醒弹窗（与考研页一致） */
.quiz-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.quiz-modal {
  background: #fff;
  border-radius: 10px;
  padding: 20px 22px;
  min-width: 320px;
  max-width: 90vw;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
}
.quiz-modal-title {
  font-size: 1rem;
  font-weight: 700;
  margin: 0 0 8px;
  color: #303133;
}
.quiz-modal-tip {
  font-size: 0.82rem;
  color: #606266;
  margin: 0 0 4px;
}
.quiz-modal-tip .t-done {
  color: #1f6ea8;
}
.quiz-modal-tip .t-miss {
  color: #c45656;
}
.quiz-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr); /* 五列一行 */
  gap: 8px;
  margin: 14px 0 6px;
}
.quiz-cell {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-weight: 700;
  font-size: 0.9rem;
}
.quiz-cell.cell-done {
  /* 已作答：蓝 */
  background: #ecf5ff;
  border-color: #409eff;
  color: #1f6ea8;
}
.quiz-cell.cell-miss {
  /* 未作答：红 */
  background: #fef0f0;
  border-color: #f56c6c;
  color: #c45656;
}
.quiz-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
}
</style>
