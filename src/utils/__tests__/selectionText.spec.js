import { describe, it, expect } from 'vitest'
import { buildDisplayParagraphs, scrollToReaderHit } from '../selectionText'

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
