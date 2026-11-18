import { describe, it, expect } from 'vitest'
import { buildDisplayParagraphs, buildWordRanges, resolveReadingWord, locateTtsWords, scrollToReaderHit, findWholeWordMatches } from '../selectionText'

// 构造一个段落片段：{ type, text, key, ...批注元数据 }
const seg = (text, type = 'text', extra = {}) => ({ type, text, key: `k-${text}`, start: 0, ...extra })
const textOf = (paragraphs) =>
  paragraphs
    .map((segments) => segments.map((s) => s.parts.map((p) => p.text).join('')).join(''))
    .join('\n')
const hitsOf = (paragraphs) =>
  paragraphs.flatMap((segments) =>
    segments.flatMap((s) => s.parts.filter((p) => p.hitIdx >= 0).map((p) => ({ text: p.text, hitIdx: p.hitIdx }))),
  )

describe('buildDisplayParagraphs（数据驱动正文高亮）', () => {
  it('单词命中多次：切成 parts 且文本可无损拼回', () => {
    const paragraphs = buildDisplayParagraphs(
      [[seg('The cat sat on the mat. The cat ran.')]],
      'cat',
    )
    expect(hitsOf(paragraphs)).toEqual([
      { text: 'cat', hitIdx: 0 },
      { text: 'cat', hitIdx: 1 },
    ])
    expect(textOf(paragraphs)).toBe('The cat sat on the mat. The cat ran.')
  })

  it('空关键词 / 无命中时只产生普通 parts', () => {
    const empty = buildDisplayParagraphs([[seg('hello world')]], '')
    expect(hitsOf(empty).length).toBe(0)
    expect(textOf(empty)).toBe('hello world')
    const none = buildDisplayParagraphs([[seg('hello world')]], 'xyz')
    expect(hitsOf(none).length).toBe(0)
    expect(textOf(none)).toBe('hello world')
  })

  it('匹配大小写不敏感', () => {
    const paragraphs = buildDisplayParagraphs([[seg('The CAT sat')]], 'cat')
    expect(hitsOf(paragraphs)).toEqual([{ text: 'CAT', hitIdx: 0 }])
  })

  it('命中跨 seg（含批注 seg）时共享 hitIdx 且批注元数据不丢', () => {
    const annotation = { id: 'a1', type: 'highlight', color: '#FFEB3B' }
    const paragraphs = buildDisplayParagraphs(
      [[seg('The '), seg('cat', 'annotation', { annotation, annotations: [annotation] }), seg(' sat on the mat')]],
      'cat sat',
    )
    // 命中短语跨 2 个 seg，被切成 2 个 part，但同属一次命中
    expect(hitsOf(paragraphs)).toEqual([
      { text: 'cat', hitIdx: 0 },
      { text: ' sat', hitIdx: 0 },
    ])
    expect(textOf(paragraphs)).toBe('The cat sat on the mat')
    // 纯函数：批注 seg 的元数据原样保留，Vue 照常渲染 .annotated 的 class/:style
    expect(paragraphs[0][1].annotation).toBe(annotation)
    expect(paragraphs[0][1].annotations).toEqual([annotation])
    // 命中所在 seg 标记 hasHit → ArticleReader 据此临时隐藏批注视觉
    expect(paragraphs[0].map((s) => s.hasHit)).toEqual([false, true, true])
  })

  it('hasHit 仅标记命中 seg；关键词清空后全部复位（批注视觉自动恢复）', () => {
    const annotation = { id: 'a1', type: 'highlight', color: '#FFEB3B' }
    const segs = [seg('The '), seg('cat', 'annotation', { annotation, annotations: [annotation] })]
    const hit = buildDisplayParagraphs([segs], 'cat')
    const cleared = buildDisplayParagraphs([segs], '')
    expect(hit[0].map((s) => s.hasHit)).toEqual([false, true])
    expect(cleared[0].every((s) => s.hasHit === false)).toBe(true)
    // 隐藏只是视觉层：批注元数据始终保留
    expect(hit[0][1].annotation).toBe(annotation)
    expect(cleared[0][1].annotation).toBe(annotation)
  })

  it('命中下标跨段落全局递增', () => {
    const paragraphs = buildDisplayParagraphs(
      [[seg('cat')], [seg('cat'), seg(' and cat')]],
      'cat',
    )
    expect(hitsOf(paragraphs).map((h) => h.hitIdx)).toEqual([0, 1, 2])
  })

  it('多词短语在逐词 seg 中命中时共享同一 hitIdx', () => {
    const paragraphs = buildDisplayParagraphs(
      [[seg('chaos'), seg(' in'), seg(' the'), seg(' years'), seg(' life.')]],
      'chaos in the years',
    )
    expect(hitsOf(paragraphs).length).toBe(4)
    expect(new Set(hitsOf(paragraphs).map((h) => h.hitIdx)).size).toBe(1)
    expect(textOf(paragraphs)).toBe('chaos in the years life.')
  })

  it('跨行关键词按换行拆段、裁掉首尾空白，mark 不包住 \\n', () => {
    const paragraphs = buildDisplayParagraphs([[seg('aa\n  bb cc')]], 'aa\n  bb')
    expect(hitsOf(paragraphs)).toEqual([
      { text: 'aa', hitIdx: 0 },
      { text: 'bb', hitIdx: 1 },
    ])
    hitsOf(paragraphs).forEach((h) => expect(h.text.includes('\n')).toBe(false))
    expect(textOf(paragraphs)).toBe('aa\n  bb cc')
  })
})

describe('buildWordRanges（朗读词切分）', () => {
  it('空格 / 换行 / 多空格切词，返回段落全文字符偏移', () => {
    expect(buildWordRanges('hello world')).toEqual([[0, 5], [6, 11]])
    expect(buildWordRanges('aa\n  bb')).toEqual([[0, 2], [5, 7]])
    expect(buildWordRanges('')).toEqual([])
  })

  it('破折号 / 连字符：连字符 - 算词内（整体），破折号 — / – 算边界（拆开）', () => {
    // idea—a 的 — 是 em dash（边界）→ 两个词；physical-format 的 - 是 ASCII 连字符（词内）→ 一个词
    expect(buildWordRanges('idea—a')).toEqual([[0, 4], [5, 6]])
    expect(buildWordRanges('physical-format')).toEqual([[0, 15]])
    expect(buildWordRanges('state-of-the-art')).toEqual([[0, 16]])
    expect(buildWordRanges('well–known and idea—a')).toEqual([
      [0, 4], [5, 10], [11, 14], [15, 19], [20, 21],
    ])
  })

  it('撇号算词内，标点不算词', () => {
    expect(buildWordRanges("don't stop")).toEqual([[0, 5], [6, 10]])
    expect(buildWordRanges('"heir" (heir)')).toEqual([[1, 5], [8, 12]])
  })

  it('纯数字与带括号数字都能成词（朗读数字不越界）', () => {
    expect(buildWordRanges('in 2015, the')).toEqual([[0, 2], [3, 7], [9, 12]])
    expect(buildWordRanges('(1957) and 2015')).toEqual([[1, 5], [7, 10], [11, 15]])
  })
})

describe('resolveReadingWord（朗读 boundary 定位，逐词独立高亮、数字不并词）', () => {
  // "In 2017 Mariah" 的词区间
  const ranges = [[0, 2], [3, 7], [8, 14]]

  it('每个词各自高亮：数字与前一 / 后一都不合并，不重复点亮', () => {
    expect(resolveReadingWord(ranges, 0, -1)).toEqual({ idx: 0, start: 0, end: 2 }) // In
    // 2017 自己发 boundary → 只高亮 2017，不并把 In 再点亮一次
    expect(resolveReadingWord(ranges, 3, 0)).toEqual({ idx: 1, start: 3, end: 7 }) // 2017
    expect(resolveReadingWord(ranges, 8, 1)).toEqual({ idx: 2, start: 8, end: 14 }) // Mariah
  })

  it('Hot 100：hot 与 100 各自亮，100 不并到 hot', () => {
    const r = [[0, 3], [4, 7]]
    expect(resolveReadingWord(r, 0, -1)).toEqual({ idx: 0, start: 0, end: 3 }) // Hot
    expect(resolveReadingWord(r, 4, 0)).toEqual({ idx: 1, start: 4, end: 7 }) // 100
  })

  it('charIndex 跳跃（TTS 漏发中间词）：直接采纳命中词，不往回补、不合并', () => {
    // since→its 跳跃，命中的是 its → 只亮 its；2015 因 TTS 未发事件而跳过（不伪造高亮）
    const r = [[0, 3], [4, 9], [10, 14], [15, 18]]
    expect(resolveReadingWord(r, 15, 1)).toEqual({ idx: 3, start: 15, end: 18 }) // 只 its
  })

  it('重复 / 回退事件返回 null，避免高亮倒退', () => {
    expect(resolveReadingWord(ranges, 0, 0)).toBe(null) // 命中 In 但已读过
    expect(resolveReadingWord(ranges, 0, 2)).toBe(null) // 回退到更早的词
  })

  it('charIndex 落在区间外（标点 / 词尾后）：找最近未读词', () => {
    expect(resolveReadingWord(ranges, 7, 0)).toEqual({ idx: 1, start: 3, end: 7 }) // 7 在 2017 词尾后，最近未读词是 2017
  })
})

describe('locateTtsWords（Edge TTS 词单元定位到段全文）', () => {
  const text = 'But since 2015 its evolving formula'
  // offset/duration 单位 100ns tick：10000 tick = 1ms
  const words = [
    { text: 'But', offset: 100000, duration: 500000 },
    { text: 'since 2015', offset: 1750000, duration: 15500000 }, // Edge 原生把数字并到前一词
    { text: 'its', offset: 20375000, duration: 1250000 },
    { text: 'evolving', offset: 22125000, duration: 5000000 },
  ]

  it('顺序定位词单元，含 "since 2015" 数字合并单元，并换算毫秒', () => {
    const got = locateTtsWords(words, text)
    expect(got.map((w) => [w.start, w.end])).toEqual([[0, 3], [4, 14], [15, 18], [19, 27]])
    expect(got[1].text).toBe('since 2015')
    expect(got[1].timeMs).toBe(175)
    expect(got[1].durMs).toBe(1550)
  })

  it('大小写 / 引号不敏感', () => {
    expect(locateTtsWords([{ text: 'DON’T', offset: 0, duration: 10000 }], "don't stop")[0]).toMatchObject({ start: 0, end: 5 })
  })

  it('startOffset 之后才定位（从选中处朗读）', () => {
    // 从 "its" 开始：20000000 tick=2000ms，词 "its" 在全文偏移 15
    expect(locateTtsWords([{ text: 'its', offset: 20000000, duration: 10000 }], text, 15)[0]).toMatchObject({ start: 15, end: 18, timeMs: 2000 })
  })

  it('找不到的词丢弃，不影响其它词', () => {
    const got = locateTtsWords([
      { text: 'But', offset: 0, duration: 1 },
      { text: 'ZZZ', offset: 1, duration: 1 },
      { text: 'since', offset: 2, duration: 1 },
    ], text)
    expect(got.map((w) => w.text)).toEqual(['But', 'since'])
  })
})

describe('scrollToReaderHit（只滚动，不改 class）', () => {
  const withMarks = () => {
    document.body.innerHTML =
      '<div class="reader-body"><p class="article-para">' +
      '<mark class="reader-hit" data-hit-index="0">cat</mark> ' +
      '<mark class="reader-hit" data-hit-index="1">cat</mark> ' +
      '<mark class="reader-hit" data-hit-index="2">cat</mark></p></div>'
    return document.querySelector('.reader-body')
  }

  it('滚动到第 k 个命中并支持取模循环', () => {
    const body = withMarks()
    // 无滚动容器时 fallback 到 scrollIntoView，返回 true
    expect(scrollToReaderHit(body, 0)).toBe(true)
    expect(scrollToReaderHit(body, 1)).toBe(true)
    expect(scrollToReaderHit(body, 5)).toBe(true) // 5 % 3 = 2，取模有效
  })

  it('不再增删 .reader-hit-current（由 Vue 依据 readerHit.index 渲染）', () => {
    const body = withMarks()
    const first = body.querySelector('mark.reader-hit')
    first.classList.add('reader-hit-current')
    scrollToReaderHit(body, 2)
    expect(first.classList.contains('reader-hit-current')).toBe(true)
    expect(body.querySelectorAll('mark.reader-hit-current').length).toBe(1)
  })

  it('无命中时返回 false', () => {
    document.body.innerHTML = '<div class="reader-body"><p>hello</p></div>'
    expect(scrollToReaderHit(document.querySelector('.reader-body'), 0)).toBe(false)
  })

  it('跨 seg 同一次命中的多个 mark 共享 data-hit-index，一起作为滚动锚点', () => {
    document.body.innerHTML =
      '<div class="reader-body"><p><mark class="reader-hit" data-hit-index="0">cat</mark>' +
      '<mark class="reader-hit" data-hit-index="0"> sat</mark> on the mat</p></div>'
    const body = document.querySelector('.reader-body')
    expect(body.querySelectorAll('mark.reader-hit').length).toBe(2)
    expect(scrollToReaderHit(body, 0)).toBe(true)
  })
})

describe('findWholeWordMatches（完整词边界匹配）', () => {
  it('heir 不命中 their，只命中独立的 heir', () => {
    expect(findWholeWordMatches('guns on their hips', 'heir')).toEqual([])
    expect(findWholeWordMatches('and presumed heir, has', 'heir')).toEqual([[13, 17]])
  })

  it('大小写不敏感，且返回全部非重叠命中', () => {
    expect(findWholeWordMatches('Heir and heir, their', 'heir')).toEqual([
      [0, 4],
      [9, 13],
    ])
  })

  it('标点 / 引号 / 连字符视为词边界，撇号视为词内', () => {
    expect(findWholeWordMatches('"heir" (heir)', 'heir')).toEqual([
      [1, 5],
      [8, 12],
    ])
    expect(findWholeWordMatches('well-known', 'well')).toEqual([[0, 4]])
    expect(findWholeWordMatches("heir's", 'heir')).toEqual([])
  })

  it('短语按整段首尾判定边界', () => {
    expect(findWholeWordMatches('presumed heir, has', 'presumed heir')).toEqual([[0, 13]])
    expect(findWholeWordMatches('their presumed heirs', 'presumed heir')).toEqual([])
  })

  it('空输入 / 无命中返回空数组', () => {
    expect(findWholeWordMatches('', 'heir')).toEqual([])
    expect(findWholeWordMatches('their', '')).toEqual([])
    expect(findWholeWordMatches('their hips', 'xyz')).toEqual([])
  })
})
