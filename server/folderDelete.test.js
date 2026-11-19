import { describe, it, expect } from 'vitest'
import {
  collectDescendantIds,
  collectArticleIdsInFolders,
  guardRoot,
  softDeleteFolder,
  restoreFolder,
  forceDeleteFolder,
  withTransaction,
} from './folderDelete.js'

// 轻量 conn mock：按 SQL 前缀返回预设行，并记录所有 query 调用
function mockConn({ children = {}, articles = {} } = {}) {
  const calls = []
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params })
      if (sql.startsWith('SELECT id FROM folders WHERE parent_id')) {
        return [(children[params[0]] || []).map((id) => ({ id }))]
      }
      if (sql.startsWith('SELECT id FROM articles WHERE folder_id')) {
        const ids = params.flatMap((id) => articles[id] || [])
        return [ids.map((id) => ({ id }))]
      }
      return [[]]
    },
  }
}

describe('guardRoot', () => {
  it('root 返回对应动作的错误文案，普通 id 返回 null', () => {
    expect(guardRoot('root', '删除')).toBe('根目录不可删除')
    expect(guardRoot('root', '永久删除')).toBe('根目录不可永久删除')
    expect(guardRoot('f1', '删除')).toBeNull()
  })
})

describe('collectDescendantIds', () => {
  it('递归收集整棵子树（含多层）', async () => {
    const conn = mockConn({ children: { f1: ['f2', 'f3'], f2: ['f4'], f3: [], f4: [] } })
    expect((await collectDescendantIds('f1', conn)).sort()).toEqual(['f2', 'f3', 'f4'])
  })

  it('parent_id 成环时不会无限递归，且每个节点只出现一次', async () => {
    const conn = mockConn({ children: { f1: ['f2'], f2: ['f1'] } })
    expect(await collectDescendantIds('f1', conn)).toEqual(['f2'])
  })

  it('叶子节点返回空数组', async () => {
    expect(await collectDescendantIds('leaf', mockConn())).toEqual([])
  })
})

describe('collectArticleIdsInFolders', () => {
  it('空列表直接返回空，不查库', async () => {
    const conn = mockConn()
    expect(await collectArticleIdsInFolders([], conn)).toEqual([])
    expect(conn.calls).toHaveLength(0)
  })

  it('按 folderIds 批量查询并去重展开', async () => {
    const conn = mockConn({ articles: { f1: ['a1', 'a2'], f2: ['a2', 'a3'] } })
    expect((await collectArticleIdsInFolders(['f1', 'f2'], conn)).sort()).toEqual(['a1', 'a2', 'a2', 'a3'])
  })
})

describe('softDeleteFolder / restoreFolder', () => {
  const opts = { children: { f1: ['f2'] }, articles: { f1: ['a1'], f2: ['a2'] } }

  it('软删：整棵子树 + 其下文章全部打 NOW()', async () => {
    const conn = mockConn(opts)
    const { folderIds, articleIds } = await softDeleteFolder('f1', conn)
    expect(folderIds).toEqual(['f2', 'f1'])
    expect(articleIds.sort()).toEqual(['a1', 'a2'])
    const updates = conn.calls.filter((c) => c.sql.includes('UPDATE'))
    expect(updates).toHaveLength(2)
    expect(updates[0].sql).toContain('folders SET deleted_at = NOW()')
    expect(updates[1].sql).toContain('articles SET deleted_at = NOW()')
  })

  it('恢复：整棵子树 + 文章 deleted_at 置 NULL', async () => {
    const conn = mockConn(opts)
    await restoreFolder('f1', conn)
    const updates = conn.calls.filter((c) => c.sql.includes('UPDATE'))
    expect(updates).toHaveLength(2)
    expect(updates[0].sql).toContain('folders SET deleted_at = NULL')
    expect(updates[1].sql).toContain('articles SET deleted_at = NULL')
  })

  it('子树无文章时只发文件夹 UPDATE', async () => {
    const conn = mockConn({ children: { f1: ['f2'] } })
    await softDeleteFolder('f1', conn)
    expect(conn.calls.filter((c) => c.sql.includes('UPDATE'))).toHaveLength(1)
  })
})

describe('forceDeleteFolder', () => {
  it('先清 canvas_strokes 再删 articles 最后删 folders', async () => {
    const conn = mockConn({ children: { f1: ['f2'] }, articles: { f1: ['a1'], f2: ['a2'] } })
    const { articleIds } = await forceDeleteFolder('f1', conn)
    expect(articleIds.sort()).toEqual(['a1', 'a2'])
    const dels = conn.calls.filter((c) => c.sql.startsWith('DELETE'))
    expect(dels).toHaveLength(3)
    expect(dels[0].sql).toBe('DELETE FROM canvas_strokes WHERE article_id IN (?,?)')
    expect(dels[1].sql).toBe('DELETE FROM articles WHERE id IN (?,?)')
    expect(dels[2].sql).toBe('DELETE FROM folders WHERE id IN (?,?)')
  })

  it('无文章时跳过 canvas/articles，只删文件夹', async () => {
    const conn = mockConn({ children: { f1: ['f2'] } })
    await forceDeleteFolder('f1', conn)
    const dels = conn.calls.filter((c) => c.sql.startsWith('DELETE'))
    expect(dels).toHaveLength(1)
    expect(dels[0].sql).toContain('DELETE FROM folders')
  })
})

describe('withTransaction', () => {
  it('成功时 commit 并 release', async () => {
    const conn = { beginTransaction: async () => {}, commit: async () => { conn.committed = true }, rollback: async () => {}, release: () => { conn.released = true } }
    const pool = { getConnection: async () => conn }
    expect(await withTransaction(pool, async () => 42)).toBe(42)
    expect(conn.committed).toBe(true)
    expect(conn.released).toBe(true)
  })

  it('异常时 rollback + release，且原错误上抛', async () => {
    const conn = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => { conn.rolledBack = true }, release: () => { conn.released = true } }
    const pool = { getConnection: async () => conn }
    await expect(withTransaction(pool, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(conn.rolledBack).toBe(true)
    expect(conn.released).toBe(true)
  })
})
