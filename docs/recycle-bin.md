# 回收站功能

> 开发记录文档 — 2026-06-20 实施

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

### 核心逻辑

```js
// server/index.js

// 递归删除（移入回收站）
app.delete('/api/folders/:id', async (req, res) => {
  // 1. 收集所有子孙文件夹 ID
  const folderIds = await collectDescendantIds(folderId)
  folderIds.push(folderId)
  // 2. 软删除文件夹
  UPDATE folders SET deleted_at = NOW() WHERE id IN (?)
  // 3. 同时软删除文件夹下的所有文章
  const articleIds = await collectArticleIdsInFolders(folderIds)
  UPDATE articles SET deleted_at = NOW() WHERE id IN (?)
})

// 回收站查询
app.get('/api/trash', async (req, res) => {
  // 返回已删除文件夹 + 已删除文章，按 deleted_at DESC 排序
  res.json({ data: { folders, articles } })
})

// 恢复
app.post('/api/folders/:id/restore', async (req, res) => {
  // 1. 收集所有子孙文件夹 ID
  // 2. 设置 deleted_at = NULL（文件夹 + 其中的文章）
})

// 永久删除
app.delete('/api/folders/:id/force', async (req, res) => {
  // 1. 先删文章（cascade 自动删 annotations/favorites）
  // 2. 再删文件夹
})
```

### 辅助函数

```js
// 递归收集所有子孙文件夹 ID
async function collectDescendantIds(parentId) {
  const [rows] = await pool.query('SELECT id FROM folders WHERE parent_id = ?', [parentId])
  const ids = []
  for (const row of rows) {
    const children = await collectDescendantIds(row.id)
    ids.push(row.id, ...children)
  }
  return ids
}

// 收集指定文件夹列表下的所有文章 ID
async function collectArticleIdsInFolders(folderIds) {
  if (!folderIds.length) return []
  const placeholders = folderIds.map(() => '?').join(',')
  const [rows] = await pool.query(`SELECT id FROM articles WHERE folder_id IN (${placeholders})`, folderIds)
  return rows.map((r) => r.id)
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

---

## UI 组件

### FolderTree.vue

文件夹树底部新增回收站入口：

```html
<div class="tree-trash" @click="emit('trash-click')">🗑️ 回收站</div>
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
- 永久删除需二次 confirm 确认

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
后端：
  ├── DELETE FROM articles（cascade 删 annotations/favorites）
  └── DELETE FROM folders
```

---

## 注意事项

1. **后端需重启**使所有改动生效（`start.bat` 或 `npm run dev:server`）
2. **已有数据不受影响**：旧的文件夹无 `deleted_at` 值(=NULL)，视为正常
3. **之前已被硬删除的数据无法恢复**
4. **没有自动清理**：回收站中的内容不会自动删除，需手动永久删除或恢复
5. **文章不提供单独恢复/删除操作**：文章随文件夹一起操作，避免状态不一致
