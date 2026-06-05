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
├── .env.example       # 环境变量模板
└── MySQL连接配置说明.md # 本文件
```

## 快速开始

### 1. 安装依赖

```bash
npm install express mysql2 cors dotenv
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
node server/index.js

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
| POST | `/api/init` | 初始化数据库表（建表） |
| GET | `/api/health` | 数据库连通性测试 |
| GET | `/api/folders` | 获取所有文件夹（扁平列表） |
| POST | `/api/folders` | 创建文件夹 `{ name, parentId }` |
| PUT | `/api/folders/:id` | 重命名文件夹 `{ name }` |
| DELETE | `/api/folders/:id` | 删除文件夹（递归删除所有子文件夹） |

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

自动创建 `folders` 表：

```sql
CREATE TABLE folders (
  id         VARCHAR(64)  PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  parent_id  VARCHAR(64)  DEFAULT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
```

## 数据库操作示例

```js
import { query } from './db.js'

// 查询
const [users] = await query('SELECT * FROM users WHERE id = ?', [1])

// 插入
const [result] = await query('INSERT INTO users (name) VALUES (?)', ['Alice'])
console.log(result.insertId)
```

如需事务支持：

```js
import { getPool } from './db.js'
const pool = getPool()
const conn = await pool.getConnection()
try {
  await conn.beginTransaction()
  // ... 业务操作
  await conn.commit()
} catch (err) {
  await conn.rollback()
  throw err
} finally {
  conn.release()
}
```
