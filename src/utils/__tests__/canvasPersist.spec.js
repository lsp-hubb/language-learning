import { describe, it, expect, vi } from 'vitest'
import { createStrokeWriter, mergeLoadedStrokes } from '../canvasPersist'

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('createStrokeWriter', () => {
  it('每笔变更立即发起写入，无防抖等待', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const writer = createStrokeWriter({ save })
    writer.commit('a1', [{ x: 1 }])
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('a1', [{ x: 1 }])
    await writer.flush()
  })

  it('串行写入：旧请求未完成时新请求排队，最终顺序与提交顺序一致', async () => {
    const order = []
    let releaseFirst
    const save = vi.fn((id, strokes) => {
      order.push(strokes[0].n)
      if (strokes[0].n === 1) return new Promise((r) => { releaseFirst = r })
      return Promise.resolve()
    })
    const writer = createStrokeWriter({ save })
    writer.commit('a1', [{ n: 1 }])
    writer.commit('a1', [{ n: 2 }])
    writer.commit('a1', [{ n: 3 }])
    expect(order).toEqual([1]) // 串行：后两笔未提前并发
    releaseFirst()
    await writer.flush()
    expect(order).toEqual([1, 2, 3])
  })

  it('commit 冻结 articleId：切文章后旧请求仍写原文章', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const writer = createStrokeWriter({ save })
    writer.commit('old', [{ x: 1 }])
    // 模拟随后 articleId 变为 new，但写入器已捕获旧值
    await writer.flush()
    expect(save).toHaveBeenCalledWith('old', [{ x: 1 }])
    expect(save.mock.calls.every(([id]) => id === 'old')).toBe(true)
  })

  it('commit 冻结快照：提交后再修改原数组不影响已入队数据', async () => {
    let release
    const save = vi.fn(() => new Promise((r) => { release = r }))
    const writer = createStrokeWriter({ save })
    const strokes = [{ x: 1 }]
    writer.commit('a1', strokes)
    strokes.push({ x: 2 })
    release()
    await writer.flush()
    expect(save).toHaveBeenCalledWith('a1', [{ x: 1 }])
  })

  it('失败按退避重试，成功后清除未落库快照', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(undefined)
    const onError = vi.fn()
    const writer = createStrokeWriter({ save, onError, sleep: () => Promise.resolve() })
    writer.commit('a1', [{ x: 1 }])
    await writer.flush()
    expect(save).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
    expect(writer.pending()).toBeNull()
  })

  it('重试耗尽后回调 onError 并保留 pending 供兜底投递', async () => {
    const save = vi.fn().mockRejectedValue(new Error('down'))
    const onError = vi.fn()
    const writer = createStrokeWriter({
      save, onError, maxRetries: 1, sleep: () => Promise.resolve(),
    })
    writer.commit('a1', [{ x: 9 }])
    await writer.flush()
    expect(save).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(writer.pending()).toEqual({ articleId: 'a1', strokes: [{ x: 9 }] })
  })

  it('后续成功写入会覆盖旧的失败快照', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(undefined)
    const writer = createStrokeWriter({
      save, maxRetries: 0, sleep: () => Promise.resolve(),
    })
    writer.commit('a1', [{ x: 1 }])
    await writer.flush()
    expect(writer.pending()).not.toBeNull()
    writer.commit('a1', [{ x: 1 }, { x: 2 }])
    await writer.flush()
    expect(writer.pending()).toBeNull()
    expect(save).toHaveBeenLastCalledWith('a1', [{ x: 1 }, { x: 2 }])
  })

  it('忽略空 articleId / default', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const writer = createStrokeWriter({ save })
    writer.commit('', [{ x: 1 }])
    writer.commit('default', [{ x: 1 }])
    await writer.flush()
    expect(save).not.toHaveBeenCalled()
    expect(writer.pending()).toBeNull()
  })

  it('模拟连续跳转：旧文章写入完成后才允许加载结果落地，快照始终指向原文章', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const writer = createStrokeWriter({ save })
    writer.commit('articleA', [{ x: 1 }])
    writer.commit('articleA', [{ x: 1 }, { x: 2 }])
    await writer.flush()
    // 切到 articleB 前应已全部落库，且没有任何一次写到 articleB
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls.every(([id]) => id === 'articleA')).toBe(true)
    expect(writer.pending()).toBeNull()
  })

  it('flush 在全部写入结束前不提前 resolve', async () => {
    let release
    const save = vi.fn(() => new Promise((r) => { release = r }))
    const writer = createStrokeWriter({ save })
    writer.commit('a1', [{ x: 1 }])
    let done = false
    const flushed = writer.flush().then(() => { done = true })
    await tick()
    expect(done).toBe(false)
    release()
    await flushed
    expect(done).toBe(true)
  })
})

describe('mergeLoadedStrokes', () => {
  it('无本地新笔迹时返回加载结果的副本', () => {
    const loaded = [{ x: 1 }]
    const merged = mergeLoadedStrokes(loaded, [])
    expect(merged).toEqual([{ x: 1 }])
    expect(merged).not.toBe(loaded)
  })

  it('加载在途期间画的新笔迹追加在后，不丢服务端已有笔迹', () => {
    expect(mergeLoadedStrokes([{ x: 1 }], [{ x: 2 }])).toEqual([{ x: 1 }, { x: 2 }])
  })

  it('非数组入参按空数组处理', () => {
    expect(mergeLoadedStrokes(null, undefined)).toEqual([])
  })
})
