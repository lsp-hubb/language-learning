# Language Learning — 项目架构文档

## 项目概述

**Language Learning** 是一个外语阅读辅助工具，帮助用户阅读英文文章并实时查词、添加批注、手绘标记。基于 **Vue 3 + Vite + Pinia** 前端和 **Express + MySQL** 后端构建。

### 核心功能

1. **文件夹管理** — 支持无限层级嵌套的文件夹，CRUD 操作，右键菜单
2. **外刊文章管理** — 在文件夹中创建、编辑、查看英文文章
3. **单页阅读视图** — 滚动阅读，两端对齐排版，滚动条在容器右侧
4. **智能单词查询** — 选中英文单词后，自动查询有道词典，弹出浮动词卡展示音标、释义；音标区鼠标悬停自动播放英式/美式发音；支持 T 键全局开关
5. **PDF 风格批注** — 黄色高亮(E键) + 红色下划线(W键)，悬停查看注释并自动播发音，点击编辑/自动填入查词结果，按 Delete 键删除，数据保存在 MySQL
6. **手绘画布** — R 键开启/关闭画布，支持画笔（Q 切换直线/波浪线）/矩形/矩形擦除/颜色切换，笔迹按文章 ID 存储在 MySQL
7. **收藏文章** — 文章卡片右上角 ★ 按钮，切换收藏状态，数据持久化
8. **外部链接面板** — 右侧悬浮面板嵌入 腾讯元宝 iframe，查阅文章时可快速翻译或提问
9. **访问验证** — 8 位一次性验证码，仅局域网其他设备需验证，本机免验证
10. **局域网共享** — 同一网络下多设备可同时访问，共享文章和批注数据
11. **阅读计时器** — 工具栏显示，点击切换开始/暂停/归零
12. **英文单词数统计** — 工具栏实时显示文章单词数
13. **手动查词卡片** — Ctrl+Shift+Z 打开，支持输入查词、一键复制、联想词下拉、任意拖动、位置记忆；查词结果自动播放英式发音，音标区可悬停切换英式/美式发音
14. **状态恢复** — 刷新/重启后自动回到上次浏览的文件夹或文章页面

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
├── .env                                # 环境变量（数据库配置）
├── .gitignore
├── start.bat                           # Windows 一键启动脚本 (前后端)
├── start-mysql.bat                     # MySQL 单独启动脚本
├── README.md
├── ARCHITECTURE.md                     # 项目架构文档
├── GIT_GUIDE.md                        # Git 使用指南
├── MySQL连接配置说明.md                 # 数据库配置文档
├── db/                                 # 数据库 SQL 备份（Git 跟踪）
│   └── language_learning.sql
│
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
│   │   ├── ArticlePage.vue             # 文章阅读/编辑页（含批注、查词、画布、链接面板、批注悬停发音）
│   │   └── ReviewPage.vue              # 复习页面（占位，待开发）
│   └── components/
│       ├── FileExplorer.vue            # 文件管理器主组件
│       ├── FolderTree.vue              # 左侧文件夹树
│       ├── ContentArea.vue             # 主内容区（文件夹+文章网格）
│       ├── ArticleCard.vue             # 文章卡片（收藏 ★/☆ + 复习 📝 按钮，新标签打开）
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
| `color` | VARCHAR(20) | 颜色（`#fff3b0` / `#e74c3c`） |
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
| POST | `/init` | 初始化数据库建表 + 迁移（含 favorites 表） |
| GET | `/health` | 健康检查（测试 MySQL 连接） |
| POST | `/verify-code` | 验证访问码 |

### 文件夹

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/folders` | 获取所有文件夹（扁平列表） |
| POST | `/folders` | 创建文件夹 `{ name, parentId }` |
| PUT | `/folders/:id` | 重命名文件夹 `{ name }` |
| DELETE | `/folders/:id` | 递归删除文件夹及其子文件夹 |

### 文章

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/article/:id` | 获取单篇文章 |
| GET | `/articles/:folderId` | 获取文件夹下所有文章（按标题排序） |
| POST | `/articles` | 创建文章 `{ title, content, folderId }` |
| PUT | `/articles/:id` | 更新文章（部分更新 `{ title?, content? }`） |
| DELETE | `/articles/:id` | 删除文章 |

### 批注

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/annotations/:articleId` | 获取文章的所有批注 |
| POST | `/annotations` | 创建批注（类型高亮/下划线，颜色固定，含注释） |
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
 ├── CodeGate.vue              —— 访问验证弹窗（全屏遮罩）
 └── <router-view>（验证通过后显示）
      ├── FileExplorer.vue ( / )
      │    ├── FolderTree.vue          —— 左侧文件夹树
      │    ├── ContentArea.vue         —— 中间内容区
      │    │    └── ArticleCard.vue    —— 文章卡片（含收藏 ★ 按钮）
      │    ├── ContextMenu.vue         —— 右键菜单
      │    ├── FolderDialog.vue        —— 文件夹对话框
      │    └── ArticleDialog.vue       —— 新建文章对话框
      │
      ├── ArticlePage.vue ( /article/:id )
     │    ├── WordCard.vue            —— 浮动查词卡片（选中查词，自动/悬停发音）
     │    ├── ManualWordCard.vue      —— 手动查词卡片（Ctrl+Shift+Z，联想词，自动发音）
     │    ├── AnnotationCard.vue      —— 浮动批注卡片
     │    ├── DrawCanvas.vue          —— 手绘画布（画笔/矩形/矩形擦除）
     │    └── 外部链接面板（内置, 腾讯元宝 iframe）
     │
     └── ReviewPage.vue ( /review/:id, 新标签)
          └── 复习功能（待开发）
```

---

## 手绘画布

画布组件 `DrawCanvas.vue` 提供在文章上手绘标记的功能：

- **快捷键**：`R` 开启/关闭画布
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
| R | 开关画布模式（画笔工具） |
| L | 开关右侧链接面板 |
| Ctrl+Shift+Z | 打开/关闭手动查词卡片 |
| Alt+1 | 切换单词查询开关 |
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

- 文章卡片右上角 ★ 按钮，点击切换收藏状态
- 后端 `favorites` 表，`article_id` 为主键且外键级联删除
- Pinia Store: `favoriteIds` (Set)、`loadFavorites()`、`isFavorited()`、`toggleFavorite()`
- 启动 `FileExplorer` 时自动调用 `store.loadFavorites()` 加载收藏数据
- API: `GET /api/favorites`（获取所有收藏 ID）、`POST /api/favorites/:articleId`（切换收藏）

---

## 外部链接面板

文章页工具栏右侧 `链接` 按钮，点击展开/收起悬浮面板：

- **面板宽度**：46vw，固定在视口右侧
- **内嵌链接**：腾讯元宝 iframe
- **页面收缩**：展开时阅读区自动缩小为 54vw
- **过渡动画**：面板展开/收起 CSS Transition

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

查询开关：T 键（全局），关闭时隐藏卡片且不触发查询
```

---

## 批注功能完整流程

### 创建批注

```
用户选中文本（可跨 span 边界） → 浮动工具栏出现 [🖍高亮] [U̲下划线]
    │
    ├── 点击高亮 / 按 E → createAnnotation('highlight', '#fff3b0')
    └── 点击下划线 / 按 W → createAnnotation('underline', '#e74c3c')
         │
         ├── 快捷键自动填入查词卡片释义（单词含完整释义，长句仅翻译）
         ├── 查词未完成时先创建批注，结果返回后补填注释（pendingNoteFill）
         ├── 工具栏点击留空注释手动输入
         ├── TreeWalker 精确计算偏移量（避免 indexOf 重复匹配）
         ├── 选区消失时回退到最后一次有效选区（lastSelection）
         ├── 检查与已有批注无重叠
         └── 存入 annotations[] + POST /api/annotations → MySQL
              │
              └── paragraphSegments computed 重新切分段落
                   └── <span class="annotated highlight|underline"> 渲染
```

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
  "color": "#fff3b0",
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

> 注意：每次 `start.bat` 重启都会生成新验证码，终端框下方有单独一行纯文本方便复制。
```

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

### 局域网访问

启动后终端显示 `Network: http://192.168.x.x:5173`，其他设备输入该地址 + 验证码即可访问。

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

## 状态持久化

| 存储方式 | 用途 |
|------|------|
| MySQL | 文件夹、文章、批注、收藏、画布笔迹数据 |
| `localStorage.lastPage` | 最后浏览的页面（文章/文件夹），重启后自动恢复 |
| `localStorage.lastFolderId` | 最后浏览的文件夹 ID |
| `sessionStorage.code_verified` | 验证码通过标记（仅当前会话） |

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

### folders（13 条）

```
经济学人-日刊
├── 2021
│   ├── 2021.09
│   ├── 2021.10
│   ├── 2021.11
│   └── 2021.12 ← 5 篇文章
├── 2022 ~ 2026（空）
经济学人-周刊（空）
科学美国人（空）
```

### articles（5 条，均在 2021.12）

| 编号 | 标题 | 大小 |
|------|------|------|
| 27 | Business in Japan at the sharp end | 4,890 bytes |
| 28 | Digital health: Psyber Boom | 4,300 bytes |
| 29 | SouthEast Asia On the rails | 3,078 bytes |
| 30 | Ride-hailing in London: Cost drivers | 2,424 bytes |
| 31 | Charging electric cars | 4,085 bytes |

### annotations（3 条，均在文章 27）

| 类型 | 内容 | 注释 |
|------|------|------|
| 高亮 | apprentice | 英/美音标 + n./v. 释义 |
| 下划线 | struck out | 短语释义 |
| 高亮 | foster | 英/美音标 + v./n./adj. 释义 |

所有注释均由快捷键自动填入完整查词结果。批注通过 `article_id` 外键绑定文章，级联删除。

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
| `177e18a` | chore: .gitignore 添加临时 SQL 文件排除 |
| `d74fd33` | feat: 添加数据库 SQL 备份到 `db/language_learning.sql` |
| `3dcaf73` | docs: 更新 markdown 文档 — 波浪线画笔(Q键), TTS清除调试日志, 查词保留连字符, 新增start-all.bat |
| `fb1a10c` | feat: TTS 发音代理 + warmup 预热 + keepalive；批注悬停发音；文章卡片重构；复习页占位 |
| `00ee46a` | feat: TTS 发音代理（服务端缓存）+ 查词卡片自动发音、音标区悬停播放 |
| `4c8c18f` | docs: 修复 markdown 文档问题 — 去重快捷键、移除不存在的引用、更新提交记录、统一 API 路径格式 |
