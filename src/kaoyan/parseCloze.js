// 考研英语试题解析（第一期：完形填空 Cloze）
//
// 录入方式（与用户约定）：创建/编辑时先选择题型标签（Cloze / Part A / Part B），
// 然后【分三块分别录入】，故这里不再做"正文 / 题目"的启发式切分：
//   · passage  = content 字段：题目原文。完形填空中含 [12] 或 {12} 形式的题目空格标记
//   · questions= questions 字段：题目区原文（题干 + 选项）
//   · answers  = answers 字段：正确答案对象，如 { "12": "A", "13": "C" }
//
// 题目区格式（宽容解析，两种写法都支持、可混用；具体规则后续可再定）：
//   写法A（单行四选项）：12. A. xxx  B. yyy  C. zzz  D. www
//   写法B（题号 + 分行选项）：
//       12.
//       A. xxx
//       B. yyy
//       C. zzz
//       D. www
//
// 说明：本文件与渲染组件均位于 src/kaoyan/ 下，不改动现有 src/components。

// 题号行：12. xxx / 12、xxx
const Q_RE = /^\s*(\d{1,3})[\.、]\s*(.*)$/
// 选项行：A. xxx / A、xxx
const OPT_RE = /^\s*([A-Da-d])[\.、]\s*(.*)$/
// 空格标记：支持 [12] 与 {12} 两种写法（完形填空录入常用 {} 包裹选项空）
const SLOT_RE = /[\[{](\d{1,3})[\]}]/g

/** 题型标签 → type 字段值（统一以 kaoyan 前缀，便于按前缀判定大类） */
export const EXAM_TYPES = [
  // label 为顶栏徽章显示的短名（完形填空 / Part A-N / Part B），desc 用于下拉补充说明
  { value: 'kaoyan-cloze', label: '完形填空', desc: 'Cloze' },
  { value: 'kaoyan-partA-1', label: 'Part A-1', desc: '阅读第 1 篇' },
  { value: 'kaoyan-partA-2', label: 'Part A-2', desc: '阅读第 2 篇' },
  { value: 'kaoyan-partA-3', label: 'Part A-3', desc: '阅读第 3 篇' },
  { value: 'kaoyan-partA-4', label: 'Part A-4', desc: '阅读第 4 篇' },
  { value: 'kaoyan-partB', label: 'Part B', desc: '新题型' },
]

/** 旧 type 值 → 新显示名（不出现在下拉选项中，仅用于已存旧数据的兼容显示） */
const LEGACY_TYPE_LABEL = {
  'kaoyan-partA': 'Part A-1',
}

/** 取题型显示短名：完形填空 / Part A-N（N 为 1~4）/ Part B；旧值按新值显示 */
export function examTypeLabelOf(type) {
  const t = String(type || '')
  const hit = EXAM_TYPES.find((x) => x.value === t)
  if (hit) return hit.label
  return LEGACY_TYPE_LABEL[t] || ''
}

/** 判断某篇文章是否为考研英语试题（按 type 前缀） */
export function isExamArticle(type) {
  return String(type || '').startsWith('kaoyan')
}

/**
 * 把题目原文按 [题号] 空格标记切成渲染片段。
 * @param {string} passage 题目原文（content）
 * @returns {Array<{type:'text', text:string} | {type:'slot', number:number}>}
 */
export function splitPassageSlots(passage) {
  const parts = []
  const s = String(passage || '')
  const re = new RegExp(SLOT_RE.source, 'g')
  let last = 0
  let m
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push({ type: 'text', text: s.slice(last, m.index) })
    parts.push({ type: 'slot', number: Number(m[1]) })
    last = m.index + m[0].length
  }
  if (last < s.length) parts.push({ type: 'text', text: s.slice(last) })
  return parts
}

/** 收集原文中出现的所有空格题号，用于校验题目与空格是否对应 */
export function collectSlotNumbers(passage) {
  const nums = []
  const re = new RegExp(SLOT_RE.source, 'g')
  let m
  while ((m = re.exec(String(passage || ''))) !== null) nums.push(Number(m[1]))
  return nums
}

/**
 * 解析题目区原文 → 题目列表。
 * @param {string} text questions 字段内容
 * @returns {Array<{number:number, text:string, options:Record<string,string>}>}
 */
export function parseQuestions(text) {
  const questions = []
  let cur = null

  const flush = () => {
    if (cur && (Object.keys(cur.options).length || cur.text)) questions.push(cur)
    cur = null
  }

  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue

    const q = Q_RE.exec(line)
    if (q) {
      flush()
      const rest = q[2].trim()
      cur = { number: Number(q[1]), text: '', options: {} }
      const inline = parseInlineOptions(rest)
      if (inline) cur.options = inline
      else cur.text = rest
      continue
    }

    const o = OPT_RE.exec(line)
    if (o && cur) {
      cur.options[o[1].toUpperCase()] = o[2].trim()
      continue
    }

    // 既非题号也非选项：作为当前题目的题干补充（仅在尚未收到选项时追加）
    if (cur && !Object.keys(cur.options).length) {
      cur.text = (cur.text ? cur.text + ' ' : '') + line
    }
  }
  flush()
  return questions
}

/** 解析行内选项：A. xx  B. yy  C. zz  D. ww */
function parseInlineOptions(s) {
  if (!/^\s*[A-Da-d][\.、]\s*/.test(s)) return null
  const re = /([A-Da-d])[\.、]\s*/g
  const found = []
  let m
  while ((m = re.exec(s)) !== null) found.push({ key: m[1].toUpperCase(), idx: m.index })
  // 至少两个选项才算行内选项，避免把题干中的 "A." 误判
  if (found.length < 2) return null
  const opts = {}
  for (let i = 0; i < found.length; i++) {
    const start = found[i].idx
    const end = i + 1 < found.length ? found[i + 1].idx : s.length
    opts[found[i].key] = s.slice(start, end).replace(/^\s*[A-Da-d][\.、]\s*/, '').trim()
  }
  return opts
}

/**
 * 答案文本 → 答案对象：单行一条 "12. A" / "12 A" / "12、A"，也支持一行内多条连写
 * （"1.A 2.B 3.C"、或末尾带标点如 "20.A；"），全文本扫描，遇到「题号 + 选项字母」即算一条。
 *
 * 考研试题页与普通文章的选择题面板共用（两者都把答案存进 articles.answers）。
 * @param {string} text
 * @returns {Record<string,string>} 形如 { "12": "A" }
 */
export function parseAnswersText(text) {
  const out = {}
  // (?<!\d) 避免命中数字串内部；(?![A-Za-z]) 避免 "12.answer" 这类误判为 12.A
  const re = /(?<!\d)(\d{1,3})\s*[\.、:：]?\s*([A-Da-d])(?![A-Za-z])/gi
  for (const m of String(text || '').matchAll(re)) {
    out[String(Number(m[1]))] = m[2].toUpperCase()
  }
  return out
}

/**
 * 解析文本 → 解析对象：一行一条 "1. 解析内容" / "1、..." / "1: ..."，
 * 取题号后的整行作为该题解析。考研试题页与普通文章共用（存进 articles.explanations）。
 * @param {string} text
 * @returns {Record<string,string>} 形如 { "1": "..." }
 */
export function parseExplanationsText(text) {
  const out = {}
  for (const raw of String(text || '').split('\n')) {
    const m = /^\s*(\d{1,3})[\.、:：]\s*(.*)$/.exec(raw.trim())
    if (m) {
      const v = m[2].trim()
      if (v) out[String(Number(m[1]))] = v
    }
  }
  return out
}

/**
 * 组合解析：把一篇文章的三个字段解析成渲染所需结构。
 * @param {{content?:string, questions?:string, answers?:object}} article
 */
export function parseExam(article = {}) {
  const passage = article.content || ''
  return {
    passageParts: splitPassageSlots(passage),
    slotNumbers: collectSlotNumbers(passage),
    questions: parseQuestions(article.questions || ''),
    answers: article.answers || {},
  }
}

/**
 * 把「题目 + 答案与解析」整段文本按一级标题拆成两部分。
 * 支持「一、题目」「二、答案与解析」或带 # 的 Markdown 写法；
 * 找不到分界时整段视为题目。
 * @param {string} text
 * @returns {{questionsText:string, answersText:string}}
 */
export function splitQuizSections(text) {
  const lines = String(text || '').split('\n')
  const re = /^\s*#?\s*二\s*[、.。]?\s*(?:答案与解析|答案解析|答案)/
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      idx = i
      break
    }
  }
  if (idx === -1) return { questionsText: lines.join('\n'), answersText: '' }
  let qLines = lines.slice(0, idx)
  // 去掉题目部分首行可能的「一、题目」标题
  if (qLines.length && /^\s*#?\s*一\s*[、.。]?\s*题目/.test(qLines[0])) qLines = qLines.slice(1)
  // 容忍题目行首尾的 Markdown 加粗 **（如「**1. 题干**」），并丢弃水平分隔线（--- / *** / ___）
  qLines = qLines
    .map((l) => l.replace(/^\s*\*\*/, '').replace(/\*\*\s*$/, ''))
    .filter((l) => !/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(l))
  return {
    questionsText: qLines.join('\n').trim(),
    answersText: lines.slice(idx + 1).join('\n').trim(),
  }
}

/**
 * 解析「答案与解析」整段 → 答案对象 + 解析对象。
 * 每行格式：「1. C —— 解析文本」，也兼容「1.C 解析」「1. C：解析」。
 * 末行「【答案速查表】 1.C 2.B …」仅提取答案（复用 parseAnswersText）。
 * @param {string} text
 * @returns {{answers:Record<string,string>, explanations:Record<string,string>}}
 */
export function parseAnswersExplanations(text) {
  const answers = {}
  const explanations = {}
  for (const raw of String(text || '').split('\n')) {
    // 容忍 Markdown 加粗 **（含答案与解析之间的 **，整行去除即可）
    const line = raw.trim().replace(/\*\*/g, '')
    if (!line) continue
    // 答案速查表：整行形如「【答案速查表】 1.C 2.B 3.A …」，只取答案
    if (/答案速查/.test(line)) {
      Object.assign(answers, parseAnswersText(line))
      continue
    }
    const m = /^(\d{1,3})\s*[\.、]\s*([A-Da-d])\s*[-—–:：]+\s*(.*)$/.exec(line)
    if (m) {
      const n = String(Number(m[1]))
      answers[n] = m[2].toUpperCase()
      const exp = m[3].trim()
      if (exp) explanations[n] = exp
    }
  }
  return { answers, explanations }
}
