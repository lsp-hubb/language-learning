# 文件夹数据导入 / 导出构建方案

> 状态：**P0 + P1 已实现（2026-11-11）**，P2 待实现。本文既是设计文档，也是已实现部分的实现说明。
> 目标：在前端一键把「一个文件夹（含子文件夹、文章及其附属数据）」或**整个 `root`** 导出成单文件，并在另一处（同机 / 另一台笔记本）从前端一键导入。
> 2026-11-10：关键决策已确认，见 [§11 已确认的决策](#11-已确认的决策)。

**P0 实现清单**

| 文件 | 作用 |
|------|------|
| `server/folderBundle.js`（新增） | `buildExport` 只读聚合、`validateBundle` 白名单校验与拓扑排序、`importBundle` 事务内 ID 全量重生成、`createImportRouter`（100 MB 前置解析） |
| `server/index.js` | 在全局 `express.json({limit:'2mb'})` **之前**挂载导入路由；新增 `GET /api/folders/:id/export`（支持 `root`） |
| `src/api/index.js` | `request()` 支持自定义超时；新增 `validateFolderBundle` / `importFolder`（2 分钟） |
| `src/utils/folderBundle.js`（新增） | 纯 JSON 下载（Blob）、文件名、前端快速预检、字节格式化 |
| `src/components/FolderImportDialog.vue`（新增） | 点击选择 / 拖拽 → 自动预检 → 统计卡片 → 卡片式目标位置（当前文件夹 / 根目录，后者用 `根目录.svg`）→ 确认导入 |
| `src/components/ContextMenu.vue` / `FileExplorer.vue` | 右键新增「导出文件夹…」「导出全部文件夹…」「导入文件夹…」并接线；三项图标为 `导出.svg` / `根目录.svg` / `导入.svg` |

**P1 实现清单（2026-11-11）**

| 文件 | 作用 |
|------|------|
| `server/folderBundle.js` | `buildExport` 按已导出文章 ID 批量聚合 `annotations` / `favorites` / `canvas_strokes`（`queryOptional` 兼容老库缺表）；`validateBundle` 校验三类数组、引用完整性、批注偏移与类型白名单，笔迹 JSON 递归剔除原型污染键；`importBundle` 在同一事务内重映射 `articleId`、重生成批注 `id` 并插入三张表；`ensureBundleTables` 在事务外建表（MySQL DDL 会隐式提交） |
| `src/components/FolderImportDialog.vue` | 预检摘要展示批注 / 收藏 / 笔迹数量与跳过计数，说明改为「完整导入」 |
| `src/components/FileExplorer.vue` | 导出与导入完成提示展示六类数据计数 |

---

## 1. 现状与为什么要新做

| 现有能力 | 位置 | 为什么不能当作文件夹导入/导出 |
|----------|------|------------------------------|
| 单篇 PDF 导出 | `src/components/PdfExportButton.vue` → `server/pdf_service.py`（5057） | 有损、渲染型、单篇、不可逆：丢失目录层级、`marks`、画布笔迹、收藏、`type` / `created_at`，批注偏移量只用于排版 |
| TXT 批量导入 | `scripts/reimport_all.cjs` | 命令行脚本；先 `DELETE FROM articles WHERE folder_id=?` **硬删**该文件夹全部文章；只 INSERT `id,title,content,folder_id` 四列；不建文件夹、不重建批注/笔记/重点/收藏/笔迹 |
| 全库备份 | `db/language_learning.sql` + `mysqldump` | 全库级、非选择性、需命令行与后端重启补列（`type` / `marks` 不在备份 DDL 中） |
| 现有 API | `server/index.js` 30 条路由 | 全是单条读写；**没有** `batch` / `import` / `export` / 文件上传端点；`package.json` 无 `multer` / zip 类依赖 |

因此需要从零设计一套「结构化、可回导、文件夹粒度」的方案。

### 1.1 目标 / 非目标

- ✅ 目标：导出某个文件夹**及其整棵子树**、或**整个 `root`（全部文件夹）**为单个 JSON 文件；导入到当前位置或 `root`；跨设备迁移；数据完整可还原；失败不留半成品。
- ❌ 非目标（已确认排除）：全库备份/恢复、增量同步、PDF 渲染导出、**回收站内容导出**、AI 面板配置 / `localStorage` 偏好迁移、**服务端鉴权 / 访问口令**、**压缩格式（gz / zip）**、**`merge` / `replace` 导入模式**。

---

## 2. 「一个文件夹的完整数据」是什么

| 实体 | 存储 | 关键字段 | 是否导出 |
|------|------|----------|----------|
| 文件夹树 | `folders` | `id, name, parent_id, created_at, deleted_at` | ✅（仅 `deleted_at IS NULL`；`root` 导出时含所有顶层文件夹） |
| 文章 | `articles` | `id, title, content, folder_id, notes(MEDIUMTEXT), marks(TEXT), type, created_at, deleted_at` | ✅（仅未删除且所属文件夹在导出集合内） |
| 批注 | `annotations` | `id, article_id, paragraph_index, start_offset, end_offset, text, type, color, note, created_at` | ✅ |
| 收藏 | `favorites` | `article_id, created_at` | ✅（跟随文章） |
| 画布笔迹 | `canvas_strokes` | `article_id, strokes_data(JSON), updated_at` | ✅ |

> `notes` / `marks` 是 `articles` 的列而非独立表；`root` 是前端虚拟节点（`src/stores/fileExplorer.js:20`），后端把 `parentId==='root'` 转成 `NULL`（`server/index.js:123`），数据库中**没有** root 记录，因此 root 导出包里也不会有对应的 `folders` 条目。
> **回收站内容一律不导出**（已确认）：所有查询统一带 `deleted_at IS NULL`；`folder_id` 指向已删除文件夹或不存在文件夹的孤儿文章同样不导出，仅在导出结果摘要里计数提示。

### 2.1 必须先解决的 8 个约束

| # | 约束 | 影响 | 对策 |
|---|------|------|------|
| 1 | `POST /api/folders`、`POST /api/articles` 的 ID 由服务端 `crypto.randomUUID()` 生成 | 无法用现有端点保留原 ID，引用会断 | 新增专用批量导入端点，服务端做 `oldId → newId` **全量重生成**映射 |
| 2 | `express.json({ limit: '2mb' })`（`server/index.js:19`）+ `src/api/index.js:6` 的 10 秒超时 | 整个文件夹（正文 + 笔记 + 笔迹 JSON）极易超限/超时 | 给导入路由挂**前置**的 100 MB 解析器；导出用独立 `fetch` + `blob()`，不设 10 秒超时 |
| 3 | 读端点分散：`GET /api/articles/:folderId` 不返回 `notes/marks/type`，`GET /api/article/:id` 不返回 `marks` | 前端逐篇拉取要 N×3+ 次请求 | 后端聚合导出，复用 `collectDescendantIds` / `collectArticleIdsInFolders`（`server/index.js:232-249`）做 `IN (...)` 批量查询 |
| 4 | `canvas_strokes` **无外键**（`_ensureCanvasTable` 主动 DROP FK） | 删除文章 / `reimport_all.cjs` 会留孤儿行 | 导出显式按 `articleId IN (...)` 取；导入显式插入并校验 `strokes_data` 合法性 |
| 5 | 软删语义不一致：`GET /api/folders` 过滤 `deleted_at`，文章类 GET 不过滤 | 回收站数据可能被带出并在导入后「复活」 | 导出统一加 `deleted_at IS NULL`；导入一律写 `deleted_at = NULL` |
| 6 | 批注偏移三元组依赖 `articles.content` 逐字不变 | 清洗/格式化正文会让批注错位 | `content` 原样写入，**不做** `normalizeQuotes` / trim / 换行归一化 |
| 7 | 无 zip / 上传依赖，无 `express.static` | 不能照搬文件上传或流式 zip 方案 | **已定：纯 JSON**，浏览器 `Blob` 下载 + `File.text()` 读取；不引入压缩库；超大包走 P2 的纯 JSON 分片上传 |
| 8 | `db/language_learning.sql` 的 `articles` DDL 缺 `type` / `marks`，靠启动 IIFE 补列 | 不能把 SQL dump 当作可回导的契约 | 自定义带 `format` / `version` 的 JSON bundle，字段白名单校验 |

---

## 3. 数据契约（导出包）

**已定格式**：单文件、UTF-8、**纯 JSON**（不压缩），扩展名 `.llfolder.json`（便于 `accept` 过滤）。
**已确认上限**：请求体 **100 MB**（`importRouter` 的 `express.json({ limit: '100mb' })`），另设 5000 篇文章 / 50000 条批注的条数上限；超过上限直接 413 并提示「按子文件夹分批导出」。上限原为 50 MB（2026-11-10 确认），2026-11-11 调整为 100 MB；后续如需变更只需改 `importRouter` 的 `limit` 与前端预检常量 `MAX_BUNDLE_BYTES` 两处。

```json
{
  "format": "language-learning/folder-bundle",
  "version": 1,
  "exportedAt": "2026-11-10T12:00:00.000Z",
  "source": {
    "folderId": "53e1c8c7-...",
    "folderName": "2021.10",
    "app": "language-learning"
  },
  "counts": { "folders": 3, "articles": 32, "annotations": 57, "favorites": 4, "canvasStrokes": 2 },
  "folders": [
    { "id": "f1", "name": "2021.10", "parentId": null, "createdAt": "2026-01-01T00:00:00.000Z" },
    { "id": "f2", "name": "经济", "parentId": "f1", "createdAt": "..." }
  ],
  "articles": [
    { "id": "a1", "folderId": "f1", "title": "1. xxx", "content": "正文原文（逐字）", "notes": "生文本", "marks": { "0__word": true }, "type": "", "createdAt": "..." }
  ],
  "annotations": [
    { "id": "n1", "articleId": "a1", "paragraphIndex": 0, "startOffset": 12, "endOffset": 20, "text": "xxx", "type": "highlight", "color": "#fff3a1", "note": "", "createdAt": "..." }
  ],
  "favorites": [{ "articleId": "a1", "createdAt": "2026-01-01T00:00:00.000Z" }],
  "canvasStrokes": [
    { "articleId": "a1", "strokes": [{ "type": "wavy", "color": "#e74c3c", "a1": {}, "a2": {} }] }
  ]
}
```

约定：

- `folders` 是**集合**，`parentId === null` 的项即顶层文件夹。普通文件夹导出时恰好 **1 个**顶层项；**`root` 导出时可有多个**（所有顶层文件夹），此时 `source.folderId = 'root'`、`source.folderName = '全部文件夹'`。
- 导入时所有顶层项的 `parentId` 统一替换为 `targetParentId`（`root` → `NULL`）；普通文件夹导出包导入到某个文件夹下即成为其子树。
- `marks` 存**对象**（不是 JSON 字符串；后端 `GET .../marks` 已反序列化），`strokes` 存数组。
- `favorites` 导出为 `{ articleId, createdAt }` 对象数组（保留收藏时间）；校验时**兼容** v1 早期写法的字符串数组 `["a1"]`。
- 字段统一 camelCase，与现有 API 返回一致；后端在 SQL 层做 snake_case ↔ camelCase 映射。
- **不导出** `deleted_at` / `updated_at` / 全局状态 / 回收站内容（已确认）；导入时 `deleted_at` 一律写 `NULL`。笔迹的 `updated_at` 由数据库重新生成。
- `counts` 仅供 UI 摘要与完整性校验，导入以实际数组为准；`skippedOrphans` / `skippedInvalidAnnotations` / `skippedInvalidCanvasStrokes` 为导出侧跳过计数，仅用于提示。
- 批注的 `type` 允许 `highlight` / `underline` / `sentence`（`sentence` 是历史遗留值，前端已不再产生）。

### 3.1 校验规则（后端为准，前端只做快速预检）

1. `format === 'language-learning/folder-bundle'` 且 `version` 在支持列表内（当前只支持 `1`）。
2. 必填数组存在且为数组（`annotations` / `favorites` / `canvasStrokes` 缺失时按空数组兼容 P0 包）；单条记录只取**白名单字段**，忽略 `__proto__` / `constructor` 等键；笔迹 JSON 递归剔除同类键，防原型污染。
3. 引用完整性：`article.folderId` 必须命中 `folders[].id`；`annotation.articleId` / `favorites[].articleId` / `canvasStrokes[].articleId` 必须命中 `articles[].id`。
4. `paragraphIndex / startOffset / endOffset` 为非负整数且 `startOffset < endOffset`；`type` 只允许 `highlight` / `underline` / `sentence`；`color` 长度 ≤ 20。
5. 体积与条数上限：**100 MB / 2000 个文件夹 / 5000 篇文章 / 50000 条批注**；`favorites` / `canvasStrokes` 各不超过文章上限（一篇文章最多一条）。超限直接 413 或 400 并给出可读提示。
6. `notes` 为字符串、`marks` 为对象、`strokes` 为数组；**P1 采用严格策略**：不合法或引用悬空时整包失败，避免静默丢数据。导出侧会跳过异常批注与非数组笔迹并在 `skippedInvalidAnnotations` / `skippedInvalidCanvasStrokes` 计数，保证导出的包一定可回导。

---

## 4. 接口设计

| Method | Path | 入参 | 行为 |
|--------|------|------|------|
| GET | `/api/folders/:id/export` | `:id` 可为真实文件夹 ID 或 **`root`** | 聚合导出，返回 bundle JSON；失败返回 `{status:'error',message}`。回收站内容一律不导出 |
| POST | `/api/folders/import/validate` | `{ targetParentId, bundle }` | **dry-run**：只校验 + 体积/条数摘要，不写库 |
| POST | `/api/folders/import` | `{ targetParentId, bundle }` | **固定 `create-new` 模式**，单事务写入，返回 `{ folderCount, articleCount, ... }` |

> 实现位置：`server/folderBundle.js` 提供 `buildExport` / `validateBundle` / `importBundle` / `createImportRouter` / `ensureBundleTables`；`server/index.js` 把 `createImportRouter(pool)` 挂在全局 2 MB 解析之前，并新增 `GET /api/folders/:id/export`。导出**直接返回纯 bundle**（不套 `status/data`），前端 `res.text()` → Blob 下载。P1 起 `validate` 摘要与 `import` 返回值都包含 `annotations` / `favorites` / `canvasStrokes` 的计数。

### 4.1 为什么后端聚合而不是前端逐条调用

- 避免 N×3+ 次请求与 10 秒超时；避免中途断网造成半状态。
- 现有单条端点无法保证 ID 与引用一致，也无法把 6 类数据放进一个事务。
- 导出只读、导入单事务，都只需一次 HTTP 往返。

### 4.2 后端实现要点

- **路由前置解析**（关键）：全局 `express.json({limit:'2mb'})` 会先拒绝大 body。把导入路由注册在全局解析之前：

  ```js
  // app.use(express.json({ limit: '2mb' })) 之前
  const importRouter = express.Router()
  importRouter.use(express.json({ limit: '100mb' }))
  importRouter.post('/validate', ...)
  importRouter.post('/', ...)
  app.use('/api/folders/import', importRouter)
  ```

- **普通文件夹导出**：一次拉取全部未删除文件夹在内存中建 `parentId` 索引后 BFS 收集子树 → 文章 `WHERE folder_id IN (?)` → 以**已导出文章 ID** 再查 `annotations` / `favorites` / `canvas_strokes` 三张表 → 组装 DTO；`marks` 用 `JSON.parse`（失败回 `{}`），`strokes_data` 直接取 JSON 列；任一张附属表不存在时按空数据处理。
- **`root` 导出**：跳过递归收集，直接 `SELECT ... FROM folders WHERE deleted_at IS NULL`（含所有顶层与子文件夹）→ 文章取 `folder_id IN (全部文件夹 id) AND deleted_at IS NULL`；**孤儿文章（folder 不存在 / 已软删）不导出**，计数写进 `counts` 之外的 `skipped` 摘要字段并在 UI 提示。
- 所有查询统一过滤 `deleted_at IS NULL`；导出只读、不锁表。
- 导入：`pool.getConnection()` → `beginTransaction()` → 批量 INSERT（多值或循环参数化）→ `commit()`；任意异常 `rollback()` 并释放连接。全部语句参数化，禁止拼接用户输入。
- 建议把 DTO 组装、校验、事务拆到 `server/folderBundle.js`，避免 `server/index.js` 继续膨胀。

### 4.3 前端请求

- 新增 `src/api/index.js` 的 `exportFolder(id)` / `validateFolderBundle(payload)` / `importFolder(payload)`，或为这三个接口单独写一个 `fetch` 封装（`request()` 固定 10 秒超时、`res.json()` 一次性解析，不适合大包）。
- 导出走 `res.blob()` + `URL.createObjectURL()` + `a[download]`，文件名 `<文件夹名>-YYYYMMDD.llfolder.json`（`root` 导出用 `全部文件夹-YYYYMMDD.llfolder.json`）；前端命名，避免 `Content-Disposition` 中文编码问题。
- 导入走 `file.text()` → 前端快速预检（magic / version / 大小）→ `validate` → 用户确认 → `import`。

---

## 5. ID 与引用重映射（核心难点）

**已确认策略：全部重新生成 ID**（`crypto.randomUUID()`），不保留原 ID、不做冲突合并。理由：跨设备导入可能与既有数据撞主键；重复导入同一包也应产生独立副本。

处理顺序与映射表 `Map<oldId, newId>`：

1. `folders`：按「父在前、子在后」拓扑顺序插入；`parentId` 命中映射表则替换；**所有 `parentId === null` 的顶层项**（普通导出 1 个、root 导出多个）统一挂到 `targetParentId`（`root` → `NULL`）。
2. `articles`：`folderId` 用映射表替换；`content / notes / marks / type / created_at` 原样写入，`deleted_at = NULL`。
3. `annotations`：`articleId` 用映射表替换；`id` 重新生成；**偏移三元组原样保留**。
4. `favorites` / `canvasStrokes`：`articleId` 用映射表替换；笔迹数组按 `JSON.stringify` 写入 `strokes_data`。

**导入模式只做 `create-new`**（已确认）：在目标位置新建一棵（或多棵，root 包）子树，与现有同名文件夹 / 文章共存；`merge`（按名称匹配合并）与 `replace`（先软删再导入）**不实现，也不纳入后续计划**。

幂等：`bundle.exportedAt` + `source.folderId` 只作展示，不做去重；重复导入产生两份，UI 需明确提示。

---

## 6. 前端交互设计

### 6.1 入口

| 位置 | 改动 |
|------|------|
| `src/components/ContextMenu.vue` | ✅ 已新增菜单项「导出文件夹…」/「导入文件夹…」/「**导出全部文件夹…（root）**」与 `export-folder` / `export-root` / `import-folder` 三个 emit |
| `src/components/FolderTree.vue` | **未改动**：树节点右键事件已带 `item.id`，透传即可；`root` 导出改由主区右键菜单触发（树里没有独立的 root 节点 DOM） |
| `src/components/ContentArea.vue` | **未改动**：主区右键（`.content`）与文件夹卡片右键复用同一菜单；主区菜单即含「导出全部文件夹…」 |
| `src/components/FileExplorer.vue` | ✅ 转发三个事件；导出 / 导入完成用 `showResult` 统计卡片弹窗展示六类数据与跳过提示，失败用 `notifyError`；删除确认改用 `askConfirm`；导入完成后 `store.loadFolders()` + `loadArticles(currentFolderId)` |
| 新增 `src/components/FolderImportDialog.vue` | ✅ 点击选择或**拖拽**数据包 → 自动调用 validate → 统计卡片显示六类数据（含跳过计数）→ 卡片式目标位置（当前文件夹 / root）→ 确认导入（**无模式选择**，固定 create-new）；文件状态、错误条与按钮 loading 均有独立视觉反馈；「根目录」卡片图标用 `根目录.svg`（CSS mask 染成 `#4a90d9`） |
| 新增 `src/utils/folderBundle.js` | ✅ Blob 下载、文件名、`file.text()`、前端快速预检、字节格式化 |
| 新增 `src/utils/feedback.js` | ✅ 统一 `notify*` / `showResult` / `askConfirm`；结果弹窗内容用 VNode 渲染（不用 HTML 字符串，避免文件名造成 XSS）；`src/assets/base.css` 统一外观 |

### 6.2 流程

**导出**

```
右键文件夹 → 导出文件夹…（或 导出全部文件夹… → id='root'）
  → GET /api/folders/:id/export（loading）
  → res.text() → Blob → a[download] → revokeObjectURL
  → showResult 统计卡片弹窗：文件名 + 六类数据 / 体积 + 跳过提示
```

**导入**

```
导入文件夹… → 点击选择或拖拽 .llfolder.json
  → 前端预检（format/version/大小）→ 上传区显示文件状态，统计卡片显示六类数据 / 体积 / 跳过计数
  → 卡片式选择目标位置（默认当前文件夹，可选 root）；模式固定 create-new，不提供选项
  → POST /import/validate（dry-run，显示体积/条数超限提示）
  → 用户确认 → POST /import（单事务，按钮显示 loading）
  → 成功：刷新目录树与当前列表，showResult 统计卡片弹窗；失败：notifyError + 对话框内错误条，显示后端 message，不改动 UI 数据
```

状态与反馈：大文件用 indeterminate loading + 字节数提示；错误一律展示后端 `message`（沿用笔记面板的做法）；成功摘要含导入后新文件夹 ID/名称，便于定位。

---

## 7. 一致性与安全

- **事务**：导入全程一个 MySQL 事务；任何一条失败 → 全部回滚，不留半棵树。
- **正文完整性**：`content` 逐字写入，禁止 `normalizeQuotes` / trim / 换行归一化，否则批注偏移失效。
- **软删**：导出过滤 `deleted_at IS NULL`（回收站内容不导出）；导入写 `NULL`，不产生回收站记录。
- **孤儿数据**：导出只取已导出文章 ID 命中三张附属表，`canvas_strokes` 显式按映射后的 `articleId` 插入；包内引用悬空的条目**整包拒绝**，避免产生孤儿行。
- **建表时机**：`favorites` / `canvas_strokes` 原本由各自 API 惰性建表，导入前在事务**之外**一次性执行 `CREATE TABLE IF NOT EXISTS`（MySQL DDL 会隐式提交事务）。
- **注入 / 原型污染**：全部参数化 SQL；DTO 按白名单取字段；拒绝 `__proto__` / `constructor` / `prototype` 键。
- **体积 / DoS**：路由级 100 MB、条数上限、导出只读不锁表。
- **XSS**：`content` 前端渲染链路已有转义，导入不引入新的 `v-html` 信任点。
- **权限（已确认不加口令）**：局域网内任何可访问者都能调用导入接口。这是**已知且接受的风险**，不实现鉴权 / 口令 / 仅本机限制；仅在功能说明中提示「导入接口无鉴权，请勿在不可信网络开放 3000 端口」。

---

## 8. 与现有能力的关系

| 能力 | 关系 |
|------|------|
| `scripts/reimport_all.cjs` | 不复用（硬删 + 只写 4 列）；P2 可改为调用新导入 API，或保留为纯 TXT 初始化工具 |
| PDF 导出（5057） | 互补：PDF 给人看、bundle 给机器回导；不要复用 5057 服务 |
| `mysqldump` 全库备份 | 互补：全库灾备 vs 文件夹级 / root 级选择性迁移 |
| 回收站 | **导出不含回收站**；导入不写软删记录 |
| `db/language_learning.sql` | 仅作 DDL 参考，不作为 bundle 契约（`type` / `marks` 缺列） |

---

## 9. 分期实施计划

| 阶段 | 交付 | 主要改动文件 | 验收 |
|------|------|--------------|------|
| **P0 ✅ 已实现（2026-11-11）** | JSON bundle v1（纯 JSON、100 MB）；后端 `export`（**含 `root`**）+ `import`（create-new、单事务、ID 全量重生成）；前端右键导出 / root 导出 / 文件选择导入；范围含 `folders` + `articles`（含 `notes/marks/type`） | `server/index.js`、新增 `server/folderBundle.js`、`src/api/index.js`、`ContextMenu.vue`、`FolderTree.vue`、`ContentArea.vue`、`FileExplorer.vue`、新增 `src/components/FolderImportDialog.vue` 与 `src/utils/folderBundle.js` | 导出→导入后目录层级、文章数、正文逐字一致；root 包可导入 |
| **P1 ✅ 已实现（2026-11-11）** | 补齐 `annotations` / `favorites` / `canvasStrokes` 的导出、校验与事务导入；批注偏移与类型白名单；笔迹 JSON 原型污染清洗；导出/导入摘要显示六类数据计数；缺少附属表时在事务外建表 | `server/folderBundle.js`、`FolderImportDialog.vue`、`FileExplorer.vue` | 批注偏移不错位、笔迹/重点/收藏完整还原；非法引用整包失败并回滚 |
| **UI 优化 ✅ 已实现（2026-11-11）** | 导入对话框改为拖拽上传 + 统计卡片 + 卡片式目标选择 + 错误条 / loading；全站原生 `alert` / `confirm` 替换为统一反馈层（卡片化消息、结构化结果弹窗、危险操作确认框）；右键菜单导入导出项与导入对话框「根目录」卡片接入 `导出.svg` / `导入.svg` / `根目录.svg` | 新增 `src/utils/feedback.js`、`src/assets/base.css`、`FolderImportDialog.vue`、`FileExplorer.vue`、`ArticleCard.vue`、`ContextMenu.vue` 等 | 导入流程无阻塞式原生弹窗；结果弹窗显示六类数据；删除确认按钮为红色且可取消；三个 SVG 图标经 mask 统一染蓝 |
| **P2** | 纯 JSON **分片上传**（不引入压缩格式）、bundle 版本迁移、导入历史记录 | 新增路由与前端分块逻辑 | 超大文件夹可分批导入；跨版本包可读 |

**明确不做**（已确认）：gz / zip 压缩格式、`merge` / `replace` 模式、访问口令 / 鉴权、回收站内容导出。

每阶段同步更新：`README.md` 功能概览、`markdown/ARCHITECTURE.md`（API 表 / 数据流 / 组件树）、`docs/MySQL连接配置说明.md`（如新增表）、本文档。

---

## 10. 验收清单 / 测试用例

1. 导出 3 层子文件夹 + 32 篇文章，文章带 `notes` / `marks` / 批注 / 画布笔迹 / 收藏 → bundle 内容完整、`counts` 正确。
2. **导出整个 `root`**：含多棵顶层文件夹树，所有 `parentId === null` 的项为顶层；导入后层级与导出前一致。
3. 导入到 `root` 与导入到某个子文件夹 → `parent_id` 正确、面包屑可导航。
4. 同一包连续导入两次 → 无主键冲突、产生两棵独立子树，ID 映射不串（验证「全部重生成」）。
5. **库内存在回收站文章 / 回收站文件夹 / 孤儿文章** → 导出包中不含它们，摘要给出跳过计数；导入后回收站不会出现「复活」数据。
6. 构造一条非法批注（引用不存在的 `articleId`）→ `validate` 报错、`import` 事务回滚，库内无半棵树。
7. `content` 含弯引号、emoji、CRLF、连续空行 → 导入前后 `LENGTH(content)` 与逐字比对一致；批注定位正确。
8. 空文件夹 / 空包 / 错误 `format` / 不支持的 `version` / 超 100 MB / 篡改 `folderId` → 明确错误提示，不写库。
9. **导出文件为纯 JSON**：文本编辑器可直接打开，无 gzip / zip 头；`JSON.parse` 可解析。
10. 从另一台笔记本导入 → 层级、正文、笔记、批注、重点、笔迹、收藏全部可用。
11. 导出过程刷新页面 / 导入中断网 → 无脏数据、无孤儿 `canvas_strokes`。

---

## 11. 已确认的决策（2026-11-10）

| # | 决策项 | 结论 | 落到本方案的位置 |
|---|--------|------|------------------|
| 1 | 回收站内容 | **不导出**；所有查询 `deleted_at IS NULL`，孤儿文章也跳过 | §1.1、§2、§4.2、§7、§8、§10 |
| 2 | ID 策略 | **全部重生成**（`crypto.randomUUID()`），不保留原 ID、不做冲突合并 | §2.1、§5、§9、§10 |
| 3 | 导入模式 | **只做 `create-new`**；`merge` / `replace` 不实现、不排期 | §1.1、§4、§5、§6、§9 |
| 4 | 导出范围 | **允许导出整个 `root`**（P0 即支持，数据库无 root 记录，包内以多个顶层项表示） | §1.1、§2、§3、§4.2、§6、§9、§10 |
| 5 | 包格式 / 体积 | **纯 JSON**（`.llfolder.json`，不压缩）+ **上限 100 MB**（2026-11-11 由 50 MB 调整），另设 5000 篇文章 / 50000 条批注条数上限 | §3、§3.1、§4.2、§7、§9、§10 |
| 6 | 鉴权 | **不加口令**，不实现鉴权 / 仅本机限制；作为已知风险写入说明 | §1.1、§7、§9 |

> 上限现为 100 MB（原 50 MB，2026-11-11 调整），不再作为待定值。后续若确实要调整，只需改 `importRouter` 的 `limit` 与前端预检常量 `MAX_BUNDLE_BYTES` 两处；条数上限不随体积变化。

---

## 12. 参考位置索引

| 主题 | 位置 |
|------|------|
| 表结构与约束 | `db/language_learning.sql`、`docs/MySQL连接配置说明.md:154-222`、`server/index.js:43-98`（`/api/init`） |
| 启动补列 IIFE | `server/index.js:22-40` |
| 递归收集子孙 | `server/index.js:232-249` |
| 现有 API 全清单 | `server/index.js`（30 条路由）、`docs/MySQL连接配置说明.md:102-133` |
| 前端右键菜单链 | `FolderTree.vue:51` → `ContentArea.vue:15,27` → `FileExplorer.vue:31-40,193-197,228-232` → `ContextMenu.vue:28-36,68-118` |
| TXT 批量导入 | `scripts/reimport_all.cjs:8-64` |
| PDF 导出 | `src/components/PdfExportButton.vue:100-137`、`server/pdf_service.py:148-195` |
| API 封装与超时 | `src/api/index.js:3-32` |
| 请求体上限 | `server/index.js:17-22`（全局 2 MB + 导入路由前置 100 MB） |
| 数据包实现 | `server/folderBundle.js`（导出 / 校验 / 事务导入 / 事务外建表，P0 + P1）、`src/utils/folderBundle.js`（下载 / 前端预检） |
| 统一反馈层 | `src/utils/feedback.js`（`notify*` / `showResult` / `askConfirm`）、`src/assets/base.css`（`.el-message` / `.fb-message-box` 外观） |
| 图标资源 | `src/components/icons/`：右键菜单导入导出项用 `导出.svg` / `根目录.svg` / `导入.svg`，导入对话框「根目录」卡片复用 `根目录.svg`；三者以 CSS `mask-image` 统一染蓝（`根目录.svg` 未写 `fill`，默认纯黑，需 mask 才能与另两个 `#1890FF` 一致） |
| P1 附属数据字段 | `annotations`：`id, article_id, paragraph_index, start_offset, end_offset, text, type, color, note, created_at`；`favorites`：`article_id, created_at`；`canvas_strokes`：`article_id, strokes_data(JSON)` |
