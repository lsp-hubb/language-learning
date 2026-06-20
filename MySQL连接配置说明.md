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

> 基础地址：`/api`（通过 Vite 代理转发至 `http://localhost:3000`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/init` | 初始化数据库表（建表 + 迁移旧表） |
| GET | `/health` | 数据库连通性测试 |
| POST | `/verify-code` | 验证访问码 |
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
| PUT | `/articles/:id` | 更新文章 |
| DELETE | `/articles/:id` | 删除文章 |
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
  id         VARCHAR(64)  PRIMARY KEY,
  title      VARCHAR(500) NOT NULL,
  content    TEXT,
  folder_id  VARCHAR(64)  NOT NULL,
  deleted_at TIMESTAMP    NULL DEFAULT NULL,
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

## 注意事项

- `favorites`、`canvas_strokes` 表通过 `/api/init` 自动创建，无需手动建表；`canvas_strokes` API 还支持自动建表
- 旧版数据库迁移：`/api/init` 会自动清理 `subtitle`、`journal_name`、`publish_date` 等旧字段
- 字符集统一使用 `utf8mb4`，支持 emoji 和中文
