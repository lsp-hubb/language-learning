# Language Learning — 项目架构文档

## 项目概述

**Language Learning** 是一个外语阅读辅助工具，帮助用户阅读英文文章并实时查词、添加批注、手绘标记。基于 **Vue 3 + Vite + Pinia** 前端和 **Express + MySQL** 后端构建。

### 核心功能

1. **文件夹管理** — 支持无限层级嵌套的文件夹，CRUD 操作，右键菜单，面包屑导航
2. **外刊文章管理** — 在文件夹中创建、编辑、查看英文文章（文章卡片显示首行预览）；文章卡片**右键菜单**提供「✏ 重命名」（就地编辑标题）／「📁 移动到…」（二级列表选目标）／「🗑 删除」（须在**顶部通知条**上二次确认才真正删除，防误删）
3. **单页阅读视图** — 滚动阅读，两端对齐排版，滚动条在容器右侧；工具栏 A−/A+ 调字号（12–32px）
4. **智能单词查询** — 选中英文单词后，自动查询有道词典，弹出浮动词卡展示音标、释义；音标区鼠标悬停自动播放英式/美式发音；支持 T 键全局开关（默认关闭）
5. **PDF 风格批注** — 黄色高亮(E键, `#FFEB3B`) + 红色下划线(W键, `#e74c3c`)，悬停 200ms 查看注释并自动播发音，点击编辑/自动填入查词结果，同类型不可重叠，按 Delete 键删除，数据保存在 MySQL。
6. **手绘画布** — Ctrl+R 开启/关闭画布，支持画笔（Q 切换水平直线/波浪线）/矩形/矩形擦除/6 色切换，笔迹按文章 ID 存储在 MySQL，500ms 防抖写入
7. **段落编号提示** — 鼠标悬停段落时左侧浮出「第 N 段」（CSS `counter` + `::before`）
8. **收藏文章** — 文章卡片右上角 SVG 书签图标，切换收藏状态，数据持久化
9. **右侧面板（AI / 笔记）** — 右侧悬浮面板（46vw），通过工具栏开关互斥切换显示内容（面板内无标签栏）：
   - **AI**（`panelMode === 'link'`）：嵌入多个 AI 站点 iframe（元宝 / 豆包 / 千问 / DeepSeek），可嵌入站点切换只显隐不重建；不支持嵌入的站点显示占位提示 +「外部打开」按钮。当前站点记忆在 `localStorage.sidePanelState`
   - **笔记**（`panelMode === 'note'`，`NotePanel.vue`）：粘贴结构化笔记，自动解析为「英文 / 中文 / 词汇」卡片；支持追加 / 修改全文、导航栏快速跳转、**单击词汇项切换重点**（变艳红 `#ff1f1f` + 加粗，词汇项统一 `user-select: none` 避免误选文本）、**右键单击复制词汇内容**、**重点标记持久化在数据库 `articles.marks`**（TEXT/JSON，键 `noteIndex__词汇`；经 `GET /api/articles/:id/marks` 读取、`PUT /api/articles/:id/marks` 覆盖写入）、**重点集中卡片** — 顶部「重点」按钮（`toggleMarkedPanel`，按钮 `:plain` 反映展开态）以**弹出式只读卡片**呈现（`.marked-panel`：`position: fixed; left/top: 0`、宽 `100vw`、高 `100vh` 顶满整个网页，内部滚动）。内容由计算属性 `markedItems` 按笔记顺序汇总 `marked` 中为 true 的项，每项带所属笔记编号（灰色徽章，纯数字）；**只读**：不能在此取消重点（重点的增删仍在原笔记卡片中单击词汇进行）；条目允许选中复制文本；无重点时显示空提示。**右侧边栏**（`.marked-sidebar`，与左侧列表各 `flex: 1 1 0` 平分宽度、独立滚动）直接渲染 `activeNote` 对应的**原笔记卡片**（与笔记列表同结构 `.note-card`：英文 + 中文 + Vocabulary 列表，无编号徽章 / 副标题头部，重点项 `vocab-marked` 红色加粗），只读；`toggleMarkedPanel` 打开时若未选笔记默认显示第一张含重点的卡片，单击左侧重点项经 `selectNote` 在右侧边栏显示其所属笔记卡片并高亮该项（`is-active`）；无重点时不渲染
   - L 键切换 AI 助手面板、r 键切换笔记面板，工具栏「AI」「笔记」按钮等价切换；**默认展开并显示笔记面板**（`showSidePanel = true`、`panelMode = 'note'`，阅读区初始即为 54vw 收缩态）
10. **局域网共享** — 同一网络下多设备可同时访问，共享文章和批注数据（无验证码）
11. **阅读计时器** — 工具栏显示，点击循环切换开始 → 暂停 → 归零
12. **英文单词数统计** — 工具栏实时显示文章单词数（按空白切分）
13. **手动查词卡片** — **默认开启**（`useWordLookup.showManualCard` 初值 `true`，进入文章页即显示，工具栏「查词」按钮呈 `primary`）；Ctrl+Shift+Z **或工具栏「查词」按钮**开关（按钮 `primary` 高亮反映卡片开合，与 `showManualCard` 双向一致）；默认显示时**不自动聚焦输入框**（`ManualWordCard` 的 `visible` watch 非 immediate），避免抢占焦点使 T / r / i 等单字母快捷键被 `INPUT` 守卫吞掉；开关状态不持久化。支持输入查词、一键复制、**清空**（清空输入内容与查询结果，并中断进行中的请求、清联想词与复制态）、联想词下拉（超出最大高度可滚动；**默认不高亮**，高亮由鼠标悬停或 ↑/↓ 产生且唯一，鼠标移出浮层即熄灭，高亮项自动滚入可视区）、任意拖动、位置记忆（`localStorage._manual_word_card_pos`）；查词结果自动播放英式发音，音标区可悬停切换英式/美式发音；卡片打开时正文选中文本自动填入查询；**Esc 只关闭联想层**，关闭整张卡片须用 Ctrl+Shift+Z 或工具栏「查词」按钮
14. **状态恢复** — 刷新/重启后自动回到上次浏览的文件夹或文章页面
15. **浮动批注栏开关已移除，仅右键弹出** — 顶部工具栏不再提供「启用/禁用浮动批注栏」的小箭头（▲/▼）按钮。**选中文本不会自动弹出栏**：`onMouseUp` 中仅当 `e.button === 2`（右键）才把 `annotToolbarVisible` 置 true，左键 mouseup 只记录选区（`pendingSelection`）并收起栏。弹出动作**只来自正文右键**：选中文本（含双击选中）后**鼠标右键单击**即 `preventDefault()` 阻止系统菜单、启用 `annotToolbarEnabled` 并经 `onMouseUp` 在光标处显示浮动批注栏；无选区时保留系统菜单。`onClearSelection` 仅处理左键（右 `mousedown` 不清除选区），确保右键时选区保留。**允许在已有批注（如红色下划线）之上选中单词再叠加另一种批注**：`onMouseUp` 不再因"选区与已有批注重叠"而隐藏工具栏（否则在下划线短语内右键无法弹出浮动栏来标注单词）；同种类型重叠仍由 `createAnnotation` 拦截（`a.type === type` 时才拒绝），不同类型可自由叠加。
浮动栏与顶栏内嵌按钮是**互斥**的两套入口，由 `annotToolbarEnabled` 决定：

| `annotToolbarEnabled` | 顶栏内嵌「高亮/下划线」按钮 | 浮动批注栏 |
|:---:|:---:|:---:|
| `false`（默认，进入文章后的初始态） | **显示**（选中文本后点击直接标注） | 不弹（`visible = annotToolbarVisible && enabled` 恒 false） |
| `true`（正文右键过一次后） | **隐藏** | 右键选区时在光标处弹出 |

> `annotToolbarEnabled` 一旦置 `true` 就不再自动复位，直到重新进入文章页。
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
├── .env                                # 环境变量（数据库配置；需自行新建，已 .gitignore）
├── .gitignore
├── start.bat                           # Windows 一键启动脚本 (前后端)
├── scripts/
│   ├── start-all.py                    # 一键启动：MySQL → 后端 → 前端 → PDF(5057) + 打开浏览器
│   ├── stop-all.py                     # 一键停止：前端 → 后端 → PDF(5057) → MySQL
│   ├── restart-backend.py              # 仅重启后端（3000），改完 server/index.js 用
│   ├── restart-pdf.py                  # 仅重启 PDF 服务（5057），改完 server/*.py 用
│   ├── focus_editor.py                 # 组件检查器跳转后把编辑器窗口置前
│   ├── reimport_all.cjs                # TXT 批量导入（一次性脚本）
│   └── bat/                            # 双击入口（静默启停，无 cmd 黑窗）
│       ├── start-all.bat               # 启动，日志 logs\start-all.log
│       └── stop-all.bat                # 停止（停 MySQL 需管理员），日志 logs\stop-all.log
├── .prettierrc.json                    # Prettier 代码格式化配置
├── README.md
├── markdown/
│   ├── ARCHITECTURE.md                 # 项目架构文档
│   ├── ANNOTATION_MIRROR.md            # 正文 / 笔记英文行批注镜像实现说明
│   ├── GIT_GUIDE.md                    # Git 使用指南
│   ├── TXT_IMPORT.md                   # TXT 文章批量导入指南
│   └── PDF_EXPORT.md                   # PDF 导出功能（reportlab + PyMuPDF）
├── docs/
│   ├── MySQL连接配置说明.md             # 数据库配置文档
│   ├── recycle-bin.md                  # 回收站功能说明
│   ├── python-env.md                   # Python 虚拟环境说明
│   └── migrate-to-new-pc.md            # 换电脑部署指南（整包复制）
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
│   ├── folderBundle.js                 # 文件夹数据包导出/校验/事务导入（P0 + P1，100 MB 前置解析）
│   ├── pdf_export.py                   # PDF 导出核心：reportlab 排版 + PyMuPDF 写注释
│   ├── notes_pdf_export.py             # 笔记单独排版成 PDF + 与正文 PDF 合并
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
│   ├── utils/
│   │   ├── selectionText.js            # 选中文本补全 + 正文/笔记匹配高亮公共工具
│   │   ├── normalizeQuotes.js          # 弯引号 → 直引号统一清洗
│   │   ├── folderBundle.js             # 文件夹包下载 / 前端快速预检（P0 + P1）
│   │   ├── feedback.js                 # 统一反馈层：消息提示 / 结果弹窗 / 确认框
│   │   └── __tests__/                  # notePanelReverse.spec.js / selectionText.spec.js
│   ├── stores/
│   │   └── fileExplorer.js             # Pinia 状态管理
│   ├── composables/                    # 可组合函数
│   │   ├── useWordLookup.js            # 单词查询 + 文本选择
│   │   ├── useAnnotations.js           # 批注 CRUD + 工具栏/卡片 UI
│   │   ├── useTimer.js                 # 阅读计时器
│   │   ├── useCanvas.js                # 画布模式/工具/颜色
│   │   └── useArticleContextMenu.js    # 文章卡右键菜单 / 删除确认通知共享状态
│   ├── views/
│   │   ├── ArticlePage.vue             # 文章阅读/编辑页（编排层：composables + 快捷键 + 面板联动）
│   │   └── ReviewPage.vue              # 复习页面（展示文章标题，待开发）
│   └── components/
│       ├── FileExplorer.vue            # 文件管理器主组件
│       ├── FolderTree.vue              # 左侧文件夹树
│       ├── ContentArea.vue             # 主内容区（文件夹+文章网格）
│       ├── ArticleCard.vue             # 文章卡片（收藏 SVG 书签图标 + 复习 📜 按钮，新标签打开）+ 右键重命名/移动到文件夹
│       ├── ArticleToolbar.vue          # 顶部工具栏（返回/编辑/计时器/链接）
│       ├── ArticleReader.vue           # 文章阅读区（段落/批注标记/画布/左侧工具侧边栏）
│       ├── ArticleEditor.vue           # 文章编辑器（标题+正文输入框）
│       ├── AnnotToolbar.vue            # 浮动批注工具栏（高亮/下划线）
│       ├── ArticleDialog.vue           # 新建文章对话框
│       ├── FolderDialog.vue            # 文件夹创建/重命名对话框
│       ├── FolderImportDialog.vue      # 文件夹包导入对话框（P0 + P1；拖拽上传 + 统计卡片）
│       ├── ContextMenu.vue             # 右键菜单（含导出/导入入口）
│       ├── WordCard.vue                # 浮动单词查询卡片（选中查词）
│       ├── ManualWordCard.vue          # 手动查词卡片（Ctrl+Shift+Z，含联想词）
│       ├── AnnotationCard.vue          # 浮动批注卡片
│       ├── NotePanel.vue               # 结构化笔记面板（解析生文本 → 英文/中文/词汇卡片）
│       ├── BookmarksPanel.vue         # 书签面板（左侧工具栏，同文件夹文章导航）
│       ├── CodeGate.vue               # 无 UI 的空组件（挂载即 emit verified 放行）
│       ├── DrawCanvas.vue              # 画布绘制组件（画笔/矩形/矩形擦除）
│       ├── PdfExportButton.vue         # PDF 导出按钮（调 5057 服务，含状态指示灯）
│       ├── icons/                      # SVG 图标（edit.svg / import.svg；手动查词卡片：复制.svg「复制全部」/ 清空.svg「清空」/ 搜索.svg 查询按钮；pdf文件.svg PDF 导出按钮）
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
PdfExportButton.vue ──直连──> pdf_service.py :5057
                                  ├── pdf_export.py（正文 + 批注）
                                  └── notes_pdf_export.py（笔记）──PyMuPDF 合并──> PDF 文件
```

**服务端口一览**

| 端口 | 服务 | 说明 |
|------|------|------|
| 3306 | MySQL80 | 数据库（`datadir` 指向项目内 `mysql-data/`，随项目目录迁移） |
| 3000 | Express 后端 | `app.listen(PORT)` 未指定 host，监听所有网卡；前端经 Vite 代理 `/api` 转发 |
| 5173 | Vite 前端 | 监听 `0.0.0.0`，局域网可访问 |
| 5057 | PDF 导出服务 | FastAPI，仅本机 `127.0.0.1`；前端**直连不经代理** |

- **前端**：`localhost:5173` / LAN: `192.168.x.x:5173`（Vite Dev Server，监听 `0.0.0.0`）
- **后端**：`localhost:3000`（Express，通过 Vite 代理转发；未显式绑定 `127.0.0.1`，Node 默认监听所有网卡）
- **前后端通信**：前端使用 `/api` 相对路径，Vite 代理转发至后端
- **PDF 导出**：前端直连 `http://127.0.0.1:5057`（地址硬编码在 `PdfExportButton.vue`）。
  因为导出返回的是二进制流且不需要走数据库，没必要绕一层代理；
  服务未启动时按钮显示红灯并提示，不影响其他功能
- **局域网访问**：其他设备通过 `http://<主机IP>:5173` 访问。
  注意 5057 只监听 `127.0.0.1`，**局域网设备无法使用 PDF 导出**（该场景未支持）

---

## 引号归一化（弯引号 → 直引号）

从 Word / PDF / 网页复制来的英文常带弯引号（`‘ ’ “ ”`）及对应 HTML 实体，与库里已有的直角引号混用会导致搜索、匹配、批注偏移等一系列问题，故统一归一为直角引号。

统一实现：`src/utils/normalizeQuotes.js`

- `normalizeQuotes(text)`：`‘ ’` → `'`、`“ ”` → `"`，并兼容 `&lsquo;` / `&rsquo;` / `&ldquo;` / `&rdquo;` 及 `&#8216;` 等 HTML 实体；`null` / `undefined` → `''`。

**三处都要调用**，保证「库里库外一致」：① 输入侧（落库前清洗）、② 输出侧（展示 / 复制前清洗，库里已干净时幂等）、③ 已入库（加载后若仍含弯引号，清洗并静默回写，完成一次性迁移）。

| 数据 | 输入侧 | 输出侧 | 已入库回写 |
|------|--------|--------|------------|
| 文章正文 `content` | `ArticlePage`（编辑保存）、`ArticleDialog`（新建） | `ArticlePage.paragraphs`（展示） | ✅ `ArticlePage` watch |
| 笔记 `notes`、重点 `marks` | `NotePanel`（保存 / 复制词汇） | `NotePanel`（展示、`highlight` 搜索高亮） | ✅ 加载后静默回写 |
| 批注 `note` | `useAnnotations`（创建 / 编辑保存） | 随批注卡片展示 | ✅ 加载后静默回写 |

> ⚠️ PDF 导出是例外：`PdfExportButton.vue` 直接把原始 `article.content` 发给 5057，未做引号归一；
> `pdf_export.py` 的 `_normalize_text()` 只替换特殊连字符。如需归一应在前端按钮或 `pdf_service.py` 补上。

`NotePanel` 曾自带一份只处理 `’` 的本地实现，导致笔记里的 `“ ”` 不被归一；现已统一委托 `src/utils/normalizeQuotes.js`，避免多处实现不一致。

**匹配归一化** `normKey()`（`ArticlePage` / `NotePanel`）：仅用于「文本匹配」时忽略大小写与弯 / 直角引号差异。
单双引号都要归一（`[‘’]` → `'`、`[“”]` → `"`），且必须是**等长 1:1 替换**，否则字符偏移量会对不上。

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

> **无自引用外键**：`parent_id` 不指向 `folders.id`，子目录的递归处理全部由应用代码完成
> （`collectDescendantIds()` 等）。

### `articles` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | VARCHAR(64) | 主键，UUID |
| `title` | VARCHAR(500) | 文章标题 |
| `content` | TEXT | 文章正文 |
| `folder_id` | VARCHAR(64) | 所属文件夹 ID |
| `type` | VARCHAR(32) | 文章类型（预留，普通文章为空串；由启动 IIFE 补列，当前 SQL 备份未含） |
| `notes` | MEDIUMTEXT | 笔记生文本（用户粘贴，原样存储，前端解析展示；SQL 备份已含；旧库 `TEXT` 由启动 IIFE 自动升级） |
| `marks` | TEXT | 重点词汇标记（JSON 文本，键 `noteIndex__词汇`，值 `true`；由 `GET/PUT /api/articles/:id/marks` 读写；由启动 IIFE 补列，当前 SQL 备份未含） |
| `deleted_at` | TIMESTAMP | NULL 表示正常，非空表示已移入回收站（SQL 备份已含） |
| `created_at` | TIMESTAMP | 创建时间 |

> **列补齐方式**：后端**模块加载时的启动 IIFE**（`server/index.js` 顶部）用 `ALTER TABLE ... ADD COLUMN`
> 幂等补齐 `notes` / `marks` / `type` / `content` 四列（异常静默忽略），`deleted_at` 由 `POST /api/init` 补齐。
> 当前 `db/language_learning.sql` 备份的建表只含 7 列（无 `type` / `marks`），**不是字段级完整备份**。
> ⚠️ 表不存在时先启动后端无效（ALTER 全部失败且被忽略）：新环境须先 `/api/init` 建表或导入 SQL 备份，
> **再重启一次后端**完成补列。
> `folder_id` 同样**无外键**，删除/恢复/永久删除文件夹均由应用代码手工处理。

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

> **无外键**：建表后会执行 `ALTER TABLE canvas_strokes DROP FOREIGN KEY canvas_strokes_ibfk_1`
> 主动移除历史外键。故 `DELETE /api/articles/:id` 会**先手动删除**该文章的笔迹；
> 而文件夹「永久删除」只删 `articles`，理论上可能残留孤立笔迹记录。

---

## 后端 API 接口

基础地址：`/api`（通过 Vite 代理转发至 `http://localhost:3000`）

### 系统

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/init` | 初始化数据库建表（folders / articles / annotations / favorites / canvas_strokes）+ 补 `deleted_at` 列 |
| GET | `/health` | 健康检查（执行 `SELECT 1`） |

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

### 文件夹数据包（P0 + P1，详见 `FOLDER_IMPORT_EXPORT.md`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/folders/:id/export` | 导出纯 JSON bundle（`:id` 可为 `root`）；含 `folders` + `articles`（含 `notes/marks/type`） + `annotations` / `favorites` / `canvasStrokes`，过滤 `deleted_at`；按已导出文章 ID 批量查询附属表 |
| POST | `/folders/import/validate` | dry-run 校验（白名单字段、引用完整性、批注偏移与类型、环检测、条数上限），不写库；摘要返回六类数据计数 |
| POST | `/folders/import` | 单事务导入；固定 `create-new`、ID 全量重生成（含批注 `id` 与所有 `articleId` 重映射）；两个导入路由自带 `express.json({limit:'100mb'})` 并**注册在全局 2 MB 解析之前**；建表 DDL 在事务外一次性执行 |

导出 / 导入数据流：

```
右键 → FileExplorer.vue → src/utils/folderBundle.js（fetch / Blob 下载）→ GET /api/folders/:id/export
     → server/folderBundle.js buildExport：folders BFS → articles → annotations / favorites / canvas_strokes（IN 批量查询）

选包 → FolderImportDialog.vue → 前端预检 → POST /folders/import/validate（摘要）
     → POST /folders/import → validateBundle（清洗/拓扑排序）→ importBundle（单事务，ID 全量重生成）
     → 刷新目录树与文章列表
```

`canvas_strokes` 无外键，必须显式按映射后的 `articleId` 插入，避免孤儿行；`articles.content` 逐字写入，不做引号归一，否则批注偏移三元组会错位。导出 / 导入结果不再用 `alert`，统一走 `src/utils/feedback.js` 的 `showResult` 统计卡片弹窗，失败走 `notifyError`。

### 文章

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/article/:id` | 获取单篇文章（含 `notes / type`） |
| GET | `/articles/:folderId` | 获取文件夹下所有文章（按标题排序） |
| POST | `/articles` | 创建文章 `{ title, folderId, content?, type? }`；根目录被拒 |
| PUT | `/articles/:id` | 更新文章（部分更新 `{ title?, content?, folderId?, type? }`） |
| GET | `/articles/:id/notes` | 读取笔记生文本 |
| PUT | `/articles/:id/notes` | 保存笔记生文本（`{ notes }`，原样存储不做解析；请求体上限 2 MB，`express.json({ limit: '2mb' })`） |
| GET | `/articles/:id/marks` | 获取重点标记（返回反序列化后的 JSON 对象） |
| PUT | `/articles/:id/marks` | 保存重点标记（body `{ marks }`，整体覆盖） |
| DELETE | `/articles/:id` | **硬删除**文章（先手动删 `canvas_strokes`，再删文章；批注/收藏靠外键级联） |

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
// 路径集中在两个常量，换机只改这里；也可用环境变量覆盖（PYTHON_HOME / PYTHON_SCRIPT_DIR）
const PYTHON_HOME = process.env.PYTHON_HOME || 'D:\\PythonFiles\\.venv'
const PYTHON_SCRIPT_DIR = process.env.PYTHON_SCRIPT_DIR || 'D:\\PythonFiles\\Python'
const SCRIPTS = { 'clipboard_to_txt': path.join(PYTHON_SCRIPT_DIR, 'clipboard_to_txt.py') }
const pythonBin = path.join(PYTHON_HOME, 'Scripts', 'pythonw.exe')  // pythonw：无控制台窗口
// 启动前校验存在性，缺失时返回 500 明确报错（避免 spawn 静默失败）
if (!existsSync(pythonBin) || !existsSync(scriptPath)) return res.status(500).json({ error: '...' })
spawn(pythonBin, [scriptPath], { cwd: PYTHON_SCRIPT_DIR, detached: true, stdio: 'ignore' }).unref()
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
- 服务端内存缓存（最大 500 条「单词+口音」，MP3 Buffer，**无 TTL**；命中不调整顺序，实为**插入顺序 FIFO** 而非 LRU）
- 请求去重（`pendingTts`）：同一单词+口音并发请求复用同一个 Promise，响应头 `X-Cache: HIT / DEDUP / MISS`
- `accent=uk` → 有道 `type=1`，其余值 → `type=2`；单词限 50 字符且只含 `[a-zA-Z\s'-]`
- Keep-Alive Agent（`ttsAgent`）：复用 TCP 连接到有道，`maxSockets: 2`
- `warmupTts()`：发起查词请求时即与释义查询并行预热 TTS 缓存（不等待查词成功），不阻塞释义返回
- 释义为空时，`translation` 由 `extractYoudaoTranslation()` 从整段翻译中提取，作为兜底展示

**性能优化特性**：
- 释义查询：服务端缓存（最大 2000 条，正常 30 分钟 / 错误 60 秒；命中会移到队尾，是真正的 LRU）
- 请求去重：`pendingLookups` 同一单词并发复用
- 8 秒超时控制（AbortController，**服务端**）
- 前端 `src/api/index.js` 的 `request()` 另有 **10 秒**超时，并支持调用方传入 signal 合并（`anySignal`）
- 联想词 `/suggest`：无本地缓存、无超时控制，最多取 5 条

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
 ├── CodeGate.vue              —— 无 UI 的空组件（模板为空，挂载即 emit('verified') 直接放行）
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
     │    │    ├── useCanvas          —— 画布模式/工具/颜色
     │    │    └── useArticleContextMenu —— 文章卡右键菜单 / 删除确认通知共享状态
     │    ├── ArticleToolbar         —— 顶部工具栏（返回/编辑/字号/计时/单词数/查词/AI/笔记/PDF，以及 annotToolbarEnabled=false 时显示的内嵌高亮/下划线按钮；Element Plus 按钮与原生 button 混用）
     │    │    └── PdfExportButton   —— PDF 导出（直连 5057，状态指示灯：绿=在线/红=未启动/黄闪=检测中）
     │    ├── ArticleReader          —— 文章阅读区（普通文章；白色圆角卡片，段落/批注标记/画布/左侧工具栏/段落编号）
     │    │    └── DrawCanvas        —— 画布（画笔/矩形/矩形擦除 + 底部工具条）
     │    ├── ArticleEditor          —— 文章编辑器（contenteditable 正文 + 标题输入）
     │    ├── AnnotToolbar           —— 浮动批注工具栏（高亮/下划线）
     │    ├── WordCard               —— 浮动查词卡片（选中查词，自动/悬停发音）
     │    ├── ManualWordCard         —— 手动查词卡片（Ctrl+Shift+Z，联想词，可拖动）
     │    ├── AnnotationCard         —— 浮动批注卡片（查看/编辑，Enter 保存）
     │    └── BookmarksPanel         —— 书签面板（左侧工具栏，同文件夹文章导航）
     │
     └── 右侧面板（App.vue 层，由工具栏开关决定显示 AI 或笔记）
          ├── AI iframe（元宝 / 豆包 常驻 DOM、切换只显隐；千问 / DeepSeek 不嵌入，显示占位提示 +「外部打开」）
          └── NotePanel.vue          —— 结构化笔记（解析生文本 → 英文/中文/词汇卡片）
     │
     └── ReviewPage.vue ( /review/:id, 新标签)
          └── 复习功能（待开发）
```

---

## 手绘画布

画布组件 `DrawCanvas.vue` 提供在文章上手绘标记的功能：

- **开关**：`Ctrl+R` 切换；也可点画布工具栏「✓ 完成」关闭（`Esc` **不**关闭画布）
- **右键开关当前工具**（`DrawCanvas.onCanvasContextMenu`，`document` 上的 `contextmenu` 监听）：画布开启（`drawMode`）且右键落在**正文面板** `.reader-content`、页面**无选中文本**时，`preventDefault()` 并复用 `onToolClick(props.tool)` 翻转 `drawActive` —— 只开/关「当前正在使用的工具」，**不关闭画布**（`drawMode` 不变，关闭仍走 ✓ 完成 / Ctrl+R），也不切换工具类型（与数字键 1/2/3 的当前工具再按一次等价）
  - 有选中文本、或事件已被正文右键批注处理（`defaultPrevented`）→ 直接 return，保留原「右键手动注释」浮栏
  - 未开启画布 → 完全不介入，右键仅原手动注释
  - 显式排除：`.side-panel` / `.note-root` / `.marked-panel` / `.input-section` / `.draw-toolbar` / `.reader-left-tools` / 输入区，避免干涉笔记卡片右键重新录入、词汇右键复制等侧面板功能
  - `startDraw` 增加 `e.button !== 0` 守卫：右键按下不进入绘制，右键不会误画出一笔
- **绘制工具**：画笔(1，Q 切换直线/波浪线，**每次开启画布时默认波浪线**，本次开启内 Q 的切换有效)、矩形(2)、矩形擦除(3)，工具栏按钮可开关
- **画笔颜色**：6 色（红 `#e74c3c`、深蓝 `#1c2833`、蓝 `#1f6ea8`、绿 `#1a7a42`、橙 `#b9770e`、紫 `#76448a`），`Space` 循环切换
- **画笔行为**：按下后沿**水平方向**绘制——向右拉揭示、向左拉擦除，抬笔（mouseup/mouseleave）才落库；即「划线/画浪线」而非自由手绘
- **橡皮擦**：拖拽绘制淡蓝色虚线矩形，框内及与边框相交的笔触被删除
- **画布范围**：仅限于 `.reader-content` 容器内（高度为 `scrollHeight`，随内容滚动）
- **与注释共存**：工具关闭时画布 `pointer-events: none`，可正常查词注释；工具激活时自动关闭查词/批注卡片并取消文本选中
- **数据存储**：每篇文章笔迹经 API 保存在 MySQL `canvas_strokes` 表，自动建表；绘制结束立即同步保存一次，另有 500ms 防抖兜底
- **笔迹格式**：`{ type: 'pen' | 'wavy' | 'rect', color, a1, a2, ... }`（`a1/a2` 为段落锚点）；重绘时按 `DrawCanvas._pointAt()` 锚点还原位置（整体等比缩放会让笔迹与文字错位），仅无锚点的旧数据才按 `refCanvasW/H` 比例回退（`ResizeObserver` 监听容器变化）
- **跨设备共享**：笔迹存入 MySQL，局域网多设备可共享同一画布内容
- **侧边栏兼容**：画布工具栏随右侧面板开闭平移（`translateX(calc(-50% - 23vw))`）
- **新画布**：清空当前文章笔迹并同步保存空数组
- **切换文章 / 组件卸载**：自动保存当前文章笔迹至 MySQL，再重置状态加载新文章笔迹
- **加载失败兜底**：接口报错时回退读 `localStorage._canvas_strokes_<articleId>`

---

## PDF 导出

把「文章正文 + 阅读器批注 +（可选）笔记」导出为 PDF。正文是可选中、可搜索、可复制的真实文本，
批注落成 PDF 标准标记注释（Highlight / Underline），在阅读器里悬浮即可看到批注内容；
`includeNotes` 开启且文章有笔记时，服务端另排一份笔记 PDF 追加在正文之后。

> 完整说明见 [PDF_EXPORT.md](./PDF_EXPORT.md)，本节只列与整体架构相关的要点。

### 链路

```
ArticleToolbar.vue
  └── PdfExportButton.vue  [●] [图标]      ● 绿=服务在线 ● 红=未启动 ● 黄闪=检测中
        │  POST /api/export-pdf（直连，不经 Vite 代理）
        ▼
   server/pdf_service.py : 5057（FastAPI，仅 127.0.0.1）
        ├── server/pdf_export.py（正文 + 批注）
        │     ① reportlab 排版（Paragraph + TA_JUSTIFY 两端对齐）
        │     ② PyMuPDF get_text("rawdict") 读回每个字符的真实位置与页码
        │     ③ 按「非空白字符序列」把字符对齐到 (段号, 段内偏移)
        │     ④ 按批注偏移量取字符 → 按 (页码, 基线) 合并 → add_highlight_annot / add_underline_annot
        └── server/notes_pdf_export.py（笔记，includeNotes 开启且有笔记时）
              → export_notes_to_pdf() 用 reportlab 排版 → merge_pdfs() 用 PyMuPDF 合并到正文之后
        ▼
   application/pdf（Content-Disposition 用 RFC 5987 双写，支持中文文件名；
                    响应头 X-Include-Notes：1=已追加笔记页，0=未追加）
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
| `src/views/ArticlePage.vue` | 向工具栏传 `:article` 与 `:annotations`（当前文章与全部批注） |

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
| E / W | 高亮 / 下划线（对当前选区）；无选区直接返回；已有同类型标记重叠时跳过创建（不取消已有标记） | `ArticlePage.onAnnotShortcut` |
| T | 全局开关单词查询（默认关闭） | `ArticlePage.onAnnotShortcut` |
| Ctrl+R | 开关画布模式（再次按下即关闭并保存）；**未排除 Shift**，Ctrl+Shift+R 同样命中 | `ArticlePage.onAnnotShortcut` |
| L | 切换 AI 助手面板（与点击 AI 按钮等价） | `ArticlePage.onAnnotShortcut` |
| r | 切换笔记面板；**画布工具激活（`drawActive`）时无效** | `ArticlePage.onAnnotShortcut` |
| i | 开关书签索引面板（与点击左侧书签按钮等价；Ctrl+I 留给 Vite 组件检查器，故要求无修饰键） | `ArticlePage.onAnnotShortcut` |
| Ctrl+Shift+Z | 打开/关闭手动查词卡片（**默认开启**，首次按下即关闭；**输入框内也生效**） | `ArticlePage.onAnnotShortcut` |
| Space | 画布模式下循环切换画笔颜色（**仅画笔 / 矩形激活时**，矩形擦除不生效） | `ArticlePage.onAnnotShortcut` |
| Ctrl+I | 开关 Vue 组件检查器（`vite-plugin-vue-devtools` 的 `toggleComboKey`，`vite.config.js` 配置） | Vite 插件 |
| 1 / 2 / 3 | 画笔 / 矩形 / 矩形擦除（要求 `drawMode` 为真，**不要求** `drawActive`） | `DrawCanvas.onKeydown` |
| Q | 切换画笔样式（直线 ↔ 波浪线，画布开启且当前为画笔时） | `DrawCanvas.onKeydown` |
| Esc | 取消文本选中 / 关闭查词卡片 / 关闭批注卡片与浮动工具栏（**不关闭画布、不关闭手动查词卡片**；输入框内仍生效） | `ArticlePage.onAnnotShortcut` |
| Delete / Backspace | 删除当前查看的批注（编辑中的 textarea 内不拦截） | `AnnotationCard.onKeyDown` |
| Ctrl+Enter / Ctrl+S | 编辑模式下保存更改（标题 input 绑 Ctrl+Enter；编辑态下 Ctrl+S 由 `ArticlePage.onAnnotShortcut` 全局捕获，同样会保存） | `ArticlePage.onAnnotShortcut` / `ArticleEditor` |
| Enter | 笔记面板有匹配项时滚动到下一个匹配卡片；若正文有反向高亮命中则改为在正文命中间循环向后跳转（输入框内不拦截） | `NotePanel._enterNavHandler` |
| Enter / Shift+Enter | 笔记输入区内：解析保存 / 换行 | `NotePanel.onEnterKey` |
| Enter / Shift+Enter | 单卡片重新录入区内：保存该卡片 / 换行 | `NotePanel.onEditEnterKey` |
| Esc | 单卡片重新录入时取消编辑（优先于关闭重点集中卡片） | `NotePanel._escCloseHandler` |
| ↑ / ↓ / Enter / Esc | 手动查词卡片联想词导航与**关闭联想层**（Esc 不关闭卡片本体） | `ManualWordCard` |

**生效边界（`ArticlePage.onAnnotShortcut` 的守卫顺序，决定哪些键会被吞掉）**：

函数内分两段，**只有后段的正文标注类才受侧栏让位影响**：

1. **① 控制类前置段**（T / Ctrl+Shift+Z / Ctrl+R / Space / L / r / i / Esc）：不依赖正文选区，
   **不受「侧栏 / 笔记选区让位」影响**，因此在笔记 / AI 面板内同样可用（详见下方「笔记 / AI 面板内复用」）。
2. 编辑态（`isEditing`）→ 只处理 Ctrl+Enter / Ctrl+S，其余 return。
3. `document.activeElement` 为 `INPUT` / `TEXTAREA` → return
   （**Esc 与 Ctrl+Shift+Z 的判断在它之前**，故这两个键在输入框内仍然生效）。
4. `drawActive` 为真 → return，即**画布工具激活时 r / i / T 失效**。
5. **② 正文标注类（E / W）**：焦点在右侧面板内（`e.target.closest('.side-panel')`）→ return；
   选区落在笔记面板（`.note-root`）内 → 同样 return。这两处让位是笔记面板能正常输入、
   且笔记英文行的 e / w 交由 `NotePanel` 自己监听处理的前提。

> 输入类元素（`INPUT` / `TEXTAREA` / contenteditable）内的按键一般不会被文章快捷键拦截，但 Esc 与 Ctrl+Shift+Z 是例外（见上）。
> 「方向键 / PgUp / PgDn / Home / End 翻页」为多页阅读视图时期的旧快捷键，随滚动式阅读已移除。
> `ArticlePage.vue` 中「b 键由 ArticleReader 处理并 emit('toggleNote')」是**历史残留注释**：`ArticleReader` 已无键盘逻辑、也无该 emit，**b 键当前无任何绑定**。

**笔记 / AI 面板内复用（无需切回正文即可开关）**：以下**控制类**快捷键由 `ArticlePage.onAnnotShortcut` 的**① 控制类前置段**统一处理，不参与侧栏 / 笔记选区让位，因此焦点落在右侧面板（`.side-panel`，即笔记或 AI 面板）内时同样生效：

| 快捷键 | 功能 | 处理位置 |
|--------|------|----------|
| T | 开关自动单词查询（自动查词） | `ArticlePage.onAnnotShortcut` ① 前置段 |
| Ctrl+Shift+Z | 开关手动查词卡片（默认开启；无视输入框，随时可调用） | `ArticlePage.onAnnotShortcut` ① 前置段 |
| Ctrl+R | 开关画布（再次按下即关闭并保存） | `ArticlePage.onAnnotShortcut` ① 前置段 |
| Space | 画布模式下循环切换画笔颜色（仅画笔 / 矩形激活时） | `ArticlePage.onAnnotShortcut` ① 前置段 |
| L | 切换 AI 助手面板 | `ArticlePage.onAnnotShortcut` ① 前置段 |
| r | 切换笔记面板（在笔记内按即收起自身） | `ArticlePage.onAnnotShortcut` ① 前置段 |
| i | 开关书签索引面板 | `ArticlePage.onAnnotShortcut` ① 前置段 |

> 历史实现曾由 `NotePanel._sideShortcutHandler` 经 `annotationBridge.shortcuts` 接管；因它与 `ArticlePage` 各自判断是否让位，
> 容易形成「两边都不管」的死角（表现为在笔记里选中英文后按 T / L / r / i 无反应），故已统一回单一 handler。

守卫：焦点在 `INPUT` / `TEXTAREA` 内时，单字母（T / L / r / i）与 `Ctrl+R`、`Space` 不触发（保护输入）；`Ctrl+Shift+Z` 按正文习惯无视输入框仍生效。笔记英文行内的 `e` / `w` 标注仍由 `NotePanel` 原有监听处理（见下），不受此表影响。

### 统一反馈层（消息提示 / 结果弹窗 / 确认框）

全站不再使用浏览器原生 `alert` / `confirm`。`src/utils/feedback.js` 基于已全局注册的 Element Plus 提供三类 API：

| API | 用途 | 实现 |
|-----|------|------|
| `notify*` | 短消息（success / error / warning / info），错误默认 6 秒、其余 3.2 秒 | `ElMessage`；PDF 导出的常驻进行中提示也复用同一外观 |
| `showResult` | 导出 / 导入完成的结构化结果：标题 + 副标题 + 统计卡片 + 跳过提示 | `ElMessageBox.alert`，`message` 传 VNode |
| `askConfirm` | 不可逆操作二次确认，Promise 化，取消 / 关闭一律返回 `false` | `ElMessageBox.confirm`；`danger: true` 时确认按钮为红色 |

`message` 全部用 `h()` 构造 VNode，不启用 `dangerouslyUseHTMLString`，避免文件名 / 后端错误消息里的 HTML 被解析。所有 `ElMessage` 统一从**页面左上角向右滑入**显示：通过 `src/main.js` 的 `ElConfigProvider` 设置 `message.placement = 'top-left'`，并在 `src/assets/base.css` 覆盖默认动画为 `translateX(-120%) → 0`（`is-center` / `is-right` 也兜底到左上角）。`base.css` 同时统一 `.el-message` 卡片外观与 `.fb-message-box` 弹窗的圆角 / 阴影 / 按钮配色。PDF 导出进行中状态用常驻（`duration: 0`）提示「正在导出 PDF…」，完成/失败后再关闭并更新结果消息。

---

## 收藏功能

- 文章卡片右上角 SVG 书签图标，点击切换收藏状态
- 后端 `favorites` 表，`article_id` 为主键且外键级联删除
- Pinia Store: `favoriteIds` (Set)、`loadFavorites()`、`isFavorited()`、`toggleFavorite()`
- 启动 `FileExplorer` 时自动调用 `store.loadFavorites()` 加载收藏数据
- API: `GET /api/favorites`（获取所有收藏 ID）、`POST /api/favorites/:articleId`（切换收藏）

---

## 右键菜单

两套菜单共用 `activeMenu`（`'card'` 文章卡 / `'context'` 文件夹区），任一打开即挤掉另一方。

**文章卡片**（`ArticleCard.vue`，`@contextmenu.prevent.stop` 阻止冒泡到下层菜单）：

| 菜单项 | 行为 |
|--------|------|
| ✏ 重命名 | 标题就地变 `<input>`；Enter 确认 / Esc 取消 / blur 确认 → `store.updateArticle(id, { title })` |
| 📁 移动到… | 二级面板：`← 返回` + 目标文件夹列表（排除 `root` 与当前文件夹，按名称排序）；无可移目标时提示「无可移动的目标文件夹」 |
| 🗑 删除 | 弹出**顶部通知条**（Teleport 到 body）：图标 + 「删除文章」标题 + 「确定删除《标题》？删除后可在回收站恢复。」+ 确认 / 取消 → `store.deleteArticle`；卡片化外观与统一反馈层一致 |

**文件夹 / 空白区**（`ContentArea` → `FileExplorer` → `ContextMenu.vue`）：

| 触发位置 | 菜单项 |
|---------|--------|
| 文件夹卡片 | 新建文件夹 / 重命名 / 删除（`root` 隐藏后两项）/ 导出文件夹… / 导出全部文件夹… / 导入文件夹… |
| 空白区 | 新建文件夹 / 新建外刊 / 导出全部文件夹… / 导入文件夹… |

删除文件夹与回收站「永久删除」均走 `src/utils/feedback.js` 的 `askConfirm` 统一确认弹窗（危险按钮为红色）：前者提示「其下所有子文件夹与文章将一并移入回收站」，后者提示「其下文章也将被永久删除，此操作不可恢复」。

---

## 右侧面板（AI / 笔记）

文章页工具栏右侧 `AI` / `笔记` 按钮，点击展开/收起悬浮面板并决定显示哪个内容，**互斥**切换。面板内**无标签栏**（与参考项目一致），切换完全由工具栏控制：

- **面板宽度**：46vw，固定在视口右侧（CSS 类名 `.side-panel`，`right: 0`）
- **面板内容**（由 `panelMode` 决定，默认 `'note'`）：
  - **AI**（`panelMode === 'link'`）：嵌入多个 AI 站点 iframe，站点定义见 `App.vue` 的 `SIDE_SITE_DEFS`

    | 站点 | URL | 可嵌入 |
    |------|-----|:------:|
    | 元宝 | `yuanbao.tencent.com/chat/naQivTmsDa` | ✅ |
    | 豆包 | `doubao.com/chat/` | ✅ |
    | 千问 | `qianwen.com/chat/` | ❌ 外部打开 |
    | DeepSeek | `chat.deepseek.com/` | ❌ 外部打开 |

    所有可嵌入站点的 iframe **常驻 DOM**，切换仅 `v-show` 显隐，不重建（避免重新登录）；站点切换用 Element Plus `el-button-group`，当前站点 `type=primary` 高亮；不可嵌入站点显示占位提示 + 「外部打开」按钮。当前站点记忆在 `localStorage.sidePanelState`
  - **笔记（默认）**（`panelMode === 'note'`，`NotePanel.vue`）：见下方「笔记面板」章节
- **面板样式**：圆角边框 `border-radius: 12px 0 0 12px`、`border: 1px solid #d4c5b0; border-right: none;`、iframe 底部圆角 `border-radius: 0 0 0 12px`
- **状态注入**：`App.vue` 通过 `provide()` 暴露给文章页：

  | key | 类型 | 说明 |
  |-----|------|------|
  | `showSidePanel` | `Ref<boolean>` | 面板是否展开 |
  | `panelMode` | `Ref<'link' \| 'note'>` | 面板显示 AI 还是笔记 |
  | `currentArticleId` | `ComputedRef<string>` | 当前文章 ID（取自路由参数） |
  | `noteSearchText` | `Ref<string>` | 正文选中的查找文本 |
  | `noteSearchNonce` | `Ref<number>` | 每次选中自增，保证同文本也能重新触发查找 |
  | `readerSearchText` | `Ref<string>` | 笔记中选中的查找文本（反向联动） |
  | `readerSearchNonce` | `Ref<number>` | 每次笔记选中自增，保证同文本也能重新触发正文高亮 |
  | `readerHit` | `reactive({ index })` | 正文反向高亮当前定位到的命中下标，由 `App` 共享给 `ArticleReader` / `NotePanel` |
  | `annotationBridge` | `Ref<Object>` | 文章页注册的批注能力桥，笔记英文行据此与正文互为镜像 |
  | `activeSearchMode` | `Ref<string>` | 仅记录最后一次联动方向；选区消失时 `App.clearActiveSearch()` **同时清除正文与笔记两侧高亮**并重置为空 |

- **页面收缩**：展开时阅读区自动缩小为 54vw（`.page-inner.shifted`）
- **过渡动画**：面板展开/收起 CSS Transition（`right 0.4s ease`）
- **默认状态**：进入文章页时面板默认展开且显示笔记（`showSidePanel` 默认 `true`，`panelMode` 默认 `'note'`），阅读区初始即为 54vw 收缩态
- **快捷键**：`L` 键开合（逻辑在 `ArticlePage` 中通过 inject 获取）
- **开关互斥逻辑**：`ArticlePage.togglePanel(mode)` — 已在该面板且展开则收起，否则切换模式并展开

---

## 笔记面板（NotePanel.vue）

独立笔记组件，常驻右侧面板（`panelMode === 'note'` 时显示），以 `articleId` 为粒度读写笔记。

**侧栏内快捷键**：控制类快捷键（T / Ctrl+Shift+Z / Ctrl+R / Space / L / r / i / Esc）统一由 `ArticlePage.onAnnotShortcut` 的**① 前置段**全局处理，焦点在笔记 / AI 面板（`.side-panel`）内时同样生效，输入框内不触发单字母；依赖正文选区的 E / W 让位给笔记英文行，由 `NotePanel._noteAnnotKeyHandler` 处理（面板内 Enter / Esc 亦由 `NotePanel` 自己接管）。完整映射见上方 [快捷键](#快捷键) 章节。

历史实现曾由 `NotePanel._sideShortcutHandler` 经 `annotationBridge.shortcuts` 接管，因与 `ArticlePage` 各自判断让位容易形成「两边都不管」的死角（在笔记里选中英文后按 T / L / r / i 无反应），现已统一回单一 handler。

> 笔记 / 重点走的是**独立接口**、且由 `NotePanel.vue` 直接 `fetch` 调用（不经 `src/api/index.js`）：
> `GET/PUT /api/articles/:id/notes`、`GET/PUT /api/articles/:id/marks`。

**英文行批注渲染（与正文互为镜像）**：`englishSegments()` 用批注文本在英文行中的命中区间做**边界点切分**，
每个片段携带**全部覆盖它的批注**（`anns`），从而实现高亮与下划线**在同一处叠加**：

- `class` = 全部覆盖批注的类型并集（可同时含 `highlight` + `underline`）；
- 背景色取覆盖批注中 `highlight` 自身的 `color`；
- 主批注按 `highlight(3) > underline(2)` 取，用于卡片交互（与正文 `pMap` 一致）。
- **片段 `key` 必须用「起点偏移」`seg.start`，不能用数组索引**：叠加 / 删除批注会改变片段划分，
  索引 key 会让 Vue 按位置复用旧节点，导致叠加样式不刷新（要刷新页面才显示）——与正文 `ArticleReader` 同一约定。
- **搜索高亮（正文选中 → 笔记高亮）复用同一套切分**：`englishSegments()` 先在整行用 `noteSearch` 算好搜索命中区间，再与批注边界合并统一切分，每个片段带 `match` 标志、`pieceHtml(seg)` 命中则包 `<mark class="note-hit">`。这样选中词即便**跨批注边界**也能被完整高亮（早期实现对各片段单独 `indexOf`，跨边界时整词匹配失败、漏高亮）。`highlight()` 仍用于中文行 / 词汇项（无批注切片，单元素匹配即可）。

**定位规则（叠加正确性的关键）：与正文一样用坐标，不用文本匹配**

正文 `ArticleReader` 直接用批注自带的段内偏移（精确坐标）；笔记侧若改用 `indexOf` 猜位置，
同一文本在句中出现多处时必然歧义 —— 这就是叠加错位与孪生错位的**根因**。故 `englishSegments()` 改为：

1. `lineAnchor(text)`：定位该英文行在正文中的落点（`findTextInParagraphs`，normKey 为等长替换，偏移可直接用）；
2. 批注 **投影**到本行：仅取同段落的批注，`start = max(0, a.startOffset − base)`、
   `end = min(行长度, a.endOffset − base)`，跨出行边界的部分被裁掉；
3. 再用投影后的区间做边界点切分（切分逻辑与正文完全相同）。

> 这样一来，包含 / 叠加 / 同一文本多处出现都无需任何启发式推断，天然正确。

**回退**：英文行在正文中定位不到（笔记自行改写、跨段、正文已改动）时，才退回文本匹配，
保证这种情况下镜像标注仍然显示（位置可能不精确）。

**缓存**：`lineAnchor` 用 `WeakMap`，以 `paragraphs` 数组**本身**为键 ——
正文不变时 computed 引用稳定即命中缓存（否则每行每次渲染都要扫一遍正文，卡片多时明显卡顿）；
正文一改 computed 重算、引用变化 → 缓存自动失效。桥因此额外暴露 `paragraphs`。

**标注侧也走正文坐标（与显示同源）**：在笔记英文行选中文字按 E/W 或右键标注时，
`selectionRangeInEnglishRow()` 把选区换算成**正文坐标**：
先 `lineAnchor(整行文本)` 拿到本行在正文中的落点，再取选区在行内的偏移（`Range` 量整行内容），
相加得 `paragraphIndex + startOffset + endOffset`，最后调桥 `annotateRange(pos, …)` → `annotateAt()`
**直接在正文里建批注**，全程无文本匹配。

- 笔记英文行只是正文的**镜像**：它自己不参与任何匹配 / 定位决策，标注执行一律落在正文；
  显示侧 `englishSegments()` 与标注侧 `selectionRangeInEnglishRow()` 共用同一套 `lineAnchor + 行内偏移`，
  所以「看到的位置」与「标注落到正文的位置」天然一致。

**笔记英文行的标注叠加限制已完全移除**：`NotePanel.doAnnotate` 原有「下划线禁止落在已有高亮区域上」检查（连同 `hasHighlightOverlap()` 与临时开关 `tempAllowAnnotOverlap`）已删除，选区与已有高亮重叠时可直接叠加下划线。笔记侧与正文侧规则一致：**不同类型自由叠加**，仅底层 `useAnnotations.createAnnotation` 保留「同种类型不可重叠」（`a.type === type` 时拒绝），避免重复批注数据。
- 换算失败（英文行在正文中定位不到：笔记自行改写 / 跨段 / 正文已改）时，才回退到 `annotateText()`
  做文本匹配（`outerId` 取选区所在 `.annotated` 覆盖批注中正文区间最长者，缩小范围），保证仍能标注。
- `annotateAt()` 抽出为笔记 / 正文标注的统一落点：夹到段落范围、校验区间有效、复用 `createAnnotation`。

**`data-annot-id` 必须写全**：片段的该属性写**所有覆盖批注的 id（空格分隔）**，
查询用属性选择器 `~=`（`[data-annot-id~="<id>"]`）。只写主批注 id 时，被压在下层的那条在 DOM 里没有落点，
新建标注后 `locateCard()` 找不到元素 → 卡片不弹出 / 落到兜底位置；正文「删高亮后自动弹剩余标注卡片」
（`useAnnotations.deleteAnnotation`）同样依赖它。`ArticleReader` 与 `NotePanel` 两处写法须保持一致。
另：`showAnnotCardForAnnotation()` 里匹配时要按**空格分隔取其中一个**（`split(/\s+/).includes(id)`），
不能用全等 —— 叠加处该属性是多值。

**新建标注后卡片要「锁定」**：一处叠了两种标注时主批注按 `highlight > underline` 取。
在**高亮区域标下划线**，新建的是下划线，但鼠标仍停在英文行上，
`onAnnotMouseEnter` 的 200ms 定时器会把卡片切回主批注（高亮）—— 表现为刚标注的下划线
看不到自己的注释框（反过来「在下划线中标高亮」不受影响，因为新建的正好是主批注）。
解决靠**两条**措施（缺一不可）：

1. **最近新建优先**（治本）：`useAnnotations` 维护 `recentAnnotId`（新建后 8s 内有效）。
   叠加处取「主批注」时，若覆盖批注中含它就直接取它 ——
   `buildParagraphSegments()`（正文）与 `NotePanel.annotPrimary()`（笔记）都遵循这条，
   于是悬停 / 点击拿到的就是刚建的那条，`onAnnotMouseEnter` 的
   `activeAnnotation === annotation` 短路生效，不会被抢。
2. **卡片锁**（治标）：`showAnnotCardForAnnotation()` 与笔记桥 `showCardAt()` 调 `lockCard()`（默认 1200ms），
   锁定期内 `onAnnotMouseEnter` 不切换、`isAnnotEditing` 时不抢。
   ⚠️ 锁定期内 `onAnnotMouseLeave` **不能只 `return`**：鼠标已移开就不会再有第二次 leave，
   卡片会永久停在屏幕上。必须等锁到期后**补判一次**（`closeCardIfIdle`）。

`onAnnotClick` 不受锁定影响，仍可立即切到点中的那条。

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
   │     历史字段：主列表与重点集中右侧边栏均已不展示，仅保留在内存笔记对象中，不入库
   │
   ├── 保存生文本 → PUT /api/articles/:id/notes { notes } → MySQL articles.notes（MEDIUMTEXT，原样存储）
   │     · 添加模式：新文本追加到已存文本之后（\n\n 分隔）
   │     · 修改模式：整体覆盖
   └── 读取 → GET /api/articles/:id/notes → parseRaw() 渲染卡片
```

**存储设计**：数据库只存**用户粘贴的生文本**（与参考项目一致），展示用的结构化数组不入库；解析逻辑集中在前端，后续调整解析规则无需迁移数据。

**体积限制与失败处理**（`NotePanel.saveNotes`）：`articles.notes` 为 `MEDIUMTEXT`（16 MB），实际先受 `express.json({ limit: '2mb' })` 约束；前端用 `TextEncoder` 按 UTF-8 字节计算「整篇生文本 / 实际 JSON 请求体」，输入区 `sizeHint` 实时显示已用与剩余容量，提交前预检超限则直接抛错不发请求。保存失败时 `onParseClick` 回滚 `parseAndRender()` 的即时预览、**保留 textarea 内容与错误提示**，并把后端返回的 `message` 拼进错误文案（不再只显示 `HTTP 500`）；单卡片重新录入同样沿用 `if (!ok) return` 保持编辑态。

**列自动补齐**：`db/language_learning.sql` 备份的 `articles` 建表已含 `notes`（`MEDIUMTEXT`）与 `deleted_at`；后端模块加载时的启动 IIFE（`server/index.js` 顶部）幂等补 `notes` / `marks` / `type` / `content` 四列，并通过 `information_schema.COLUMNS` 判断把旧库的 `notes` 从 `TEXT` 升级为 `MEDIUMTEXT`（仅类型不符时执行），`POST /api/init` 幂等补 `deleted_at`。⚠️ 表尚不存在时先启动后端无效（ALTER 失败会被静默忽略），新环境须先 `/api/init` 建表或导入 SQL 备份，再重启一次后端完成补列。

**顶部常驻操作栏**（`flex: 0 0 auto`，不随内容滚动）：`解析并渲染`（primary）/ `修改`（warning）/ `重点 N`（danger，`N` 为当前重点数量 `markedItems.length`，实时反映已标记词汇数；`:plain` 反映展开态）/ `关闭`

**输入区**：添加/修改笔记的输入框以**独立悬浮卡片**在面板顶部弹出（`position: fixed`，`right:16px; top:56px`，宽度 `calc(46vw - 32px)`），不随笔记列表滚动；textarea 内 Enter 触发解析保存、Shift+Enter 换行。

**交互**：

| 操作 | 说明 |
|------|------|
| 解析并渲染 | 顶部主按钮；输入区未开则打开（添加模式），已开则解析并保存 |
| 修改 | 载入数据库生文本，整体覆盖（输入区以顶部弹出卡片打开，宽度保持 `46vw` 右上贴边，弹出层用 `fixed` + `top:56px; bottom:16px; right:16px`（宽度保持 `calc(46vw - 32px)`）；`.raw-input-full` 用 `flex:1` 撑满卡片剩余高度，textarea 不可手动拉伸） |
| 关闭 | 收起输入区 |
| 保存后 | 以保存后的完整生文本重新 `parseRaw()` 渲染，保证展示与存储一致；修改模式保存后自动切回添加模式（输入区保持打开，方便继续追加）。**保存失败**则回滚预览、保留输入内容与错误提示 |
| 笔记卡片 | 主列表卡片仅渲染**英文 / 中文 / Vocabulary**（已移除顶部「编号徽章 + 副标题」头部，顶部导航栏 `#1 #2…` 亦已移除；`Vocabulary & Expressions` 标题也已移除，词汇列表直接跟在中文下方）；重点集中卡片右侧边栏同样已移除该头部，但词汇区仍保留 `.vocab-title`（`Vocabulary & Expressions`）标题 |
| 右键卡片（重新录入） | 在卡片空白处**右键单击**进入单卡片录入：编辑区自动回填该卡片原文（`serializeNote`，编号取 `index+1`）并聚焦；整块改完按 `Enter`（或点「保存」）即由 `parseRaw` 重新解析，`Shift+Enter` 换行。**操作条（保存 / 取消）仅在编辑态出现**，平时卡片无按钮。⚠️ 词汇项 `<li>` 的右键是**复制**（`@contextmenu.prevent.stop` 阻止冒泡），不会被卡片右键覆盖；卡片内**已选中文字**时右键交还浏览器（便于复制），不进入编辑 |
| 单击词汇项 | 标记/取消重点（红色加粗），键为 `noteIndex__词汇文本`，**持久化在数据库 `articles.marks`**（`GET/PUT /api/articles/:id/marks`） |
| 重点 | 顶部「重点」按钮，展开/收起**重点集中卡片**（`markedPanelVisible`）：弹出式只读卡片，汇总所有重点词汇，带笔记编号（纯数字）；单击左侧重点项在右侧边栏显示其所属笔记卡片 |
| 重点集中卡片 | 弹出层（`fixed` + `left/top: 0` + `transform: none`，**宽 `100vw`、高 `100vh` 顶满整个网页**），内部滚动，标题带「只读」标签；**只读**：不支持在此取消重点（重点增删仍在原卡片单击词汇），条目文本可选中复制；无重点时显示空提示。**左右平分宽度**：`.marked-body` 中左侧重点列表与右侧边栏各 `flex: 1 1 0` 均分。左侧列表为**中性灰色调（不使用红色）**，当前项 `.marked-item.is-active` 用蓝色（`#409eff`）高亮；右侧边栏笔记卡片内的重点项 `vocab-marked` 仍保留红色 |
| 重点卡片右侧边栏 | `.marked-body` 为左右布局：左侧重点列表（`flex: 1 1 0`）+ 右侧边栏（`.marked-sidebar`，`flex: 1 1 0` 与左侧平分宽，独立滚动）。边栏由 `activeNote`（当前 `activeNoteIndex` 对应笔记）直接渲染**原笔记卡片结构**（`note-card`：英文 + 中文 + Vocabulary 列表，同样无编号徽章 / 副标题头部，重点项红色加粗），只读；打开卡片时默认显示第一张含重点的笔记，单击左侧重点项经 `selectNote` 切换并高亮（`marked-item.is-active` 蓝）；无重点时不渲染 |
| 正文选中联动 | 笔记面板打开时，在正文选中/双击文本 → 自动在英文/中文/词汇中查找包含项，精确高亮匹配文字段（`<mark class="note-hit">` 半透明蓝底 `rgba(64,158,255,0.4)`、`color: inherit`，不描边不圆角；当前命中为 `rgba(13,71,161,0.55)`）、滚动到第一个匹配卡片至区域中央；回车滚动到下一个匹配卡片。查找关键词为**单词边界自动扩展后的完整文本**（见下方「选中补全逻辑」） |
| 笔记选中联动（反向） | 在笔记的英文/中文区域用鼠标选中文字 → 复用「选中补全逻辑」得到完整词 → `emit('reverse-select')` → `App.onReverseSelect` 更新 `readerSearchText` / 递增 `readerSearchNonce` 并把 `readerHit.index` 置 0 → `ArticleReader` 的 `displayParagraphs` computed 用 `buildDisplayParagraphs(paragraphSegments, readerSearchText)` 把每个段落片段按命中切成 `parts`（命中 part 带全局 `hitIdx`），由 **Vue 模板渲染** `<mark class="reader-hit">`（半透明蓝底、不描边；命中期间临时隐藏批注视觉，见「匹配视觉层级」）；watch `readerSearchNonce` 只在渲染完成后调 `scrollToReaderHit` 滚到当前命中（`.reader-content` 居中）；**回车在正文命中间循环向后跳转**（`NotePanel.nextReaderHit` 写入共享的 `readerHit.index`，Vue 据此渲染 `.reader-hit-current`，`scrollToReaderHit` 只滚动）。⚠️ **正文高亮完全数据驱动、零 DOM 改写**：旧方案 `highlightMatchesInReader` 用 `splitText` / `replaceChild` / `extractContents` 改写 Vue 托管的 `.annotated` 结构，会把批注文本搬离 span 并造成 vnode 与真实 DOM 失配，表现为「匹配结束后黄色高亮/下划线渲染丢失、刷新页面才恢复」，现已整套移除。⚠️ 反向通道仍用 **emit 上报而非 NotePanel 直接 inject 写入** `readerSearchText`（Options API 的 inject 会自动解包 ref，直接 `.value` 赋值无效）；`readerHit` 则用 **reactive 对象** provide，供 Options API 的 NotePanel 与 Composition API 的 ArticleReader 共享同一份状态，避免解包歧义。回车处理统一在 `NotePanel.bindEnterNav`：**优先反向**（正文存在 `reader-hit` 则滚正文命中），否则正向（滚笔记匹配卡片），避免双监听冲突 |

**单卡片重新录入（右键进入）**：

```
卡片内右键 → startEdit(i)：回填该卡片原文（编号. 英文 / 中文 /（词汇1\词汇2…））
   │
   ├── validateCardInput()：录入格式自检（不通过则提示并撤销，绝不落库）
   │     · 只允许 1 个编号块（出现多个 = 英文中误含「数字. 」等，拒绝）
   │     · 第 1 行英文非空、第 2 行中文非空（中文缺失会让词汇行被当成中文）
   │     · 词汇行必须以（开头、以）结尾（否则被静默丢弃或错位）
   │
   ├── 回环检测（关键）：替换后 serializeNotes() → parseRaw() 再解析一遍
   │     · 整篇解析出的卡片数须与编辑前一致（用编辑前后各自回环数对比，
   │       避免历史数据本身不自洽造成误判）
   │     · 本卡片重新解析后的英文 / 中文 / 词汇须与录入解析结果一致
   │     → 任一不一致即判定会污染后续卡片，撤销且不写入数据库
   │
   ├── 重点标记处理：本卡片原有 marks 全部清空；其余卡片标记保留，
   │     并按卡片增减数（parsed.length - 1）整体位移索引
   │
   └── saveNotes() 成功后 → saveMarked(marks) 落库 → parseRaw(savedRaw) 重渲染
```

> **为何需要回环检测**：笔记是**整篇序列化**存储（`articles.notes`），单卡片的格式错误会被固化进生文本，
> 下次加载全篇 `parseRaw` 时会连带后续所有卡片错位（典型：录入内容误含「数字. 」开头的行会被切成新块、
> 中文缺失会让词汇行抢占中文位）。故保存前必须确认整篇结构未被本次录入带偏。

**选中补全逻辑**（`src/utils/selectionText.js` 的 `getExpandedSelectionText`，ArticleReader 与 NotePanel 共用）：仅当选区边界位于单词内部才按空白补全到词首/词尾，双击选中完整单词不会误扩展，避免把后一个词带入；边界判定字符集为「空白 或 连字符/破折号 `- – —`」，故 `power-hungry`、`him—and`、`beings—powerless` 不会被误判为一个单词。**选区仅含空白时直接返回空**（`range.toString().trim()` 为空即返回 `''`）：双击文本末尾空白处时浏览器只选中空白字符，若继续补全，起点会因左侧是非空白而向前补到词首，把最后一个单词整个带进来（表现为"双击没选中内容，正文却匹配了最后一个单词"），故在补全前先拦截。

**真实选区同步扩展**（`applyExpandedSelection`）：`getExpandedSelectionText` 只扩展"返回的文本"，浏览器蓝色选区仍是用户划的半个词。两处消费方在读选区前先调 `applyExpandedSelection()` 把真实选区补全到单词边界（`sel.removeAllRanges() + addRange(扩展Range)`），视觉选区与取词一致：① `NotePanel` 英文行**左键松手（`onEnglishMouseUp`）与右键（`onEnglishContextMenu`）**；② 正文侧 `useAnnotations.onMouseUp`（目标是 `.side-panel` / `.note-root` 时跳过，避免笔记选中被扩展）。正文批注基于精确坐标偏移 `(paragraphIndex, startOffset, endOffset)`，偏移在扩展后的选区上量取，故批注落点自然覆盖完整单词（原 `expandRangeToWords` 只扩展多词短语、单词划半截不补全，已删除并统一到共享实现）。

**跨行命中拆分**（`buildDisplayParagraphs`）：跨行选中的短语作为关键词时自带 `\n`（正文 `white-space: pre-wrap`），若 `<mark>` 包住换行/行尾空格，命中底色会跨行黏连、在行边界留下游离色块。故命中区间按 `\n` 拆成多段并裁掉每段首尾空白后再生成命中 part（换行与空白留在 mark 外作普通文本）。`App.clearActiveSearch` 为**两侧都清**（原先只清"最后激活的一侧"，另一侧可能残留无对应的旧命中标记）。

**选区消失自动清除高亮**：App.vue 监听 `document.selectionchange`，当选区变为空（点击空白/按 Esc 等清空选区）时调用 `clearActiveSearch()`，**两侧高亮都清**（不再只看 `activeSearchMode`）：
- 清空 `readerSearchText` + 递增 `readerSearchNonce` → `displayParagraphs` 重算为无命中 parts → 正文 `reader-hit` 随 Vue 渲染自然消失，`.annotated` 批注始终完好（不再需要 JS 还原 mark）
- 清空 `noteSearchText` + 递增 `noteSearchNonce` → `NotePanel.findMatches` 清空 `matchIndices`，笔记卡片高亮消失
- 复位 `readerHit.index = -1` 与 `activeSearchMode=''`，避免选区再次为空时重复触发

**跨片段短语匹配（纯函数）**（`buildDisplayParagraphs`）：正文段落可能因批注/单词级 span 被拆成多个 seg。匹配时先把该段所有 seg 的 `text` 拼成段落逻辑全文，用 `indexOf` 找所有不重叠命中，再投影回各 seg 切成 `parts`；同一次命中跨 seg 的多个 part 共享全局递增的 `hitIdx`，`scrollToReaderHit` 与 `.reader-hit-current` 都按它定位"完整命中"。纯函数不碰 DOM、不改 seg 原始字段，批注元数据原样保留，故不存在"标注被吸进 mark / 搬离父节点"的问题。

**匹配视觉层级**：命中卡片描边蓝色 `#409eff`（`note-card.note-match`），当前定位的那一张描边加深为 `#1f6ea8`（`note-current`）；命中文字段 `.note-hit` 为半透明蓝底 `rgba(64,158,255,0.4)`、文字颜色继承（`color: inherit`），与卡片描边同色系。正文 `<mark class="reader-hit">` 与笔记侧 `.note-hit` 均只保留**半透明蓝底**（`rgba(64,158,255,0.4)`、`color: inherit`），**不描边、不圆角**：命中短语常被 seg / 批注边界拆成多个相邻 `<mark>`，四周 `box-shadow` 与 `border-radius` 会在接缝处画竖线、把连续命中切成数块；去掉后相邻 mark 融成一整条，且不会撑宽内联盒导致重排。**回车定位到的当前命中**由 Vue 依据 `part.hitIdx === readerHit.index`（正文）/ `seg.current`（笔记）加 `.reader-hit-current` / `.note-hit-current`，仅换成**更深蓝 `#0d47a1`** 底色，同样不描边。`scrollToReaderHit` 只按 `data-hit-index` 找锚点滚动、**不再增删 class**（避免与 Vue 托管的 DOM 冲突）；跨 seg 同一次命中的多个 `<mark>` 共享 `data-hit-index`，一起作为滚动锚点。

**命中期临时隐藏批注视觉**：匹配高亮覆盖到批注时，黄底与半透明蓝叠加成绿块、红色下划线横穿命中区，造成割裂。故两侧在命中期只隐藏**视觉样式**，批注数据与交互全部保留：
- 正文侧：`buildDisplayParagraphs` 给每个 seg 加 `hasHit`（含命中 part）；`ArticleReader.annotSegClass/annotSegStyle` 在 `hasHit` 时返回空类 / 空样式，`.annotated` 不再带 `highlight`/`underline` 类与 inline `backgroundColor`；`data-annot-id`、悬停与点击卡片照常。
- 笔记侧：`englishSegments` 已把批注边界与命中边界合并切分，每段带 `seg.match`；模板按 `seg.match ? [] : annotClasses(seg.anns)` / `seg.match ? {} : annotStyle(seg.anns)` 决定批注样式，`pieceHtml` 照常输出 `<mark class="note-hit">`。片段 `key` 带 `_m` 命中标记，状态变化会强制重渲染。
- 恢复：`clearActiveSearch()` 清空 `readerSearchText` / `noteSearchText` → `hasHit=false`、`seg.match=false` → 批注样式随 Vue 渲染自动回来，无需额外逻辑。批注数据、坐标与 PDF 导出均不受影响（导出读数据库）。

> ⚠️ `.note-hit` 必须写成 `:deep(.note-hit)`：该 `<mark>` 由 `highlight()` 经 `v-html`
> 动态插入，编译期拿不到 `scoped` 的 `data-v-xxx` 属性，直接写 `.note-hit` 会匹配不到，
> 从而露出浏览器给 `<mark>` 的 UA 默认黄色（表现为"改了样式却不生效"）。
> 正文命中的 `<mark class="reader-hit">` 现由 `ArticleReader.vue` 模板（Vue）渲染，
> 保留 `:deep(.reader-hit)` 写法即可命中；不再由 JS 动态插入。

**防 Ctrl+F 干扰**：此前导航项与卡片副标题用 `::before` + `attr(data-text)` 伪元素渲染（DOM 无文本节点，浏览器查找不命中）；随顶部导航栏与卡片头部一并移除，该技巧现已不再使用。

---

## Pinia Store（fileExplorer）

**核心状态**：
- `folders` — `{ id → folder }` 映射，含虚拟 `root` 根节点
- `articles` — `{ articleId → article }` 映射
- `currentFolderId` — 当前浏览的文件夹 ID
- `loading` / `loadingArticles` / `initialized` — 加载状态
- `showTrash` / `trashedFolders` / `trashedArticles` — 回收站的显示开关与内容
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
- `loadTrash()` / `restoreFromTrash(id)` / `permanentDelete(id)` — 回收站
- `loadFavorites()` / `isFavorited(id)` / `toggleFavorite(id)`

---

## 单词查询完整流程

```
用户选中英文文本（mouseup 事件）
    │
    ▼
useWordLookup.onTextSelection(mouseX, mouseY)（由 ArticlePage 的 mouseup 处理传入 e.clientX/e.clientY）
    ├── 获取选中文本 → 清洗（去标点、过滤无效内容）
    ├── 以 mouseup 坐标作为卡片初始位置（卡片显示后再由 WordCard.adjustPosition() 用 getBoundingClientRect 校正）
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
    ├── 并行 warmupTts(word) 预热英/美发音到 ttsCache（不等待查词成功）
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

查询开关：T 键（全局），关闭时隐藏卡片且不触发查询。关闭后按 E/W 创建批注时，会按选区词**单独发起一次** `lookupWord()`（开关状态不变），结果经 `buildNoteFromLookup()` / `pendingNoteFill` 回填批注注释。另有 `GET /api/suggest` 供手动查词卡片联想词。
```

---

## 批注功能完整流程

### 创建批注

```
用户在正文选中文本（可跨 span 边界）后**右键单击** → 浮动工具栏出现 [🖍高亮] [U̲下划线]
    │     （左键选中只记录 pendingSelection、并收起已开的工具栏；也可用 E/W 或顶栏内嵌按钮标注）
    ├── 点击高亮 / 按 E → createAnnotation('highlight', '#FFEB3B')
    └── 点击下划线 / 按 W → createAnnotation('underline', '#e74c3c')
         │
         ├── 快捷键自动填入查词结果（短词：词本身 + 音标 + 释义；长句省略首行词但仍带音标与释义，仅无释义时才填整段翻译）
         ├── 查词未完成时先创建批注，结果返回后补填注释（pendingNoteFill）
         ├── 用 Range 量出「段落开头 → 选区起点」的文本长度得到偏移（异常时 TreeWalker 兜底），段内再用 indexOf(text, absoluteStart) 校正
         ├── 若本次取偏移失败但仍有活动选区，回退到最后一次有效选区（lastSelection）；选区已清空则直接返回
         ├── 不同类型可自由叠加；同种类型重叠时跳过创建（不取消已有标记）
         └── 存入 annotations[] + POST /api/annotations → MySQL
              │
              └── paragraphSegments（ref）经 deep watch 调用 buildParagraphSegments() 重新切分
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
    │     ├── 失去焦点 / Enter（Shift+Enter 换行）→ 自动保存
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
- 段落偏移量用 `Range` 量取（异常时 `TreeWalker` 兜底），并在段内用 `indexOf(text, absoluteStart)` 校正，避免重复文本误匹配
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
> 该脚本**不启动** PDF 导出服务（5057）；要启用 PDF 导出请用下面的 `start-all.py`
> （Windows 下双击 `scripts\bat\start-all.bat` 可静默拉起全套服务，含 5057、全程无黑窗；停止用 `scripts\bat\stop-all.bat`）。

### 完整启动（含 MySQL 检查）

```bash
python scripts/start-all.py   # 自动检查/拉起 MySQL80（优先 net start，非管理员回退直接启动 mysqld），再启动后端 / 前端 / PDF 服务
```

### 一键启停脚本（Python）

```bash
python scripts/start-all.py   # MySQL(3306) → 后端(3000) → 前端(5173) → PDF 导出(5057) → 自动打开浏览器
python scripts/stop-all.py    # 前端(5173) → 后端(3000) → PDF 导出(5057) → MySQL
python scripts/restart-backend.py  # 只重启后端(3000)，改完 server/index.js 后用
python scripts/restart-pdf.py      # 只重启 PDF 服务(5057)，改完 server/*.py 后用
```

行为要点：
- 项目根由脚本自身位置推导（`scripts/` 的上级），node / python / MySQL 服务名自动探测，但仍有兜底硬编码路径；双击入口 `scripts/bat/start-all.bat` / `stop-all.bat` 把 `PROJECT_DIR` 与 `VENV_PY` 写死，换机需改这两行
- 端口已在监听的服务直接跳过，不会重复拉起 —— 所以改了代码后跑 `start-all.py` **不会**加载
  新模块（Python 服务启动时一次性导入），需先 `stop-all.py` 停干净，或用对应的 `restart-*.py`
- **带延时的循环就绪检测**（避免"拉起过快"误判）：每拉起一个服务后调用 `wait_for_port(port, timeout, interval)` 轮询 `netstat` 直到 LISTENING（MySQL / 后端 / 前端 / PDF 均最多等待 **10s**，间隔 1s），而非 `sleep(3)` 后一次性判定
- **后端健康检查循环重试**：`wait_for_http_ok('/api/health', timeout=10, interval=1)`，端口就绪 ≠ 应用就绪（后端还需连接 MySQL、幂等建表，期间可能返回 500 或连接被拒），只有拿到 200 才算就绪；HTTPError/URLError 均视为未就绪继续重试，最长 10s
- **就绪后才打开浏览器**：浏览器在端口与健康检查全部轮询结束后才打开；后端未健康时仅告警仍打开前端
- 前端固定 `node node_modules/vite/bin/vite.js`（不经 `npm run dev`）
- PDF 服务用 **`python.exe` + `CREATE_NO_WINDOW`**，不用 `pythonw.exe`：
  `pythonw` 下 `sys.stdout`/`sys.stderr` 为 `None`，uvicorn 配置 logging 时会崩溃且异常无处输出，
  表现为进程静默退出、端口不通（`pdf_service.py` 内亦有兜底）
- MySQL 先用 `net start`；非管理员失败时回退为直接以当前用户启动 `mysqld`（`CREATE_NO_WINDOW` 抑制黑框）
- 后端 / 前端用 `DETACHED_PROCESS`；PDF 服务与直接拉起的 `mysqld` 用 `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP`（非 `DETACHED_PROCESS`）。均脱离进程组，脚本退出后服务继续存活

> ⚠️ `stop-all.py` 会停止 MySQL（管理员走 `net stop`，否则强杀 3306 上的 `mysqld`）。若该实例还服务其他项目，请只手动关闭前后端。

### 局域网访问

启动后终端显示 `Network: http://192.168.x.x:5173`，同一局域网其他设备直接输入该地址即可访问，无需验证码。

> 首次使用需要添加 Windows 防火墙规则放行端口 5173：
> ```cmd
> netsh advfirewall firewall add rule name="Vite5173" dir=in action=allow protocol=TCP localport=5173
> ```

---

## 换电脑后恢复数据

项目根目录的 `db/language_learning.sql` 是数据库数据备份（通过 Git 同步；不含 `CREATE DATABASE` / `USE`，且 `type` / `marks` 等运行期补列需在启动后端后生成），在新电脑上按以下步骤恢复：

```bash
# 1. 克隆代码（或 git pull 拉取最新）
git clone git@github.com:lsp-hubb/language-learning.git
cd language-learning && npm install

# 2. 配置 .env（修改 DB_PASSWORD 为你的 MySQL 密码）

# 3. 创建数据库并导入备份数据
mysql -u root -e "CREATE DATABASE IF NOT EXISTS language_learning DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root language_learning < db/language_learning.sql

# 4. 启动应用（MySQL 由脚本自动检查/拉起；或先手动 net start MySQL80）
python scripts/start-all.py
#   也可用项目根目录的 start.bat 启动前/后端
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
| MySQL | 文件夹、文章（含 `notes` 笔记、`marks` 重点标记）、批注、收藏、画布笔迹数据 |
| `localStorage.lastPage` | 最后浏览的页面（`article:<id>` / `folder:<id>`），重启后自动恢复 |
| `localStorage.lastFolderId` | 最后浏览的文件夹 ID |
| `localStorage.fontSize` | 阅读字号（12–32，默认 16） |
| `localStorage.sidePanelState` | 右侧面板当前 AI 站点（`{ site }`） |
| `localStorage.readerScroll:<articleId>` | 正文阅读滚动位置（200ms 防抖写入，刷新/重进恢复） |
| `localStorage.noteScroll:<articleId>` | 笔记面板滚动位置（刷新/重进恢复） |
| ~~`localStorage.note_marks_<articleId>`~~ | **已废弃**：重点标记已改为入库 `articles.marks`（经 `GET/PUT /api/articles/:id/marks`） |
| `localStorage._manual_word_card_pos` | 手动查词卡片位置（`{ x, y }`） |
| ~~`localStorage._canvas_strokes_<articleId>`~~ | **历史遗留键**：代码中只剩 `getItem` 兜底回退，**已无任何 `setItem` 写入方**，等价于只读残留 |

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

# 后端拉起 Python 脚本用（可选，均有默认值）
PYTHON_HOME=D:\PythonFiles\.venv            # 默认 D:\PythonFiles\.venv
PYTHON_SCRIPT_DIR=D:\PythonFiles\Python     # 默认 D:\PythonFiles\Python
```

**默认值**（`server/db.js` / `server/index.js`）：`DB_HOST=localhost`、`DB_PORT=3306`（无效值回退）、
`DB_USER=root`、`DB_PASSWORD=''`、`DB_NAME=language_learning`、`SERVER_PORT=3000`。

> 另有 `VITE_FOCUS_EDITOR=1` 可**开启**「组件检查器跳转后自动置前编辑器窗口」——该行为**默认关闭**（见下节）。

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
| 窗口置前 | 打开文件后用 `pythonw scripts/focus_editor.py --process <exe名> --file <路径> --root <项目根>` 把编辑器提到最前；**默认关闭**，需 `VITE_FOCUS_EDITOR=1` 才启用 |
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

> Python 虚拟环境配置与后端调用说明见 [docs/python-env.md](../docs/python-env.md)。

---

## 当前数据概览

> 以下数据基于当前运行中的数据库（`language_learning`），实际数据随使用变化。数据备份见 `db/language_learning.sql`。

| 表 | 数量 | 说明 |
|----|------|------|
| folders | - | 经济学人日刊各月目录 + 其他空文件夹（数量随使用变化） |
| articles | - | 文章（数量随使用变化） |
| annotations | - | 高亮、下划线两种批注（数量随使用变化。注：`sentence` 类型已从前端移除，但数据库仍兼容） |
| favorites | - | 收藏的文章 ID |
| canvas_strokes | - | 每篇文章一条笔迹 JSON |

> `paragraph_notes` 等旧列已从当前 SQL 备份与代码中移除；`sentence` 仅为 `annotations.type` 的历史取值。

---

## Git 版本管理

项目已初始化 Git 仓库，当前分支 `main` 跟踪 `origin/main`；截至 2026-11-06 已推送至 `37064e9`，本地与远端同步。远端 `origin` 为 SSH 地址 `git@github.com:lsp-hubb/language-learning.git`（本机 HTTPS/443 被阻断，推送必须走 SSH）。`node_modules`、`.env`、`mysql-data/`、`migrate-mysql.ps1` 已排除；临时测试日志 `.vitest-out.txt` 未忽略，`git add .` 前需排除。

```bash
git status -sb                 # 查看改动与 ahead/behind
git add .                      # 暂存所有改动（先排除临时文件）
git commit -m "feat: 描述"     # 提交
git push                       # 推送到 origin/main（SSH）
```

详细使用方法见 [GIT_GUIDE.md](./GIT_GUIDE.md)。

### 近期提交

> 曾于 2026-09-24 起暂停版本管理，2026-11-06 已把重建后积压的本地提交一次性推送至远端（下表首 5 条均已推送）；
> `0373a11` 之前的 `5b5ffb4` … `e5645bf` 为重建前保留的历史说明记录。
> 完整历史提交表见 [GIT_GUIDE.md](./GIT_GUIDE.md)，本表为摘要；后续提交以 `git log` 为准。

| 提交 | 说明 |
|------|------|
| `37064e9` | refactor: 精简试题相关代码与旧脚本，同步功能修复并全量更新 Markdown 文档 |
| `c2b7298` | chore: 空变更提交 |
| `626ed23` | feat: 考研英语完形模块 + 答题判分 + 批注/画布/PDF导出优化 + 启动脚本整理 |
| `d7e199b` | chore: 恢复业务文件 Git 跟踪（node_modules_broken 保持忽略） |
| `ea34399` | chore: 取消误跟踪文件版本控制（node_modules_broken 等），保留磁盘文件 |
| `0373a11` | chore: 初始化提交 |
| `5b5ffb4` | feat: 笔记面板精简(去导航条/卡片头) + 允许不同类型批注重叠 + 命中描边修复 + 启动脚本浏览器后置 + 换机迁移文档 |
| `b63136c` | feat: 重点集中卡片 + 批注栏右键弹出 + 高亮排版修复 |
| `33b1980` | feat: PDF下划线BBox==Rect修复(粗细一致) + 笔记选中反向联动正文高亮跳转 + 启动脚本无黑框 + 文档同步 |
| `ea18cc9` | docs: 同步 GIT_GUIDE 提交记录表(a9716e0) |
| `a9716e0` | feat: PDF导出/笔记交互优化 + 单词边界破折号支持 + 快捷键 r/l + 消息提示左上角 |
| `e5645bf` | docs: 提交记录表补充 6fb97ee 与 1dd3dfe |
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
