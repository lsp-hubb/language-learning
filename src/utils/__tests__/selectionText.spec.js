import { describe, it, expect } from 'vitest'
import { highlightMatchesInReader, scrollToReaderHit } from '../selectionText'

describe('highlightMatchesInReader', () => {
  it('在单个文本节点中高亮所有命中词', () => {
    document.body.innerHTML = '<div class="reader-body"><p class="article-para">The cat sat on the mat. The cat ran.</p></div>'
    const body = document.querySelector('.reader-body')
    const hits = highlightMatchesInReader(body, 'cat')
    expect(hits.length).toBe(2)
    expect(body.querySelectorAll('mark.reader-hit').length).toBe(2)
    // 还原后文本不变
    body.querySelectorAll('mark.reader-hit').forEach((m) => {
      const t = document.createTextNode(m.textContent)
      m.parentNode.replaceChild(t, m)
    })
    expect(body.textContent).toBe('The cat sat on the mat. The cat ran.')
  })

  it('命中词在节点中间仍能正确拆分', () => {
    document.body.innerHTML = '<div class="reader-body"><p class="article-para">abcabcabc</p></div>'
    const body = document.querySelector('.reader-body')
    const hits = highlightMatchesInReader(body, 'abc')
    expect(hits.length).toBe(3)
  })

  it('无命中时返回空数组', () => {
    document.body.innerHTML = '<div class="reader-body"><p class="article-para">hello world</p></div>'
    const body = document.querySelector('.reader-body')
    const hits = highlightMatchesInReader(body, 'xyz')
    expect(hits.length).toBe(0)
    expect(body.querySelectorAll('mark.reader-hit').length).toBe(0)
  })

  it('二次调用会清除上一次高亮', () => {
    document.body.innerHTML = '<div class="reader-body"><p class="article-para">apple apple</p></div>'
    const body = document.querySelector('.reader-body')
    highlightMatchesInReader(body, 'apple')
    expect(body.querySelectorAll('mark.reader-hit').length).toBe(2)
    highlightMatchesInReader(body, 'apple')
    expect(body.querySelectorAll('mark.reader-hit').length).toBe(2)
  })

  it('命中词跨多个文本节点（批注拆分）时能分别高亮', () => {
    document.body.innerHTML =
      '<div class="reader-body"><p class="article-para">The <span class="annotated">quick</span> brown fox</p></div>'
    const body = document.querySelector('.reader-body')
    const hits = highlightMatchesInReader(body, 'quick')
    expect(hits.length).toBe(1)
  })

  it('多词短语横跨两个相邻 span（批注切词）时能跨节点匹配', () => {
    document.body.innerHTML =
      '<div class="reader-body"><p class="article-para">The <span class="annotated">cat</span> <span class="annotated">sat</span> on the mat</p></div>'
    const body = document.querySelector('.reader-body')
    const hits = highlightMatchesInReader(body, 'cat sat')
    // 命中 "cat sat" 横跨 3 个文本节点（cat / 空格 / sat），各被包一个 mark
    expect(hits.length).toBe(3)
    expect(body.querySelectorAll('mark.reader-hit').length).toBe(3)
    expect(body.textContent).toBe('The cat sat on the mat')
  })

  it('多词短语横跨 span 与普通文本节点时能匹配', () => {
    document.body.innerHTML =
      '<div class="reader-body"><p class="article-para">The <span class="annotated">cat</span> sat on the mat</p></div>'
    const body = document.querySelector('.reader-body')
    const hits = highlightMatchesInReader(body, 'cat sat')
    expect(hits.length).toBe(2)
    expect(body.textContent).toBe('The cat sat on the mat')
  })

  it('短语命中多次且横跨节点', () => {
    document.body.innerHTML =
      '<div class="reader-body"><p class="article-para"><span>quick</span> brown <span>quick</span> brown</p></div>'
    const body = document.querySelector('.reader-body')
    const hits = highlightMatchesInReader(body, 'quick brown')
    expect(hits.length).toBe(4) // 每次命中拆成 quick + brown 两个 mark
    expect(body.querySelectorAll('mark.reader-hit').length).toBe(4)
  })

  it('传空关键词时仅清除旧高亮，不产生新 mark', () => {
    document.body.innerHTML =
      '<div class="reader-body"><p class="article-para">The cat sat on the mat</p></div>'
    const body = document.querySelector('.reader-body')
    highlightMatchesInReader(body, 'cat')
    expect(body.querySelectorAll('mark.reader-hit').length).toBe(1)
    const hits = highlightMatchesInReader(body, '')
    expect(hits.length).toBe(0)
    expect(body.querySelectorAll('mark.reader-hit').length).toBe(0)
    expect(body.textContent).toBe('The cat sat on the mat')
  })
})

describe('scrollToReaderHit', () => {
  it('滚动到第 k 个命中并支持取模循环', () => {
    document.body.innerHTML =
      '<div class="reader-body"><p class="article-para">cat cat cat</p></div>'
    const body = document.querySelector('.reader-body')
    highlightMatchesInReader(body, 'cat')
    expect(body.querySelectorAll('mark.reader-hit').length).toBe(3)
    // 无滚动容器时 fallback 到 scrollIntoView，返回 true
    expect(scrollToReaderHit(body, 0)).toBe(true)
    expect(scrollToReaderHit(body, 1)).toBe(true)
    expect(scrollToReaderHit(body, 5)).toBe(true) // 5 % 3 = 2，取模有效
  })

  it('定位到的当前命中被标记 reader-hit-current，其他命中移除', () => {
    document.body.innerHTML =
      '<div class="reader-body"><p class="article-para">cat cat cat</p></div>'
    const body = document.querySelector('.reader-body')
    highlightMatchesInReader(body, 'cat')
    const marks = () => Array.from(body.querySelectorAll('mark.reader-hit'))

    // 定位到第 0 个：第 0 个为 current，其他不是
    scrollToReaderHit(body, 0)
    expect(marks()[0].classList.contains('reader-hit-current')).toBe(true)
    expect(marks()[1].classList.contains('reader-hit-current')).toBe(false)
    expect(marks()[2].classList.contains('reader-hit-current')).toBe(false)

    // 定位到第 1 个：current 转移到第 1 个
    scrollToReaderHit(body, 1)
    expect(marks()[0].classList.contains('reader-hit-current')).toBe(false)
    expect(marks()[1].classList.contains('reader-hit-current')).toBe(true)
    expect(marks()[2].classList.contains('reader-hit-current')).toBe(false)
  })

  it('无命中时返回 false', () => {
    document.body.innerHTML = '<div class="reader-body"><p>hello</p></div>'
    const body = document.querySelector('.reader-body')
    expect(scrollToReaderHit(body, 0)).toBe(false)
  })

  it('跨节点短语同一命中的所有 mark 共享 data-hit-index 且一起变深蓝', () => {
    document.body.innerHTML =
      '<div class="reader-body"><p class="article-para"><span>cat</span> <span>sat</span> on the mat</p></div>'
    const body = document.querySelector('.reader-body')
    // "cat sat" 命中跨 cat / 空格 / sat 三个文本节点，被拆成 3 个 mark，同属一个命中
    highlightMatchesInReader(body, 'cat sat')
    const marks = Array.from(body.querySelectorAll('mark.reader-hit'))
    expect(marks.length).toBe(3)
    const indexes = marks.map((m) => Number(m.getAttribute('data-hit-index')))
    expect(indexes).toEqual([0, 0, 0]) // 同属命中 0

    // 定位到第 0 个命中：整个短语的 3 个 mark 都应一起变深蓝
    scrollToReaderHit(body, 0)
    marks.forEach((m) => {
      expect(m.classList.contains('reader-hit-current')).toBe(true)
    })
  })
})
