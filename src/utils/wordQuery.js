// 查词文本归一化 / 校验规则（前端统一口径，消除各组件各自为政）
// 与后端 server/index.js 的 isLookupWordValid 保持一致：仅允许字母、空格、撇号、连字符，且必须含字母。

const LEADING_TRAILING_PUNC = '.,;:!?"\'，。！？；：、·…`()（）[]{}<>《》【】'
const FILE_EXT_RE = /^(png|jpg|jpeg|gif|txt|exe|pdf|py|js|ts|css|html|json)$/i

/** 长句阈值：超过该词数只展示段落翻译，不展开单词卡片（两个卡片共用） */
export const LONG_QUERY_WORDS = 5

/** 是否长句 */
export function isLongQuery(text = '') {
  return String(text).split(/\s+/).filter(Boolean).length > LONG_QUERY_WORDS
}

/**
 * 从任意选中文本归一化出可查词文本：
 *  - 换行合并为空格
 *  - 去首尾标点
 *  - 排除路径 / 文件扩展名 / 纯数字
 * 返回小写文本；不可查词时返回 ''。
 */
export function normalizeLookupText(raw = '') {
  let text = String(raw).split('\n').join(' ').trim()
  while (LEADING_TRAILING_PUNC.includes(text[0])) text = text.slice(1).trim()
  while (LEADING_TRAILING_PUNC.includes(text[text.length - 1])) text = text.slice(0, -1).trim()
  if (!text) return ''
  if (/[/\\]/.test(text)) return ''
  if (FILE_EXT_RE.test(text.split('.').pop())) return ''
  if (/^\d+$/.test(text)) return ''
  if (!/[a-zA-Z]{2,}/.test(text)) return ''
  return text.toLowerCase()
}

/** 后端校验的等价前端版（用于手动输入提示，避免发出必然 400 的请求） */
export function isValidLookupWord(text = '') {
  const t = String(text).trim()
  return !!t && t.length <= 50 && /[a-z]/i.test(t)
}

/** 把网络错误映射为中文提示（前端错误文案统一） */
export function lookupErrorMessage(err) {
  if (err?.name === 'AbortError') return '查询已取消'
  // 只取字符串型 message；Error/对象兜底为空，不返回 "[object Object]"
  const raw = typeof err?.message === 'string'
    ? err.message
    : typeof err === 'string'
      ? err
      : ''
  if (!raw) return '查询失败，请稍后重试'
  if (/AbortError|abort/i.test(raw)) return '查询已取消'
  if (/failed|ECONNRESET|ETIMEDOUT|UND_ERR|timeout|网络|502|503/i.test(raw)) {
    return '词典服务连接失败，请稍后重试'
  }
  if (/400|无效/.test(raw)) return '查询内容无效'
  return raw
}
