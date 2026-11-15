import { describe, it, expect } from 'vitest'
import {
  LONG_QUERY_WORDS,
  isLongQuery,
  normalizeLookupText,
  isValidLookupWord,
  lookupErrorMessage,
} from '../wordQuery'

describe('normalizeLookupText', () => {
  it('合并换行、去首尾标点、转小写', () => {
    expect(normalizeLookupText('  Hello,\n世界！')).toBe('hello, 世界')
  })
  it('纯英文短句归一化', () => {
    expect(normalizeLookupText('"Hello world."')).toBe('hello world')
  })
  it('排除路径 / 扩展名 / 纯数字 / 无字母', () => {
    expect(normalizeLookupText('src/utils/a.png')).toBe('')
    expect(normalizeLookupText('config.json')).toBe('')
    expect(normalizeLookupText('12345')).toBe('')
    expect(normalizeLookupText('！！！')).toBe('')
    expect(normalizeLookupText('a')).toBe('') // 需含 2 个以上连续字母
  })
})

describe('isLongQuery / LONG_QUERY_WORDS', () => {
  it('阈值为 5，超过才判长句', () => {
    expect(LONG_QUERY_WORDS).toBe(5)
    expect(isLongQuery('one two three four five')).toBe(false)
    expect(isLongQuery('one two three four five six')).toBe(true)
  })
})

describe('isValidLookupWord', () => {
  it('与后端口径一致：含字母、长度合理', () => {
    expect(isValidLookupWord('hello')).toBe(true)
    expect(isValidLookupWord("don't stop")).toBe(true)
    expect(isValidLookupWord('')).toBe(false)
    expect(isValidLookupWord('a'.repeat(51))).toBe(false)
    expect(isValidLookupWord('123')).toBe(false)
  })
})

describe('lookupErrorMessage', () => {
  it('把英文/技术错误映射为中文文案', () => {
    expect(lookupErrorMessage({ message: 'fetch failed' })).toBe('词典服务连接失败，请稍后重试')
    expect(lookupErrorMessage({ message: 'ECONNRESET' })).toBe('词典服务连接失败，请稍后重试')
    expect(lookupErrorMessage({ name: 'AbortError' })).toBe('查询已取消')
    expect(lookupErrorMessage({ message: '无效的查询内容' })).toBe('查询内容无效')
    expect(lookupErrorMessage({})).toBe('查询失败，请稍后重试')
  })
})
