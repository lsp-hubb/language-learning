// 有道 result 页面解析（纯函数，便于单测）
// 说明：有道解析依赖 CSS class 正则，页面改版可能失效；这里对空释义做「明确返回空」
// 而非抛异常，由上层 doLookup 统一转成「未找到释义」提示，避免静默失败。

// 常见 HTML 实体（含释义里实测出现的 &lt; / &gt;）
const NAMED_ENTITIES = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
}

/** 解码 HTML 实体：命名实体 + 十进制/十六进制数字实体。未知实体原样保留。 */
export function decodeHtmlEntities(input = '') {
  return String(input).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const isHex = code[1]?.toLowerCase() === 'x'
      const num = parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      if (Number.isFinite(num) && num > 0 && num <= 0x10ffff) {
        return String.fromCodePoint(num)
      }
      return match
    }
    const key = code.toLowerCase()
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key)
      ? NAMED_ENTITIES[key]
      : match
  })
}

/**
 * 取音标文本：先去外层空白、再剥首尾斜杠、最后再去一次内侧空白。
 * 修复 "/ həˈləʊ /" → "həˈləʊ"（旧实现只 trim 外侧，斜杠内侧空格残留）。
 */
function normalizePhoneText(raw = '') {
  return String(raw)
    .replace(/^\s+|\s+$/g, '')
    .replace(/^\/+\s*|\s*\/*$/g, '')
    .replace(/^\s+|\s+$/g, '')
}

export function extractYoudaoPhonetic(html = '') {
  const result = { uk: '', us: '' }

  // 方法1（首选）：div.phone_con > div.per-phone > span + span.phonetic
  const phoneConRe = /<div[^>]*class="phone_con"[^>]*>([\s\S]*?)<\/div>/i
  const phoneConMatch = phoneConRe.exec(html)
  if (phoneConMatch) {
    const perPhoneRe = /<div[^>]*class="per-phone"[^>]*>([\s\S]*?)<\/div>/gi
    let m
    while ((m = perPhoneRe.exec(phoneConMatch[1])) !== null) {
      const block = m[1]
      const langMatch = /<span[^>]*>([^<]*)<\/span>/i.exec(block)
      const phoneMatch = /<span[^>]*class="phonetic"[^>]*>([^<]+)<\/span>/i.exec(block)
      if (langMatch && phoneMatch) {
        const lang = langMatch[1].trim()
        const phone = normalizePhoneText(phoneMatch[1])
        if (phone) {
          if (lang.includes('英')) result.uk = `/${phone}/`
          else if (lang.includes('美')) result.us = `/${phone}/`
        }
      }
    }
  }

  // 方法2（备选）：直接取所有 span.phonetic
  if (!result.uk && !result.us) {
    const phoneRe = /<span[^>]*class="phonetic"[^>]*>([^<]+)<\/span>/gi
    const phonetics = []
    let m
    while ((m = phoneRe.exec(html)) !== null) {
      const phone = normalizePhoneText(m[1])
      if (phone) phonetics.push(phone)
    }
    if (phonetics[0]) result.uk = `/${phonetics[0]}/`
    if (phonetics[1]) result.us = `/${phonetics[1]}/`
  }

  return result
}

export function extractYoudaoDefs(html = '') {
  const defs = []
  const blockRe = /<li[^>]*class="word-exp"[^>]*>([\s\S]*?)<\/li>/gi
  let block
  while ((block = blockRe.exec(html)) !== null) {
    const content = block[1]
    const posMatch = /<span[^>]*class="pos"[^>]*>([^<]*)<\/span>/i.exec(content)
    const transMatch = /<span[^>]*class="trans"[^>]*>([^<]*)<\/span>/i.exec(content)
    if (transMatch) {
      defs.push({
        part_of_speech: decodeHtmlEntities(posMatch ? posMatch[1].trim() : ''),
        translation: decodeHtmlEntities(transMatch[1].trim()),
      })
    }
  }
  return defs
}

export function extractYoudaoTranslation(html = '') {
  const re = /<p[^>]*class="trans-content"[^>]*>([\s\S]*?)<\/p>/i
  const m = re.exec(html)
  return m ? decodeHtmlEntities(String(m[1]).replace(/<[^>]+>/g, '').trim()) : ''
}

/** 一次解析出音标 / 释义 / 翻译，供 doLookup 使用。 */
export function parseYoudaoResult(html = '') {
  const { uk, us } = extractYoudaoPhonetic(html)
  const definitions = extractYoudaoDefs(html)
  const translation = definitions.length ? '' : extractYoudaoTranslation(html)
  return { phonetic_uk: uk, phonetic_us: us, definitions, translation }
}
