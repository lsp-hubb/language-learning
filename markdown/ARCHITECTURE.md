# Language Learning — 项目架构文档

## 项目概述

**Language Learning** 是一个外语阅读辅助工具，帮助用户阅读英文文章并实时查词、添加批注、手绘标记。基于 **Vue 3 + Vite + Pinia** 前端和 **Express + MySQL** 后端构建。

### 核心功能

1. **文件夹管理** — 支持无限层级嵌套的文件夹，CRUD 操作，右键菜单，面包屑导航
2. **外刊文章管理** — 在文件夹中创建、编辑、查看英文文章（文章卡片显示首行预览）
3. **单页阅读视图** — 滚动阅读，两端对齐排版，滚动条在容器右侧；工具栏 A−/A+ 调字号（12–32px）
4. **智能单词查询** — 选中英文单词后，自动查询有道词典，弹出浮动词卡展示音标、释义；音标区鼠标悬停自动播放英式/美式发音；支持 T 键全局开关（默认关闭）
5. **PDF 风格批注** — 黄色高亮(E键, `#FFEB3B`) + 红色下划线(W键, `#e74c3c`)，悬停 200ms 查看注释并自动播发音，点击编辑/自动填入查词结果，同类型不可重叠，按 Delete 键删除，数据保存在 MySQL
6. **手绘画布** — Ctrl+R 开启/关闭画布，支持画笔（Q 切换水平直线/波浪线）/矩形/矩形擦除/6 色切换，笔迹按文章 ID 存储在 MySQL，500ms 防抖写入
7. **段落编号提示** — 鼠标悬停段落时左侧浮出「第 N 段」（CSS `counter` + `::before`）
8. **收藏文章** — 文章卡片右上角 SVG 书签图标，切换收藏状态，数据持久化
9. **右侧面板（AI / 笔记）** — 右侧悬浮面板（46vw），通过工具栏开关互斥切换显示内容（面板内无标签栏）：
   - **AI**（`panelMode === 'link'`）：嵌入多个 AI 站点 iframe（元宝 / 豆包 / 千问 / DeepSeek），可嵌入站点切换只显隐不重建；不支持嵌入的站点显示占位提示 +「外部打开」按钮。当前站点记忆在 `localStorage.sidePanelState`
   - **笔记**（`panelMode === 'note'`，`NotePanel.vue`）：粘贴结构化笔记，自动解析为「英文 / 中文 / 词汇」卡片；支持追加 / 修改全文、导航栏快速跳转、**双击标记重点**（变艳红 `#ff1f1f` + 加粗，标记态不可选中避免误选文本）、**右键单击复制词汇内容**（`localStorage.note_marks_<articleId>`）
   - L 键切换 AI 助手面板、r 键切换笔记面板，工具栏「AI」「笔记」按钮等价切换，默认关闭
10. **局域网共享** — 同一网络下多设备可同时访问，共享文章和批注数据（无验证码）
11. **阅读计时器** — 工具栏显示，点击循环切换开始 → 暂停 → 归零
12. **英文单词数统计** — 工具栏实时显示文章单词数（按空白切分）
13. **手动查词卡片** — Ctrl+Shift+Z 打开，支持输入查词、一键复制、联想词下拉、任意拖动、位置记忆（`localStorage._manual_word_card_pos`）；查词结果自动播放英式发音，音标区可悬停切换英式/美式发音；卡片打开时正文选中文本自动填入查询
14. **状态恢复** — 刷新/重启后自动回到上次浏览的文件夹或文章页面
15. **批注工具栏开关** — 默认关闭浮动批注栏，顶部工具栏小箭头按钮（▲/▼）手动开启；关闭时工具栏显示内嵌高亮/下划线按钮（选中文本后点击可用）
16. **阅读区左侧工具栏** — 文章阅读区左缘小半圆钮（▶），悬停展开 3 个功能按钮（书签 / 启动 Python 脚本 / 功能三占位），移开自动收起
17. **一键启停脚本** — `scripts/start-all.py` / `scripts/stop-all.py` 按端口幂等拉起/停止全部服务

---

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | Vue 3 (Composition API + `<script setup>`) | ^3.5 |
| UI 组件库 | Element Plus（全局注册，中文 locale） | ^2.14 |
| 构建工具 | Vite | ^8.0 |
| 状态管理 | Pinia | ^3.0 |
| 路由 | Vue Router | ^5.0 |
| 后端框架 | Express | ^5.2 |
| 数据库 | MySQL (mysql2/promise) | ^3.22 |
| 代码格式化 | Prettier | 3.8.3 |
| 单元测试 | Vitest + @vue/test-utils + jsdom | — |
| E2E 测试 | Playwright | — |
| Vite 插件 | @vitejs/plugin-vue, vue-jsx, vite-plugin-vue-devtools | — |

## 环境要求

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| **Node.js** | `^20.19.0` 或 `>=22.12.0` | 由 `package.json` engines 字段指定，[下载](https://nodejs.org/) |
| **MySQL** | **8.0** | 当前使用 8.0.46，[下载](https://dev.mysql.com/downloads/installer/) |
| **npm** | 随 Node.js 自带 | — |
| **Git** | 无硬性要求，推荐 ≥2.x | 用于版本控制，[下载](https://git-scm.com/) |

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
├── .env                                # 环境变量（数据库配置）
├── .gitignore
├── start.bat                           # Windows 一键启动脚本 (前后端)
├── start-mysql.bat                     # MySQL 单独启动脚本
├── scripts/
│   ├── start-all.py                    # 一键启动：MySQL → 后端 → 前端 + 打开浏览器
│   ├── stop-all.py                     # 一键停止：前端 → 后端 → MySQL
│   ├── focus_editor.py                 # 组件检查器跳转后把编辑器窗口置前
│   └── reimport_all.cjs                # TXT 批量导入（一次性脚本）
├── .prettierrc.json                    # Prettier 代码格式化配置
├── README.md
├── markdown/
│   ├── ARCHITECTURE.md                 # 项目架构文档
│   ├── GIT_GUIDE.md                    # Git 使用指南
│   ├── TXT_IMPORT.md                   # TXT 文章批量导入指南
│   └── PDF_EXPORT.md                   # PDF 导出功能（reportlab + PyMuPDF）
├── docs/
│   ├── MySQL连接配置说明.md             # 数据库配置文档
│   ├── recycle-bin.md                  # 回收站功能说明
│   └── python-env.md                   # Python 虚拟环境说明
├── db/                                 # 数据库 SQL 备份（Git 跟踪）
│   └── language_learning.sql
│
├── public/
│   ├── favicon.ico
│   └── list.png                        # 左侧工具栏「书签」按钮图标
│
├── server/                             # 后端服务
│   ├── db.js                           # MySQL 连接池
│   ├── index.js                        # Express API 服务（核心后端，端口 3000）
│   ├── pdf_export.py                   # PDF 导出核心：reportlab 排版 + PyMuPDF 写注释
│   └── pdf_service.py                  # PDF 导出服务（FastAPI，端口 5057）
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
│   ├── composables/                    # 可组合函数
│   │   ├── useWordLookup.js            # 单词查询 + 文本选择
│   │   ├── useAnnotations.js           # 批注 CRUD + 工具栏/卡片 UI
│   │   ├── useTimer.js                 # 阅读计时器
│   │   └── useCanvas.js                # 画布模式/工具/颜色
│   ├── views/
│   │   ├── ArticlePage.vue             # 文章阅读/编辑页（编排层，409 行：composables + 快捷键 + 面板联动）
│   │   └── ReviewPage.vue              # 复习页面（展示文章标题，待开发）
│   └── components/
│       ├── FileExplorer.vue            # 文件管理器主组件
│       ├── FolderTree.vue              # 左侧文件夹树
│       ├── ContentArea.vue             # 主内容区（文件夹+文章网格）
│       ├── ArticleCard.vue             # 文章卡片（收藏 SVG 书签图标 + 复习 📜 按钮，新标签打开）
│       ├── ArticleToolbar.vue          # 顶部工具栏（返回/编辑/计时器/链接）
│       ├── ArticleReader.vue           # 文章阅读区（段落/批注标记/画布/左侧工具侧边栏）
│       ├── ArticleEditor.vue           # 文章编辑器（标题+正文输入框）
│       ├── AnnotToolbar.vue            # 浮动批注工具栏（高亮/下划线）
│       ├── ArticleDialog.vue           # 新建文章对话框
│       ├── FolderDialog.vue            # 文件夹创建/重命名对话框
│       ├── ContextMenu.vue             # 右键菜单
│       ├── WordCard.vue                # 浮动单词查询卡片（选中查词）
│       ├── ManualWordCard.vue          # 手动查词卡片（Ctrl+Shift+Z，含联想词）
│       ├── AnnotationCard.vue          # 浮动批注卡片
│       ├── BookmarksPanel.vue         # 书签面板（左侧工具栏，同文件夹文章导航）
│       ├── CodeGate.vue               # 访问验证门（验证码已移除，直接 emit verified）
│       ├── DrawCanvas.vue              # 画布绘制组件（画笔/矩形/矩形擦除）
│       ├── PdfExportButton.vue         # PDF 导出按钮（调 5057 服务，含状态指示灯）
│       ├── icons/                      # SVG 图标（edit.svg / import.svg）
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

PDF 导出（独立链路，不经 Vite 代理）：
PdfExportButton.vue ──直连──> pdf_service.py :5057 ──> pdf_export.py ──> PDF 文件
```

**服务端口一览**

| 端口 | 服务 | 说明 |
|------|------|------|
| 3306 | MySQL80 | 数据库 |
| 3000 | Express 后端 | 经 Vite 代理，不直接对外暴露 |
| 5173 | Vite 前端 | 监听 `0.0.0.0`，局域网可访问 |
| 5057 | PDF 导出服务 | FastAPI，仅本机 `127.0.0.1`；前端**直连不经代理** |

- **前端**：`localhost:5173` / LAN: `192.168.x.x:5173`（Vite Dev Server，监听 `0.0.0.0`）
- **后端**：`localhost:3000`（Express，通过 Vite 代理转发，不直接对外暴露）
- **前后端通信**：前端使用 `/api` 相对路径，Vite 代理转发至后端
- **PDF 导出**：前端直连 `http://127.0.0.1:5057`（地址硬编码在 `PdfExportButton.vue`）。
  因为导出返回的是二进制流且不需要走数据库，没必要绕一层代理；
  服务未启动时按钮显示红灯并提示，不影响其他功能
- **局域网访问**：其他设备通过 `http://<主机IP>:5173` 访问。
  注意 5057 只监听 `127.0.0.1`，**局域网设备无法使用 PDF 导出**（该场景未支持）

---

## 数据库表结构

### `folders` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | VARCHAR(64) | 主键，UUID |
| `name` | VARCHAR(255) | 文件夹名称 |
| `parent_id` | VARCHAR(64) | 父文件夹 ID（NULL 表示根目录） |
| `deleted_at` | TIMESTAMP | NULL 表示正常，非空表示已移入回收站 |
| `created_at` | TIMESTAMP | 创建时间 |

### `articles` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | VARCHAR(64) | 主键，UUID |
| `title` | VARCHAR(500) | 文章标题 |
| `content` | TEXT | 文章正文 |
| `folder_id` | VARCHAR(64) | 所属文件夹 ID |
| `notes` | TEXT | 笔记生文本（用户粘贴，原样存储，前端解析展示） |
| `deleted_at` | TIMESTAMP | NULL 表示正常，非空表示已移入回收站 |
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
| `type` | VARCHAR(20) | 批注类型（`highlight` / `underline`；`sentence` 为历史遗留，前端不再产生） |
| `color` | VARCHAR(20) | 颜色（`#FFEB3B` / `#e74c3c`） |
| `note` | TEXT | 注释内容 |
| `created_at` | TIMESTAMP | 创建时间 |

### `favorites` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `article_id` | VARCHAR(64) | 主键，文章 ID（外键，级联删除） |
| `created_at` | TIMESTAMP | 创建时间 |

### `canvas_strokes` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `article_id` | VARCHAR(64) | 主键，文章 ID |
| `strokes_data` | JSON | 笔迹数据（画笔/矩形数组） |
| `updated_at` | TIMESTAMP | 最后更新时间（自动更新） |

---

## 后端 API 接口

基础地址：`/api`（通过 Vite 代理转发至 `http://localhost:3000`）

### 系统

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/init` | 初始化数据库建表 + 迁移（含 favorites, deleted_at, notes 字段） |
| GET | `/health` | 健康检查（测试 MySQL 连接） |

### 文件夹（含回收站）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/folders` | 获取所有正常文件夹（`deleted_at IS NULL`） |
| POST | `/folders` | 创建文件夹 `{ name, parentId }` |
| PUT | `/folders/:id` | 重命名文件夹 `{ name }` |
| DELETE | `/folders/:id` | 移入回收站（软删除文件夹及其所有文章） |
| GET | `/trash` | 获取回收站所有已删除文件夹和文章 |
| POST | `/folders/:id/restore` | 从回收站恢复文件夹及其所有子文件和文章 |
| DELETE | `/folders/:id/force` | 从回收站永久删除（含文章、批注、收藏，不可逆） |

### 文章

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/article/:id` | 获取单篇文章 |
| GET | `/articles/:folderId` | 获取文件夹下所有文章（按标题排序） |
| POST | `/articles` | 创建文章 `{ title, content, folderId }` |
| PUT | `/articles/:id` | 更新文章（部分更新 `{ title?, content? }`） |
| PUT | `/articles/:id/notes` | 保存笔记生文本（`{ notes }`，原样存储不做解析） |
| DELETE | `/articles/:id` | 删除文章 |

### 批注

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/annotations/:articleId` | 获取文章的所有批注 |
| POST | `/annotations` | 创建批注（类型 `highlight` / `underline`，颜色固定，含注释） |
| PUT | `/annotations/:id` | 更新批注的注释内容 `{ note }` |
| DELETE | `/annotations/:id` | 删除批注 |

### 收藏

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/favorites` | 获取所有已收藏文章 ID 列表 |
| POST | `/favorites/:articleId` | 切换收藏状态（有则删除，无则添加），返回 `{ favorited: bool }` |

### 画布笔迹

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/canvas-strokes/:articleId` | 获取文章画布笔迹（数组） |
| POST | `/canvas-strokes/:articleId` | 保存/覆盖画布笔迹 `{ strokes: [...] }` |

> 表不存在时自动创建，无需手动初始化。

### 单词查询

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/lookup?word=hello` | 查询单词释义（有道词典） |
| GET | `/suggest?q=word` | 有道联想词建议 |
| GET | `/tts?word=hello&accent=uk` | TTS 发音代理（代理有道 dictvoice，服务端 MP3 缓存，避免 CORS） |

### Python 脚本

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/run-python` | 启动本地 Python 脚本 `{ key }`，key 白名单见下 |

```js
// server/index.js
const SCRIPTS = { 'clipboard_to_txt': 'F:\\PythonProject\\Python\\clipboard_to_txt.py' }
const pythonBin = 'F:\\PythonProject\\.venv\\Scripts\\pythonw.exe'  // pythonw：无控制台窗口
spawn(pythonBin, [SCRIPTS[key]], { cwd: 'F:\\PythonProject\\Python', detached: true, stdio: 'ignore' }).unref()
```

- 只接受 `key`，不接受任意脚本路径（避免任意代码执行）
- 用 `pythonw.exe` 而非 `python.exe`，不会弹出黑色控制台窗口
- 前端封装：`api.runPythonScript(key)`；阅读区左侧工具栏「启动脚本」→ `ArticlePage.onRunScript()` → `key: 'clipboard_to_txt'`

**响应格式**（释义查询）：
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

**TTS 发音代理特性**：
- 代理有道 dictvoice 接口，返回 MP3 音频，避免浏览器 CORS
- 服务端 LRU 内存缓存（最大 500 条，MP3 Buffer）
- 请求去重（`pendingTts`）：同一单词+口音并发请求复用同一个 Promise
- Keep-Alive Agent（`ttsAgent`）：复用 TCP 连接到有道，`maxSockets: 2`
- `warmupTts()`：查词成功后后台并行预热 TTS 缓存，不阻塞释义返回
- 释义为空时，`translation` 由 `extractYoudaoTranslation()` 从整段翻译中提取，作为兜底展示

**性能优化特性**：
- 释义查询：服务端 LRU 内存缓存（最大 2000 条，正常 30 分钟 / 错误 60 秒）
- 请求去重：`pendingLookups` 同一单词并发复用
- 8 秒超时控制（AbortController）
- 前端 AbortController 取消旧请求，防止结果覆盖

---

## 前端路由

| 路径 | 名称 | 组件 | 说明 |
|------|------|------|------|
| `/` | home | `FileExplorer.vue` | 文件管理器首页 |
| `/article/:id` | article | `ArticlePage.vue` | 文章阅读/编辑页 |
| `/review/:id` | review | `ReviewPage.vue` | 复习页面（占位，新标签打开） |

---

## 组件关系图

```
App.vue
 ├── CodeGate.vue              —— 访问验证弹窗（保留组件，验证码功能已移除，本机直接放行）
 └── <router-view>（验证通过后显示）
      ├── FileExplorer.vue ( / )
      │    ├── FolderTree.vue          —— 左侧文件夹树
      │    ├── ContentArea.vue         —— 中间内容区
      │    │    └── ArticleCard.vue    —— 文章卡片（含收藏 SVG 书签图标 + 复习 📜 按钮）
      │    ├── ContextMenu.vue         —— 右键菜单
      │    ├── FolderDialog.vue        —— 文件夹对话框
      │    └── ArticleDialog.vue       —— 新建文章对话框
      │
      ├── ArticlePage.vue ( /article/:id )
     │    ├── [composables]
     │    │    ├── useWordLookup      —— 单词查询 + 文本选择 + 卡片状态
     │    │    ├── useAnnotations     —— 批注 CRUD + 工具栏/卡片 UI
     │    │    ├── useTimer           —— 阅读计时器
     │    │    └── useCanvas          —— 画布模式/工具/颜色
     │    ├── ArticleToolbar         —— 顶部工具栏（参考项目风格：白色圆角卡片，返回/编辑/字号/批注开关/计时/单词数/AI/笔记/PDF，均用 Element Plus 组件）
     │    │    └── PdfExportButton   —— PDF 导出（直连 5057，状态指示灯：绿=在线/红=未启动/黄闪=检测中）
     │    ├── ArticleReader          —— 文章阅读区（白色圆角卡片，段落/批注标记/画布/左侧工具栏/段落编号）
     │    │    └── DrawCanvas        —— 画布（画笔/矩形/矩形擦除 + 底部工具条）
     │    ├── ArticleEditor          —— 文章编辑器（contenteditable 正文 + 标题输入）
     │    ├── AnnotToolbar           —— 浮动批注工具栏（高亮/下划线）
     │    ├── WordCard               —— 浮动查词卡片（选中查词，自动/悬停发音）
     │    ├── ManualWordCard         —— 手动查词卡片（Ctrl+Shift+Z，联想词，可拖动）
     │    ├── AnnotationCard         —— 浮动批注卡片（查看/编辑，Enter 保存）
     │    └── BookmarksPanel         —— 书签面板（左侧工具栏，同文件夹文章导航）
     │
     └── 右侧面板（App.vue 层，由工具栏开关决定显示 AI 或笔记）
          ├── AI iframe（元宝 / 豆包 / 千问 / DeepSeek，常驻只显隐）
          └── NotePanel.vue          —— 结构化笔记（解析生文本 → 英文/中文/词汇卡片）
     │
     └── ReviewPage.vue ( /review/:id, 新标签)
          └── 复习功能（待开发）
```

---

## 手绘画布

画布组件 `DrawCanvas.vue` 提供在文章上手绘标记的功能：

- **开关**：`Ctrl+R` 切换；也可点画布工具栏「✓ 完成」关闭（`Esc` **不**关闭画布）
- **绘制工具**：画笔(1，Q 切换直线/波浪线)、矩形(2)、矩形擦除(3)，工具栏按钮可开关
- **画笔颜色**：6 色（红 `#e74c3c`、深蓝 `#1c2833`、蓝 `#1f6ea8`、绿 `#1a7a42`、橙 `#b9770e`、紫 `#76448a`），`Space` 循环切换
- **画笔行为**：按下后沿**水平方向**绘制——向右拉揭示、向左拉擦除，抬笔（mouseup/mouseleave）才落库；即「划线/画浪线」而非自由手绘
- **橡皮擦**：拖拽绘制淡蓝色虚线矩形，框内及与边框相交的笔触被删除
- **画布范围**：仅限于 `.reader-content` 容器内（高度为 `scrollHeight`，随内容滚动）
- **与注释共存**：工具关闭时画布 `pointer-events: none`，可正常查词注释；工具激活时自动关闭查词/批注卡片并取消文本选中
- **数据存储**：每篇文章笔迹经 API 保存在 MySQL `canvas_strokes` 表，自动建表；绘制结束立即同步保存一次，另有 500ms 防抖兜底
- **笔迹格式**：`{ type: 'pen' | 'wavy' | 'rect', color, ... }`，重绘时按 `refCanvasW/H` 比例缩放（`ResizeObserver` 监听容器变化）
- **跨设备共享**：笔迹存入 MySQL，局域网多设备可共享同一画布内容
- **侧边栏兼容**：画布工具栏随右侧面板开闭平移（`translateX(calc(-50% - 23vw))`）
- **新画布**：清空当前文章笔迹并同步保存空数组
- **切换文章 / 组件卸载**：自动保存当前文章笔迹至 MySQL，再重置状态加载新文章笔迹
- **加载失败兜底**：接口报错时回退读 `localStorage._canvas_strokes_<articleId>`

---

## PDF 导出

把「文章正文 + 阅读器批注」导出为 PDF。正文是可选中、可搜索、可复制的真实文本，
批注落成 PDF 标准标记注释（Highlight / Underline），在阅读器里悬浮即可看到批注内容。

> 完整说明见 [PDF_EXPORT.md](./PDF_EXPORT.md)，本节只列与整体架构相关的要点。

### 链路

```
ArticleToolbar.vue
  └── PdfExportButton.vue  [●] 📄 PDF     ● 绿=服务在线 ● 红=未启动 ● 黄闪=检测中
        │  POST /api/export-pdf（直连，不经 Vite 代理）
        ▼
   server/pdf_service.py : 5057（FastAPI，仅 127.0.0.1）
        ▼
   server/pdf_export.py
        ① reportlab 排版（Paragraph + TA_JUSTIFY 两端对齐）
        ② PyMuPDF get_text("rawdict") 读回每个字符的真实位置与页码
        ③ 按「非空白字符序列」把字符对齐到 (段号, 段内偏移)
        ④ 按批注偏移量取字符 → 按 (页码, 基线) 合并 → add_highlight_annot / add_underline_annot
        ▼
   application/pdf（Content-Disposition 用 RFC 5987 双写，支持中文文件名）
```

### 与批注数据模型的关系

批注自带 `(paragraphIndex, startOffset, endOffset)`，是**精确坐标**，
所以导出时不需要任何文本匹配算法 —— 只需把「段内字符偏移」映射到「PDF 字符」。
映射靠非空白字符序列对齐完成，天然免疫 reportlab 对空白的合并/丢弃。

### 前端接入

| 文件 | 改动 |
|------|------|
| `src/components/PdfExportButton.vue` | 导出按钮；`onMounted` 探测 `/health`，未连通时点击只提示不请求 |
| `src/components/ArticleToolbar.vue` | 「笔记」按钮后挂载；新增 `article` / `annotations` 两个 props |
| `src/views/ArticlePage.vue` | 向工具栏传 `:article` 与 `:annotations` |

### 边界

- **服务未启动**：按钮显示红灯并提示「请先运行 scripts/start-all.py」，
  **无浏览器端回退**（jsPDF 无两端对齐与注释 API，且批注按偏移量定位需先完成排版，
  等于在浏览器重写 reportlab —— 不划算，详见 PDF_EXPORT.md）
- **画布笔迹不导出**：`canvas_strokes` 是相对阅读容器的屏幕像素，
  与 PDF 的分页版心不存在可换算的映射，强行缩放必然错位
- **局域网设备不可用**：5057 只监听 `127.0.0.1`

---

## 快捷键

| 快捷键 | 功能 | 处理位置 |
|--------|------|----------|
| E / W | 高亮 / 下划线（对当前选区） | `ArticlePage.onAnnotShortcut` |
| T | 全局开关单词查询（默认关闭） | `ArticlePage.onAnnotShortcut` |
| Ctrl+R | 开关画布模式（再次按下即关闭并保存） | `ArticlePage.onAnnotShortcut` |
| L | 切换 AI 助手面板（与点击 AI 按钮等价） | `ArticlePage.onAnnotShortcut` |
| r | 切换笔记面板（与点击笔记按钮等价） | `ArticlePage.onAnnotShortcut` |
| Ctrl+Shift+Z | 打开/关闭手动查词卡片 | `ArticlePage.onAnnotShortcut` |
| Space | 画布模式下循环切换画笔颜色（画笔/矩形激活时） | `ArticlePage.onAnnotShortcut` |
| Ctrl+I | 开关 Vue 组件检查器（`vite-plugin-vue-devtools` 的 `toggleComboKey`，`vite.config.js` 配置） | Vite 插件 |
| 1 / 2 / 3 | 画笔 / 矩形 / 矩形擦除（画布开启时） | `DrawCanvas.onKeydown` |
| Q | 切换画笔样式（直线 ↔ 波浪线，画布开启且当前为画笔时） | `DrawCanvas.onKeydown` |
| Esc | 取消文本选中 / 关闭查词卡片 / 关闭批注卡片与浮动工具栏 | `ArticlePage.onAnnotShortcut` |
| Delete / Backspace | 删除当前查看的批注（编辑中的 textarea 内不拦截） | `AnnotationCard.onKeyDown` |
| Ctrl+Enter / Ctrl+S | 编辑模式下保存更改 | `ArticlePage.onAnnotShortcut` / `ArticleEditor` |
| Enter | 笔记面板有匹配项时滚动到下一个匹配卡片（输入框内不拦截） | `NotePanel._enterNavHandler` |
| Enter / Shift+Enter | 笔记输入区内：解析保存 / 换行 | `NotePanel.onEnterKey` |
| ↑ / ↓ / Enter / Esc | 手动查词卡片联想词导航与关闭 | `ManualWordCard` |

> 输入类元素（`INPUT` / `TEXTAREA` / contenteditable）内的按键不会被文章快捷键拦截。
> 「方向键 / PgUp / PgDn / Home / End 翻页」为多页阅读视图时期的旧快捷键，随滚动式阅读已移除。

### 全局消息提示（ElMessage）

所有 `ElMessage` 提示框统一从**页面左上角向右滑入**显示：通过 `src/main.js` 的 `ElConfigProvider` 设置 `message.placement = 'top-left'`，并在 `src/assets/base.css` 覆盖默认动画为 `translateX(-120%) → 0`（`is-center` / `is-right` 也兜底到左上角）。PDF 导出进行中状态用常驻（`duration: 0`）提示「正在导出 PDF…」，完成/失败后再关闭并更新结果消息。

---

## 收藏功能

- 文章卡片右上角 SVG 书签图标，点击切换收藏状态
- 后端 `favorites` 表，`article_id` 为主键且外键级联删除
- Pinia Store: `favoriteIds` (Set)、`loadFavorites()`、`isFavorited()`、`toggleFavorite()`
- 启动 `FileExplorer` 时自动调用 `store.loadFavorites()` 加载收藏数据
- API: `GET /api/favorites`（获取所有收藏 ID）、`POST /api/favorites/:articleId`（切换收藏）

---

## 右侧面板（AI / 笔记）

文章页工具栏右侧 `AI` / `笔记` 按钮，点击展开/收起悬浮面板并决定显示哪个内容，**互斥**切换。面板内**无标签栏**（与参考项目一致），切换完全由工具栏控制：

- **面板宽度**：46vw，固定在视口右侧（CSS 类名 `.side-panel`，`right: 0`）
- **面板内容**（由 `panelMode` 决定）：
  - **AI（默认）**：嵌入多个 AI 站点 iframe，站点定义见 `App.vue` 的 `SIDE_SITE_DEFS`

    | 站点 | URL | 可嵌入 |
    |------|-----|:------:|
    | 元宝 | `yuanbao.tencent.com/chat/naQivTmsDa` | ✅ |
    | 豆包 | `doubao.com/chat/` | ✅ |
    | 千问 | `qianwen.com/chat/` | ❌ 外部打开 |
    | DeepSeek | `chat.deepseek.com/` | ❌ 外部打开 |

    所有可嵌入站点的 iframe **常驻 DOM**，切换仅 `v-show` 显隐，不重建（避免重新登录）；站点切换用 Element Plus `el-button-group`，当前站点 `type=primary` 高亮；不可嵌入站点显示占位提示 + 「外部打开」按钮。当前站点记忆在 `localStorage.sidePanelState`
  - **笔记**（`NotePanel.vue`）：见下方「笔记面板」章节
- **面板样式**：圆角边框 `border-radius: 12px 0 0 12px`、`border: 1px solid #d4c5b0; border-right: none;`、iframe 底部圆角 `border-radius: 0 0 0 12px`
- **状态注入**：`App.vue` 通过 `provide()` 暴露给文章页：

  | key | 类型 | 说明 |
  |-----|------|------|
  | `showSidePanel` | `Ref<boolean>` | 面板是否展开 |
  | `panelMode` | `Ref<'link' \| 'note'>` | 面板显示 AI 还是笔记 |
  | `currentArticleId` | `ComputedRef<string>` | 当前文章 ID（取自路由参数） |
  | `noteSearchText` | `Ref<string>` | 正文选中的查找文本 |
  | `noteSearchNonce` | `Ref<number>` | 每次选中自增，保证同文本也能重新触发查找 |
- **页面收缩**：展开时阅读区自动缩小为 54vw（`.page-inner.shifted`）
- **过渡动画**：面板展开/收起 CSS Transition（`right 0.4s ease`）
- **默认状态**：进入文章页时面板默认关闭（`showSidePanel` 默认 `false`，`panelMode` 默认 `'link'`）
- **快捷键**：`L` 键开合（逻辑在 `ArticlePage` 中通过 inject 获取）
- **开关互斥逻辑**：`ArticlePage.togglePanel(mode)` — 已在该面板且展开则收起，否则切换模式并展开

---

## 笔记面板（NotePanel.vue）

独立笔记组件，挂载在右侧面板（`panelMode === 'note'` 时显示），以 `articleId` 为粒度读写整篇笔记。

**数据流**：

```
粘贴结构化笔记 → textarea（Enter 解析保存 / Shift+Enter 换行）
   │
   ├── parseRaw() 前端解析：
   │     · 切块：text.split(/\n(?=\d+\.\s?)/)  —— 以「行首 N. 」为界
   │     · 英文 = 第 1 行（去掉 "N. " 前缀）
   │     · 中文 = 第 2 行
   │     · 词汇 = 第 3 行起以「（」或「(」开头的行，去首尾括号后按 \ 分隔
   │     · 副标题 = 英文前 6 个词（超出加省略号）
   │     仅用于展示，不入库
   │
   ├── 保存生文本 → PUT /api/articles/:id/notes { notes } → MySQL articles.notes（TEXT，原样存储）
   │     · 添加模式：新文本追加到已存文本之后（\n\n 分隔）
   │     · 修改模式：整体覆盖
   │
   └── 读取 → GET /api/article/:id → notes 字段 → parseRaw() 渲染卡片
```

**存储设计**：数据库只存**用户粘贴的生文本**（与参考项目一致），展示用的结构化数组不入库；解析逻辑集中在前端，后续调整解析规则无需迁移数据。

**列自动补齐**：`articles.notes` 列由后端启动时（`server/index.js` 顶部）及 `POST /init` 用 `ALTER TABLE articles ADD COLUMN notes TEXT` 幂等补齐。`db/language_learning.sql` 备份文件**不含此列**，换环境导入后首次启动后端即自动补上，笔记功能无需手动处理。

**顶部常驻操作栏**（`flex: 0 0 auto`，不随内容滚动）：`解析并渲染`（primary）/ `修改`（warning）/ `关闭`

**输入区**：添加/修改笔记的输入框以**独立悬浮卡片**在面板顶部弹出（`position: fixed`，`right:16px; top:56px`，宽度 `calc(46vw - 32px)`），不随笔记列表滚动；textarea 内 Enter 触发解析保存、Shift+Enter 换行。

**交互**：

| 操作 | 说明 |
|------|------|
| 解析并渲染 | 顶部主按钮；输入区未开则打开（添加模式），已开则解析并保存 |
| 修改 | 载入数据库生文本，整体覆盖（输入区同样以顶部弹出卡片形式打开，textarea 更高 240px） |
| 关闭 | 收起输入区 |
| 保存后 | 以保存后的完整生文本重新 `parseRaw()` 渲染，保证展示与存储一致；修改模式保存后自动切回添加模式（输入区保持打开，方便继续追加） |
| 导航栏 | `#1 #2…` 锚点跳转，滚轮横向快速滚动（`deltaY × 6`），隐藏滚动条 |
| 双击词汇 | 标记/取消重点（红色加粗），键为 `noteIndex__词汇文本`，持久化在 `localStorage.note_marks_<articleId>` |
| 正文选中联动 | 笔记面板打开时，在正文选中/双击文本 → 自动在英文/中文/词汇中查找包含项，精确高亮匹配文字段（`<mark class="note-hit">` 黄底）、滚动到第一个匹配卡片至区域中央；回车滚动到下一个匹配卡片。查找关键词为**单词边界自动扩展后的完整文本**（`ArticleReader.getExpandedSelectionText`：仅当选区边界位于单词内部才按空白补全到词首/词尾，双击选中完整单词不会误扩展，避免把后一个词带入；边界判定字符集为「空白 或 连字符/破折号 `- – —`」，故 `power-hungry`、`him—and`、`beings—powerless` 不会被误判为一个单词） |

**匹配视觉层级**：命中卡片描边橙色 `note-card.note-match`，当前定位的那一张描边加深 `note-current`。

**防 Ctrl+F 干扰**：导航项与卡片副标题文本用 `::before` + `attr(data-text)` 伪元素渲染，DOM 无文本节点，浏览器查找不会命中。

---

## Pinia Store（fileExplorer）

**核心状态**：
- `folders` — `{ id → folder }` 映射，含虚拟 `root` 根节点
- `articles` — `{ articleId → article }` 映射
- `currentFolderId` — 当前浏览的文件夹 ID
- `loading` / `initialized` — 加载状态
- `favoriteIds` — `Set<articleId>` 已收藏文章 ID 集合

**核心计算属性**：
- `currentFolder` — 当前文件夹对象
- `currentChildren` — 当前文件夹的子文件夹列表
- `currentArticles` — 当前文件夹的文章列表（按标题前导数字排序）
- `breadcrumb` — 面包屑导航路径

**方法**：
- `loadFolders()` / `initDB()` / `restoreFolder()`
- `navigateTo(id)` / `getChildren(id)`
- `createFolder()` / `renameFolder()` / `deleteFolder()`
- `loadArticles()` / `createArticle()` / `deleteArticle()` / `updateArticle()`
- `loadFavorites()` / `isFavorited(id)` / `toggleFavorite(id)`

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
    ├── 立即清除旧 wordResult，启动查词
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
WordCard.vue / ManualWordCard.vue
    ├── adjustPosition() → 计算卡片位置（优先下方, 空间不足则上方）
    ├── 渲染音标 / 释义列表（释义为空时显示整段翻译兜底）
    ├── 过渡动画（向上/向下展开）
    ├── autoPlayAudio() → 预下载英/美式发音（通过 /api/tts 代理，Blob 缓存）
    │     ├── fetch /api/tts?word=...&accent=uk → Blob → URL.createObjectURL
    │     ├── fetch /api/tts?word=...&accent=us → Blob → URL.createObjectURL
    │     └── 自动播放英式发音（new Audio().play()）
    └── 音标区 @mouseenter → playAudio('uk'|'us')
          ├── 从 audioCache 取出 Blob URL → new Audio().play()
          └── 支持点击/悬停两种交互方式

查询开关：T 键（全局），关闭时隐藏卡片且不触发查询。关闭后按 E/W 快捷键创建批注时自动临时启用查词获取释义填入注释。
```

---

## 批注功能完整流程

### 创建批注

```
用户选中文本（可跨 span 边界） → 浮动工具栏出现 [🖍高亮] [U̲下划线]
    │
    ├── 点击高亮 / 按 E → createAnnotation('highlight', '#FFEB3B')
    └── 点击下划线 / 按 W → createAnnotation('underline', '#e74c3c')
         │
         ├── 快捷键自动填入查词卡片释义（单词含完整释义，长句仅翻译）
         ├── 查词未完成时先创建批注，结果返回后补填注释（pendingNoteFill）
         ├── TreeWalker 精确计算偏移量（避免 indexOf 重复匹配）
         ├── 选区消失时回退到最后一次有效选区（lastSelection）
         ├── 不限制重叠：两种标注可在彼此区域内自由建立，但同种类型不可重叠
         └── 存入 annotations[] + POST /api/annotations → MySQL
              │
              └── paragraphSegments computed 重新切分段落
                   ├── 收集所有边界点切分，每段记录全部覆盖标注
                   └── <span class="annotated highlight underline"> 合并渲染
```

#### 嵌套标注优先级

| 优先级 | 类型 | 创建规则 | 卡片弹出 | Delete 删除 |
|--------|------|----------|----------|-------------|
| 1 | `highlight` | 无限制 | 优先弹出 | 删高亮后自动弹剩余标注卡片 |
| 2 | `underline` | 无限制 | 次级弹出 | 删下划线后自动弹剩余标注卡片 |

- 嵌套区域中悬停，弹出**最高优先级**的批注卡片
- 两种标注可任意相互叠加渲染（背景黄 + 下划线红 同时生效）

### 查看/编辑批注

```
悬停批注文本 200ms → AnnotationCard 弹出（渐变背景，多层阴影，流畅动画）
    │
    ├── 自动发音：文本清洗后若匹配 /^[a-zA-Z]+(?:-[a-zA-Z]+)?$/ 且 ≤30 字符，
    │     则预下载英/美发音并播放英式（useAnnotations.preloadAnnotAudio）
    ├── 查看模式：显示注释内容（或"暂无注释，点击编辑"），卡片内滚动不穿透页面
    │
    ├── 点击进入编辑 → textarea 自动聚焦（并锁定当前尺寸避免变形）
    │     ├── 失去焦点 / Ctrl+Enter（Shift+Enter 换行）→ 自动保存
    │     └── 键盘 Delete/Backspace → 删除批注（编辑中且焦点在 textarea 时不拦截）
    │
    ├── 切换批注时先隐藏旧卡片（避免双重显示）
    ├── 查看模式下移出批注文本 + 卡片 150ms → 关闭卡片
    ├── 编辑模式下移出卡片不关闭，移出后点击卡片外部 → 自动保存并关闭
    └── 滚动文章 / 点击卡片外 → 关闭卡片
```

> 新建批注时（`E`/`W` 键、工具栏按钮创建）会先创建再延时 100ms 弹出卡片，查词结果返回后回填注释（`pendingNoteFill`）。

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
# 清理旧 Node 进程 + 关闭旧窗口 → 启动后端:3000 + 前端:5173 → 显示 LAN IP → 打开浏览器
```
> `start.bat` 使用纯英文编写，避免中文编码导致命令解析异常。
> 该脚本**不启动** PDF 导出服务（5057）；要启用 PDF 导出请用下面的 `start-all.py`。

### 完整启动（含 MySQL 检查）

```bash
start-mysql.bat   # 先检查/启动 MySQL80 服务
start.bat         # 再启动前/后端
```

### 一键启停脚本（Python）

```bash
python scripts/start-all.py   # MySQL(3306) → 后端(3000) → 前端(5173) → PDF 导出(5057) → 自动打开浏览器
python scripts/stop-all.py    # 前端(5173) → 后端(3000) → PDF 导出(5057) → MySQL
```

行为要点：
- 项目根由脚本自身位置推导（`scripts/` 的上级），node / python / MySQL 服务名自动探测，无硬编码路径
- 端口已在监听的服务直接跳过，不会重复拉起
- 前端固定 `node node_modules/vite/bin/vite.js`（不经 `npm run dev`）
- PDF 服务用 **`python.exe` + `CREATE_NO_WINDOW`**，不用 `pythonw.exe`：
  `pythonw` 下 `sys.stdout`/`sys.stderr` 为 `None`，uvicorn 配置 logging 时会崩溃且异常无处输出，
  表现为进程静默退出、端口不通（`pdf_service.py` 内亦有兜底）
- MySQL 先用 `net start`；非管理员失败时回退为直接以当前用户启动 `mysqld`（`CREATE_NO_WINDOW` 抑制黑框）
- 子进程全部 `DETACHED`，脚本退出后服务继续存活

> ⚠️ `stop-all.py` 会停止 MySQL（管理员走 `net stop`，否则强杀 3306 上的 `mysqld`）。若该实例还服务其他项目，请只手动关闭前后端。

### 局域网访问

启动后终端显示 `Network: http://192.168.x.x:5173`，同一局域网其他设备直接输入该地址即可访问，无需验证码。

> 首次使用需要添加 Windows 防火墙规则放行端口 5173：
> ```cmd
> netsh advfirewall firewall add rule name="Vite5173" dir=in action=allow protocol=TCP localport=5173
> ```

---

## 换电脑后恢复数据

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

> 每次新增数据后，建议重新导出备份：
> ```bash
> mysqldump -u root --databases language_learning > db/language_learning.sql
> git add . && git commit -m "feat: 更新数据库备份" && git push
> ```

---

## 多标签页与文章导航

### 打开新标签

文件首页点击文章卡片时，用 `<a target="_blank">` 模拟点击在新标签打开（不经过 `window.open`，避免弹窗拦截）：

```
FileExplorer.onViewArticle(articleId)
  → router.resolve({ name: 'article', params: { id } }).href
  → 创建 <a href=origin+url target="_blank" rel="noopener noreferrer"> 并 click()
```

- 每次点击都会新开一个标签页（不做同文章复用）
- 文章卡片右上角「📜 复习」按钮同样新开标签，跳 `/review/:id`（`ReviewPage` 目前仅展示标题，功能待开发）
- 「收藏」书签图标点击 `stopPropagation`，不会触发打开文章

### 重启恢复

`App.vue` 的 `onVerified()` 读取 `localStorage.lastPage` 并跳转：

```js
const last = localStorage.getItem('lastPage')
if (last && last.startsWith('article:')) {
  router.replace({ name: 'article', params: { id: articleId } })
}
```

- 仅在 `pathname === '/'`（首页）时才恢复，直接访问 `/article/:id` 不会被重定向
- 多标签页中，最后一个加载的标签会覆盖 `lastPage`（合理默认值）

### lastPage 更新策略

- 每次 `ArticlePage` 加载时写入 `localStorage.lastPage = "article:{当前文章ID}"`
- 多标签页中，**最后一个加载的标签**覆盖 lastPage（合理默认值）

---

## 状态持久化

| 存储方式 | 用途 |
|------|------|
| MySQL | 文件夹、文章（含 `notes`）、批注、收藏、画布笔迹数据 |
| `localStorage.lastPage` | 最后浏览的页面（`article:<id>` / `folder:<id>`），重启后自动恢复 |
| `localStorage.lastFolderId` | 最后浏览的文件夹 ID |
| `localStorage.fontSize` | 阅读字号（12–32，默认 16） |
| `localStorage.sidePanelState` | 右侧面板当前 AI 站点（`{ site }`） |
| `localStorage.note_marks_<articleId>` | 笔记词汇重点标记 |
| `localStorage._manual_word_card_pos` | 手动查词卡片位置（`{ x, y }`） |
| `localStorage._canvas_strokes_<articleId>` | 画布笔迹 **兜底**（接口失败时才回退读取） |

- 刷新页面：保持在当前文件夹/文章不变
- 重启前后端：自动跳转到上次退出时的页面（仅在 `pathname === '/'` 时恢复，避免覆盖直接访问的文章 URL）
- 从文章返回首页：跳过重复初始化，无加载闪烁

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

> 另有 `VITE_FOCUS_EDITOR=0` 可关闭「组件检查器跳转后自动置前编辑器窗口」（见下节）。

---

## Vite 配置要点（`vite.config.js`）

| 能力 | 说明 |
|------|------|
| 代理 | `/api` → `http://localhost:3000`；`server.host: '0.0.0.0'`，端口 5173 |
| 别名 | `@` → `./src`（`jsconfig.json` 同步配置） |
| 插件 | `@vitejs/plugin-vue`、`@vitejs/plugin-vue-jsx`、`vite-plugin-vue-devtools` |
| 组件检查器 | `componentInspector.toggleComboKey: 'control-i'`（即 **Ctrl+I**）、`toggleButtonVisibility: 'active'` |
| 无黑窗打开编辑器 | 自定义插件 `no-window-open-in-editor` 拦截 Vite 内置 `/__open-in-editor` 请求，直接 `spawn` 编辑器 exe（`--goto file:line:col`），绕开 `cmd.exe` 避免弹黑窗 |
| 编辑器 exe 探测 | `resolveEditorExe()`：先试常见 VS Code / CodeBuddy 安装路径，再用 `where code` 反推真实 exe（`<安装目录>\Code.exe`）；找不到时降级为 `code` |
| 窗口置前 | 打开文件后用 `pythonw scripts/focus_editor.py --process <exe名> --file <路径> --root <项目根>` 把编辑器提到最前；`VITE_FOCUS_EDITOR=0` 可关闭 |
| pythonw 探测 | `resolvePythonw()`：项目内 `.venv` → 上级目录 `.venv` → PATH（用 `pythonw` 而非 `python` 以避免控制台窗口） |

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

> Python 虚拟环境配置与后端调用说明见 [docs/python-env.md](./docs/python-env.md)。

---

## 当前数据概览

> 以下数据基于当前运行中的数据库（`language_learning`），实际数据随使用变化。数据备份见 `db/language_learning.sql`。

| 表 | 数量 | 说明 |
|----|------|------|
| folders | - | 经济学人日刊各月目录 + 其他空文件夹（数量随使用变化） |
| articles | - | 外刊、考研英语等文章（数量随使用变化） |
| annotations | - | 高亮、下划线两种批注（数量随使用变化。注：`sentence` 类型已从前端移除，但数据库仍兼容） |
| favorites | - | 收藏的文章 ID |
| canvas_strokes | - | 每篇文章一条笔迹 JSON |

> `articles.paragraph_notes` 为历史遗留列（旧段落笔记 `NoteEditor` 已移除），当前代码不读写，保留只为数据兼容。

---

## Git 版本管理

项目已初始化 Git 仓库。`node_modules`、`.env`、`mysql-data/`、`migrate-mysql.ps1` 已排除。

```bash
git status                     # 查看改动
git add .                      # 暂存所有改动
git commit -m "feat: 描述"     # 提交
```

详细使用方法见 [GIT_GUIDE.md](./GIT_GUIDE.md)。

### 近期提交

| 提交 | 说明 |
|------|------|
| `6fb97ee` | docs: 全量核对代码并同步更新所有 markdown 文档 |
| `1dd3dfe` | feat: 正文选中联动笔记面板查找高亮 + 组件检查器改 Ctrl+I + 启停脚本免管理员处理 MySQL |
| `7557acf` | feat: 参考项目UI改造（顶部栏/阅读区/右侧面板）引入 Element Plus + 文档更新 |
| `51a44b0` | feat: 组件检查器定位后自动将编辑器窗口前置 |
| `73e8db5` | fix: 动态探测编辑器exe，修复组件检查器弹cmd黑窗 |
| `1ff2e42` | refactor: 移除侧面板顶部标签栏，改由工具栏开关控制面板内容 |
| `6f0f359` | feat: 右侧面板改为AI与笔记双标签页，照搬参考项目NotePanel |
| `51b988f` | style: ContentArea文件夹按名称排序 |
| `b1c30c2` | refactor: 彻底移除文章翻译功能 |
| `475a4f7` | chore: 移除已无功能的英文句点误判文档(abbrev-dot.md) |
| `87cee0b` | refactor: 移除段落翻译和翻译句子高亮功能 |
| `3d93ede` | chore: 清理旧迁移代码、更新数据库备份、同步markdown文档 |
| `ce6b764` | feat: b键快捷打开段落笔记 + 自动聚焦 + 阅读器/编辑器宽度加大 + 字号同步 + 编辑器v-once移除 |
| `07cb0ba` | style: 界面背景色统一 + 笔记字号增大 + 修复悬停笔记按钮抖动 |
| `796992e` | fix: 笔记按钮位置固定 — right:0+translateX替代硬编码 |
| `1bcf755` | chore: 移除调试日志 — 笔记功能稳定后清理 |
| `7db5445` | docs: 段落笔记功能文档 — 数据结构/API/表结构说明 |
| `4e0766d` | feat: 笔记阅读/编辑双模式 — 有内容阅读，无内容直接编辑 |
| `9530658` | feat: 段落笔记 — 右侧笔记指示器、侧面板编辑器、JSON存储 |
| `0df051e` | feat: 编辑器无缝切换、居中编辑指示、环境要求文档 |
| `9926b15` | feat: pythonw无窗口运行脚本、TXT导入、文章预览、SVG图标替换 |
| `344e6b0` | feat: 书签面板、Python脚本启动、工具栏纯图标按钮 |
| `cb9d30c` | feat: 加载状态优化 + 注释卡片Enter确认 + SVG图标统一 |
| `915b7ac` | feat: 翻译句子高亮 + 批注栏开关/内嵌按钮 + 左侧工具栏 |
| `7d775eb` | feat: sentence批注卡片不可见 + 同类型不可重叠 |
| `4d65414` | fix: 长难句Delete改鼠标悬停定位 |
| `603d0c7` | fix: 长难句蓝色+支持Delete删除+嵌套连续删除自动弹卡 |
| `aab7901` | feat: 多页阅读视图、查词开关、UI优化 |
| `faafd11` | fix: ManualWordCard查词防重复 + 样式优化 |
| `fec6ef1` | docs: 全量更新markdown — 移除验证码/回收站API补充 |
| `180ce80` | feat: 段落编号悬停显示+翻译提示仅has-trans时显示 |
| `28d8355` | feat: 段落翻译导入(S键切换)+文章编辑器修复+画布字号调节 |
| `c45e72c` | chore: 移除访问验证码; 修复启动脚本标签问题; 更新文档 |
| `e0116ec` | fix: App.vue多标签导航; feat: 字号调节+工具栏布局 |
| `83a3874` | feat: 画布线宽2px+空格切换颜色; 查词默认关闭; 注释快捷键修复
