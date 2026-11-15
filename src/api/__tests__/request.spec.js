import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { lookupWord } from '../index'

describe('request 错误体兼容', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('非 2xx + {error} 时抛出 error 文案（兼容后端旧错误体）', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: '无效的查询内容' }),
    })
    await expect(lookupWord('!!')).rejects.toThrow('无效的查询内容')
  })

  it('非 2xx + {message} 时抛出 message 文案', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ message: '词典服务暂时不可用' }),
    })
    await expect(lookupWord('hello')).rejects.toThrow('词典服务暂时不可用')
  })

  it('成功响应返回数据', async () => {
    const data = { word: 'hello', definitions: [] }
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => data })
    await expect(lookupWord('hello')).resolves.toEqual(data)
  })
})
