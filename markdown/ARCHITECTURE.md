# Language Learning — 项目架构文档

## 项目概述

**Language Learning** 是一个外语阅读辅助工具，帮助用户阅读英文文章并实时查词、添加批注、手绘标记。基于 **Vue 3 + Vite + Pinia** 前端和 **Express + MySQL** 后端构建。

### 核心功能

1. **文件夹管理** — 支持无限层级嵌套的文件夹，CRUD 操作，右键菜单，面包屑导航
2. **外刊文章管理** — 在文件夹中创建、编辑、查看英文文章（文章卡片显示首行预览）；文章卡片**右键菜单**提供「✏ 重命名」（就地编辑标题）／「📁 移动到…」（二级列表选目标，考研/普通目录隔离，绝不串目录）／「🗑 删除」（须在**顶部通知条**上二次确认才真正删除，防误删）
3. **单页阅读视图** — 滚动阅读，两端对齐排版，滚动条在容器右侧；工具栏 A−/A+ 调字号（12–32px）
4. **智能单词查询** — 选中英文单词后，自动查询有道词典，弹出浮动词卡展示音标、释义；音标区鼠标悬停自动播放英式/美式发音；支持 T 键全局开关（默认关闭）
5. **PDF 风格批注** — 黄色高亮(E键, `#FFEB3B`) + 红色下划线(W键, `#e74c3c`)，悬停 200ms 查看注释并自动播发音，点击编辑/自动填入查词结果，同类型不可重叠，按 Delete 键删除，数据保存在 MySQL。**考研试题页**同样支持 E/W，但只做标记（`note` 为空、不弹注释卡片），再按一次即取消
6. **手绘画布** — Ctrl+R 开启/关闭画布，支持画笔（Q 切换水平直线/波浪线）/矩形/矩形擦除/6 色切换，笔迹按文章 ID 存储在 MySQL，500ms 防抖写入
7. **段落编号提示** — 鼠标悬停段落时左侧浮出「第 N 段」（CSS `counter` + `::before`）
8. **收藏文章** — 文章卡片右上角 SVG 书签图标，切换收藏状态，数据持久化
9. **右侧面板（AI / 笔记）** — 右侧悬浮面板（46vw），通过工具栏开关互斥切换显示内容（面板内无标签栏）：
   - **AI**（`panelMode === 'link'`）：嵌入多个 AI 站点 iframe（元宝 / 豆包 / 千问 / DeepSeek），可嵌入站点切换只显隐不重建；不支持嵌入的站点显示占位提示 +「外部打开」按钮。当前站点记忆在 `localStorage.sidePanelState`
   - **笔记**（`panelMode === 'note'`，`NotePanel.vue`）：粘贴结构化笔记，自动解析为「英文 / 中文 / 词汇」卡片；支持追加 / 修改全文、导航栏快速跳转、**双击标记重点**（变艳红 `#ff1f1f` + 加粗，标记态不可选中避免误选文本）、**右键单击复制词汇内容**、**双击标记的重点持久化在数据库 `articles.marks`**（TEXT/JSON，键 `noteIndex__词汇`；经 `GET /api/articles/:id/marks` 读取、`PUT /api/articles/:id/marks` 覆盖写入）、**重点集中卡片** — 顶部「重点」按钮（`toggleMarkedPanel`，按钮 `:plain` 反映展开态）以**弹出式只读卡片**呈现（`.marked-panel`：`position: fixed; left/top: 0`、宽 `100vw`、高 `100vh` 顶满整个网页，内部滚动）。内容由计算属性 `markedItems` 按笔记顺序汇总 `marked` 中为 true 的项，每项带所属笔记编号（灰色徽章，纯数字）；**只读**：不能在此取消重点（重点的增删仍在原笔记卡片中双击词汇进行）；条目允许选中复制文本；无重点时显示空提示。**右侧边栏**（`.marked-sidebar`，与左侧列表各 `flex: 1 1 0` 平分宽度、独立滚动）直接渲染 `activeNote` 对应的**原笔记卡片**（与笔记列表同结构 `.note-card`：编号徽章 + 副标题 + 英文 + 中文 + Vocabulary 列表，重点项 `vocab-marked` 红色加粗），只读；`toggleMarkedPanel` 打开时若未选笔记默认显示第一张含重点的卡片，单击左侧重点项经 `selectNote` 在右侧边栏显示其所属笔记卡片并高亮该项（`is-active`）；无重点时不渲染
   - L 键切换 AI 助手面板、r 键切换笔记面板，工具栏「AI」「笔记」按钮等价切换，默认关闭
10. **局域网共享** — 同一网络下多设备可同时访问，共享文章和批注数据（无验证码）
11. **阅读计时器** — 工具栏显示，点击循环切换开始 → 暂停 → 归零
12. **英文单词数统计** — 工具栏实时显示文章单词数（按空白切分）
13. **手动查词卡片** — Ctrl+Shift+Z **或工具栏「查词」按钮**开关（按钮 `primary` 高亮反映卡片开合，与 `showManualCard` 双向一致），支持输入查词、一键复制、**清空**（清空输入内容与查询结果，并中断进行中的请求、清联想词与复制态）、联想词下拉（超出最大高度可滚动；**默认不高亮**，高亮由鼠标悬停或 ↑/↓ 产生且唯一，鼠标移出浮层即熄灭，高亮项自动滚入可视区）、任意拖动、位置记忆（`localStorage._manual_word_card_pos`）；查词结果自动播放英式发音，音标区可悬停切换英式/美式发音；卡片打开时正文选中文本自动填入查询；**Esc 只关闭联想层**，关闭整张卡片须用 Ctrl+Shift+Z 或工具栏「查词」按钮
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
├── .env                                # 环境变量（数据库配置）
├── .gitignore
├── start.bat                           # Windows 一键启动脚本 (前后端)
├── start-mysql.bat                     # MySQL 单独启动脚本
├── scripts/
│   ├── start-all.py                    # 一键启动：MySQL → 后端 → 前端 → PDF(5057) + 打开浏览器
│   ├── stop-all.py                     # 一键停止：前端 → 后端 → PDF(5057) → MySQL
│   ├── start-all.bat                   # 双击入口：静默启动（无 cmd 黑窗），日志 logs\start-all.log
│   ├── stop-all.bat                    # 双击入口：静默停止（无 cmd 黑窗；停 MySQL 需管理员）
│   ├── restart-backend.py              # 仅重启后端（3000），改完 server/index.js 用
│   ├── restart-pdf.py                  # 仅重启 PDF 服务（5057），改完 server/*.py 用
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
│   ├── utils/
│   │   └── selectionText.js            # 选中文本补全 + 正文/笔记匹配高亮公共工具
│   ├── kaoyan/                         # 考研英语试题页（独立模块，不改 src/components）
│   │   ├── KaoyanArticlePage.vue       # 试题页主体（正文空格 + 题目浮动栏 + 录入 + 判分）
│   │   ├── KaoyanImportDialog.vue      # 考研专用新建窗（只填年份标题）
│   │   ├── parseCloze.js               # 题型表 EXAM_TYPES + 原文/题目/答案解析
│   │   ├── useKaoyanAnnotations.js     # 正文标记（E/W，只做标记不写注释）
│   │   └── isKaoyanFolder.js           # 「考研英语」目录归属判定（与后端同规则）
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
│       ├── ArticleCard.vue             # 文章卡片（收藏 SVG 书签图标 + 复习 📜 按钮，新标签打开）+ 右键重命名/移动到文件夹
│       ├── ArticleToolbar.vue          # 顶部工具栏（返回/编辑/计时器/链接）
│       ├── ArticleReader.vue           # 文章阅读区（段落/批注标记/画布/左侧工具侧边栏/选择题面板挂载点）
│       ├── QuizPanel.vue               # 选择题面板（普通文章，K 键开关，贴右侧；复用 @/kaoyan/parseCloze 解析与判分）
│       ├── ArticleEditor.vue           # 文章编辑器（标题+正文输入框）
│       ├── AnnotToolbar.vue            # 浮动批注工具栏（高亮/下划线）
│       ├── ArticleDialog.vue           # 新建文章对话框
│       ├── FolderDialog.vue            # 文件夹创建/重命名对话框
│       ├── ContextMenu.vue             # 右键菜单
│       ├── WordCard.vue                # 浮动单词查询卡片（选中查词）
│       ├── ManualWordCard.vue          # 手动查词卡片（Ctrl+Shift+Z，含联想词）
│       ├── AnnotationCard.vue          # 浮动批注卡片
│       ├── NotePanel.vue               # 结构化笔记面板（解析生文本 → 英文/中文/词汇卡片）
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
| 3306 | MySQL80 | 数据库（`datadir` 指向项目内 `mysql-data/`，随项目目录迁移） |
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

## 引号归一化（弯引号 → 直引号）

从 Word / PDF / 网页复制来的英文常带弯引号（`‘ ’ “ ”`）及对应 HTML 实体，与库里已有的直角引号混用会导致搜索、匹配、批注偏移等一系列问题，故统一归一为直角引号。

统一实现：`src/utils/normalizeQuotes.js`

- `normalizeQuotes(text)`：`‘ ’` → `'`、`“ ”` → `"`，并兼容 `&lsquo;` / `&rsquo;` / `&ldquo;` / `&rdquo;` 及 `&#8216;` 等 HTML 实体；`null` / `undefined` → `''`。
- `normalizeSections(sections)`：考研按题型分节的 `sections` 整体清洗；无变化时返回 `null`，便于调用方跳过回写。

**三处都要调用**，保证「库里库外一致」：① 输入侧（落库前清洗）、② 输出侧（展示 / 导出 / 复制前清洗，库里已干净时幂等）、③ 已入库（加载后若仍含弯引号，清洗并静默回写，完成一次性迁移）。

| 数据 | 输入侧 | 输出侧 | 已入库回写 |
|------|--------|--------|------------|
| 文章正文 `content` | `ArticlePage`（编辑保存）、`ArticleDialog`（新建） | `ArticlePage.paragraphs`、PDF 导出 | ✅ `ArticlePage` watch |
| 考研分节 `sections`（content / questions） | `KaoyanArticlePage` | `KaoyanArticlePage.exam` | ✅ `normalizeSections` |
| 笔记 `notes`、重点 `marks` | `NotePanel`（保存 / 复制词汇） | `NotePanel`（展示、`highlight` 搜索高亮） | ✅ 加载后静默回写 |
| 选择题 `questions` / `explanations` | `QuizPanel`（导入保存） | `QuizPanel`（题干 / 解析展示） | ✅ 加载后静默回写 |
| 批注 `note` | `useAnnotations`（创建 / 编辑保存） | 随批注卡片展示 | ✅ 加载后静默回写 |

> `NotePanel` 曾自带一份只处理 `’` 的本地实现，导致笔记里的 `“ ”` 不被归一；现已统一委托 `src/utils/normalizeQuotes.js`，避免多处实现不一致。

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
> （`collectDescendantIds()` / `isKaoyanFolder()` 等）。

### `articles` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | VARCHAR(64) | 主键，UUID |
| `title` | VARCHAR(500) | 文章标题 |
| `content` | TEXT | 文章正文（考研题：当前题型的题目原文） |
| `folder_id` | VARCHAR(64) | 所属文件夹 ID |
| `type` | VARCHAR(32) | 文章类型，`''` = 普通外刊；`kaoyan-*` = 考研英语题（见考研章节） |
| `questions` | TEXT | 题目区原文（题干 + 选项），考研专用 |
| `answers` | TEXT | 正确答案 JSON 文本，如 `{ "12": "A" }` |
| `explanations` | TEXT | 每题解析 JSON 文本，如 `{ "1": "..." }`；普通文章选择题面板的解析导入入口 |
| `sections` | TEXT | 多题型内容 JSON：`{ "kaoyan-cloze": { content, questions, answers }, ... }` |
| `picked` | TEXT | 作答进度 JSON：`{ "kaoyan-cloze": { "12": "A" }, ... }`（按题型分组） |
| `notes` | TEXT | 笔记生文本（用户粘贴，原样存储，前端解析展示）；考研文章为**分节 JSON** |
| `marks` | TEXT | 重点词汇标记（JSON 文本，键 `noteIndex__词汇`，值 `true`；由 `GET/PUT /api/articles/:id/marks` 读写） |
| `deleted_at` | TIMESTAMP | NULL 表示正常，非空表示已移入回收站 |
| `created_at` | TIMESTAMP | 创建时间 |

> **列补齐方式**：`type` / `answers` / `questions` / `explanations` / `sections` / `picked` / `notes` / `marks`
> 由后端**模块加载时的启动 IIFE**（`server/index.js` 顶部）用 `ALTER TABLE ... ADD COLUMN` 幂等补齐；
> `deleted_at` 由 `POST /api/init` 补齐。**建表与补列分两步**，因此新环境必须先让后端启动一次
> （补列）再建表，或建表后重启一次后端，否则进阶列可能缺失。
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

### 文章

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/article/:id` | 获取单篇文章（含 `notes / type / answers / questions / sections / picked / explanations`；`type` 为空时按目录临时推导，**仅响应不入库**） |
| GET | `/articles/:folderId` | 获取文件夹下所有文章（按标题排序） |
| POST | `/articles` | 创建文章 `{ title, folderId, content?, type?, answers?, questions?, sections?, explanations? }`；根目录被拒；未传 `type` 时按目录自动写入 `kaoyan-cloze` |
| PUT | `/articles/:id` | 更新文章（部分更新 `{ title?, content?, folderId?, type?, answers?, questions?, sections?, picked?, explanations? }`；传 `folderId` 时同时按目标目录重算 `type`，保证考研/普通目录判定不串） |
| GET | `/articles/:id/notes` | 读取笔记生文本（`?section=题型` 时按题型返回分节内容） |
| PUT | `/articles/:id/notes` | 保存笔记生文本（`{ notes }`，原样存储不做解析；带 `?section=` 时合并该节而非覆盖整篇） |
| GET | `/articles/:id/marks` | 获取重点标记（返回反序列化后的 JSON 对象；支持 `?section=`） |
| PUT | `/articles/:id/marks` | 保存重点标记（body `{ marks }`；无 `section` 时整体覆盖，带 `?section=` 时只合并该节） |
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
- `warmupTts()`：查词成功后后台并行预热 TTS 缓存，不阻塞释义返回
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
     │    ├── ArticleReader          —— 文章阅读区（普通文章；白色圆角卡片，段落/批注标记/画布/左侧工具栏/段落编号）
     │    │    └── DrawCanvas        —— 画布（画笔/矩形/矩形擦除 + 底部工具条）
     │    ├── KaoyanArticlePage      —— 考研试题页（isKaoyan 时**替代** ArticleReader，二者互斥挂载）
     │    │    ├── parseCloze.js     —— 题型表 + 原文空格 / 题目 / 答案解析
     │    │    ├── useKaoyanAnnotations.js —— 正文标记（E/W，只做标记）
     │    │    ├── .ky-sidebar       —— 右侧题目浮动栏（点选 A/B/C/D、提交判分）
     │    │    └── .ky-editor        —— 录入面板（题型 + 原文 / 题目 / 答案三块）
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
| `src/views/ArticlePage.vue` | 向工具栏传 `:article` 与 `:annotations`；考研文章传的是「当前题型」视图（见下） |

**考研文章按当前题型（节）导出**：一套真题内含多个题型，正文存在 `sections[type].content`，
顶层 `content` 只是最早录入时留下的旧字段（直接导出会永远拿到同一节）。因此传给工具栏的是两个派生值：

- `exportArticle` —— 正文取试题页回传的当前节内容（`KaoyanArticlePage` 经 `exam-state`
  事件一并回传 `content`，已含旧数据迁移），`store` 里的 `sections` 可能不是最新，仅作兜底；
  当前节未录入时正文为空，导出按钮提示「正文为空，无法导出」。
- `exportAnnotations` —— 批注按题型隔离（`paragraphIndex = 题型序号 * TYPE_SPAN(1000) + 片段序号`），
  只取落在当前题型区间内的，避免其它题型的批注串到本次正文上。

> 考研正文的批注坐标是「文本片段序号」，而 PDF 导出按 `\n` 段落定位，两者体系不同，
> 因此考研页的 E/W 标记目前不会落成 PDF 注释（第一期未接入）。

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
| E / W | 高亮 / 下划线（对当前选区）；无选区直接返回。**考研页**由 `KaoyanArticlePage.onMarkKeydown` 接管：只做标记、不写注释，已有同类型标记则取消 | `ArticlePage.onAnnotShortcut` / `KaoyanArticlePage.onMarkKeydown` |
| T | 全局开关单词查询（默认关闭） | `ArticlePage.onAnnotShortcut` |
| Ctrl+R | 开关画布模式（再次按下即关闭并保存）；**未排除 Shift**，Ctrl+Shift+R 同样命中 | `ArticlePage.onAnnotShortcut` |
| L | 切换 AI 助手面板（与点击 AI 按钮等价） | `ArticlePage.onAnnotShortcut` |
| r | 切换笔记面板；**画布工具激活（`drawActive`）时无效** | `ArticlePage.onAnnotShortcut` |
| i | 开关书签索引面板（与点击左侧书签按钮等价；Ctrl+I 留给 Vite 组件检查器，故要求无修饰键） | `ArticlePage.onAnnotShortcut` |
| K | 开关**选择题面板**（仅普通文章，`ArticleReader` 内按 K；输入框内不生效） | `ArticleReader.onQuizKeydown` |
| Ctrl+Shift+Z | 打开/关闭手动查词卡片（**输入框内也生效**） | `ArticlePage.onAnnotShortcut` |
| Space | 画布模式下循环切换画笔颜色（**仅画笔 / 矩形激活时**，矩形擦除不生效） | `ArticlePage.onAnnotShortcut` |
| Ctrl+I | 开关 Vue 组件检查器（`vite-plugin-vue-devtools` 的 `toggleComboKey`，`vite.config.js` 配置） | Vite 插件 |
| 1 / 2 / 3 | 画笔 / 矩形 / 矩形擦除（要求 `drawMode` 为真，**不要求** `drawActive`） | `DrawCanvas.onKeydown` |
| Q | 切换画笔样式（直线 ↔ 波浪线，画布开启且当前为画笔时） | `DrawCanvas.onKeydown` |
| Esc | 取消文本选中 / 关闭查词卡片 / 关闭批注卡片与浮动工具栏（**不关闭画布、不关闭手动查词卡片**；输入框内仍生效） | `ArticlePage.onAnnotShortcut` |
| Delete / Backspace | 删除当前查看的批注（编辑中的 textarea 内不拦截）。**考研页**：删鼠标悬停的那条标记，无悬停时删与选区重叠的标记 | `AnnotationCard.onKeyDown` / `KaoyanArticlePage.onMarkKeydown` |
| Ctrl+Enter / Ctrl+S | 编辑模式下保存更改（正文 contenteditable 内两种都行；标题 input 仅 Ctrl+Enter） | `ArticlePage.onAnnotShortcut` / `ArticleEditor` |
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
| Ctrl+Shift+Z | 开关手动查词卡片（无视输入框，随时可调用） | `ArticlePage.onAnnotShortcut` ① 前置段 |
| Ctrl+R | 开关画布（再次按下即关闭并保存） | `ArticlePage.onAnnotShortcut` ① 前置段 |
| Space | 画布模式下循环切换画笔颜色（仅画笔 / 矩形激活时） | `ArticlePage.onAnnotShortcut` ① 前置段 |
| L | 切换 AI 助手面板 | `ArticlePage.onAnnotShortcut` ① 前置段 |
| r | 切换笔记面板（在笔记内按即收起自身） | `ArticlePage.onAnnotShortcut` ① 前置段 |
| i | 开关书签索引面板 | `ArticlePage.onAnnotShortcut` ① 前置段 |

> 历史实现曾由 `NotePanel._sideShortcutHandler` 经 `annotationBridge.shortcuts` 接管；因它与 `ArticlePage` 各自判断是否让位，
> 容易形成「两边都不管」的死角（表现为在笔记里选中英文后按 T / L / r / i 无反应），故已统一回单一 handler。

守卫：焦点在 `INPUT` / `TEXTAREA` 内时，单字母（T / L / r / i）与 `Ctrl+R`、`Space` 不触发（保护输入）；`Ctrl+Shift+Z` 按正文习惯无视输入框仍生效。笔记英文行内的 `e` / `w` 标注仍由 `NotePanel` 原有监听处理（见下），不受此表影响。

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

## 右键菜单

两套菜单共用 `activeMenu`（`'card'` 文章卡 / `'context'` 文件夹区），任一打开即挤掉另一方。

**文章卡片**（`ArticleCard.vue`，`@contextmenu.prevent.stop` 阻止冒泡到下层菜单）：

| 菜单项 | 行为 |
|--------|------|
| ✏ 重命名 | 标题就地变 `<input>`；Enter 确认 / Esc 取消 / blur 确认 → `store.updateArticle(id, { title })` |
| 📁 移动到… | 二级面板：`← 返回` + 目标文件夹列表（按「是否考研目录」与文章同类过滤，排除 `root` 与当前文件夹，按名称排序）；无可移目标时提示「无可移动的目标文件夹」 |
| 🗑 删除 | 弹出**顶部通知条**（Teleport 到 body）：「确定删除《标题》？」+ 确认 / 取消 → `store.deleteArticle` |

**文件夹 / 空白区**（`ContentArea` → `FileExplorer` → `ContextMenu.vue`）：

| 触发位置 | 菜单项 |
|---------|--------|
| 文件夹卡片 | 新建文件夹 / 重命名 / 删除（`root` 隐藏后两项） |
| 空白区 | 新建文件夹 / 新建外刊（考研目录下文案变「新建考研题」） |

删除文件夹走 `window.confirm` 二次确认，提示「其下所有子文件夹也将一并删除」。

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
  | `currentExamType` | `Ref<string>` | 当前考研题型（如 `kaoyan-cloze`），普通文章为空串。由 `ArticlePage` 写入，App 转发给 `NotePanel` 作 `section`，实现**笔记/重点按题型分节** |
  | `noteSearchText` | `Ref<string>` | 正文选中的查找文本 |
  | `noteSearchNonce` | `Ref<number>` | 每次选中自增，保证同文本也能重新触发查找 |
  | `readerSearchText` | `Ref<string>` | 笔记中选中的查找文本（反向联动） |
  | `readerSearchNonce` | `Ref<number>` | 每次笔记选中自增，保证同文本也能重新触发正文高亮 |
  | `activeSearchMode` | `Ref<string>` | 最后一次触发的联动方向：`'forward'`（正文→笔记）\| `'reverse'`（笔记→正文），用于选区消失时只清除当前激活的一侧 |
- **页面收缩**：展开时阅读区自动缩小为 54vw（`.page-inner.shifted`）
- **过渡动画**：面板展开/收起 CSS Transition（`right 0.4s ease`）
- **默认状态**：进入文章页时面板默认关闭（`showSidePanel` 默认 `false`，`panelMode` 默认 `'link'`）
- **快捷键**：`L` 键开合（逻辑在 `ArticlePage` 中通过 inject 获取）
- **开关互斥逻辑**：`ArticlePage.togglePanel(mode)` — 已在该面板且展开则收起，否则切换模式并展开

---

## 考研英语试题页（src/kaoyan/）

为「考研英语」目录设计的试题阅读页，**组件全部位于 `src/kaoyan/` 下，不改动现有 `src/components`**。

**判定与分流**：`articles.type` 以 `kaoyan` 前缀即为考研英语题。在名为「考研英语」的目录（含子目录）下新建文章时，后端 `resolveExamType()` 沿 `folders.parent_id` 祖先链查找，命中即自动写入 `type`（默认 `kaoyan-cloze`）；读取单篇时若 `type` 为空也按目录补全（仅响应、不入库），故该目录下的旧文章同样能进入试题页。`ArticlePage` 据此分流到 `KaoyanArticlePage`，否则走原阅读页。

**字段划分**：

| 字段 | 含义 |
|------|------|
| `type` | `kaoyan-cloze`（完形填空）/ `kaoyan-partA-1`~`kaoyan-partA-4`（阅读 Part A 第 1~4 篇）/ `kaoyan-partB`（新题型）；顶栏徽章显示短名（完形填空 / Part A-N，N 为 1~4 / Part B）；**下拉只提供新值**，已存的旧值 `kaoyan-partA` 由 `examTypeLabelOf()` 统一按 `Part A-1` 显示 |
| `content` | 题目原文；完形填空中用 `[12]` 标记题目空格位置 |
| `questions` | 题目区原文（题干 + 选项），与原文**分开录入** |
| `answers` | 正确答案 JSON，如 `{ "12": "A" }`，录入文章时一并写入（可选）。录入文本框支持灵活格式：`12. A` / `12 A` / `12、A` 均可，且可一行内多条连写（如 `1.A 2.B 3.C`，点后有无空格皆可），解析时全文本扫描「题号 + 选项字母」即算一条 |
| `sections` | **多题型内容** JSON：`{ "kaoyan-cloze": { content, questions, answers }, "kaoyan-partA-1": {...} }`。一篇真题可含多个题型，顶栏下拉切换查看。旧数据（单组 `content/questions/answers`）在 `load()` 时**惰性包装**成 `{ [type]: {...} }` 区块——只在内存里，**用户点保存才真正写入 `sections` 列** |
| `picked` | 作答进度 JSON：`{ "kaoyan-cloze": { "12": "A" }, ... }`，**按题型分组**；每次点选/取消即落库，跨会话保留 |

**顶栏衔接**：试题页**不自带顶栏**——「题型下拉 + 录入 / 修改」合并进 `ArticleToolbar`（`isKaoyan` 为真时替代普通「编辑」按钮，与返回 / 字号 / 计时等同栏）；按钮点击经 `ArticlePage.toggleExamEdit()` 转发到试题页暴露的 `toggleEditing()` / `openEditing()` / `setType()`（`defineExpose`）。右侧题目浮动栏的让位由 `ArticlePage` 统一处理：组件 emit `sidebar-change`，`.page-inner` 加 `.kaoyan-shift`（`padding-right: 534px`），使顶栏与内容区**同宽同位置**，避免两层顶栏叠加或水平错位。

**父子通信**（`ArticlePage` ↔ `KaoyanArticlePage`）：

| 方向 | 名称 | 说明 |
|------|------|------|
| prop ↓ | `article-id` / `panel-open` / `font-size` | 路由文章 ID、右侧面板是否展开、正文字号 |
| emit ↑ | `editing-change` | 录入面板开合 → `examEditing` |
| emit ↑ | `sidebar-change` | 题目浮动栏是否存在 → `kaoyanSidebar`（决定是否加 `.kaoyan-shift`） |
| emit ↑ | `exam-state` | `{ currentType, recorded }` → 顶栏下拉选中项与「已录入」映射 |
| ref 方法 | `toggleEditing()` / `openEditing()` / `setType(t)` | 顶栏下拉切换题型时调用；**切到未录入题型会自动 `openEditing()`** |

**正文字号**：`KaoyanArticlePage` 新增 `fontSize` prop（由 `ArticlePage` 传入同一个 `fontSize`），绑定到正文 `.ky-passage`，与顶栏 A−/A+ **实时联动**（同 `ArticleReader` 只作用于正文的处理方式，题目浮动栏不随之变化）。空格槽内题号（`.ky-slot-num`，`0.95em`）与填空区（`.ky-slot-blank`，`1.4em` 固定宽，字母填入不引起重排）均为 `em` 单位，随字号等比缩放，无需单独适配。

**AI / 笔记面板展开时**（`panelOpen` 为真）：题目浮动栏隐藏、`kaoyan-shift` 让位取消；同时 `.page-inner.shifted` 下 `.kaoyan-inner` 改为 `width: 100%`（原本固定 `960px` 在收窄后的内容区会溢出造成排版混乱），保证面板与正文并排时布局正常。

**显示区对齐与划词联动**：
- **显示区**：`.kaoyan-inner` 固定 `960px` 与普通 `.reader` 同宽；正文阅读列 `.ky-passage` 限制 `max-width: 720px; margin: 0 auto`，与普通 `.reader-body` 的阅读列宽度一致，视觉对齐。
- **划词联动**：复用 App 已有的 `noteSearchText` / `noteSearchNonce` / `readerSearchText` / `readerSearchNonce` / `showSidePanel` / `panelMode` / `activeSearchMode` 注入与 `selectionText.js` 工具，逻辑与普通 `ArticleReader` 完全一致：
  - **正向（文章→笔记）**：在 `.ky-body` 上 `@mouseup`，仅当笔记面板处于「笔记」模式时，把选中文本（单词边界自动补全）推给 `noteSearchText` / `noteSearchNonce`，触发笔记面板高亮匹配。
  - **反向（笔记→文章）**：`watch(readerSearchNonce)`，在 `.ky-passage` 中高亮所有命中词（`<mark class="reader-hit">` 浅蓝 `#409eff`，当前命中 `#0d47a1`）并滚动到首个命中（滚动容器 `.ky-body`）。`<mark>` 由 JS 动态插入，样式用 `:deep()` 声明于 `KaoyanArticlePage` 作用域内。考研页与普通阅读页互斥挂载，不会双触发。

**录入**：
- **新建（独立导入窗）**：在「考研英语」目录（含子目录）下，工具栏按钮变为「📝 新建考研题」，走专用导入窗 `src/kaoyan/KaoyanImportDialog.vue`——只填**年份标题**（如 `2021`），正文留空；**题型标签不在此选**，进入文章后在录入面板选择（导入时不传 `type`，由后端按目录自动写入默认 `kaoyan-cloze`）。其它目录仍用原「📰 新建外刊」对话框（`ArticleDialog.vue`），两者互不影响。目录判定见 `src/kaoyan/isKaoyanFolder.js`（与后端 `resolveExamType()` 同一规则：祖先链精确匹配「考研英语」）。
- **内容**：试题页右上「录入 / 修改」→ 选择题型 + 三个输入框分别录入原文 / 题目 / 答案。
- **多题型**：一篇真题可录入**多个题型**。顶栏题型下拉切换当前题型，按钮在「录入 / 修改」与「收起录入 / 收起修改」之间切换：

  | 位置 | 下拉内容 |
  |------|---------|
  | 顶栏 `ArticleToolbar` | **只有题型名**（`完形填空` / `Part A-1` …）；录入中 `disabled`，title 提示「录入中请在下方面板内切换题型」 |
  | 录入面板内 | `题型名（说明）`，已录入的追加 `（已录入）` |

  > ⚠️ 顶栏下拉**没有 ✓ 标记**（`ArticleToolbar.vue` 里那行「已录入的带 ✓」注释与实现不符），
  > 「已录入」只在**录入面板内的下拉**里以 `（已录入）` 呈现。

  录入面板的题型下拉与顶栏联动（`setType()`），保存只写入当前题型的 `sections[type]` 区块（走 `PUT /api/articles/:id`），**不影响其它已录入题型**；同时把 `type` 更新为当前题型，下次打开默认进入它。保存前若当前区块有未保存改动，`setType()` 会先弹 `window.confirm` 拦截（`isDirty()` / `formSnapshot()` 比对）。

**解析**（`src/kaoyan/parseCloze.js`）：

| 导出 | 说明 |
|------|------|
| `EXAM_TYPES` | 题型标签表 `{ value, label, desc }`，6 项：`kaoyan-cloze` / `kaoyan-partA-1`~`4` / `kaoyan-partB` |
| `examTypeLabelOf(type)` | 取显示短名；旧值 `kaoyan-partA` 经 `LEGACY_TYPE_LABEL` 统一显示 `Part A-1` |
| `isExamArticle(type)` | `type.startsWith('kaoyan')` |
| `splitPassageSlots(passage)` | 按 `[n]` 或 `{n}`（`SLOT_RE`，两种括号都支持）切成文本片段与空格槽 |
| `collectSlotNumbers(passage)` | 收集正文全部空格题号（导出备用，当前无调用方） |
| `parseQuestions(text)` | 解析题目区，兼容单行四选项（`12. A. x B. y C. z D. w`）与题号后分行写选项两种写法；行内选项需**至少 2 个**才判定为选项行，避免题干里的 `A.` 误判 |
| `parseExam({content,questions,answers})` | 组合解析，组件唯一入口 |

答案文本 `parseAnswersText()` 用全文本扫描正则 `/(?<!\d)(\d{1,3})\s*[\.、:：]?\s*([A-Da-d])(?![A-Za-z])/gi`，
`12. A` / `12 A` / `12、A` / `1.A 2.B 3.C` 连写、末尾带标点均可，一行内多条也照收。

解析文本 `parseExplanationsText()` 按行解析 `题号. 解析内容`（`1. 考查固定搭配` / `1、...` / `1: ...` 均可），
取题号后的整行作为该题解析，存入 `explanations` 对象 `{ "1": "..." }`。

**答题**：A/B/C/D 点选，**统一提交后才判分**（非即时反馈）。提交前若仍有未作答题目，弹窗以「五列一行的方格」展示作答情况（已作答蓝色、未作答红色）并提示题数，确认后仍提交则未作答一律按错误处理（计入错题）；提交后正确项标绿、错选项标红，顶部显示得分与错题号；提交栏容器高度稳定、分数独占一行换行，避免长错题列表挤乱版面。

**答题交互细节**：

| 操作 | 行为 |
|------|------|
| 左键点选项 | 写入 `picked[currentType][题号]` 并**立即落库**（`savePicked()`）；已提交（`submitted`）时拒绝修改 |
| **右键点选项** | **取消该题选择**并落库（无 `submitted` 守卫 —— 提交后仍可取消，属已知不一致） |
| **右键点题目** | 切换「存疑」标记（`.ky-q-doubt`），**纯前端、不入库、也不按题型分组** |
| 点正文空格槽 | 滚动到对应题目（`#ky-q-<n>`）并金色呼吸闪烁 2100ms（`@keyframes ky-breathe`） |
| 提交后 | `correct / total / wrong`；判分口径：`标准答案存在 && 已选 && 相等` 才算对，**选错 / 未作答 / 缺标准答案一律计错** |
| 重做 | `resetQuiz()` 清空当前题型作答并落库；`resetGrading()` 只复位判分、保留各题型已选 |

**当前题型优先级**：`localStorage['ky-last-exam-type']`（需通过 `EXAM_TYPES` 合法性校验）> 文章 `type` > 第一个已录入的题型 > `EXAM_TYPES[0].value`。

> ⚠️ 已知边界：旧数据若 `type === 'kaoyan-partA'`（legacy），迁移时会用 `kaoyan-partA` 作 section 键，
> 而该键不在 `EXAM_TYPES` 中 —— 区块数据仍在库里，但下拉选不中、UI 上不可达。

**分期**：第一期完形填空（正文含 `[n]` 空格）；第二期阅读 Part A（正文无空格，题目在原文之后）；第三期 Part B 新题型（题目中含空格）——三种题型**均已支持**（下拉可切换、按题型分块存储）。

**已接入 / 未接入**：

| 能力 | 状态 |
|------|------|
| 正文标记（高亮 / 下划线） | ✅ 已接入，**只做标记不写注释**（`src/kaoyan/useKaoyanAnnotations.js`，见下节） |
| 笔记面板 | ✅ 已接入，**按题型分节**（`section` = 当前题型，`notes` / `marks` 各存一套） |
| 正文 ↔ 笔记双向划词联动 | ✅ 已接入（正向 `.ky-body` mouseup；反向高亮 `.ky-passage`、滚动容器 `.ky-body`） |
| 批注注释 / 悬停卡片 / 查词回填 | ❌ 未接入（`note` 恒为空，不弹 `AnnotationCard`） |
| 选中查词、手绘画布 | ❌ 未接入 |

### 正文标记（E / W）

与普通文章**同一张 `annotations` 表、同一套 API、同一快捷键**，但只做标记：`note` 恒为空、不弹批注卡片、不做查词回填。

**坐标约定**（考研页没有「段落」，只有 `passageParts` 切出的文本片段）：

| 字段 | 取值 |
|------|------|
| `paragraphIndex` | **题型序号 × 1000 + 文本片段序号**（`passageParts` 中 `type === 'text'` 的第几个） |
| `startOffset` / `endOffset` | 该片段纯文本内的字符偏移 |

> 把题型编进 `paragraphIndex` 是为了隔离：一篇真题含多个题型、正文各不相同，
> 而 `annotations` 表没有题型列，这样可免改后端。

**渲染**：文本片段包一层 `.ky-seg`（带 `data-fi` 供量取偏移），内部再按覆盖它的批注切分为
`.ky-mark-hl`（`#FFEB3B` 底）/ `.ky-mark-ul`（`#e74c3c` 下划线），两种**可叠加**。

**交互**（`useKaoyanAnnotations`）：全程**静默**，不弹任何 `ElMessage` 提示。

| 操作 | 行为 |
|------|------|
| 选中正文 + `E` / `W` | 创建高亮 / 下划线；已有**同类型**标记覆盖选区则**取消**（开关语义） |
| 鼠标悬停标记 + `Delete` / `Backspace` | 删除该标记（与普通文章「悬停批注后按 Delete」一致）。悬停时标记加蓝色描边 `.ky-mark-hover` 作提示 |
| 同一处叠了两种标记 | 连按两次依次删除，**先高亮后下划线**（与普通文章 `pMap` 优先级一致） |
| 无悬停时选中正文 + `Delete` | 退一步删除与选区重叠的标记（选中范围即意图，无需精确悬停） |
| 跨空格槽的选区 | 静默忽略——空格槽不是纯文本，无法算偏移 |
| 切换题型 | 标记按题型隔离，自动换一套；`saveForm()` 后随 `load()` 重新拉取 |
| 顶栏内嵌高亮/下划线按钮 | 考研页**隐藏**（按钮依赖普通阅读区的选区，点了无效），标记只走快捷键 |

**实现要点**：
- 快捷键用 **capture 阶段**注册并 `stopPropagation()`，避免 `ArticlePage.onAnnotShortcut` 的通用 E/W 分支重复处理
  （后者靠 `.reader-body .article-para` 取偏移，考研页取不到，本就无事可做）。
- 偏移量用 `Range` 量取（与 `useAnnotations.getSelectionOffsets` 同思路）：`selectNodeContents(segEl)` + `setEnd(选区起点)`
  得到起点长度，再 trim 掉首尾空白/换行，避免标记范围多出看不见的字符。

## 普通文章的选择题面板（QuizPanel.vue）

考研试题页的选择题能力下放到普通文章：**K 键**开关，面板 fixed 贴右侧（宽 46vw，与笔记页面 .side-panel 一致，四周倒角），
解析与判分复用 `src/kaoyan/parseCloze.js`，不另写一套。

| 项 | 说明 |
|------|------|
| 挂载 | `ArticleReader` 内 `v-if="quizOpen"`；K 键由 `ArticleReader.onQuizKeydown` 处理并 emit `quizToggle` |
| 让位 | `ArticlePage` 收 `quizToggle` → `.page-inner.quiz-shifted`（`width: calc(100% - 46vw)`，与笔记页面等宽） |
| 互斥 | 打开时自动收起 AI / 笔记面板（两者都贴右侧，同时展开会互相遮挡） |
| 数据 | 复用 `articles` 的 `questions` / `answers` / `explanations` / `picked`；新增 `explanations` 列（建表 IIFE 补齐），普通文章选择题面板专用 |
| 解析 | `parseQuestions()`（题干 + 选项，兼容单行四选项与分行选项）+ `parseAnswersText()`（答案文本 → `{ "1": "A" }`）+ `parseExplanationsText()`（解析文本 → `{ "1": "..." }`）。三者原先定义在 `KaoyanArticlePage.vue` 内，已提取到 `parseCloze.js` 供两处共用 |

与考研页的差异：

- 普通文章正文没有 `[n]` 空格槽，**不做**「点空格跳题」，作答全部在面板内完成；
- `picked` 直接用题号作键（`{ "1": "A" }`），考研是按题型分组的两层结构；
  读取时 `normalizePicked()` 只接受字符串值，避免文章类型被来回改动后残留对象把界面搞乱；
- 面板**顶部**提供「导入题目/答案/解析」：**单个文本框整段粘贴**，按一级标题「一、题目」「二、答案与解析」自动分块；
  `splitQuizSections()` 切块后，题目部分交给 `parseQuestions()`，答案与解析部分由 `parseAnswersExplanations()` 一行「`1. C —— 解析文本`」同时解出答案与解析（末行「【答案速查表】」仅取答案）。保存走 `PUT /api/articles/:id`（写入 `questions` / `answers` / `explanations`）。题目**提交判分后**点「查看解析」在每题下方展示该题解析。

交互与考研一致：左键选项作答（右键取消）、右键题目切换「存疑」、
**统一提交后才判分**（未作答 / 选错均计入错题）、判分后正确绿 / 错选红、可「重新作答」。

---

## 笔记面板（NotePanel.vue）

独立笔记组件，挂载在右侧面板（`panelMode === 'note'` 时显示），以 `articleId` 为粒度读写笔记；
**考研文章再按题型分节**（`section` = 当前题型），切题型即换一套笔记与重点。

**侧栏内快捷键**：焦点落在笔记 / AI 面板（`.side-panel`）内时，无需切回正文即可用快捷键开关自动查词（T）、手动查词卡片（Ctrl+Shift+Z）、画布（Ctrl+R，空格切换颜色）、AI 面板（L）、笔记面板（r）、书签索引（i）。这些键由 `NotePanel._sideShortcutHandler` 接管，复用 `ArticlePage` 提供的 `annotationBridge.shortcuts`；输入框内不触发单字母以避免干扰输入。

接管判定为「焦点在侧栏元素内」**或**「选区落在笔记面板（`.note-root`）内」二者满足其一：`e.target` 只反映焦点，而点击笔记英文行 / 卡片时焦点仍在 `body`（`body.closest('.side-panel')` 为 null），只判焦点会与 `ArticlePage.onAnnotShortcut` 的 note-root 选区让位形成两不管死角，表现为**在笔记里选中英文后按 T / L / r / i 毫无反应**。完整映射见上方 [快捷键](#快捷键) 章节的「笔记 / AI 面板内复用」小节。

> 笔记 / 重点走的是**独立接口**、且由 `NotePanel.vue` 直接 `fetch` 调用（不经 `src/api/index.js`）：
> `GET/PUT /api/articles/:id/notes[?section=]`、`GET/PUT /api/articles/:id/marks[?section=]`。

**英文行批注渲染（与正文互为镜像）**：`englishSegments()` 用批注文本在英文行中的命中区间做**边界点切分**，
每个片段携带**全部覆盖它的批注**（`anns`），从而实现高亮与下划线**在同一处叠加**：

- `class` = 全部覆盖批注的类型并集（可同时含 `highlight` + `underline`）；
- 背景色取覆盖批注中 `highlight` 自身的 `color`；
- 主批注按 `highlight(3) > underline(2)` 取，用于卡片交互（与正文 `pMap` 一致）。
- **片段 `key` 必须用「起点偏移」`seg.start`，不能用数组索引**：叠加 / 删除批注会改变片段划分，
  索引 key 会让 Vue 按位置复用旧节点，导致叠加样式不刷新（要刷新页面才显示）——与正文 `ArticleReader` 同一约定。

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
   │     仅用于右侧边栏「对应笔记」卡片展示，不入库
   │
   ├── 保存生文本 → PUT /api/articles/:id/notes[?section=] { notes } → MySQL articles.notes（TEXT，原样存储）
   │     · 添加模式：新文本追加到已存文本之后（\n\n 分隔）
   │     · 修改模式：整体覆盖
   │     · 带 section：读出旧的分节对象、合并该节后重新序列化（不动其它节）
   │
   └── 读取 → GET /api/articles/:id/notes[?section=] → parseRaw() 渲染卡片
```

**存储设计**：数据库只存**用户粘贴的生文本**（与参考项目一致），展示用的结构化数组不入库；解析逻辑集中在前端，后续调整解析规则无需迁移数据。

**列自动补齐**：`articles.notes` 列由后端启动时（`server/index.js` 顶部）及 `POST /init` 用 `ALTER TABLE articles ADD COLUMN notes TEXT` 幂等补齐。`db/language_learning.sql` 备份文件**不含此列**，换环境导入后首次启动后端即自动补上，笔记功能无需手动处理。

**顶部常驻操作栏**（`flex: 0 0 auto`，不随内容滚动）：`解析并渲染`（primary）/ `修改`（warning）/ `重点 N`（danger，`N` 为当前重点数量 `markedItems.length`，实时反映已标记词汇数；`:plain` 反映展开态）/ `关闭`

**输入区**：添加/修改笔记的输入框以**独立悬浮卡片**在面板顶部弹出（`position: fixed`，`right:16px; top:56px`，宽度 `calc(46vw - 32px)`），不随笔记列表滚动；textarea 内 Enter 触发解析保存、Shift+Enter 换行。

**交互**：

| 操作 | 说明 |
|------|------|
| 解析并渲染 | 顶部主按钮；输入区未开则打开（添加模式），已开则解析并保存 |
| 修改 | 载入数据库生文本，整体覆盖（输入区以顶部弹出卡片打开，宽度保持 `46vw` 右上贴边，**仅高度顶满网页**：`fixed` + `top/bottom:16px`；`.raw-input-full` 用 `flex:1` 撑满卡片剩余高度，textarea 不可手动拉伸） |
| 关闭 | 收起输入区 |
| 保存后 | 以保存后的完整生文本重新 `parseRaw()` 渲染，保证展示与存储一致；修改模式保存后自动切回添加模式（输入区保持打开，方便继续追加） |
| 笔记卡片 | 主列表卡片仅渲染**英文 / 中文 / Vocabulary**（已移除顶部「编号徽章 + 副标题」头部，顶部导航栏 `#1 #2…` 亦已移除；`Vocabulary & Expressions` 标题也已移除，词汇列表直接跟在中文下方）；右侧边栏对应卡片仍保留编号徽章 + 副标题 |
| 右键卡片（重新录入） | 在卡片空白处**右键单击**进入单卡片录入：编辑区自动回填该卡片原文（`serializeNote`，编号取 `index+1`）并聚焦；整块改完按 `Enter`（或点「保存」）即由 `parseRaw` 重新解析，`Shift+Enter` 换行。**操作条（保存 / 取消）仅在编辑态出现**，平时卡片无按钮。⚠️ 词汇项 `<li>` 的右键是**复制**（`@contextmenu.prevent.stop` 阻止冒泡），不会被卡片右键覆盖；卡片内**已选中文字**时右键交还浏览器（便于复制），不进入编辑 |
| 双击词汇 | 标记/取消重点（红色加粗），键为 `noteIndex__词汇文本`，**持久化在数据库 `articles.marks`**（`GET/PUT /api/articles/:id/marks`） |
| 重点 | 顶部「重点」按钮，展开/收起**重点集中卡片**（`markedPanelVisible`）：弹出式只读卡片，汇总所有重点词汇，带笔记编号（纯数字）；单击左侧重点项在右侧边栏显示其所属笔记卡片 |
| 重点集中卡片 | 弹出层（`fixed` + `left/top: 0` + `transform: none`，**宽 `100vw`、高 `100vh` 顶满整个网页**），内部滚动，标题带「只读」标签；**只读**：不支持在此取消重点（重点增删仍在原卡片双击词汇），条目文本可选中复制；无重点时显示空提示。**左右平分宽度**：`.marked-body` 中左侧重点列表与右侧边栏各 `flex: 1 1 0` 均分。左侧列表为**中性灰色调（不使用红色）**，当前项 `.marked-item.is-active` 用蓝色（`#409eff`）高亮；右侧边栏笔记卡片内的重点项 `vocab-marked` 仍保留红色 |
| 重点卡片右侧边栏 | `.marked-body` 为左右布局：左侧重点列表（`flex: 1 1 0`）+ 右侧边栏（`.marked-sidebar`，`flex: 1 1 0` 与左侧平分宽，独立滚动）。边栏由 `activeNote`（当前 `activeNoteIndex` 对应笔记）直接渲染**原笔记卡片结构**（`note-card`：编号徽章 + 副标题 + 英文 + 中文 + Vocabulary 列表，重点项红色加粗），只读；打开卡片时默认显示第一张含重点的笔记，单击左侧重点项经 `selectNote` 切换并高亮（`marked-item.is-active` 蓝）；无重点时不渲染 |
| 正文选中联动 | 笔记面板打开时，在正文选中/双击文本 → 自动在英文/中文/词汇中查找包含项，精确高亮匹配文字段（`<mark class="note-hit">` 蓝底 `#409eff` + 白字）、滚动到第一个匹配卡片至区域中央；回车滚动到下一个匹配卡片。查找关键词为**单词边界自动扩展后的完整文本**（见下方「选中补全逻辑」） |
| 笔记选中联动（反向） | 在笔记的英文/中文区域用鼠标选中文字 → 复用「选中补全逻辑」得到完整词 → 在正文中高亮所有命中词（`<mark class="reader-hit">` 蓝底白字）并滚动到第一个命中处（`.reader-content` 居中）；**回车在正文命中间循环向后跳转**（`NotePanel.nextReaderHit` 维护 `readerHitIndex`，`scrollToReaderHit` 滚动到第 k 个命中）。链路：`NotePanel.onReverseSelect`（英文/中文区域 `@mouseup`）→ `emit('reverse-select', 完整词)` → `App.onReverseSelect` 更新 `readerSearchText`/递增 `readerSearchNonce` → `ArticleReader` watch 后调 `highlightMatchesInReader` 在 `.reader-body` 高亮，每次先清除上一次遗留的 `reader-hit`。⚠️ 反向通道用 **emit 上报而非 NotePanel 直接 inject 写入**：Options API 的 `inject` 会自动解包 ref（`this.readerSearchText` 变成值而非 ref），直接 `.value` 赋值无效，故由 App 持有并更新 ref，ArticleReader 用 Composition API `inject`（拿到 ref 对象）watch 消费。回车处理统一在 `NotePanel.bindEnterNav`：**优先反向**（正文存在 `reader-hit` 则滚正文命中），否则正向（滚笔记匹配卡片），避免双监听冲突（`ArticleReader` 与 `KaoyanArticlePage` 互斥挂载，二者均 watch `readerSearchNonce` 消费同一反向通道；考研页高亮目标为 `.ky-passage`、滚动容器 `.ky-body`） |

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

**选区消失自动清除高亮**：App.vue 监听 `document.selectionchange`，当选区变为空（点击空白/按 Esc 等清空选区）时调用 `clearActiveSearch()`，只清除**最后一次激活的那一侧**高亮（依据 `activeSearchMode`）：
- 反向激活时：清空 `readerSearchText` + 递增 `readerSearchNonce` → `ArticleReader` watch 以空关键词调 `highlightMatchesInReader` 清除正文 `reader-hit`（空关键词也能清高亮）
- 正向激活时：清空 `noteSearchText` + 递增 `noteSearchNonce` → `NotePanel.findMatches` 清空 `matchIndices`，笔记卡片高亮消失
- 清除后重置 `activeSearchMode=''`，避免选区再次为空时重复触发

**跨节点短语匹配**（`highlightMatchesInReader`）：正文段落可能因批注/单词级 span 被拆成多个文本节点。匹配时先把 `.reader-body` 下所有文本节点按文档顺序拼接成逻辑全文，用 `indexOf` 找所有不重叠命中，再映射回各文本节点生成多段 `<mark>`；随后通过 `mergeAdjacentHitMarks` 把同一次命中的相邻 mark 及其之间的空白文本合并为一个连续 `<mark>`（`data-hit-index` 保留），避免单词间出现背景断裂，实现视觉上的完整连续高亮。

**匹配视觉层级**：命中卡片描边蓝色 `#409eff`（`note-card.note-match`），当前定位的那一张描边加深为 `#1f6ea8`（`note-current`）；命中文字段 `.note-hit` 为蓝底白字，与卡片描边同色系。正文反向命中的 `<mark class="reader-hit">` 为浅蓝底 `#409eff`（`box-shadow: 0 0 0 1px #409eff` 替代横向 `padding`，避免命中词撑宽导致段落重排/移位），**回车定位到的当前命中**加 `.reader-hit-current` 类显示**更深蓝 `#0d47a1`**，并把 `box-shadow` 描边**同步覆盖为 `#0d47a1`**（否则深蓝背景外残留 `.reader-hit` 的浅蓝 1px 描边，表现为"深蓝块外一圈浅蓝边"）（由 `scrollToReaderHit` 维护：定位时移除其他命中的 current 类、仅当前命中保留，首次选中滚到第一个时即标记第一个为当前）。`scrollToReaderHit` 按 `data-hit-index` 处理完整命中；合并后每个命中仅一个 `<mark>`，`reader-hit-current` 直接加在该连续 mark 上即可。

> ⚠️ `.note-hit` 必须写成 `:deep(.note-hit)`：该 `<mark>` 由 `highlight()` 经 `v-html`
> 动态插入，编译期拿不到 `scoped` 的 `data-v-xxx` 属性，直接写 `.note-hit` 会匹配不到，
> 从而露出浏览器给 `<mark>` 的 UA 默认黄色（表现为"改了样式却不生效"）。
> 同理，正文命中的 `<mark class="reader-hit">` 由 `selectionText.js` 经 JS 动态插入，
> 也须写成 `:deep(.reader-hit)`（位于 `ArticleReader.vue`）。

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
> 该脚本**不启动** PDF 导出服务（5057）；要启用 PDF 导出请用下面的 `start-all.py`
> （Windows 下双击 `scripts\start-all.bat` 可静默拉起全套服务，含 5057、全程无黑窗）。

### 完整启动（含 MySQL 检查）

```bash
start-mysql.bat   # 先检查/启动 MySQL80 服务
start.bat         # 再启动前/后端
```

### 一键启停脚本（Python）

```bash
python scripts/start-all.py   # MySQL(3306) → 后端(3000) → 前端(5173) → PDF 导出(5057) → 自动打开浏览器
python scripts/stop-all.py    # 前端(5173) → 后端(3000) → PDF 导出(5057) → MySQL
python scripts/restart-backend.py  # 只重启后端(3000)，改完 server/index.js 后用
python scripts/restart-pdf.py      # 只重启 PDF 服务(5057)，改完 server/*.py 后用
```

行为要点：
- 项目根由脚本自身位置推导（`scripts/` 的上级），node / python / MySQL 服务名自动探测，无硬编码路径
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
| MySQL | 文件夹、文章（含 `notes` 笔记、`marks` 重点标记）、批注、收藏、画布笔迹数据 |
| `localStorage.lastPage` | 最后浏览的页面（`article:<id>` / `folder:<id>`），重启后自动恢复 |
| `localStorage.lastFolderId` | 最后浏览的文件夹 ID |
| `localStorage.fontSize` | 阅读字号（12–32，默认 16） |
| `localStorage.sidePanelState` | 右侧面板当前 AI 站点（`{ site }`） |
| `localStorage.ky-last-exam-type` | 考研试题页最后查看的题型（需通过 `EXAM_TYPES` 合法性校验才生效） |
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

> ⚠️ 项目已暂停使用 Git（2026-09-24 起），下表仅供日后恢复版本管理时参考。
> 仓库重新初始化后以 `0373a11` 为起点，其后的 `5b5ffb4` … `e5645bf` 为重建前保留的说明记录。

| 提交 | 说明 |
|------|------|
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
