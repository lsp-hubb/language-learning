# Language Learning — 项目架构文档

## 项目概述

**Language Learning** 是一个外语阅读辅助工具，帮助用户阅读英文文章并实时查词、添加批注、手绘标记。基于 **Vue 3 + Vite + Pinia** 前端和 **Express + MySQL** 后端构建。

### 核心功能

1. **文件夹管理** — 支持无限层级嵌套的文件夹，CRUD 操作，右键菜单
2. **外刊文章管理** — 在文件夹中创建、编辑、查看英文文章
3. **单页阅读视图** — 滚动阅读，两端对齐排版，滚动条在容器右侧
4. **智能单词查询** — 选中英文单词后，自动查询有道词典，弹出浮动词卡展示音标、释义；音标区鼠标悬停自动播放英式/美式发音；支持 T 键全局开关
5. **PDF 风格批注** — 黄色高亮(E键, `#FFEB3B`) + 红色下划线(W键, `#e74c3c`)，悬停查看注释并自动播发音，点击编辑/自动填入查词结果，按 Delete 键删除，数据保存在 MySQL
6. **长难句标注** — 选中句子后按 r 键，字体变蓝色，自动保存对应段落中文翻译到注释中
7. **手绘画布** — Ctrl+R 开启/关闭画布，支持画笔（Q 切换直线/波浪线）/矩形/矩形擦除/颜色切换，笔迹按文章 ID 存储在 MySQL
8. **收藏文章** — 文章卡片右上角 SVG 书签图标，切换收藏状态，数据持久化
9. **外部链接面板** — 右侧悬浮面板嵌入 腾讯元宝 iframe，查阅文章时可快速翻译或提问
10. **局域网共享** — 同一网络下多设备可同时访问，共享文章和批注数据
11. **阅读计时器** — 工具栏显示，点击切换开始/暂停/归零
12. **英文单词数统计** — 工具栏实时显示文章单词数
13. **手动查词卡片** — Ctrl+Shift+Z 打开，支持输入查词、一键复制、联想词下拉、任意拖动、位置记忆；查词结果自动播放英式发音，音标区可悬停切换英式/美式发音
14. **段落翻译** — 点击工具栏「导入翻译」粘贴中文翻译（每段一行），悬停英文段落按 S 键切换显示/隐藏中文翻译，数据持久化到 MySQL
15. **状态恢复** — 刷新/重启后自动回到上次浏览的文件夹或文章页面

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
| 代码格式化 | Prettier | 3.8.3 |
| 单元测试 | Vitest + @vue/test-utils + jsdom | — |
| E2E 测试 | Playwright | — |
| Vite 插件 | @vitejs/plugin-vue, vue-jsx, vite-plugin-vue-devtools | — |

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
├── start-all.bat                       # Windows 完整启动 (含 MySQL 检查)
├── start-mysql.bat                     # MySQL 单独启动脚本
├── .prettierrc.json                    # Prettier 代码格式化配置
├── README.md
├── ARCHITECTURE.md                     # 项目架构文档
├── GIT_GUIDE.md                        # Git 使用指南
├── MySQL连接配置说明.md                 # 数据库配置文档
├── db/                                 # 数据库 SQL 备份（Git 跟踪）
│   └── language_learning.sql
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
│   ├── composables/                    # 可组合函数
│   │   ├── useWordLookup.js            # 单词查询 + 文本选择
│   │   ├── useAnnotations.js           # 批注 CRUD + 工具栏/卡片 UI
│   │   ├── useTimer.js                 # 阅读计时器
│   │   └── useCanvas.js                # 画布模式/工具/颜色
│   ├── views/
│   │   ├── ArticlePage.vue             # 文章阅读/编辑页（编排层，~286 行）
│   │   └── ReviewPage.vue              # 复习页面（展示文章标题，待开发）
│   └── components/
│       ├── FileExplorer.vue            # 文件管理器主组件
│       ├── FolderTree.vue              # 左侧文件夹树
│       ├── ContentArea.vue             # 主内容区（文件夹+文章网格）
│       ├── ArticleCard.vue             # 文章卡片（收藏 SVG 书签图标 + 复习 📜 按钮，新标签打开）
│       ├── ArticleToolbar.vue          # 顶部工具栏（返回/编辑/计时器/链接）
│       ├── ArticleReader.vue           # 文章阅读区（段落/批注标记/画布）
│       ├── ArticleEditor.vue           # 文章编辑器（标题+正文输入框）
│       ├── AnnotToolbar.vue            # 浮动批注工具栏（高亮/下划线）
│       ├── ArticleDialog.vue           # 新建文章对话框
│       ├── FolderDialog.vue            # 文件夹创建/重命名对话框
│       ├── ContextMenu.vue             # 右键菜单
│       ├── WordCard.vue                # 浮动单词查询卡片（选中查词）
│       ├── ManualWordCard.vue          # 手动查词卡片（Ctrl+Shift+Z，含联想词）
│       ├── AnnotationCard.vue          # 浮动批注卡片
│       ├── CodeGate.vue                # 访问验证码弹窗
│       ├── DrawCanvas.vue              # 画布绘制组件（画笔/矩形/矩形擦除）
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
| `deleted_at` | TIMESTAMP | NULL 表示正常，非空表示已移入回收站 |
| `created_at` | TIMESTAMP | 创建时间 |

### `articles` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | VARCHAR(64) | 主键，UUID |
| `title` | VARCHAR(500) | 文章标题 |
| `content` | TEXT | 文章正文 |
| `folder_id` | VARCHAR(64) | 所属文件夹 ID |
| `translation` | TEXT | 段落翻译（每个段落一行，S 键切换显示） |
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
| `type` | VARCHAR(20) | 批注类型（`highlight` / `underline` / `sentence`） |
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
| POST | `/init` | 初始化数据库建表 + 迁移（含 favorites, deleted_at, translation 字段） |
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
| PUT | `/articles/:id` | 更新文章（部分更新 `{ title?, content?, translation? }`） |
| DELETE | `/articles/:id` | 删除文章 |

### 批注

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/annotations/:articleId` | 获取文章的所有批注 |
| POST | `/annotations` | 创建批注（类型 highlight/underline/sentence，颜色固定，含注释） |
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
      │    │    └── ArticleCard.vue    —— 文章卡片（含收藏 SVG 书签图标）
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
     │    ├── ArticleToolbar         —— 顶部工具栏（返回/编辑/计时器/链接）
     │    ├── ArticleReader          —— 文章阅读区（段落/批注标记/画布）
     │    ├── ArticleEditor          —— 文章编辑器（编辑模式）
     │    ├── AnnotToolbar           —— 浮动批注工具栏（高亮/下划线）
     │    ├── WordCard               —— 浮动查词卡片（选中查词，自动/悬停发音）
     │    ├── ManualWordCard         —— 手动查词卡片（Ctrl+Shift+Z，联想词）
     │    ├── AnnotationCard         —— 浮动批注卡片
     │    └── 外部链接面板（内置, 腾讯元宝 iframe）
     │
     └── ReviewPage.vue ( /review/:id, 新标签)
          └── 复习功能（待开发）
```

---

## 手绘画布

画布组件 `DrawCanvas.vue` 提供在文章上手绘标记的功能：

- **快捷键**：`Ctrl+R` 开启/关闭画布
- **绘制工具**：画笔(1, Q 切换直线/波浪线)、矩形(2)、矩形擦除(3)，工具栏按钮可开关
- **画笔颜色**：6 色切换（红、深蓝、蓝、绿、橙、紫）
- **橡皮擦**：拖拽绘制淡蓝色虚线矩形，框内及与边框相交的笔触被删除
- **画布范围**：仅限于 `.reader-content` 容器内（含滚动条区域）
- **与注释共存**：工具关闭时画布透明不可交互，可正常查词注释；工具激活时自动关闭查词/批注卡片并取消文本选中
- **数据存储**：每篇文章笔迹经由 API 保存在 MySQL `canvas_strokes` 表，自动建表，500ms 防抖写入
- **跨设备共享**：笔迹存入 MySQL，局域网多设备可共享同一画布内容
- **侧边栏兼容**：画布尺寸随链接面板开闭自动调整，笔迹按比例缩放保持相对位置
- **快捷键**：`Esc` 关闭画布并保存，`Q` 切换画笔直线/波浪线，`新画布` 清空当前文章笔迹
- **切换文章**：自动保存当前文章笔迹至 MySQL，清空状态准备加载新文章笔迹

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| E / W | 高亮 / 下划线 |
| T | 全局开关单词查询 |
| Ctrl+R | 开关画布模式（画笔工具） |
| r | 长难句标注（选中句子按 r，对应翻译自动存入注释） |
| L | 开关右侧链接面板 |
| Ctrl+Shift+Z | 打开/关闭手动查词卡片 |
| S | 切换当前悬停段落的翻译显示/隐藏（需先导入翻译） |
| Space | 画布模式下循环切换画笔颜色（画笔/矩形工具激活时） |
| 1 | 画笔（Q 切换直线/波浪线） |
| 2 | 矩形 |
| 3 | 矩形擦除 |
| Q | 切换画笔样式（直线 ↔ 波浪线，画布开启时） |
| Esc | 取消选中 / 关闭浮动卡片 / 关闭画布并保存 |
| Delete / Backspace | 删除当前查看的批注（非编辑模式） |
| 方向键 / PgUp / PgDn | 翻页 |
| Home / End | 首页 / 末页 |

---

## 收藏功能

- 文章卡片右上角 SVG 书签图标，点击切换收藏状态
- 后端 `favorites` 表，`article_id` 为主键且外键级联删除
- Pinia Store: `favoriteIds` (Set)、`loadFavorites()`、`isFavorited()`、`toggleFavorite()`
- 启动 `FileExplorer` 时自动调用 `store.loadFavorites()` 加载收藏数据
- API: `GET /api/favorites`（获取所有收藏 ID）、`POST /api/favorites/:articleId`（切换收藏）

---

## 外部链接面板

文章页工具栏右侧 `链接` 按钮，点击展开/收起悬浮面板：

- **面板宽度**：46vw，固定在视口右侧（CSS 类名 `.side-panel`，`right: 0`）
- **内嵌链接**：腾讯元宝 iframe（URL: `https://yuanbao.tencent.com/chat/naQivTmsDa`）
- **页面收缩**：展开时阅读区自动缩小为 54vw
- **过渡动画**：面板展开/收起 CSS Transition（`transition: width 0.4s ease, opacity 0.3s ease`）
- **默认状态**：进入文章页时面板默认展开
- **快捷键**：`L` 键切换（代码变量名为 `showLeftPanel`，实际为右侧面板）

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
    ├── 渲染音标 / 释义列表 / 段落翻译
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
    ├── 点击下划线 / 按 W → createAnnotation('underline', '#e74c3c')
    └── 选中文本按 r → createAnnotation('sentence', '#2980b9', note=对应翻译)
         │
         ├── 快捷键自动填入查词卡片释义（单词含完整释义，长句仅翻译）
         ├── 长难句自动扩展为整句（按 "." 定位句起止）
         ├── 长难句按 "。" 拆分中文翻译，取对应句存入 note
         ├── 查词未完成时先创建批注，结果返回后补填注释（pendingNoteFill）
         ├── TreeWalker 精确计算偏移量（避免 indexOf 重复匹配）
         ├── 选区消失时回退到最后一次有效选区（lastSelection）
         ├── 不限制重叠，三种标注可在彼此区域内自由建立
         └── 存入 annotations[] + POST /api/annotations → MySQL
              │
              └── paragraphSegments computed 重新切分段落
                   ├── 收集所有边界点切分，每段记录全部覆盖标注
                   └── <span class="annotated highlight underline sentence"> 合并渲染
```

#### 嵌套标注优先级

| 优先级 | 类型 | 创建规则 | 卡片弹出 | Delete 删除 |
|--------|------|----------|----------|-------------|
| 1 | `highlight` | 无限制 | 优先弹出 | 删高亮后自动弹剩余标注卡片 |
| 2 | `underline` | 无限制 | 次级弹出 | 删下划线后自动弹剩余标注卡片 |
| 3 | `sentence` (`#2980b9`) | 无限制 | 不弹出卡片 | 悬停时按 Delete 删除（与高亮/下划线一致） |

- 嵌套区域中悬停，弹出**最高优先级**的批注卡片
- 三种标注可任意相互叠加渲染（背景黄 + 下划线红 + 字体蓝 同时生效）

### 查看/编辑批注

```
悬停批注文本 200ms → AnnotationCard 弹出（渐变背景，多层阴影，流畅动画）
    │
    ├── 查看模式：显示注释内容（或"暂无注释，点击编辑"），卡片内滚动不穿透页面
    │
    ├── 点击进入编辑 → textarea 自动聚焦
    │     ├── 失去焦点 / Ctrl+Enter → 自动保存
    │     ├── 点击"删除" → 删除批注
    │     └── 键盘 Delete/Backspace → 删除批注
    │
    ├── 切换批注时先隐藏旧卡片（避免双重显示）
    ├── 查看模式下移出批注文本+卡片 150ms → 关闭卡片
    ├── 编辑模式下移出卡片不关闭，移出后点击卡片外部 → 自动保存并关闭
    └── 编辑/查看模式下滚动文章 / 点击卡片外 → 关闭卡片
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

### 完整启动（含 MySQL 检查）

```bash
start-all.bat
# 先检查/启动 MySQL80 服务 → 再执行与 start.bat 相同的流程
```

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
start-all.bat
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

文件首页点击文章卡片时，通过 `window.open` 在新标签打开：

```
FileExplorer.onViewArticle(articleId)
  → router.resolve({ name: 'article', params: { id } })  // 生成准确 URL
  → window.open(fullUrl, `article-${id}`, 'noopener,noreferrer')
     └── 被浏览器拦截时回退 <a> 标签模拟点击
```

- 每篇文章使用独立窗口名 `article-{uuid}`，同一文章复用标签
- 被浏览器拦截时自动回退 `<a>` 标签模拟点击

### 重启恢复

`App.vue` 的 `onVerified()` 读取 `localStorage.lastPage` 并跳转：

```js
const last = localStorage.getItem('lastPage')
if (last && last.startsWith('article:')) {
  router.replace({ name: 'article', params: { id: articleId } })
}
```

- 当前实现无 `pathname === '/'` 检查，多标签页中最后一个加载的标签会覆盖 lastPage

### lastPage 更新策略

- 每次 `ArticlePage` 加载时写入 `localStorage.lastPage = "article:{当前文章ID}"`
- 多标签页中，**最后一个加载的标签**覆盖 lastPage（合理默认值）

---

## 状态持久化

| 存储方式 | 用途 |
|------|------|
| MySQL | 文件夹、文章、批注、收藏、画布笔迹数据 |
| `localStorage.lastPage` | 最后浏览的页面（文章/文件夹），重启后自动恢复 |
| `localStorage.lastFolderId` | 最后浏览的文件夹 ID |

- 刷新页面：保持在当前文件夹/文章不变
- 重启前后端：自动跳转到上次退出时的页面
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

## 当前数据概览

> 以下数据基于当前运行中的数据库（`language_learning`，2026-06-26 查询）。

### 汇总

| 表 | 数量 | 说明 |
|----|------|------|
| folders | 16 | 15 个正常文件夹 + 1 个空子文件夹 |
| articles | **22** | 14 篇考研英语 + 8 篇经济学人 |
| annotations | **132** | 73 高亮 + 57 下划线 + 2 长难句 |
| favorites | 2 | 2 篇文章被收藏 |

### folders（16 条）

```
经济学人-日刊
├── 2021
│   ├── 2021.09
│   ├── 2021.10
│   ├── 2021.11
│   └── 2021.12 ← 8 篇经济学人文章
├── 2022 ~ 2026（空）
├── 2023
│   └── 2023.01（空）
经济学人-周刊（空）
科学美国人（空）
其他阅读
└── 考研英语真题题源阅读 ← 14 篇文章
```

### articles（22 条）

**考研英语真题题源阅读（14 篇）**

| # | 标题 | 批注数 | 翻译 |
|---|------|--------|------|
| 1 | Congress Must Pass Strong Federal Privacy Law... | 12 | - |
| 2 | Climate Change Threatens Australia... | 7 | - |
| 3 | Meta Threatens to Block News in California... | 4 | - |
| 4 | UK Unveils Tough New Laws to Tackle Online Harms | 2 | - |
| 5 | Britain's Startup Lifeline... | 10 | - |
| 6 | Supreme Court Rules States Cannot Keep Surplus Profits... | 7 | - |
| 7 | Rent control in Berlin | 5 | ✅ 6 段 |
| 8 | UK Two-Child Benefit Limit Hits 600,000 Children | 4 | ✅ 6 段 |
| 9 | Fewer veterans serve in Congress | 10 | - |
| 10 | Fake News Sites Used to Burnish Online Reputations... | 9 | - |
| 11 | Three-pronged attack | 2 | ✅ |
| 12 | Airbnb escapes the estate-agent tag | 0 | - |
| 13 | Connecticut's witches, posthumously exonerated | 0 | - |
| 14 | The Fed's $600bn conundrum | 0 | ✅ |

**2021.12 经济学人（8 篇）**

| # | 标题 | 批注数 |
|---|------|--------|
| 24 | The music business | 2 |
| 25 | Art review | 0 |
| 26 | Across the age gap Activism shrinks generation differences | 8 |
| 27 | Business in Japan at the sharp end | 13 |
| 28 | Digital health: Psyber Boom | **21** |
| 29 | SouthEast Asia: On the rails | 10 |
| 30 | Ride-hailing in London: Cost drivers | 6 |
| 31 | Charging electric cars | 0 |

### annotations（132 条）

| 类型 | 数量 | 说明 |
|------|------|------|
| `highlight`（黄色高亮） | 73 | E 键创建，自动填入查词释义 |
| `underline`（红色下划线） | 57 | W 键创建，自动填入查词释义 |
| `sentence`（红色字体） | 2 | r 键创建，自动填入对应句中文翻译 |

分布在 17 篇文章中（5 篇无批注）。批注通过 `article_id` 外键绑定文章，级联删除。

### 收藏（2 条）

2 篇文章已被收藏。文章卡片右上角书签图标切换收藏状态。

### 翻译（5 篇有翻译）

5 篇文章已导入中文翻译，导入后可在文章页按 S 键切换显示/隐藏。

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
| `faafd11` | fix: ManualWordCard查词防重复 + 点击选中清除 + ContentArea/ArticleCard样式优化 |
| `fec6ef1` | docs: 全量更新markdown — 移除验证码/回收站API补充/数据库表结构修正/提交记录同步 |
| `180ce80` | feat: 段落编号悬停显示+翻译提示仅在has-trans时显示 |
| `ea50665` | feat: 更新数据库备份 — 18篇文章/105条批注 |
| `1d12290` | fix: 修正数据概览 — 实际18篇文章/105条批注 |
| `42e38f6` | docs: 全量更新markdown — 数据概览修正+项目结构补充 |
| `28d8355` | feat: 段落翻译导入(S键切换)+文章编辑器修复+画布字号调节 |
| `c45e72c` | chore: 移除访问验证码; 修复启动脚本标签问题; 更新文档 |
| `80a95b3` | docs: 全量更新markdown文档 — 回收站/画布/字号调节/API更新 |
| `e0116ec` | fix: App.vue 多标签导航; feat: 字号调节+工具栏布局 |
| `83a3874` | feat: 画布线宽2px+空格切换颜色; 查词默认关闭; 注释快捷键修复 |
| `eb52ce4` | docs: 更新项目结构 — 新增 ArticlePage 拆分后的组件和 composables |
