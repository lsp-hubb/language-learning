// 文件夹删除族（软删 / 恢复 / 永久删）的事务逻辑，从 index.js 抽出以便单测。
// conn 由调用方提供（需支持 beginTransaction / commit / rollback / release / query）。
// 所有查询都走同一个 conn：要么全部成功，要么整笔回滚。

// 递归收集所有子孙文件夹 ID；visited 防 parent_id 成环（正常建树不会成环，
// 但若数据异常出现环，这里直接跳过已访问节点，避免无限递归）。
export async function collectDescendantIds(parentId, conn, visited = new Set()) {
  if (visited.has(parentId)) return []
  visited.add(parentId)
  const [rows] = await conn.query('SELECT id FROM folders WHERE parent_id = ?', [parentId])
  const ids = []
  for (const row of rows) {
    if (visited.has(row.id)) continue
    ids.push(row.id, ...(await collectDescendantIds(row.id, conn, visited)))
  }
  return ids
}

// 收集指定文件夹列表下的所有文章 ID
export async function collectArticleIdsInFolders(folderIds, conn) {
  if (!folderIds.length) return []
  const placeholders = folderIds.map(() => '?').join(',')
  const [rows] = await conn.query(`SELECT id FROM articles WHERE folder_id IN (${placeholders})`, folderIds)
  return rows.map((r) => r.id)
}

// root 防护：三处路由共用，返回 400 消息或 null
export function guardRoot(folderId, action) {
  if (folderId === 'root') return `根目录不可${action}`
  return null
}

// 移入回收站：整棵子树 + 其下文章一起打 deleted_at。返回 affected 计数供提示/测试。
export async function softDeleteFolder(folderId, conn) {
  const folderIds = [...(await collectDescendantIds(folderId, conn)), folderId]
  const fPlaceholders = folderIds.map(() => '?').join(',')
  await conn.query(`UPDATE folders SET deleted_at = NOW() WHERE id IN (${fPlaceholders})`, folderIds)
  const articleIds = await collectArticleIdsInFolders(folderIds, conn)
  if (articleIds.length > 0) {
    const aPlaceholders = articleIds.map(() => '?').join(',')
    await conn.query(`UPDATE articles SET deleted_at = NOW() WHERE id IN (${aPlaceholders})`, articleIds)
  }
  return { folderIds, articleIds }
}

// 从回收站恢复：把 deleted_at 置 NULL（对非回收站文件夹调用也幂等，但语义上应由路由校验状态）。
export async function restoreFolder(folderId, conn) {
  const folderIds = [...(await collectDescendantIds(folderId, conn)), folderId]
  const fPlaceholders = folderIds.map(() => '?').join(',')
  await conn.query(`UPDATE folders SET deleted_at = NULL WHERE id IN (${fPlaceholders})`, folderIds)
  const articleIds = await collectArticleIdsInFolders(folderIds, conn)
  if (articleIds.length > 0) {
    const aPlaceholders = articleIds.map(() => '?').join(',')
    await conn.query(`UPDATE articles SET deleted_at = NULL WHERE id IN (${aPlaceholders})`, articleIds)
  }
  return { folderIds, articleIds }
}

// 永久删除：先手工清 canvas_strokes（无外键），再删 articles（cascade 批注/收藏），最后删文件夹。
// 返回 articleIds 供调用方在【事务提交后】触发 TTS 缓存清理。
export async function forceDeleteFolder(folderId, conn) {
  const folderIds = [...(await collectDescendantIds(folderId, conn)), folderId]
  const articleIds = await collectArticleIdsInFolders(folderIds, conn)
  if (articleIds.length > 0) {
    const aPlaceholders = articleIds.map(() => '?').join(',')
    await conn.query(`DELETE FROM canvas_strokes WHERE article_id IN (${aPlaceholders})`, articleIds)
    await conn.query(`DELETE FROM articles WHERE id IN (${aPlaceholders})`, articleIds)
  }
  const fPlaceholders = folderIds.map(() => '?').join(',')
  await conn.query(`DELETE FROM folders WHERE id IN (${fPlaceholders})`, folderIds)
  return { folderIds, articleIds }
}

// 事务执行器：统一 getConnection → begin → fn(conn) → commit / rollback → release
export async function withTransaction(pool, fn) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}
