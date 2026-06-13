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

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/init` | 初始化数据库表（建表 + 迁移旧表） |
| GET | `/api/health` | 数据库连通性测试 |
| POST | `/api/verify-code` | 验证访问码 |
| GET | `/api/folders` | 获取所有文件夹（扁平列表） |
| POST | `/api/folders` | 创建文件夹 `{ name, parentId }` |
| PUT | `/api/folders/:id` | 重命名文件夹 `{ name }` |
| DELETE | `/api/folders/:id` | 递归删除文件夹 |
| GET | `/api/article/:id` | 获取单篇文章 |
| GET | `/api/articles/:folderId` | 获取文件夹下所有文章 |
| POST | `/api/articles` | 创建文章 |
| PUT | `/api/articles/:id` | 更新文章 |
| DELETE | `/api/articles/:id` | 删除文章 |
| GET | `/api/annotations/:articleId` | 获取文章批注 |
| POST | `/api/annotations` | 创建批注 |
| PUT | `/api/annotations/:id` | 更新批注注释 |
| DELETE | `/api/annotations/:id` | 删除批注 |
| GET | `/api/lookup?word=xxx` | 查有道词典 |
| GET | `/api/suggest?q=xxx` | 有道联想词建议 |
| GET | `/api/favorites` | 获取所有收藏文章 ID |
| POST | `/api/favorites/:articleId` | 切换收藏状态 |
| GET | `/api/canvas-strokes/:articleId` | 获取画布笔迹 |
| POST | `/api/canvas-strokes/:articleId` | 保存画布笔迹 `{ strokes: [...] }` |

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
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
```

### articles 表

```sql
CREATE TABLE articles (
  id         VARCHAR(64)  PRIMARY KEY,
  title      VARCHAR(500) NOT NULL,
  content    TEXT,
  folder_id  VARCHAR(64)  NOT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
```

### annotations 表

```sql
CREATE TABLE annotations (
  id              VARCHAR(64)  PRIMARY KEY,
  article_id      VARCHAR(64)  NOT NULL,
  paragraph_index INT          NOT NULL,
  start_offset    INT          NOT NULL,
  end_offset      INT          NOT NULL,
  text            TEXT         NOT NULL,
  type            VARCHAR(20)  NOT NULL,
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

## 注意事项

- `favorites`、`canvas_strokes` 表通过 `/api/init` 自动创建，无需手动建表；`canvas_strokes` API 还支持自动建表
- 旧版数据库迁移：`/api/init` 会自动清理 `subtitle`、`journal_name`、`publish_date` 等旧字段
- 字符集统一使用 `utf8mb4`，支持 emoji 和中文
