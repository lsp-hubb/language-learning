# Language Learning

外语阅读辅助工具 — 读英文文章、查词、添加批注、手绘标记、段落翻译。

## 功能

- **文件夹管理** — 无限层级嵌套，右键菜单（新建/重命名/删除），面包屑导航，刷新保持位置
- **回收站** — 删除的文件夹和文章移入回收站（软删除），支持恢复和永久删除
- **英文文章阅读/编辑** — 两端对齐排版，滚动条在容器右侧，支持编辑模式
- **智能单词查询** — 选中单词自动查询有道词典（音标、释义、翻译），LRU 缓存去重（2000 条），T 键全局开关；音标区悬停播放英式/美式发音
- **手动查词卡片** — Ctrl+Shift+Z 打开，支持输入查词、联想词下拉、一键复制、任意拖动、位置记忆、TTS 自动发音
- **TTS 发音代理** — 服务端代理有道 dictvoice，MP3 缓存（500 条），请求去重，Keep-Alive 连接池
- **PDF 风格批注** — E 高亮（黄色 #FFEB3B）/ W 下划线（红色 #e74c3c），自动填入查词释义，悬停 200ms 查看注释并自动发音，点击编辑 textarea，Ctrl+Enter/失焦保存，Delete 删除
- **三种批注类型** — `highlight`（高亮）、`underline`（下划线）、`sentence`（长难句），可互相叠加，同类型不可重叠
- **长难句标注** — 选中句子后按 r 键，字体变蓝色（#2980b9），自动扩展为整句并保存对应中文翻译到注释
- **段落翻译** — 点击工具栏「导入翻译」粘贴中文翻译（每段一行），悬停英文段落按 S 键切换显示/隐藏，数据持久化到 MySQL
- **翻译句子高亮** — 选中英文文本时，对应中文翻译句子自动高亮（粉色背景 #fce4ec），取消选中后高亮保持
- **手绘画布** — Ctrl+R 开启/关闭，画笔/波浪线(Q 切换)/矩形/矩形擦除，6 色（红/深蓝/蓝/绿/橙/紫），笔迹按文章 MySQL 存储，支持局域网共享，页面缩放自适应
- **收藏文章** — SVG 书签图标切换收藏，数据持久化
- **外部链接面板** — 右侧悬浮面板嵌入腾讯元宝 iframe 用于翻译/提问，L 键开关，默认展开
- **阅读计时器** — 工具栏显示，点击切换开始/暂停/归零
- **英文单词数统计** — 工具栏实时显示文章单词数
- **批注工具栏开关** — 默认关闭浮动批注栏，点击标题栏 ▼ 手动开启；收起时标题栏内嵌高亮/下划线按钮
- **阅读区左侧工具栏** — 书签面板（同文件夹所有文章标题，点击跳转）、Python 脚本启动按钮、批量删除按钮
- **重启恢复** — 刷新/重启后自动回到上次浏览的文件夹或文章页面（localStorage 持久化）
- **多标签页** — 每篇文章独立标签页（window.open），同一文章复用标签
- **局域网共享** — 同一网络下多设备可同时访问，共享文章和批注数据（无验证码）
- **Python 脚本集成** — 后端通过 child_process 调用本地 Python GUI 脚本（独立进程，不阻塞服务）
- **MySQL 数据库备份** — db/language_learning.sql 通过 Git 跟踪，方便换电脑迁移数据

## 从零开始的安装说明

### 1. 环境要求

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| **Node.js** | ^20.19.0 或 >=22.12.0 | [下载](https://nodejs.org/) |
| **MySQL** | 8.0 | [下载](https://dev.mysql.com/downloads/installer/) |
| **npm** | 随 Node.js 自带 | — |
| **Git**（可选） | — | 用于克隆仓库，[下载](https://git-scm.com/) |

### 2. 获取代码

```bash
# 方式一：克隆仓库（需要 Git）
git clone git@github.com:lsp-hubb/language-learning.git
cd language-learning

# 方式二：直接下载 ZIP
# https://github.com/lsp-hubb/language-learning/archive/refs/heads/main.zip
# 解压后进入目录
```

### 3. 安装依赖

```bash
npm install
```

### 4. 配置 MySQL

#### 4.1 确保 MySQL 服务运行

```bash
# Windows — 检查 MySQL80 服务状态
sc query MySQL80

# 如果未运行，以管理员身份启动：
net start MySQL80

# 或双击项目根目录的 start-mysql.bat
```

#### 4.2 创建数据库

```bash
# 方式一：命令行
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS language_learning DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 方式二：MySQL Workbench 等 GUI 工具新建数据库 language_learning
```

#### 4.3 配置环境变量

在项目根目录创建 `.env` 文件（已加入 `.gitignore`，不会提交到 Git）：

```ini
# MySQL 数据库连接配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=          # 你的 MySQL 密码（默认为空）
DB_NAME=language_learning

# 服务端端口
SERVER_PORT=3000
```

### 5. 首次启动（初始化数据库）

#### 一键启动（Windows 推荐）

```bash
start.bat
```

此命令会自动：
1. 清理旧 Node 进程
2. 启动后端（端口 3000）
3. 启动前端（端口 5173，监听 `0.0.0.0`）
4. 显示局域网 IP 地址
5. 打开浏览器

#### 手动分别启动

```bash
# 终端 1：后端
npm run dev:server

# 终端 2：前端
npm run dev
```

#### 初始化数据库表

首次启动后，浏览器访问：

```
http://localhost:5173
```

前端会自动调用 `POST /api/init` 创建数据表。也可手动触发：

```bash
curl -X POST http://localhost:3000/api/init
```

> 画布笔迹 API（`canvas-strokes`）支持自动建表，无需手动 init。

### 6. 访问应用

| 地址 | 说明 |
|------|------|
| `http://localhost:5173` | 本机访问 |
| `http://192.168.x.x:5173` | 局域网其他设备访问 |

#### 局域网访问（首次需开放防火墙）

```cmd
netsh advfirewall firewall add rule name="Vite5173" dir=in action=allow protocol=TCP localport=5173
```

### 7. 换电脑后恢复数据

项目根目录的 `db/language_learning.sql` 是数据库完整备份（通过 Git 同步），在新电脑上按以下步骤恢复：

```bash
# 1. 克隆代码（或 git pull 拉取最新）
git clone git@github.com:lsp-hubb/language-learning.git
cd language-learning && npm install

# 2. 配置 .env（修改 DB_PASSWORD 为你的 MySQL 密码）

# 3. 创建数据库并导入备份数据
mysql -u root -e "CREATE DATABASE IF NOT EXISTS language_learning DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root language_learning < db/language_learning.sql

# 4. 启动应用
start-mysql.bat   # 先确保 MySQL 运行
start.bat         # 启动前/后端
```

> 如果 MySQL 设置了 root 密码，命令中需添加 `-p` 参数：`mysql -u root -p ...`

> 每次新增文章或数据后，建议重新导出更新备份：
> ```bash
> mysqldump -u root --databases language_learning > db/language_learning.sql
> git add . && git commit -m "feat: 更新数据库备份" && git push
> ```

## 项目结构

```
Language-learning/
├── server/                  # Express 后端 + MySQL
│   ├── db.js                # 数据库连接池
│   └── index.js             # API 路由（所有业务逻辑）
├── src/                     # Vue 3 前端
│   ├── views/
│   │   ├── ArticlePage.vue  # 文章阅读/编辑页（编排层）
│   │   └── ReviewPage.vue   # 复习页面（待开发）
│   ├── components/
│   │   ├── FileExplorer.vue # 文件管理器主页
│   │   ├── FolderTree.vue   # 左侧文件夹树
│   │   ├── ContentArea.vue  # 中间内容区域
│   │   ├── ArticleCard.vue  # 文章卡片（收藏 SVG 书签图标）
│   │   ├── ArticleToolbar.vue   # 顶部工具栏
│   │   ├── ArticleReader.vue    # 文章阅读器（段落/批注/画布）
│   │   ├── ArticleEditor.vue    # 文章编辑器
│   │   ├── AnnotToolbar.vue     # 浮动批注工具栏
│   │   ├── WordCard.vue         # 自动查词卡片
│   │   ├── ManualWordCard.vue   # 手动查词卡片
│   │   ├── AnnotationCard.vue   # 批注详情卡片
│   │   ├── BookmarksPanel.vue   # 书签面板
│   │   ├── DrawCanvas.vue       # 画布绘制组件
│   │   ├── FolderDialog.vue     # 文件夹创建/重命名弹窗
│   │   ├── ArticleDialog.vue    # 新建文章弹窗
│   │   ├── ContextMenu.vue      # 右键菜单
│   │   └── CodeGate.vue         # 访问验证（已移除验证码，直接放行）
│   ├── composables/
│   │   ├── useWordLookup.js     # 单词查询 + 文本选择
│   │   ├── useAnnotations.js    # 批注 CRUD + 工具栏/卡片 UI
│   │   ├── useCanvas.js         # 画布模式/工具/颜色
│   │   └── useTimer.js          # 阅读计时器
│   ├── api/index.js          # API 请求封装
│   ├── stores/fileExplorer.js # Pinia 状态管理
│   ├── router/index.js       # 路由配置
│   └── assets/               # 全局样式
├── db/
│   └── language_learning.sql # 数据库备份（Git 跟踪）
├── docs/                     # 辅助技术文档
│   ├── MySQL连接配置说明.md
│   ├── python-env.md
│   ├── recycle-bin.md
│   └── abbrev-dot.md
├── markdown/
│   ├── ARCHITECTURE.md       # 项目架构文档（详细）
│   └── GIT_GUIDE.md          # Git 使用指南
├── start.bat                 # Windows 一键启动
├── start-mysql.bat           # MySQL 启动脚本
├── .env                      # 环境变量（已 .gitignore）
├── .gitignore
├── .prettierrc.json          # 代码格式化配置
├── index.html                # Vite 入口 HTML
├── jsconfig.json             # 路径别名 @/ → src/
├── package.json              # 依赖与脚本
├── vite.config.js            # Vite 构建配置
├── vitest.config.js          # 单元测试配置
├── playwright.config.js      # E2E 测试配置
└── e2e/vue.spec.js           # Playwright E2E 测试
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| E / W | 高亮 / 下划线 |
| T | 全局开关单词查询 |
| Ctrl+R | 开关画布模式 |
| r | 长难句标注（选中句子后按 r，对应翻译自动存入注释） |
| L | 开关右侧链接面板 |
| Ctrl+Shift+Z | 打开/关闭手动查词卡片 |
| S | 切换当前悬停段落的翻译显示/隐藏（需先导入翻译） |
| Space | 画布模式下循环切换画笔颜色（画笔/矩形工具激活时） |
| 1 | 画笔（Q 切换直线/波浪线） |
| 2 | 矩形 |
| 3 | 矩形擦除 |
| Q | 切换画笔样式（直线 ↔ 波浪线，画布开启时） |
| Esc | 取消选中 / 关闭浮动卡片 / 关闭画布并保存 |
| Delete / Backspace | 删除当前查看的批注；光标在长难句内直接删除最深层 sentence |
| 方向键 / PgUp / PgDn | 翻页 |
| Home / End | 首页 / 末页 |

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | Vue 3 (Composition API + `<script setup>`) | ^3.5 |
| 构建工具 | Vite | ^8.0 |
| 状态管理 | Pinia | ^3.0 |
| 路由 | Vue Router | ^5.0 |
| 后端框架 | Express | ^5.2 |
| 数据库 | MySQL (mysql2/promise) | ^3.22 |
| 代码格式化 | Prettier | 3.8.3 |
| 单元测试 | Vitest + @vue/test-utils + jsdom | — |
| E2E 测试 | Playwright | — |

其他集成：
- **有道词典** — 服务端 HTML 解析，LRU 缓存 2000 条，请求去重，8 秒超时
- **TTS 发音** — 服务端代理有道 dictvoice，MP3 缓存 500 条，Keep-Alive 连接池
- **Python 3.11** — 虚拟环境 `F:\PythonProject\.venv`，通过 `child_process.spawn` 调用 GUI 脚本
- **腾讯元宝** — 右侧 iframe 嵌入用于翻译/提问

## 脚本命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器（前端，监听 0.0.0.0） |
| `npm run dev:server` | 启动 Express 后端 |
| `npm run build` | 生产构建 |
| `npm run preview` | 预览生产构建 |
| `npm run test:unit` | 运行 Vitest 单元测试 |
| `npm run test:e2e` | 运行 Playwright E2E 测试 |
| `npm run format` | Prettier 代码格式化 |

## 数据库表（5 张）

| 表 | 说明 |
|----|------|
| `folders` | 文件夹（含 `deleted_at` 支持回收站） |
| `articles` | 文章（含 `translation` 段落翻译、`deleted_at` 回收站） |
| `annotations` | 批注（highlight/underline/sentence 三种类型） |
| `favorites` | 收藏（article_id 主键，级联删除） |
| `canvas_strokes` | 画布笔迹（JSON 存储，每篇文章一条） |

## 文档

| 文件 | 说明 |
|------|------|
| [ARCHITECTURE.md](./markdown/ARCHITECTURE.md) | 项目架构文档（详细架构、API 列表、数据流、组件关系） |
| [GIT_GUIDE.md](./markdown/GIT_GUIDE.md) | Git 使用指南 |
| [MySQL连接配置说明.md](./docs/MySQL连接配置说明.md) | 数据库配置说明（含表结构 DDL） |
| [python-env.md](./docs/python-env.md) | Python 虚拟环境说明 |
| [recycle-bin.md](./docs/recycle-bin.md) | 回收站功能说明 |
| [abbrev-dot.md](./docs/abbrev-dot.md) | 英文句点误判问题（长难句分割逻辑） |
| [TXT_IMPORT.md](./markdown/TXT_IMPORT.md) | TXT 文章批量导入指南（`scripts/` 配套脚本） |
