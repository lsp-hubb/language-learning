# TXT 文章批量导入指南

## TXT 文件格式要求

每个 TXT 文件代表一篇文章，格式如下：

```
文章标题（第一行）
正文第一段
正文第二段
正文第三段
...
```

- **首行**：文章的标题
- **第二行起**：文章的正文内容
- 编码：UTF-8（无 BOM）
- 文件名按数字顺序排序（如 `01.txt`、`02.txt`），导入后将按此顺序编号

## 快速导入流程

### 1. 获取目标文件夹 ID

启动后端后，查询所有文件夹：

```bash
node -e "
const mysql=require('mysql2/promise');
require('dotenv').config({path:'D:/PythonFiles/Language-learning/.env'});
(async()=>{
  const p=mysql.createPool({
    host:process.env.DB_HOST,port:+process.env.DB_PORT||3306,
    user:process.env.DB_USER,password:process.env.DB_PASSWORD||'',
    database:process.env.DB_NAME||'language_learning',waitForConnections:true
  });
  const[r]=await p.query('SELECT id,name FROM folders WHERE deleted_at IS NULL ORDER BY name');
  console.table(r);
  await p.end();
})();
"
```

找到目标文件夹的 `id`（UUID 格式）。

### 2. 编写导入脚本

在 `scripts/` 目录新建 `.cjs` 文件（可直接复制 `scripts/reimport_all.cjs` 改参数），模板如下：

```javascript
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ===== 修改以下两个参数 =====
const TXT_DIR = process.env.TXT_DIR || 'D:\\path\\to\\your\\txt\\folder';   // TXT 文件夹路径（可用环境变量覆盖）
const FOLDER_ID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';  // 目标文件夹 ID
// ===========================

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'language_learning', waitForConnections: true,
  });

  // 可选：先删除目标文件夹下的旧文章
  // const [del] = await pool.query('DELETE FROM articles WHERE folder_id = ?', [FOLDER_ID]);
  // console.log(`已删除 ${del.affectedRows} 篇旧文章`);

  // 读取并排序 TXT 文件
  const files = fs.readdirSync(TXT_DIR)
    .filter(f => f.endsWith('.txt'))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] || '0');
      const nb = parseInt(b.match(/\d+/)?.[0] || '0');
      return na - nb;
    });

  console.log(`找到 ${files.length} 个 TXT 文件`);

  let success = 0;
  for (let i = 0; i < files.length; i++) {
    const filePath = path.join(TXT_DIR, files[i]);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const rawTitle = (lines[0] || '').replace(/\r$/, '').trim();
    const body = lines.slice(1).join('\n').trim();

    if (!rawTitle) {
      console.warn(`⚠ ${files[i]}: 跳过，首行为空`);
      continue;
    }

    // 标题前添加序号 "1. "、"2. "、...
    const title = `${i + 1}. ${rawTitle}`;
    const id = crypto.randomUUID();

    await pool.query(
      'INSERT INTO articles (id, title, content, folder_id) VALUES (?, ?, ?, ?)',
      [id, title, body, FOLDER_ID]
    );
    console.log(`✅ ${title.slice(0, 50)}...`);
    success++;
  }

  console.log(`\n完成！成功导入 ${success}/${files.length} 篇文章`);
  await pool.end();
})();
```

### 3. 运行脚本

```bash
node scripts/reimport_all.cjs
```

依赖 `mysql2` 与 `dotenv`（项目已安装），直接读项目根 `.env` 连库。

路径都用环境变量覆盖，不必改脚本：

```bash
set TXT_DIR=D:\my\txt
set FOLDER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
node scripts/reimport_all.cjs
```

> ⚠️ 现成的 `scripts/reimport_all.cjs` **会先 `DELETE FROM articles WHERE folder_id = ?`**
> （第 50 行是**启用**状态），即导入前清空目标文件夹下的旧文章。
> 想保留旧文章请先注释掉该行；上方模板里这一行默认是注释掉的。
> 脚本顶部的默认 `FOLDER_ID` 指向「考研英语」根目录，换目标务必显式传 `FOLDER_ID`。

### 4. 刷新页面

浏览器中按 **Ctrl + F5** 硬刷新，即可看到新导入的文章。

## 常用变体

### 不加编号

将标题行改为：

```javascript
const title = rawTitle;  // 不加 "序号. " 前缀
```

### 只在标题前加编号，不清除旧文章

注释掉删除旧文章的代码段即可。

### 导入到新文件夹

先通过前端界面创建新文件夹，再用第 1 步的方法查到其 UUID，填入 `FOLDER_ID`。

### 导入到「考研英语」目录（仅标题）

脚本会**自动判定**目标文件夹：若 `FOLDER_ID` 所在的祖先链中任意一层名为「考研英语」（含其子目录），则本次导入改为**仅导入标题、正文留空**——考研英语文章的内容需分「题目原文 / 题目 / 答案」三块录入，进入文章后在试题页「录入 / 编辑」中粘贴原文即可（文章仍会自动进入试题页，因为后端读取时按目录补全 `type`）。

其他文件夹不受影响，仍导入「标题 + 正文」。运行时会打印当前模式，例如：

```
导入模式: 考研英语目录 → 仅导入标题（正文留空）
```

## 数据库表结构参考

```sql
-- articles 表
id          VARCHAR(64) PRIMARY KEY,   -- UUID
title       VARCHAR(500) NOT NULL,     -- 文章标题（含编号）
content     TEXT,                      -- 正文内容（考研题：题目原文）
folder_id   VARCHAR(64) NOT NULL,      -- 所属文件夹（无外键约束）
type        VARCHAR(32) DEFAULT '',    -- '' 普通外刊 / kaoyan-* 考研英语题
questions   TEXT,                      -- 题目区原文（考研）
answers     TEXT,                      -- 正确答案 JSON 文本（考研）
sections    TEXT,                      -- 多题型内容 JSON（考研）
picked      TEXT,                      -- 作答进度 JSON（考研）
notes       TEXT,                      -- 笔记生文本（前端解析展示）
marks       TEXT,                      -- 重点标记 JSON（键 `noteIndex__词汇`，值 true）
created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
deleted_at  TIMESTAMP NULL DEFAULT NULL
```

> `type` / `questions` / `answers` / `sections` / `picked` / `notes` / `marks` 由后端启动时
> 用 `ALTER TABLE ... ADD COLUMN` 幂等补齐，导入脚本无需关心。
