# Language Learning — 项目架构文档

## 项目概述

**Language Learning** 是一个外语阅读辅助工具，帮助用户阅读英文文章并实时查词、添加批注。基于 **Vue 3 + Vite + Pinia** 前端和 **Express + MySQL** 后端构建。

### 核心功能

1. **文件夹管理** — 支持无限层级嵌套的文件夹，CRUD 操作，右键菜单
2. **外刊文章管理** — 在文件夹中创建、编辑、查看英文文章
3. **智能单词查询** — 选中英文单词后，自动查询有道词典，弹出浮动词卡展示音标、释义
4. **PDF 风格批注** — 黄色高亮 + 红色下划线，悬停查看注释，点击编辑，按 Delete 键删除，数据保存在 MySQL
5. **访问验证** — 8 位一次性验证码，仅局域网其他设备需验证，本机免验证
6. **局域网共享** — 同一网络下多设备可同时访问，共享文章和批注数据

---

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | Vue 3 (Composition API + `<script setup>`) | ^3.5 |
| 构建工具 | Vite | ^8.0 |
| 状态管理 | Pinia | ^3.0 |
| 路由 | Vue Router | ^5.0 |
| 后端框架 | Express | ^5.2 |
| 数据库 | MySQL (mysql2/promise) | ^3.22 |
| 代码格式化 | Prettier | — |
| 单元测试 | Vitest + @vue/test-utils + jsdom | — |
| E2E 测试 | Playwright | — |

---

## 目录结构

```
Language-learning/
├── index.html                          # Vite 入口 HTML
├── jsconfig.json                       # 路径别名 @/ → src/
├── package.json                        # 项目依赖与脚本
├── vite.config.js                      # Vite 构建配置 (含代理 + LAN 访问)
├── vitest.config.js                    # 单元测试配置
├── playwright.config.js                # E2E 测试配置
├── .prettierrc.json                    # 代码格式化规则
├── .env                                # 环境变量（数据库配置）
├── .gitignore
├── start.bat                           # Windows 一键启动脚本 (显示 LAN IP)
├── README.md
├── ARCHITECTURE.md                     # 项目架构文档
├── GIT_GUIDE.md                        # Git 使用指南
├── MySQL连接配置说明.md                 # 数据库配置文档
│
├── public/
│   └── favicon.ico
│
├── server/                             # 后端服务
│   ├── db.js                           # MySQL 连接池
│   └── index.js                        # Express API 服务（核心后端）
│
├── src/                                # 前端源码
│   ├── main.js                         # Vue 应用入口
│   ├── App.vue                         # 根组件（含 CodeGate 验证门）
│   ├── api/
│   │   └── index.js                    # 所有 API 请求封装（相对路径 /api）
│   ├── assets/
│   │   ├── base.css                    # 全局 CSS Reset
│   │   └── main.css                    # 导入 base.css
│   ├── router/
│   │   └── index.js                    # Vue Router 路由配置
│   ├── stores/
│   │   └── fileExplorer.js             # Pinia 状态管理
│   ├── views/
│   │   └── ArticlePage.vue             # 文章阅读/编辑页（含批注功能）
│   └── components/
│       ├── FileExplorer.vue            # 文件管理器主组件
│       ├── FolderTree.vue              # 左侧文件夹树
│       ├── ContentArea.vue             # 主内容区（文件夹+文章网格）
│       ├── ArticleCard.vue             # 文章卡片
│       ├── ArticleDialog.vue           # 新建文章对话框
│       ├── FolderDialog.vue            # 文件夹创建/重命名对话框
│       ├── ContextMenu.vue             # 右键菜单
│       ├── WordCard.vue                # 浮动单词查询卡片
│       ├── AnnotationCard.vue          # 浮动批注卡片
│       ├── CodeGate.vue                # 访问验证码弹窗
│       ├── icons/                      # (空)
│       └── __tests__/
│           └── FileExplorer.spec.js    # 组件单元测试
│
└── e2e/
    └── vue.spec.js                     # Playwright E2E 测试
```

---

## 数据流架构

```
用户操作 → Vue组件 → Pinia Store → API层 (fetch) → Vite代理 → Express后端 → MySQL数据库
                                                                    ↓
                                                            有道词典 (服务端代理)
```

- **前端**：`localhost:5173` / LAN: `192.168.x.x:5173`（Vite Dev Server，监听 `0.0.0.0`）
- **后端**：`localhost:3000`（Express，通过 Vite 代理转发，不直接对外暴露）
- **前后端通信**：前端使用 `/api` 相对路径，Vite 代理转发至后端
- **局域网访问**：其他设备通过 `http://<主机IP>:5173` 访问

---

## 数据库表结构

### `folders` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | VARCHAR(64) | 主键，UUID |
| `name` | VARCHAR(255) | 文件夹名称 |
| `parent_id` | VARCHAR(64) | 父文件夹 ID（NULL 表示根目录） |
| `created_at` | TIMESTAMP | 创建时间 |

### `articles` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | VARCHAR(64) | 主键，UUID |
| `title` | VARCHAR(500) | 文章标题 |
| `content` | TEXT | 文章正文 |
| `folder_id` | VARCHAR(64) | 所属文件夹 ID |
| `created_at` | TIMESTAMP | 创建时间 |

### `annotations` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | VARCHAR(64) | 主键，UUID |
| `article_id` | VARCHAR(64) | 所属文章 ID（外键，级联删除） |
| `paragraph_index` | INT | 段落索引 |
| `start_offset` | INT | 批注起始偏移 |
| `end_offset` | INT | 批注结束偏移 |
| `text` | TEXT | 被标注的文本 |
| `type` | VARCHAR(20) | 批注类型（`highlight` / `underline`） |
| `color` | VARCHAR(20) | 颜色（`#FFEB3B` / `#e74c3c`） |
| `note` | TEXT | 注释内容 |
| `created_at` | TIMESTAMP | 创建时间 |

---

## 后端 API 接口

基础地址：`/api`（通过 Vite 代理转发至 `http://localhost:3000`）

### 系统

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/init` | 初始化数据库建表 + 迁移 |
| GET | `/health` | 健康检查（测试 MySQL 连接） |
| POST | `/verify-code` | 验证访问码 |

### 文件夹

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/folders` | 获取所有文件夹（扁平列表） |
| POST | `/folders` | 创建文件夹 |
| PUT | `/folders/:id` | 重命名文件夹 |
| DELETE | `/folders/:id` | 递归删除文件夹及其子文件夹 |

### 文章

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/article/:id` | 获取单篇文章 |
| GET | `/articles/:folderId` | 获取文件夹下所有文章 |
| POST | `/articles` | 创建文章 |
| PUT | `/articles/:id` | 更新文章（部分更新） |
| DELETE | `/articles/:id` | 删除文章 |

### 批注

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/annotations/:articleId` | 获取文章的所有批注 |
| POST | `/annotations` | 创建批注（含高亮/下划线类型、颜色、注释） |
| PUT | `/annotations/:id` | 更新批注的注释内容 |
| DELETE | `/annotations/:id` | 删除批注 |

### 单词查询

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/lookup?word=hello` | 查询单词释义（有道词典） |

**响应格式**：
```json
{
  "word": "hello",
  "phonetic_uk": "/həˈloʊ/",
  "phonetic_us": "/hɛˈloʊ/",
  "definitions": [
    { "part_of_speech": "int.", "translation": "你好；喂" },
    { "part_of_speech": "n.", "translation": "招呼，问候" }
  ],
  "translation": ""
}
```

**性能优化特性**：
- 服务端 LRU 内存缓存（最大 2000 条，正常 30 分钟 / 错误 60 秒）
- 请求去重：同一单词并发请求复用同一个 Promise
- 8 秒超时控制（AbortController）
- 前端 AbortController 取消旧请求，防止结果覆盖

---

## 前端路由

| 路径 | 名称 | 组件 | 说明 |
|------|------|------|------|
| `/` | home | `FileExplorer.vue` | 文件管理器首页 |
| `/article/:id` | article | `ArticlePage.vue` | 文章阅读/编辑页 |

---

## 组件关系图

```
App.vue
 ├── CodeGate.vue              —— 访问验证弹窗（全屏遮罩）
 └── <router-view>（验证通过后显示）
      ├── FileExplorer.vue ( / )
      │    ├── FolderTree.vue          —— 左侧文件夹树
      │    ├── ContentArea.vue         —— 中间内容区
      │    │    └── ArticleCard.vue    —— 文章卡片
      │    ├── ContextMenu.vue         —— 右键菜单
      │    ├── FolderDialog.vue        —— 文件夹对话框
      │    └── ArticleDialog.vue       —— 新建文章对话框
      │
      └── ArticlePage.vue ( /article/:id )
           ├── WordCard.vue            —— 浮动查词卡片
           └── AnnotationCard.vue      —— 浮动批注卡片
```

---

## Pinia Store（fileExplorer）

**核心状态**：
- `folders` — `{ id → folder }` 映射，含虚拟 `root` 根节点
- `articles` — `{ articleId → article }` 映射
- `currentFolderId` — 当前浏览的文件夹 ID
- `loading` / `initialized` — 加载状态

**核心计算属性**：
- `currentFolder` — 当前文件夹对象
- `currentChildren` — 当前文件夹的子文件夹列表
- `currentArticles` — 当前文件夹的文章列表
- `breadcrumb` — 面包屑导航路径

---

## 单词查询完整流程

```
用户选中英文文本（mouseup 事件）
    │
    ▼
ArticlePage.onTextSelection()
    ├── 获取选中文本 → 清洗（去标点、过滤无效内容）
    ├── 获取屏幕位置（getBoundingClientRect）
    ├── 取消上一个未完成的请求（AbortController）
    ├── 300ms 防抖
    │
    ▼
api.lookupWord(word, signal) → 相对路径 /api/lookup
    │
    ▼
server/index.js → /api/lookup
    ├── 检查内存缓存（LRU, max 2000）
    ├── 检查请求去重（pendingLookups）
    ├── fetch('https://dict.youdao.com/result?word=...&lang=en')
    ├── HTML 解析：
    │     extractYoudaoPhonetic()  → 英/美音标
    │     extractYoudaoDefs()      → 词性 + 释义列表
    │     extractYoudaoTranslation() → 整段翻译
    ├── 缓存结果（正常 30 分钟, 错误 60 秒）
    └── 返回 JSON
         ▼
WordCard.vue
    ├── adjustPosition() → 计算卡片位置（优先下方, 空间不足则上方）
    ├── 渲染音标 / 释义列表 / 段落翻译
    └── 过渡动画（向上/向下展开）
```

---

## 批注功能完整流程

### 创建批注

```
用户选中文本（可跨 span 边界） → 浮动工具栏出现 [🖍高亮] [U̲下划线]
    │
    ├── 点击高亮 → createAnnotation('highlight', '#FFEB3B')
    └── 点击下划线 → createAnnotation('underline', '#e74c3c')
         │
         ├── TreeWalker 精确计算偏移量（避免 indexOf 重复匹配）
         ├── 检查与已有批注无重叠
         └── 存入 annotations[] + localStorage(annot_{articleId})
              │
              └── paragraphSegments computed 重新切分段落
                   └── <span class="annotated highlight|underline"> 渲染
```

### 查看/编辑批注

```
悬停批注文本 200ms → AnnotationCard 弹出
    │
    ├── 查看模式：显示批注类型标签 + 注释内容（或"暂无注释，点击编辑"）
    │
    ├── 点击卡片 → 进入编辑模式 → textarea 自动聚焦
    │     ├── 失去焦点 → 自动保存
    │     ├── Ctrl+Enter → 手动保存
    │     ├── 点击"删除" → 删除批注
    │     └── 键盘 Delete/Backspace → 删除批注
    │
    └── 移出批注文本+卡片 300ms → 关闭卡片
```

### 数据存储

批注数据持久化在 MySQL `annotations` 表，通过 API 增删改查：

```json
// POST /api/annotations
{
  "id": "m5k2x...",
  "articleId": "e811a714-...",
  "paragraphIndex": 0,
  "startOffset": 120,
  "endOffset": 135,
  "text": "selected text",
  "type": "highlight",
  "color": "#FFEB3B",
  "note": "用户的注释内容"
}
```

- 批注按文章 ID 隔离，切换文章时自动加载新数据
- 段落渲染使用 TreeWalker 精确计算偏移量，避免 indexOf 重复匹配
- 文章删除时批注级联删除（`ON DELETE CASCADE`）

---

## 访问验证流程

```
启动后端 → 生成 8 位随机验证码（大小写+数字+符号）→ 打印在终端
         ↓
浏览器打开页面 → 检测 hostname
         ├── localhost / 127.0.0.1 → 直接进入（本机免验证）
         └── 其他 IP（局域网） → CodeGate 全屏遮罩
              ├── 输入验证码 → POST /api/verify-code
              ├── 成功 → sessionStorage 标记 → 进入页面
              └── 失败 → 错误提示，清空输入框

> **注意**：每次 `start.bat` 重启都会生成新验证码，终端框下方有单独一行纯文本方便复制。

---

## 启动方式

### 手动启动

```bash
# 1. 安装依赖
npm install

# 2. 配置 .env（MySQL 连接信息）

# 3. 启动后端（端口 3000）
npm run dev:server

# 4. 启动前端（端口 5173，监听 0.0.0.0）
npm run dev
```

### 一键启动（Windows）

```bash
start.bat
# 自动清理旧进程 → 启动后端 + 前端 → 显示 LAN IP → 打开浏览器
```

### 局域网访问

启动后终端显示 `Network: http://192.168.x.x:5173`，其他设备输入该地址 + 验证码即可访问。

> 首次使用需要添加 Windows 防火墙规则放行端口 5173：
> ```cmd
> netsh advfirewall firewall add rule name="Vite5173" dir=in action=allow protocol=TCP localport=5173
> ```

---

## 环境变量（.env）

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=language_learning
SERVER_PORT=3000
```

---

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

---

## Git 版本管理

项目已初始化 Git 仓库，初始提交 37 个文件。`node_modules`、`.env` 已排除。

```bash
git status                     # 查看改动
git add .                      # 暂存所有改动
git commit -m "feat: 描述"     # 提交
```

详细使用方法见 [GIT_GUIDE.md](./GIT_GUIDE.md)。
