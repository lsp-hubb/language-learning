// 判断某个文件夹是否位于「考研英语」目录下（祖先链任意一层命中即生效，含其子目录）
// 与后端 server/index.js 的 resolveExamType()、脚本 scripts/reimport_all.cjs 的
// isKaoyanFolder() 保持同一规则：名称精确匹配「考研英语」。

export const KAOYAN_ROOT_NAME = '考研英语'

/**
 * @param {Object} folders id → { id, name, parentId }（store.folders 的结构）
 * @param {string} folderId 当前文件夹 id（根目录为 'root'）
 * @returns {boolean}
 */
export function isKaoyanFolder(folders, folderId) {
  if (!folderId || folderId === 'root' || !folders) return false
  let cur = folders[folderId]
  let guard = 0
  while (cur && guard++ < 50) {
    if (String(cur.name || '').trim() === KAOYAN_ROOT_NAME) return true
    cur = cur.parentId ? folders[cur.parentId] : null
  }
  return false
}
