import { describe, it, expect } from 'vitest'
import {
  decodeHtmlEntities,
  extractYoudaoPhonetic,
  extractYoudaoDefs,
  extractYoudaoTranslation,
  parseYoudaoResult,
} from './youdaoParser.js'

describe('decodeHtmlEntities', () => {
  it('解码 HTML 实体（&lt; / &gt; / &amp; / 数字实体）', () => {
    expect(decodeHtmlEntities('&lt;非正式&gt;')).toBe('<非正式>')
    expect(decodeHtmlEntities('&lt;美&gt; &amp; &quot;x&quot;')).toBe('<美> & "x"')
    expect(decodeHtmlEntities('&#60;tag&#62; &#x3C;')).toBe('<tag> <')
  })
  it('未知实体原样保留', () => {
    expect(decodeHtmlEntities('&notanentity;')).toBe('&notanentity;')
  })
})

describe('extractYoudaoPhonetic', () => {
  it('剥掉斜杠内侧空格 "/ həˈləʊ /" → "/həˈləʊ/"', () => {
    const html = `<div class="phone_con">
      <div class="per-phone"><span>英</span><span class="phonetic">/ həˈləʊ /</span></div>
      <div class="per-phone"><span>美</span><span class="phonetic">/ ˈloʊ /</span></div>
    </div>`
    expect(extractYoudaoPhonetic(html)).toEqual({ uk: '/həˈləʊ/', us: '/ˈloʊ/' })
  })
  it('备选方案同样去掉内侧空格', () => {
    const html = `<span class="phonetic">/ həˈləʊ /</span><span class="phonetic">/ həˈloʊ /</span>`
    expect(extractYoudaoPhonetic(html)).toEqual({ uk: '/həˈləʊ/', us: '/həˈloʊ/' })
  })
})

describe('extractYoudaoDefs', () => {
  it('解码释义与词性中的实体', () => {
    const html = `<li class="word-exp"><span class="pos">&lt;非正式&gt;</span><span class="trans">&lt;口&gt; 你好</span></li>`
    expect(extractYoudaoDefs(html)).toEqual([
      { part_of_speech: '<非正式>', translation: '<口> 你好' },
    ])
  })
})

describe('extractYoudaoTranslation', () => {
  it('去标签并解码实体', () => {
    const html = `<p class="trans-content">&lt;书&gt;<b>你好</b> &lt;/书&gt;</p>`
    expect(extractYoudaoTranslation(html)).toBe('<书>你好 </书>')
  })
})

describe('parseYoudaoResult', () => {
  it('有释义时不产出 translation', () => {
    const html = `<div class="phone_con"><div class="per-phone"><span>英</span><span class="phonetic">/həˈləʊ/</span></div></div>
      <li class="word-exp"><span class="pos">n.</span><span class="trans">你好</span></li>
      <p class="trans-content">段落翻译</p>`
    const r = parseYoudaoResult(html)
    expect(r.phonetic_uk).toBe('/həˈləʊ/')
    expect(r.definitions).toEqual([{ part_of_speech: 'n.', translation: '你好' }])
    expect(r.translation).toBe('')
  })
  it('无释义时回退段落翻译', () => {
    const r = parseYoudaoResult('<p class="trans-content">段落翻译</p>')
    expect(r.definitions).toEqual([])
    expect(r.translation).toBe('段落翻译')
  })
})
