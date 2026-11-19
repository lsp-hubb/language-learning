# 回收站功能

> 开发记录文档 — 2026-06-20 实施；2026-11-19 补齐交互边界、实现约束与已知问题

---

## 背景

原删除功能为**硬删除**（直接从 MySQL DELETE），文件夹和文章删除后无法恢复。为防范误删，改为**软删除**实现回收站机制。

## 设计思路

使用 `deleted_at` 时间戳标记实现软删除：

| 状态 | `deleted_at` 值 | 含义 |
|------|----------------|------|
| 正常 | `NULL` | 文件夹/文章可见 |
| 回收站 | `TIMESTAMP` | 已被删除，移入回收站 |

操作分离为三级：

```
删除（移入回收站） → 回收站视图 → ♻️ 恢复（还原）
                                → 🗑️ 永久删除（不可逆）
```

只有**文件夹**走这套回收站流程。单篇文章的删除是**硬删除**（`DELETE /api/articles/:id`，直接删行 + 手工清笔迹 + 触发 TTS 缓存清理），不进回收站、不可恢复——`ArticleCard.vue` 上「删除后可在回收站恢复」的文案与此不符，以本说明为准。

### 交互与能力边界

| 操作 | 入口 | 确认方式 | 成功反馈 | 级联范围 |
|------|------|----------|----------|----------|
| 移入回收站 | 右键文件夹 →「删除」（root 不显示该项） | `askConfirm` 危险确认框（红色按钮） | `notifySuccess('文件夹已移入回收站')` | 自身 + 所有子孙文件夹 + 其下全部文章，一起打 `deleted_at` |
| 恢复 | 回收站面板文件夹行「♻️ 恢复」 | **无二次确认** | `notifySuccess('已恢复「X」及其子目录')` | 后端递归恢复整棵子树 + 其下文章 |
| 永久删除 | 回收站面板文件夹行「🗑️ 永久删除」 | `askConfirm` 危险确认框 | `notifySuccess('已永久删除「X」及其子目录')` | 后端递归删整棵子树 + 文章（cascade 批注 / 收藏）+ 笔迹 |
| 文章恢复 / 单删 | 回收站文章行**只读**，仅提示「恢复文件夹即可恢复文章」 | — | — | 不提供文章级操作 |

**当前不具备**（勿按常规文件管理器预期）：

- 无批量选择 / 多选删除 / 批量恢复（文件夹树 `selected` 只是当前目录单一高亮）。
- 无「清空回收站」路由与按钮；回收站内容不会自动过期，只能逐文件夹恢复或永久删除。
- 无文件夹 Delete / Backspace 快捷键（`README.md` 快捷键表中的 Delete 是删批注）。
- 无键盘操作回收站条目，全部靠鼠标点击面板按钮。
- 右键菜单无回收站专属项：进入回收站靠树底部入口或工具栏按钮，操作只在面板行内。

---

## 数据库变更

### `folders` 表

```sql
ALTER TABLE folders ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL;
```

### `articles` 表

```sql
ALTER TABLE articles ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL;
```

迁移在 `POST /api/init` 中自动执行，通过 try/catch 忽略重复添加。

---

## 后端 API

### 新增接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/trash` | 获取回收站所有已删除文件夹和文章 |
| `POST` | `/api/folders/:id/restore` | 从回收站恢复文件夹及其所有子文件和文章 |
| `DELETE` | `/api/folders/:id/force` | 永久删除（含文件夹、文章，cascade 删批注/收藏） |

### 修改接口

| 方法 | 路径 | 改动 |
|------|------|------|
| `DELETE` | `/api/folders/:id` | 原硬删除 → 软删除（设置 `deleted_at = NOW()`） |
| `GET` | `/api/folders` | 新增 `WHERE deleted_at IS NULL` 过滤 |

> ⚠️ 只有文件夹列表接口过滤了 `deleted_at`：`GET /api/articles/:folderId`、`GET /api/article/:id`、
> `GET /api/favorites` 均未过滤，软删文章仍可由 API 取到（前端靠本地缓存隐藏）。
> ✅ 永久删除会**先手工 `DELETE FROM canvas_strokes`**（`canvas_strokes` 无外键，单篇删除接口也这么做），再删 articles / folders，不留孤儿笔迹行。

### 实现结构

三个删除族路由的核心逻辑已抽到 `server/folderDelete.js`（便于单测），`server/index.js` 只保留 HTTP 响应：

| 导出函数 | 作用 |
|----------|------|
| `guardRoot(folderId, action)` | root 防护，返回 400 文案或 `null`；**后端也挡 root**（不再只靠前端菜单） |
| `collectDescendantIds(parentId, conn, visited)` | 递归收集子孙；`visited` **防 `parent_id` 成环**，每个节点只出现一次 |
| `collectArticleIdsInFolders(folderIds, conn)` | 批量收集文章 ID |
| `softDeleteFolder` / `restoreFolder` / `forceDeleteFolder` | 三种操作的 SQL 序列，全部走传入的 `conn` |
| `withTransaction(pool, fn)` | 统一 `getConnection → begin → fn → commit / rollback → release`，**三个路由都在事务内**，多步 UPDATE / DELETE 原子化 |

其他要点：

- 递归仍是逐层 `SELECT`（N+1），但已复用事务连接、无环风险；深层级性能可接受（正常建树无环）。
- 成功响应 `{ status:'ok', message }`，失败 `500 { status:'error', message }`，无逐项失败明细。
- **无「是否已软删」状态校验**：对非回收站文件夹调 restore 会把整棵子树 `deleted_at` 置 NULL（幂等，语义略越界）；重复软删也无副作用（重复打 NOW()）。
- 永久删除触发 `cleanupUnusedTtsCache('folder-force-delete')` **仅在 `articleIds.length > 0` 且事务提交后**；软删 / 恢复不触发（原因见下）。
- 单测 `server/folderDelete.test.js` 13 项覆盖：root 防护、多层递归、成环保护、三种操作的 SQL 顺序（含笔迹清理优先）、事务提交 / 回滚。

> **TTS 缓存清理的四个触发点**（`server/index.js:1318` 启动、`:397` 文章正文真变、`:507` 文章硬删、`:278` 文件夹永久删）：`collectLiveTtsKeys()` 读的是 `SELECT content FROM articles` **含回收站文章**，所以软删不会让音频被清掉；恢复后立即可用。只有真正从库里删掉的文章，其无引用缓存文件才会被异步清理。详见 `markdown/DISK_INTERFACES.md §3.2`。

### 核心逻辑

```js
// server/folderDelete.js（核心逻辑，可单测）
app.delete('/api/folders/:id', async (req, res) => {
  if (guardRoot(folderId, '删除')) return res.status(400).json(...)
  await withTransaction(pool, (conn) => softDeleteFolder(folderId, conn))
  // softDeleteFolder：collectDescendantIds → UPDATE folders deleted_at=NOW()
  //                  → collectArticleIdsInFolders → UPDATE articles deleted_at=NOW()
  res.json({ status: 'ok', message: '已移入回收站' })
})

app.get('/api/trash', async (req, res) => {
  // 两张表 WHERE deleted_at IS NOT NULL，按 deleted_at DESC 排序
  res.json({ status: 'ok', data: { folders, articles } })
})

app.post('/api/folders/:id/restore', async (req, res) => {
  if (guardRoot(folderId, '恢复')) return res.status(400).json(...)
  await withTransaction(pool, (conn) => restoreFolder(folderId, conn))
  // restoreFolder：递归收集 → UPDATE folders/articles deleted_at = NULL
  res.json({ status: 'ok', message: '恢复成功' })
})

app.delete('/api/folders/:id/force', async (req, res) => {
  if (guardRoot(folderId, '永久删除')) return res.status(400).json(...)
  const { articleIds } = await withTransaction(pool, (conn) => forceDeleteFolder(folderId, conn))
  // forceDeleteFolder：先 DELETE canvas_strokes（无外键，手工清）
  //                   → DELETE articles（cascade 批注/收藏）→ DELETE folders
  if (articleIds.length > 0) cleanupUnusedTtsCache('folder-force-delete') // 提交后
  res.json({ status: 'ok', message: '永久删除成功' })
})
```

### 辅助函数

```js
// server/folderDelete.js
async function collectDescendantIds(parentId, conn, visited = new Set()) {
  if (visited.has(parentId)) return []   // 防 parent_id 成环
  visited.add(parentId)
  const [rows] = await conn.query('SELECT id FROM folders WHERE parent_id = ?', [parentId])
  const ids = []
  for (const row of rows) {
    if (visited.has(row.id)) continue
    ids.push(row.id, ...(await collectDescendantIds(row.id, conn, visited)))
  }
  return ids
}

async function collectArticleIdsInFolders(folderIds, conn) {
  if (!folderIds.length) return []
  const placeholders = folderIds.map(() => '?').join(',')
  const [rows] = await conn.query(`SELECT id FROM articles WHERE folder_id IN (${placeholders})`, folderIds)
  return rows.map((r) => r.id)
}

async function withTransaction(pool, fn) {
  const conn = await pool.getConnection()
  try { await conn.beginTransaction(); const r = await fn(conn); await conn.commit(); return r }
  catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}
```

---

## 前端 API

`src/api/index.js` 新增：

| 函数 | 说明 |
|------|------|
| `fetchTrash()` | `GET /api/trash` |
| `restoreFolder(id)` | `POST /api/folders/:id/restore` |
| `forceDeleteFolder(id)` | `DELETE /api/folders/:id/force` |

```js
export function fetchTrash() { return request('/trash') }
export function restoreFolder(id) { return request(`/folders/${id}/restore`, { method: 'POST' }) }
export function forceDeleteFolder(id) { return request(`/folders/${id}/force`, { method: 'DELETE' }) }
```

---

## Store 状态

`src/stores/fileExplorer.js` 新增：

| 状态/方法 | 类型 | 说明 |
|-----------|------|------|
| `showTrash` | `ref(false)` | 是否显示回收站视图 |
| `trashedFolders` | `ref([])` | 回收站中的文件夹列表 |
| `trashedArticles` | `ref([])` | 回收站中的文章列表 |
| `loadTrash()` | `async` | 从 API 加载回收站数据 |
| `restoreFromTrash(folderId)` | `async` | 恢复文件夹 + 重新加载正常视图 |
| `permanentDelete(folderId)` | `async` | 永久删除文件夹 |

```js
const showTrash = ref(false)
const trashedFolders = ref([])
const trashedArticles = ref([])

async function loadTrash() {
  const res = await api.fetchTrash()
  trashedFolders.value = res.data?.folders || []
  trashedArticles.value = res.data?.articles || []
}

async function restoreFromTrash(folderId) {
  await api.restoreFolder(folderId)
  // 从回收站列表中移除
  trashedFolders.value = trashedFolders.value.filter((f) => f.id !== folderId)
  // 同步清理回收站文章列表：只保留仍属于剩余回收站文件夹的文章
  trashedArticles.value = trashedArticles.value.filter(
    (a) => !trashedFolders.value.some((f) => f.id === a.folderId),
  )
  // 重新加载正常文件夹视图
  await loadFolders()
}

async function permanentDelete(folderId) {
  await api.forceDeleteFolder(folderId)
  trashedFolders.value = trashedFolders.value.filter((f) => f.id !== folderId)
  trashedArticles.value = trashedArticles.value.filter((a) => a.folderId !== folderId)
}
```

`navigateTo()` 中新增 `showTrash.value = false`，点击任何正常文件夹时自动退出回收站。

`deleteFolder(folderId)`（`:113-138`）另有三点值得记录：拒绝 `root`；成功后从父节点 `children` 移除并递归清本地 `folders` 缓存；**若删的是当前所在目录，`currentFolderId` 回退到父目录或 `root`**。它不调用 `loadTrash()`，回收站数据只在打开回收站视图时按需加载。

> ✅ `FileExplorer.vue` 的「恢复」/「永久删除」包装函数在 `store.restoreFromTrash` / `store.permanentDelete` 之后**立即 `await store.loadTrash()`**，因此即使后端递归处理整棵子树，子文件夹与文章也不会残留在回收站列表里。store 内按单个 folderId 的本地过滤只作为即时 optimitic 更新，最终以 `loadTrash()` 的服务端结果为准。

---

## UI 组件

### FolderTree.vue

文件夹树底部新增回收站入口：

```html
<div class="tree-trash" @click="emit('trash-click')">🗑️ 回收站</div>
```

父组件监听：

```html
<FolderTree
  @contextmenu="onFolderTreeContextMenu"
  @trash-click="store.showTrash = true; store.loadTrash()"
/>
```

样式：灰色文字 + 悬停变红色背景。

### FileExplorer.vue

**工具栏按钮**：

```html
<button class="btn btn-trash" :class="{ active: store.showTrash }"
  @click="store.showTrash ? (store.showTrash = false) : (store.showTrash = true, store.loadTrash())">
  🗑️ 回收站
</button>
```

- 点击开/关回收站视图
- 打开时按钮高亮（红色边框）

**回收站视图**（替代 `ContentArea`）：

```
🗑️ 回收站

[文件夹]
📁 文件夹名        2026/6/20 16:00  [♻️ 恢复] [🗑️ 永久删除]

[文章]
📄 文章标题        2026/6/20 16:00  恢复文件夹即可恢复文章

（为空时：回收站为空）
```

- 文件夹提供 **恢复** 和 **永久删除** 操作
- 文章只读显示，提示"恢复文件夹即可恢复文章"
- 永久删除需二次危险确认：`askConfirm({ title:'永久删除文件夹', message:'确定永久删除「X」？', detail:'其下文章也将被永久删除，此操作不可恢复。', confirmText:'永久删除', danger:true })`（`FileExplorer.vue:123-137`）
- 软删确认：`title:'移入回收站'`、`detail:'其下所有子文件夹与文章将一并移入回收站。'`、`confirmText:'删除'`、`danger:true`（`FileExplorer.vue:139-154`）
- 两个确认均走 `src/utils/feedback.js:61-83` 的 `askConfirm`（Promise 化 `ElMessageBox.confirm`），取消返回 `false`；**恢复无确认**

### 交互逻辑

| 操作 | 行为 |
|------|------|
| 右键 → 删除 | 移入回收站（软删除） |
| 点击回收站入口 | 进入回收站视图并加载数据 |
| 点击文件夹 | 通过 `navigateTo` 退出回收站 |
| 点击工具栏回收站按钮 | 切换回收站视图 |

---

## 数据流

```
用户点击删除
    │
    ▼
contextMenu emit('delete') → FileExplorer @delete
    │
    ▼
store.deleteFolder(id) → api.deleteFolder(id) → DELETE /api/folders/:id
    │
    ▼
后端：
  ├── collectDescendantIds(id)        → 递归收集子孙文件夹
  ├── UPDATE folders SET deleted_at   → 软删文件夹
  ├── collectArticleIdsInFolders(ids) → 收集文件夹下文章
  └── UPDATE articles SET deleted_at  → 软删文章
    │
    ▼
前端：移除文件夹及子孙从本地 folders 缓存

──────────────────────────────────

用户点击回收站 → 进入回收站视图
    │
    ▼
store.loadTrash() → GET /api/trash
    │
    ▼
显示已删除的文件夹和文章列表

──────────────────────────────────

用户点击 ♻️ 恢复
    │
    ▼
store.restoreFromTrash(id) → POST /api/folders/:id/restore
    │
    ▼
后端：设置 deleted_at = NULL（文件夹 + 文章）
    │
    ▼
前端：重新加载正常视图，文件夹恢复显示

──────────────────────────────────

用户点击 🗑️ 永久删除
    │
    ▼
二次 confirm → store.permanentDelete(id) → DELETE /api/folders/:id/force
    │
    ▼
后端（单事务）：
  ├── DELETE FROM canvas_strokes（无外键，手工清）
  ├── DELETE FROM articles（cascade 删 annotations/favorites）
  └── DELETE FROM folders
提交后：若有文章被删 → cleanupUnusedTtsCache('folder-force-delete')
前端：notifySuccess + loadTrash() 刷新列表
```

---

## 注意事项

1. **后端需重启**使所有改动生效（`start.bat` 或 `npm run dev:server`）
2. **已有数据不受影响**：旧的文件夹无 `deleted_at` 值(=NULL)，视为正常
3. **之前已被硬删除的数据无法恢复**
4. **没有自动清理**：回收站中的内容不会自动删除，需手动永久删除或恢复；没有「清空回收站」功能
5. **文章不提供单独恢复/操作**：文章随文件夹一起操作，避免状态不一致；单篇文章的删除是硬删除（`DELETE /api/articles/:id`），不进回收站
6. **三种操作均有成功提示**（`notifySuccess`），失败仍为 `notifyError`；恢复 / 永久删后前端会 `loadTrash()` 刷新列表
7. **后端有 root 防护与事务**，三个路由的所有 UPDATE / DELETE 原子化；递归有环检测（仍为 N+1 查询，正常建树无环）
8. **永久删除会先清 `canvas_strokes`**，不留孤儿笔迹；单篇删除接口同样清理
9. **`ArticleCard.vue` 的单篇删除文案已修正**为「此操作将永久删除、不可恢复」
10. **自动化覆盖**：`server/folderDelete.test.js` 13 项覆盖 root 防护、递归 / 成环、三种操作的 SQL 顺序（含笔迹清理）、事务提交 / 回滚；TTS 缓存清理本身仍未单独测试

> 详细的接口行号与磁盘接口见 `markdown/DISK_INTERFACES.md` 的 `PATH-*` / 清理接口卡片；导入导出不导回收站内容的约束见 `markdown/FOLDER_IMPORT_EXPORT.md`。
