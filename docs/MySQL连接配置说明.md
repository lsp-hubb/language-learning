# MySQL 连接配置说明

## 环境信息

| 项目 | 内容 |
|------|------|
| 数据库 | MySQL 8.0 |
| 主机 | localhost |
| 端口 | 3306 |
| 数据库名 | `language_learning` |

## 目录结构

```
language-learning/
├── server/
│   ├── db.js          # MySQL 连接池模块
│   └── index.js       # Express 服务入口
├── .env               # 数据库与服务器环境变量（已加入 .gitignore）
└── MySQL连接配置说明.md # 本文件
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

编辑 `.env` 文件，根据本地 MySQL 修改：

```ini
# MySQL 连接配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=          # 你的 MySQL 密码（默认为空）
DB_NAME=language_learning

# 服务端口
SERVER_PORT=3000
```

### 3. 创建数据库

在 MySQL 中执行：

```sql
CREATE DATABASE IF NOT EXISTS language_learning
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
```

### 4. 启动服务

**方式一：一键启动（推荐）**

双击项目根目录的 `start.bat`，会自动打开两个终端窗口分别启动后端和前端。

**方式二：分别启动**

```bash
# 终端1：后端
npm run dev:server

# 终端2：前端
npm run dev
```

**方式三：Python 一键脚本**

```bash
python scripts/start-all.py   # MySQL(3306) → 后端(3000) → 前端(5173) → PDF(5057) → 打开浏览器
python scripts/stop-all.py    # 前端(5173) → 后端(3000) → PDF(5057) → MySQL
```

- 端口已在监听的服务会跳过，不重复拉起
- 前端固定用 `node node_modules/vite/bin/vite.js`（不经 `npm run dev`）
- ⚠️ `stop-all.py` 会停止 MySQL；若该实例还服务其他项目，请只手动关闭前后端

### 5. 测试连接

访问: http://localhost:3000/api/health

返回示例：
```json
{
  "status": "ok",
  "message": "MySQL 连接成功",
  "data": [{ "ok": 1 }]
}
```

## API 路由

> 基础地址：`/api`（通过 Vite 代理转发至 `http://localhost:3000`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/init` | 初始化数据库表（建表 + 添加 deleted_at/notes 列） |
| GET | `/health` | 数据库连通性测试 |
| GET | `/folders` | 获取所有文件夹（扁平列表） |
| POST | `/folders` | 创建文件夹 `{ name, parentId }` |
| PUT | `/folders/:id` | 重命名文件夹 `{ name }` |
| DELETE | `/folders/:id` | 移入回收站（软删除） |
| GET | `/trash` | 获取回收站所有已删除文件夹和文章 |
| POST | `/folders/:id/restore` | 从回收站恢复文件夹 |
| DELETE | `/folders/:id/force` | 永久删除文件夹 |
| GET | `/article/:id` | 获取单篇文章 |
| GET | `/articles/:folderId` | 获取文件夹下所有文章 |
| POST | `/articles` | 创建文章 |
| PUT | `/articles/:id` | 更新文章（支持 `title`, `content`, `folderId`, `type`, `answers`, `questions`, `sections`, `picked`） |
| GET | `/articles/:id/notes` | 读取笔记生文本（支持 `?section=`） |
| PUT | `/articles/:id/notes` | 保存笔记生文本（`{ notes }`，原样存储不做解析；带 `?section=` 时只合并该节） |
| GET | `/articles/:id/marks` | 获取文章重点标记（返回 JSON 对象，支持 `?section=`） |
| PUT | `/articles/:id/marks` | 保存重点标记（body `{ marks }`；带 `?section=` 时只合并该节） |
| DELETE | `/articles/:id` | **硬删除**文章（先手动删 canvas_strokes，再删文章） |
| GET | `/annotations/:articleId` | 获取文章批注 |
| POST | `/annotations` | 创建批注 |
| PUT | `/annotations/:id` | 更新批注注释 |
| DELETE | `/annotations/:id` | 删除批注 |
| GET | `/lookup?word=xxx` | 查有道词典（LRU 缓存 2000 条，8 秒超时，请求去重） |
| GET | `/suggest?q=xxx` | 有道联想词建议 |
| GET | `/tts?word=hello&accent=uk` | TTS 发音代理（服务端 LRU 缓存 500 条，请求去重，Keep-Alive） |
| GET | `/favorites` | 获取所有收藏文章 ID |
| POST | `/favorites/:articleId` | 切换收藏状态 |
| GET | `/canvas-strokes/:articleId` | 获取画布笔迹 |
| POST | `/canvas-strokes/:articleId` | 保存画布笔迹 `{ strokes: [...] }` |
| POST | `/run-python` | 启动本地 Python 脚本 `{ key }`（key 白名单，见 `docs/python-env.md`） |

### 完整启动流程

```bash
# 1. 创建数据库
mysql -u root -e "CREATE DATABASE IF NOT EXISTS language_learning DEFAULT CHARACTER SET utf8mb4"

# 2. 修改 .env 中的 MySQL 密码（如需）

# 3. 启动后端
npm run dev:server

# 4. 启动前端（新终端）
npm run dev
```

访问前端后，组件会自动调用 `/api/init` 建表并加载数据。

## 数据库表结构

### folders 表

```sql
CREATE TABLE folders (
  id         VARCHAR(64)  PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  parent_id  VARCHAR(64)  DEFAULT NULL,
  deleted_at TIMESTAMP    NULL DEFAULT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
```

### articles 表

```sql
CREATE TABLE articles (
  id              VARCHAR(64)  PRIMARY KEY,
  title           VARCHAR(500) NOT NULL,
  content         TEXT,
  folder_id       VARCHAR(64)  NOT NULL,   -- 无外键约束，删除文件夹由应用代码处理
  type            VARCHAR(32)  DEFAULT '', -- '' 普通外刊 / kaoyan-* 考研英语题
  questions       TEXT,                    -- 题目区原文（考研）
  answers         TEXT,                    -- 正确答案 JSON 文本（考研）
  sections        TEXT,                    -- 多题型内容 JSON（考研）
  picked          TEXT,                    -- 作答进度 JSON（考研）
  notes           TEXT,          -- 笔记生文本（原样存储；考研文章为分节 JSON）
  marks           TEXT,          -- 重点词汇标记（JSON 文本，键 `noteIndex__词汇`，值 true）
  deleted_at      TIMESTAMP    NULL DEFAULT NULL,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
```

> `type` / `questions` / `answers` / `sections` / `picked` / `notes` / `marks` 由后端**模块加载时的启动 IIFE**
> 用 `ALTER TABLE ... ADD COLUMN` 幂等补齐（失败静默忽略）；`deleted_at` 由 `POST /api/init` 补齐。

### annotations 表

```sql
CREATE TABLE annotations (
  id              VARCHAR(64)  PRIMARY KEY,
  article_id      VARCHAR(64)  NOT NULL,
  paragraph_index INT          NOT NULL,
  start_offset    INT          NOT NULL,
  end_offset      INT          NOT NULL,
  text            TEXT         NOT NULL,
  type            VARCHAR(20)  NOT NULL,  -- highlight / underline（sentence 已从前端移除）
  color           VARCHAR(20)  NOT NULL,
  note            TEXT,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);
```

### favorites 表

```sql
CREATE TABLE favorites (
  article_id VARCHAR(64) PRIMARY KEY,
  created_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);
```

### canvas_strokes 表

```sql
CREATE TABLE canvas_strokes (
  article_id   VARCHAR(64) PRIMARY KEY,
  strokes_data JSON       NOT NULL,
  updated_at   TIMESTAMP  DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

## 数据库操作示例

```js
import pool from './db.js'

// 查询
const [rows] = await pool.query('SELECT * FROM folders WHERE id = ?', [id])

// 插入
const [result] = await pool.query('INSERT INTO folders (id, name) VALUES (?, ?)', [id, name])

// 更新
await pool.query('UPDATE folders SET name = ? WHERE id = ?', [name, id])

// 删除
await pool.query('DELETE FROM folders WHERE id = ?', [id])
```

## 数据库备份与恢复

项目中的 `db/language_learning.sql` 是 Git 跟踪的数据库备份，用于换电脑时迁移数据。

### 更新备份

```bash
mysqldump -u root --databases language_learning > db/language_learning.sql
```

### 恢复备份

```bash
mysql -u root -e "CREATE DATABASE IF NOT EXISTS language_learning DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root language_learning < db/language_learning.sql
```

> 如果 MySQL 设置了 root 密码，上述命令中需添加 `-p` 参数（例如 `mysql -u root -p ...`）。

### 笔记（notes）

`notes` 列为 TEXT 类型，按文章存储**用户粘贴的整篇笔记生文本**（不做任何解析/处理，原样存储）：

```
1. The justices green-light a near-total abortion ban in Texas.
最高法院的法官们为得克萨斯州近乎全面的堕胎禁令开了绿灯。
（green-light 批准；near-total 近乎全面的）
```

- 解析逻辑在前端 `NotePanel.vue` 的 `parseRaw()`：按 `/^\d+\.\s?/` 切块 → 英文(第1行) / 中文(第2行) / 词汇(`（...）` 行，`\` 分隔)
- 后端启动时自动执行 `ALTER TABLE articles ADD COLUMN notes TEXT`
- 通过 `PUT /api/articles/:id/notes` 写入，`GET /api/articles/:id/notes` 读取（考研文章带 `?section=题型` 分节）
- 重点标记（双击词汇）**入库**：存 `articles.marks`（TEXT，JSON 对象，键为 `noteIndex__词汇`、值为 `true`）
- 读取 `GET /api/articles/:id/marks`，写入 `PUT /api/articles/:id/marks`（整体覆盖，body `{ marks }`）
- 后端启动时自动执行 `ALTER TABLE articles ADD COLUMN marks TEXT`（幂等，失败忽略）

## 注意事项

- `favorites`、`canvas_strokes` 表通过 `/api/init` 自动创建，无需手动建表；`canvas_strokes` API 还支持自动建表
- 旧版数据库迁移：`/api/init` 会自动清理 `subtitle`、`journal_name`、`publish_date` 等旧字段（2026-07 已移除该迁移代码）
- `translation` 列已从数据库彻底删除（2026-07）
- `notes` / `marks` 两列均通过后端**启动时**自动迁移添加（`ALTER TABLE articles ADD COLUMN ...`，失败则忽略）
- ⚠️ 后端是 `node server/index.js`，**没有热更新**：改完 `server/index.js` 必须**重启后端进程**才生效。
  否则新增的路由会 404、启动时才执行的 `ALTER TABLE` 也不会跑，表现为「接口 404 / 数据看着没入库」。
  排查时用 `curl http://localhost:3000/api/articles/<id>/marks` 确认路由是否真的加载了
- `paragraph_notes` 列为历史遗留：旧段落笔记功能（NoteEditor）已移除，该列无代码读写，保留仅为数据兼容
- 字符集统一使用 `utf8mb4`，支持 emoji 和中文
