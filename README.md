# Language Learning

外语阅读辅助工具 — 读英文文章、查词、添加批注、画布标记。

## 功能

- **文件夹管理** — 无限层级嵌套，右键菜单（新建/重命名/删除），面包屑导航，刷新保持位置
- **回收站** — 右键文件夹「删除」把该文件夹**及其整棵子目录、其下全部文章**一起软删除（`deleted_at`）移入回收站，回收站面板可「♻️ 恢复」（无二次确认）或「🗑️ 永久删除」（红色危险确认框）；**单篇文章的删除是硬删除、不进回收站、不可恢复**（文章卡片右键 → 顶部通知条确认）。回收站无批量操作、无清空、无快捷键，内容不自动过期；三种操作均有成功提示，恢复 / 永久删后自动刷新回收站列表；后端单事务 + root 防护 + 环检测，永久删会先清笔迹不留孤儿行。实现与约束见 [recycle-bin.md](./docs/recycle-bin.md)
- **英文文章阅读/编辑** — 两端对齐排版，滚动条在容器右侧，支持编辑模式；工具栏 A−/A+ 调字号（12–32px，写入 `localStorage.fontSize`）；文章只能建在文件夹内，**根目录禁止新建文章**（前端禁用创建按钮，后端同时校验 `folderId` 为 `root`/空时拒绝）；文章卡片**右键可删除**，需在**顶部通知条上确认**后才会真正删除（防误删）；文章卡片右键菜单另提供「✏ 重命名」（就地编辑标题）与「📁 移动到…」（二级列表选目标文件夹）
- **逐段朗读** — 标题左侧「循环朗读全文」按钮，点击从第 1 段连续循环朗读（读到末尾自动回第 1 段，再点停止），朗读中按钮常亮；段首只保留两个按钮：「段循环」（先选中文字再点则循环选中内容、未选中直接点则循环整段，均跟随词级高亮；读到匹配的笔记句时联动跳到对应笔记卡片，无匹配则不跳）与「逐句循环」（笔记英文行定位到正文的句子循环；有选中内容则从选中句句首开始，跨句只取首句）；原「朗读本段」按钮已移除。笔记卡片右上角悬停显现「循环播放该句」按钮，复用逐句循环播该卡片对应正文句（定位不到则不播）。四类入口互斥，任一时刻只一处出声；朗读中按空格暂停 / 继续。正文拖选 / 有选区时朗读高亮冻结让位；全文回卷与段 / 句循环重播等自动续播不清选区。音频由**服务端 Edge TTS 合成并缓存**（默认 Andrew `en-US-AndrewNeural`，即微软「Microsoft Andrew Online (Natural)」；左侧工具条由小半圆钮点击手动展开 / 收起；在左侧「音频准备情况」面板点音色行可切换 Andrew / Emma `en-US-EmmaMultilingualNeural` / Ryan `en-GB-RyanNeural`（原工具条循环按钮已移除，切换不中断朗读、从下一个词起生效（按词偏移对齐续播）），选择持久化到本地）；**编辑文章保存后，仅当段落正文真的变化才重新预热三音色**（只改标题或仅换行 / 空白差异不重下；缓存 key 含文本，未变段落直接命中缓存，**不重复下载已成功的段**，带宽留给新文本与失败段；旧文本的无引用缓存文件由服务端自动清理），前端一次下载本地 `<audio>` 播放，**重复播放 / 跳转播放不再在线加载**、无延迟；**三级缓存**：服务端内存（上限 200 段）+ 服务端磁盘（`server/.tts-cache/`，按「文本+音色+语速」sha256 存 audio+词边界、原子写、无容量淘汰，启动 / 正文变更 / 文章永久删除后自动清理无引用文件）+ 前端模块级 blob（上限 120 段）+ 请求去重；磁盘缓存让**刷新页面、重启后端都不丢音频**，本地常驻、命中即读（实测 58ms）。**单进程并发合成**：批量接口把多段合并为一次 spawn，Python 进程内用 `asyncio.gather` 并发合成（4 段从多进程 ~7.3s 降到 ~2.9s），省掉每段重复启动进程 + import 的开销；**单段失败自动重试 3 次**（每次限时 20 秒、退避 1s / 2s，三次全失败才记失败）。**打开文章即后台预热 + 滑动窗口并发预取**：Edge TTS 单段合成约 6 秒是远程建连的固定开销（本地 import 仅 0.25 秒），点朗读瞬间无法消除。因此正文就绪后（`contentReadyTick`）即**后台预热全文音频**：按 **Andrew → Emma → Ryan 顺序串行**（默认音色优先，就绪后点播即秒开），每音色每批 20 段、切文章中断、缓存 key 含音色互不串味；进入文章时只弹一条**自动关闭**的短暂提示（延迟 600ms、3 秒后消失；全命中缓存时不闪消息），完成后再弹一条自动关闭的简短汇总，逐段进度与缓存来源在左侧「音频准备情况」面板查看，利用浏览时间提前合成并落盘；全文朗读时再叠加**滑动窗口预取**——播放当前段的同时经 `POST /api/tts/read/batch` 把后续 4 段一次并发合成，切段时 `prepare` 直接命中缓存秒开、不再「读一段合成一段」地在线等待；单段朗读不额外预取。批量内每段独立占位避免互相拖累。词级高亮由 Edge TTS 的 WordBoundary 时间戳驱动（**Edge 原生把 `since 2015` 当一个词单元**，数字与相邻词的分组由 TTS 权威给出，不再前端猜测）；**从选中位置开始**：正文选中文字后点该段朗读按钮即从选处读起（用整段缓存 + 时间戳 seek 跳转、不切片、秒开；选中背景保留到真正开播才消失）；**朗读中改选即重读**：朗读中选词松手立即从新选处重读；当前词黄底高亮并滚到视图中央、**覆盖**笔记命中蓝底；拖拽选词期间冻结高亮、仅词离开视口才瞬时滚动；单例（切段 / 停止 / 切文章自动停止），高亮全程数据驱动、不改写 DOM，批注结构不受影响。**音频准备情况查看器**：左侧工具条柱状图按钮开 / 关面板，只读展示当前文章三音色在内存 / 磁盘 / 生成中 / 未准备的段数、逐段来源与各音色音频缓存大小（不触发合成），面板开启时先检测一次、未全部就绪才每秒自动重测并在全部就绪后停止，发现未准备段且无在途合成时自动重试预热，面板内可一键预热，进入文章的后台预热完成后面板若开着也会自动刷新；点面板 ✕ 或面板以外区域均可关闭。依赖后端 Python 虚拟环境的 `edge-tts`（网络需可访问 Edge 语音服务），合成失败有错误提示。**逐句朗读（笔记英文行 → 正文句子）**：每段行首循环按钮下方另有「逐句朗读本段」按钮，把该段笔记英文行用 `findTextInParagraphs` 定位到正文句子后**循环朗读当前句**；`→` 下一句 / `←` 上一句可跨段切换、到头尾回绕、切完立即循环新句，句子按正文出现顺序排列（定位不到的笔记行跳过）；**读到哪句，右侧笔记面板就自动把对应笔记卡片滚到视图中央并加绿色描边高亮**（同一句循环重播不重复滚动，停止朗读自动撤销高亮；面板隐藏期间切句，重新显示时也会对准当前句）。依赖笔记已解析、句子在正文可定位，实现详见 [READ_ALOUD.md](./markdown/READ_ALOUD.md)
- **智能单词查询** — 选中单词自动查询有道词典（音标、释义，无释义时回退整段翻译），LRU 缓存（2000 条）+ 请求去重 + 8 秒超时，T 键全局开关（工具栏「查词」下拉的「自动查词」项等价）；开关状态持久化（记住退出前状态，下次进入文章页恢复）；音标区悬停播放英式/美式发音
- **手动查词卡片** — 默认开启（进入文章页即显示，工具栏「查词」下拉主按钮同步呈 `primary` 高亮）；Ctrl+Shift+Z 或工具栏「查词」下拉的「手动查词」项开/关；**开关状态持久化**（与「自动查词」一同存 localStorage，下次进入文章页恢复退出前状态，不再固定默认）；卡片显示时**不自动聚焦输入框**，避免抢占焦点影响 T / r / i 等单字母快捷键。支持输入查词、联想词下拉（↑↓/Enter/Esc）、一键复制、**清空**（清空输入与查询结果）、任意拖动、位置记忆、TTS 自动发音；卡片开启时正文选中文本自动填入查询
- **TTS 发音代理** — 服务端代理有道 dictvoice，MP3 缓存（500 条，插入顺序 FIFO、无 TTL）、请求去重、Keep-Alive 连接池；发起查词时即与释义查询并行预热发音缓存
- **PDF 风格批注** — E 高亮（屏幕为「经典荧光笔」渐变 `#fff9b0→#fff176`，参考 `标注方式大全.html` 的 `.mark-yellow`，数据色记 `#FFEB3B`）/ W 下划线（红色 `#e74c3c`），自动填入查词释义，**创建时自动裁掉选中文本两端的标点 / 引号**（如 `"Hypocrisy` 只标注 `Hypocrisy`，`text` 与 `(startOffset, endOffset)` 同步收缩；词内 `don't` / `well-known` 不变），悬停 200ms 查看注释并自动发音，点击编辑 textarea，Enter（Shift+Enter 换行）/失焦保存，Delete 删除
- **两种批注类型** — `highlight`（高亮）和 `underline`（下划线），可互相叠加，同类型不可重叠
- **PDF 导出** — 工具栏纯图标按钮（`src/components/icons/pdf文件.svg`，按钮内无「PDF」文字，功能与服务状态由悬停 `title` 提示），把正文与批注导出为 PDF：正文两端对齐且是可搜索的真实文本，批注落成 PDF 标准 Highlight / Underline 注释（悬浮可见批注内容），支持多页与跨行；**产物按五个独立片段顺序拼接，每个都从新的一页开始**：①「批注」——完全照网页三栏模式（三列、按正文顺序从上到下再从左到右），格内只放被标注原文，注释内容（含英 / 美音标、词性、释义）全部写进 PDF 标准 Highlight 注释，悬停即可查看且音标不再乱码；②「重点」（重点词汇，导出前实时读取 `articles.marks`，带 `#N` 编号）；③「句子」（收藏的笔记卡片内容拷贝，仅英文 + 中文，无词汇列表）；④ 文章正文（含原有批注）；⑤ 笔记全文（重点词汇标红）。PDF 导航目录为五个一级书签「批注 / 重点 / 句子 / 文章标题 / 笔记全文」，各指向该片段首页，打开即在阅读器目录跳转。由 Python 服务 `server/pdf_service.py`（端口 5057）生成，详见 [PDF_EXPORT.md](./markdown/PDF_EXPORT.md)
- **画布（选中即标注）** — **进入文章页默认开启**（`drawMode` 初值 `true`），Ctrl+R 开关（**开启后默认不激活工具**，canvas 不拦截鼠标，才能选中正文文本）；**已不支持手画**，笔迹只由选中文本生成；下划线样式**固定为红色波浪线 + 红色背景**（细密波浪 `#e06c75` + 半透明红底 `rgba(224,108,117,0.15)`，参考 `下划线.html` 的 `.wavy-bg`），无切换控件、快捷键或色板；旧格式笔迹加载时直接丢弃并覆盖入库、不再渲染；**选中即自动添加**（需先开启下方的自动加线开关，默认关）：在正文用左键选中文本，松手即按该样式在该行文字下方 5px 生成 `double` 笔迹（文字底部增加 2px，波浪线落在文字行盒底部下方），无需点按钮（跨行拆成多条；**自动加线开启时选区禁止跨段落**，关闭时选区可正常跨段落）；加线后自动清除选区，避免粉色选区与红底背景重叠割裂；**重合处理**：再次选中同一处（跨行按文本区间精确判定完全重合）→ 整组删除、不添加；部分重合 → 去掉所有重叠的原线，按本次选区重新添加；不重合 → 直接添加；旧格式笔迹加载即丢弃，不参与重合判断；橡皮擦（`1` 键 / 工具条按钮）保留，可擦除画笔笔迹；**正文区无选中文本时右键开 / 关「选中文本自动添加线」**（默认关；开启 / 关闭不再弹提示，左下状态按钮直接显示开 / 关）；笔迹按文章存 MySQL `canvas_strokes`，**每画一笔 / 删一笔 / 清空都立即入库**（串行写入、失败重试、页面关闭用 sendBeacon 兜底，切文章不会再丢），缩放自适应；选中自动线按段落字符区间锚点（与批注同款）记忆位置，A−/A+ 改字号后自动跟随（旧格式笔迹加载即丢弃）；与 W 下划线批注、PDF 导出完全独立
- **段落编号提示** — 鼠标悬停段落时在左侧显示「第 N 段」
- **收藏文章** — SVG 书签图标切换收藏，数据持久化
- **文件夹数据导入 / 导出（P0 + P1）** — 右键文件夹「导出文件夹…」或主区右键「导出全部文件夹…」下载纯 JSON 包（`.llfolder.json`，上限 100 MB）；「导入文件夹…」支持点击选择或**拖拽**数据包，预检后以统计卡片展示六类数据、跳过提示与卡片式目标位置选择。完整包含文件夹、文章（含 `notes` / `marks` / `type`）、批注、收藏、画布笔迹，不导回收站内容；ID 全量重生成、单事务、固定 `create-new`，支持导出整个 `root`。导入前 dry-run 校验引用完整性与批注偏移，详见 [FOLDER_IMPORT_EXPORT.md](./markdown/FOLDER_IMPORT_EXPORT.md)
- **统一反馈层** — 全站不再使用浏览器原生 `alert` / `confirm`：短消息统一为左上角卡片化 `ElMessage`（成功 / 失败 / 警告 / 进行中），导出与导入完成用带统计卡片的 `ElMessageBox` 结果弹窗，删除等不可逆操作用带红色危险按钮的确认弹窗；实现见 `src/utils/feedback.js`，外观在 `src/assets/base.css` 统一覆盖
- **右侧面板（AI / 笔记）** — 右侧悬浮面板（46vw），由工具栏「AI」「笔记」开关互斥切换显示内容（面板内无标签栏；默认展开并显示笔记面板），L 键切换 AI 面板、r 键切换笔记面板：
  - **AI** — 嵌入多个 AI 站点 iframe（元宝/豆包可嵌入，千问/DeepSeek 外部打开），可嵌入站点的 iframe 常驻 DOM、切换只显隐不重建，当前站点记忆在 `localStorage.sidePanelState`
  - **笔记** — 粘贴结构化笔记，自动解析为「英文/中文/词汇」卡片；**导入前逐句校验**：每张卡片的英文行须能在当前文章正文中定位到（忽略大小写与弯 / 直引号差异），全部命中才写入并弹出成功消息，否则取消导入并弹出失败消息（不渲染、不写库）；输入框内提供「解析并渲染 / 保存修改」主按钮与「全部删除」（确认框置于笔记面板内、遮罩不覆盖正文；二次确认后清空当前文章的全部笔记及其重点标记，已收藏的句子副本保留）、支持追加/修改全文（输入区以顶部弹出卡片形式出现）、导航跳转、**右键卡片重新录入单张**（自动回填该卡片原文，保存前做格式自检与整篇回环检测，异常不落库；本卡片原重点标记自动清空且落库）、单击词汇项标记/取消重点（变艳红加粗，词汇项不可选中避免误选；标记持久化在数据库 `articles.marks`）、右键单击复制词汇内容、**集中卡片** — 顶部「重点」按钮弹出一张**全屏**汇总卡片（顶满整个网页 `100vw × 100vh`，内部滚动），**首次默认展示三栏批注集中（只读）**，之后打开恢复上次退出前的视图（存 `localStorage.noteMarkedView`）：标题带「只读」标签，按正文出现顺序「从上到下、从左到右」铺成三列，每格只显示正文中被黄色高亮 / 红色下划线标注的原文（保留原视觉）；**只需悬停该行**即在行下方立即弹出只读注释卡片（复用 `AnnotationCard` 的 `readonly` 模式：仅查看注释，禁止编辑与 Delete 删除，无需点击、无 200ms 延时）；若该格文本是单个英文单词，悬停 200ms 后还会像正文批注一样自动播英式发音（去首尾标点、旧请求序号守卫，复用统一 TTS 的预下载与缓存）；卡片头部「批注 / 重点」**切换按钮**可切回原**重点集中**只读视图（集中显示所有重点词汇，带所属笔记编号 `#N`，单击在**右侧边栏**直接显示其所属的原笔记卡片；重点的增删仍在原笔记卡片中单击词汇进行）；正文选中/双击文本时自动查找匹配卡片并精确高亮文字段（查找词按单词边界自动补全为完整文本，边界含空白与连字符/破折号 `- – —`，避免 `power-hungry`/`him—and` 等被误判为一个词；笔记英文行的批注镜像与查找高亮也按完整词边界匹配，避免 `heir` 误挂到 `their`）、回车滚动到下一个；**反向联动** — 在笔记英文/中文区域选中文字，正文所有命中词高亮（半透明蓝底 `rgba(64,158,255,0.4)`、文字颜色继承）并滚动到第一个命中处，回车在正文命中间循环向后跳转，当前定位的命中用深蓝 `rgba(13,71,161,0.55)` 区分；**选区消失自动清除高亮** — 点击空白处使选区消失时，由 `App.clearActiveSearch()` 同时清除正文命中与笔记匹配两侧的高亮；**体积与保存** — 输入区实时显示整篇 UTF-8 字节数和剩余容量（请求体上限 2 MB），超限时阻止提交并提示需减少多少；保存失败会保留输入内容、回滚预览并显示具体原因（含后端错误信息）
- **阅读计时器** — 工具栏显示，点击切换开始/暂停/归零
- **英文单词数统计** — 工具栏实时显示文章单词数
- **批注工具栏** — 浮动批注栏**仅正文右键**弹出（选中文本后右键，左键选中只记录选区、不自动弹）；顶栏内嵌「高亮/下划线」按钮与浮动栏**互斥**——未右键过时显示内嵌按钮（选中文本后点击直接标注），右键过一次后改走浮动栏。顶栏已无 ▲/▼ 开关按钮。**手动点击高亮 / 下划线时自动读取剪贴板内容填入注释**（正文顶栏、正文右键浮动栏、笔记英文行浮动栏同源；填入后直接保存并显示注释，等效于在编辑框按回车；读取失败或为空则留空进入编辑态，E/W 快捷键仍自动填查词结果）
- **阅读区左侧工具栏** — 左缘小半圆钮（▶）悬停展开 4 个按钮：书签面板、音频准备情况、画布开关、批注章节横版（朗读音色改在「音频准备情况」面板内点选），移开自动收起；书签面板头部第一行显示当前文章所在文件夹名称（长名称省略、悬停可看全名）
- **重启恢复** — 刷新/重启后自动回到上次浏览的文件夹或文章页面（localStorage 持久化）
- **当前标签打开文章/复习页** — 首页点击文章卡片或复习 📜 按钮均通过路由跳转在当前标签页加载，不再新开标签页；原文界面（笔记侧栏可见时）按 Tab 可直接打开收藏集中卡片；复习页头部「查看原文」跳回原文文章页，批注 / 重点 / 句子三视图均用 Tab / Shift+Tab 循环切换
- **局域网共享** — 同一网络下多设备可同时访问，共享文章和批注数据（无验证码）
- **Python 脚本集成** — 后端通过 `child_process.spawn` 调用本地 Python 脚本，使用 `pythonw.exe` 无窗口运行（独立进程，不阻塞服务）；路径由 key 白名单固定，不接受用户输入
- **一键启动/停止** — `scripts/start-all.py` / `scripts/stop-all.py` 按端口幂等拉起/停止 MySQL、后端(3000)、前端(5173)、PDF 导出服务(5057)，并自动打开浏览器；Windows 下可直接双击 `scripts/bat/start-all.bat` / `scripts/bat/stop-all.bat` 静默启停（无 cmd 黑窗，日志在 `logs/`）
- **组件检查器** — Ctrl+I 开启，点击页面元素直达对应 `.vue` 源码（编辑器自动置前**默认关闭**，需设 `VITE_FOCUS_EDITOR=1` 开启，见 `docs/python-env.md`）
- **MySQL 数据库备份** — `db/language_learning.sql` 通过 Git 跟踪，方便换电脑迁移数据

## 从零开始的安装说明

### 1. 环境要求

| 依赖            | 版本要求              | 说明                                                                              |
| --------------- | --------------------- | --------------------------------------------------------------------------------- |
| **Node.js**     | ^20.19.0 或 >=22.12.0 | [下载](https://nodejs.org/)                                                       |
| **MySQL**       | 8.0                   | [下载](https://dev.mysql.com/downloads/installer/)                                |
| **npm**         | 随 Node.js 自带       | —                                                                                 |
| **Python**      | 3.11                  | 一键启停脚本、组件检查器跳转、PDF 导出（见[python-env.md](./docs/python-env.md)） |
| **Git**（可选） | —                     | 用于克隆仓库，[下载](https://git-scm.com/)                                        |

> PDF 导出需要 `fastapi` / `uvicorn` / `PyMuPDF` / `reportlab`；Python 虚拟环境位于**项目父目录**的 `.venv`（当前机器为 `D:\PythonFiles\.venv`，Python 3.11.3）。
> 未安装时 5057 服务仍可启动，但 `/health` 返回 `ok:false`、导出接口返回 500。
> 当前虚拟环境**已安装**这些依赖（5057 `/health` 返回 `ok:true`，PyMuPDF 1.28.2）；换机重建 venv 后需重新安装（见 `docs/python-env.md`）。

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

# 如果未运行，以管理员身份启动（服务方式）：
net start MySQL80

# 免管理员方式：运行 scripts/start-all.py 一键拉起全部服务（MySQL + 后端 + 前端）
#   —— start-all.py 优先用服务启动；非管理员时自动回退为直接启动 mysqld
#      （本项目 datadir 在项目目录内可写，普通用户即可拉起，无需管理员权限）
python scripts/start-all.py
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

#### 一键启动 / 停止（Python 脚本，推荐给 AI / 自动化场景）

```bash
# 按端口幂等拉起：MySQL(3306) → 后端(3000) → 前端(5173) → PDF 导出(5057)，就绪后自动打开浏览器
python scripts/start-all.py

# 按端口停止：前端(5173) → 后端(3000) → PDF 导出(5057) → MySQL
python scripts/stop-all.py
```

- 两个脚本的路径全部自动推导（项目根 = 脚本所在目录的上级），项目搬家不会失效
- 已监听的端口会跳过，不会重复拉起第二个实例
- 前端固定用 `node node_modules/vite/bin/vite.js`（不用 `npm run dev`）
- PDF 服务用 `python.exe` + `CREATE_NO_WINDOW` 启动（不用 `pythonw.exe`，否则 uvicorn 会因
  `sys.stdout is None` 静默崩溃）

> ⚠️ `stop-all.py` 会停止 MySQL：管理员权限下执行 `net stop MySQL80`，非管理员则强制结束监听 3306 的 `mysqld` 进程。
> 若本机 MySQL 实例上还跑着**其他项目**的数据库，请勿使用该脚本，改为手动关闭前后端终端窗口。

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

| 地址                      | 说明                                   |
| ------------------------- | -------------------------------------- |
| `http://localhost:5173`   | 本机访问                               |
| `http://192.168.x.x:5173` | 局域网（同一 WiFi/路由器）其他设备访问 |

> 本项目为纯本地部署，**无公网地址**。PDF 服务显式监听 `127.0.0.1`，MySQL 仅本机，Vite 前端监听 `0.0.0.0`；Express 后端 `app.listen(PORT)` 未指定 host，Node 默认监听所有网卡，但前端统一经 Vite 代理 `/api` 使用，无需向局域网直接暴露。

**服务端口一览**

| 端口 | 服务         | 绑定地址    | 说明                              |
| ---- | ------------ | ----------- | --------------------------------- |
| 3306 | MySQL80      | `127.0.0.1` | 数据库，仅本机                    |
| 3000 | Express 后端 | 未指定 host（`0.0.0.0`/`::`） | 经 Vite 代理（`/api` → 3000）转发 |
| 5173 | Vite 前端    | `0.0.0.0`   | 本机及局域网可访问                |
| 5057 | PDF 导出服务 | `127.0.0.1` | FastAPI，仅本机，前端直连不经代理 |

> PDF 导出服务只监听本机，局域网设备**无法**使用该功能。
> 未启动 5057 时，工具栏 PDF 按钮显示红灯并提示，其余功能不受影响。

#### 谁能访问（局域网范围说明）

前端监听 `0.0.0.0:5173`，因此**同一局域网（同一 WiFi / 同一路由器下的有线设备）**的其他设备能用本机局域网 IP 访问；以下情况**不能**访问：

- 不同 WiFi / 不同路由器下的设备
- 使用移动数据（4G/5G）的手机
- 开启了"访客网络"隔离的 WiFi 设备
- 公网任意设备（除非额外做内网穿透 / 部署到云服务器）

> 简单记：**同一 WiFi 或同一路由器 = 能连；跨网络或用流量 = 不能。**

#### 获取本机局域网地址

启动 `scripts/start-all.py` 时终端会打印类似：

```
  ➜  Network:   http://192.168.1.23:5173
```

把该 `http://192.168.x.x:5173` 地址发给同一 WiFi 下的设备即可访问。
也可手动查询本机 IP：

```cmd
ipconfig | findstr /i "IPv4"
```

#### 局域网访问（首次需开放防火墙）

首次让其他设备访问前，需在本机放行 5173 端口入站：

```cmd
netsh advfirewall firewall add rule name="Vite5173" dir=in action=allow protocol=TCP localport=5173
```

> 注意：PDF（5057）显式只监听 `127.0.0.1`，**局域网设备用不了 PDF 导出**；局域网设备访问前端时 `/api` 经 Vite 代理到本机 3000 正常可用（后端未指定 host，实际监听所有网卡，请注意防火墙放行范围）。

### 7. 换电脑后恢复数据

> **整包复制到新电脑**（含重装 Node/Python 依赖、改硬编码路径、导入数据库）请见专用指南：[docs/migrate-to-new-pc.md](./docs/migrate-to-new-pc.md)。
>
> 当前 MySQL 的 `datadir` 已指向项目内的 `mysql-data/`，数据随项目目录走；换机时既可整包复用该目录，也可用下面的 `db/language_learning.sql` 导入。

项目根目录的 `db/language_learning.sql` 是数据库数据备份（通过 Git 同步；不含 `CREATE DATABASE` / `USE`，`type` / `marks` 等列由后端启动后补齐），在新电脑上按以下步骤恢复：

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

> 每次新增文章或数据后，建议重新导出更新备份：
>
> ```bash
> mysqldump -u root --databases language_learning > db/language_learning.sql
> git add . && git commit -m "feat: 更新数据库备份" && git push
> ```

## 项目结构

```
Language-learning/
├── server/                  # 后端
│   ├── db.js                # 数据库连接池
│   ├── index.js             # Express API 路由（所有业务逻辑，端口 3000）
│   ├── pdf_export.py        # PDF 导出核心：reportlab 排版 + PyMuPDF 写注释（只管正文 + 批注）
│   ├── notes_pdf_export.py  # 笔记侧各片段独立排版（批注 / 重点 / 句子 / 笔记全文）+ 合并
│   └── pdf_service.py       # PDF 导出服务（FastAPI，端口 5057）
├── src/                     # Vue 3 前端
│   ├── views/
│   │   ├── ArticlePage.vue  # 文章阅读/编辑页（编排层）
│   │   └── ReviewPage.vue   # 复习页面（复用 NotePanel 的收藏全屏面板：批注/重点/句子）
│   ├── components/
│   │   ├── FileExplorer.vue # 文件管理器主页
│   │   ├── FolderTree.vue   # 左侧文件夹树
│   │   ├── ContentArea.vue  # 中间内容区域
│   │   ├── ArticleCard.vue  # 文章卡片（收藏 SVG 书签图标 + 右键重命名/移动到文件夹）
│   │   ├── ArticleToolbar.vue   # 顶部工具栏
│   │   ├── ArticleReader.vue    # 文章阅读器（段落/批注/画布）
│   │   ├── ArticleEditor.vue    # 文章编辑器
│   │   ├── AnnotToolbar.vue     # 浮动批注工具栏
│   │   ├── WordCard.vue         # 自动查词卡片
│   │   ├── ManualWordCard.vue   # 手动查词卡片
│   │   ├── AnnotationCard.vue   # 批注详情卡片
│   │   ├── BookmarksPanel.vue   # 书签面板
│   │   ├── DrawCanvas.vue       # 画布绘制组件
│   │   ├── PdfExportButton.vue  # PDF 导出按钮（直连 5057，含服务状态指示灯）
│   │   ├── NotePanel.vue        # 结构化笔记面板（解析生文本 → 英文/中文/词汇卡片）
│   │   ├── FolderDialog.vue     # 文件夹创建/重命名弹窗
│   │   ├── ArticleDialog.vue    # 新建文章弹窗
│   │   ├── ContextMenu.vue      # 右键菜单（含导出 / 导入入口）
│   │   ├── CodeGate.vue         # 空组件（验证码已移除，挂载即放行）
│   │   ├── icons/               # SVG 图标（edit.svg / import.svg；手动查词卡片：复制.svg「复制全部」/ 清空.svg「清空」/ 搜索.svg 查询按钮；pdf文件.svg PDF 导出按钮）
│   │   └── __tests__/           # 组件单元测试（FileExplorer.spec.js）
│   ├── composables/
│   │   ├── useWordLookup.js     # 单词查询 + 文本选择
│   │   ├── useAnnotations.js    # 批注 CRUD + 工具栏/卡片 UI
│   │   ├── useCanvas.js         # 画布模式/工具/颜色
│   │   ├── useTimer.js          # 阅读计时器
│   │   └── useArticleContextMenu.js # 文章卡右键菜单 / 顶部删除确认通知共享状态
│   ├── api/index.js          # API 请求封装
│   ├── utils/                # 公共工具
│   │   ├── selectionText.js  # 选中文本补全 + 正文匹配高亮公共工具
│   │   ├── normalizeQuotes.js # 弯引号 → 直引号统一清洗
│   │   └── __tests__/        # notePanelReverse.spec.js / selectionText.spec.js
│   ├── stores/fileExplorer.js # Pinia 状态管理
│   ├── router/index.js       # 路由配置
│   └── assets/               # 全局样式
├── db/
│   └── language_learning.sql # 数据库备份（Git 跟踪）
├── docs/                     # 辅助技术文档
│   ├── MySQL连接配置说明.md   # 数据库配置与表结构
│   ├── python-env.md         # Python 虚拟环境说明
│   ├── recycle-bin.md        # 回收站功能说明
│   └── migrate-to-new-pc.md  # 换电脑部署指南
├── markdown/
│   ├── ARCHITECTURE.md       # 项目架构文档（详细）
│   ├── ANNOTATION_MIRROR.md  # 正文 / 笔记英文行批注镜像实现说明
│   ├── GIT_GUIDE.md          # Git 使用指南
│   ├── TXT_IMPORT.md         # TXT 文章批量导入指南
│   └── PDF_EXPORT.md         # PDF 导出功能（reportlab + PyMuPDF）
├── scripts/                  # 运维 / 导入脚本
│   ├── start-all.py          # 一键启动（MySQL + 后端 + 前端 + PDF 服务）并打开浏览器
│   ├── stop-all.py           # 一键停止（前端 → 后端 → PDF 服务 → MySQL）
│   ├── restart-backend.py    # 只重启后端（3000）
│   ├── restart-pdf.py        # 只重启 PDF 服务（5057；改了 server/*.py 用这个，start-all 会因端口已监听而跳过）
│   ├── focus_editor.py       # 组件检查器跳转后把编辑器窗口置前（默认关闭，需 VITE_FOCUS_EDITOR=1）
│   ├── reimport_all.cjs      # TXT 批量导入（一次性脚本）
│   └── bat/                  # 双击入口（静默启停，无 cmd 黑窗）
│       ├── start-all.bat     # 双击启动，日志 logs\start-all.log
│       └── stop-all.bat      # 双击停止（停 MySQL 需管理员），日志 logs\stop-all.log
├── public/                   # 静态资源（favicon.ico、list.png 书签图标）
├── start.bat                 # Windows 一键启动（前后端）
├── .env                      # 环境变量（需自行新建，已 .gitignore）
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

| 快捷键              | 功能                                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| E / W               | 高亮 / 下划线（对当前选区；已有同类型标记重叠时跳过创建，不取消已有标记） |
| T                   | 全局开关单词查询（工具栏「查词」下拉 →「自动查词」）                                                       |
| Ctrl+R              | 开关画布模式                                                           |
| L                   | 切换 AI 助手面板（与点击 AI 按钮等价）                                 |
| r                   | 切换笔记面板（与点击笔记按钮等价）                                     |
| i                   | 开关书签索引面板（与点击左侧书签按钮等价）                              |
| Ctrl+Shift+Z        | 打开/关闭手动查词卡片（默认开启，首次按下为关闭；工具栏「查词」下拉 →「手动查词」等价）                    |
| Ctrl+I              | 开关 Vue 组件检查器（`vite-plugin-vue-devtools`，见 `vite.config.js`） |
| 1                   | 橡皮擦（再按一次关闭工具）                                             |
| 正文右键（无选区） | 开 / 关「选中文本自动添加线」                                          |
| Esc                 | 取消文本选中 / 关闭查词卡片 / 关闭批注卡片与浮动工具栏（**不关画布、不关手动查词卡片**） |
| Delete / Backspace  | 删除当前查看的批注（编辑中的 textarea 内不拦截）     |
| Ctrl+Enter / Ctrl+S | 编辑模式下保存更改（标题输入框绑 Ctrl+Enter；编辑态下 Ctrl+S 由 `ArticlePage.onAnnotShortcut` 全局捕获，同样会保存） |
| Enter               | 有反向正文高亮则在命中间循环跳转，否则笔记匹配卡片滚动到下一个（输入框内不拦截）；逐句循环播放时 Enter 走原有翻页逻辑 |
| Enter / Shift+Enter | 笔记输入区内：解析保存 / 换行                                          |
| Tab / Shift+Tab     | 原文界面（笔记侧栏可见、集中卡片未打开）快速打开收藏集中卡片；打开后在「批注 / 重点 / 句子」三视图间循环切换（输入框内不拦截） |
| C / Z（悬停某段时） | C：启动该段循环朗读（该段有选中内容则循环选中内容、否则循环整段；读到匹配笔记句时联动跳卡片），再按停止；Z：启动该段逐句朗读（有选中内容则从选中句句首开始），再按停止。等价于点段首对应按钮，输入框内不拦截 |
| Z（悬停笔记卡片时） | 循环朗读该卡片英文对应的正文句（等价点卡片右上角循环按钮），再按停止；该句在正文定位不到则不播 |
| ↑ / ↓（重点集中视图） | 在左侧重点词汇列表逐项切换选中，右侧边栏笔记卡片同步切换并滚入视野 |
| Z（重点集中视图） | 循环朗读右侧边栏当前笔记对应的正文句（等价点侧栏朗读按钮），再按停止 |
| → / ←（逐句朗读中） | 下一句 / 上一句，可跨段；切完立即循环朗读新句、到头尾回绕（输入框内不拦截） |
| ↑ / ↓ / Enter | 手动查词卡片联想词导航与选中（**联想层不响应 Esc**，Esc 由文章页全局处理） |

> 画布通过工具栏「✓ 完成」按钮或再次按 Ctrl+R 关闭（关闭时自动保存笔迹）；Esc 不关闭画布。
> **鼠标右键（画布开启时）**：在正文面板内且**没有选中任何文本**时，右键开/关「选中文本自动添加线」（只翻转 `autoAddLines`，画布与工具激活状态都不变）；有选中文本时右键仍是原来的手动注释浮栏；未开启画布时右键完全走原逻辑。右侧 AI / 笔记面板、输入区、画布工具条、左侧小工具栏内的右键均不受影响。

**生效边界**：

- 焦点在**右侧面板**（AI iframe / 笔记面板）内时，**控制类**快捷键（T / Ctrl+Shift+Z / Ctrl+R / Space / L / r / i）**仍然生效**——它们由 `ArticlePage.onAnnotShortcut` 的前置段处理，不参与侧栏让位。只有依赖正文选区的 `E` / `W` 让位给 `NotePanel`（笔记英文行的标注由它内部处理，面板内的 Enter / Esc 同理）。
- 画布工具激活时，`r` / `i` / `E` / `W` / `T` 失效；`2` / `Q` 仍可用（只需画布模式开启）；`1` / `3` 不生效。
- `Esc` 与 `Ctrl+Shift+Z` 在输入框内**仍然生效**（其它文章快捷键在输入框内被吞掉）。
- `Ctrl+R` 未排除 Shift，Ctrl+Shift+R 也会切换画布。

**侧栏内复用（笔记 / AI 面板内，无需切回正文即可开关）**：以下**控制类**快捷键由 `ArticlePage.onAnnotShortcut` 的前置段统一处理，不参与侧栏 / 笔记选区让位，故焦点落在右侧面板内时同样生效：

| 快捷键 | 功能 | 处理位置 |
|--------|------|----------|
| T | 开关自动单词查询 | `ArticlePage.onAnnotShortcut` 前置段 |
| Ctrl+Shift+Z | 开关手动查词卡片（默认开启；无视输入框） | `ArticlePage.onAnnotShortcut` 前置段 |
| Ctrl+R | 开关画布 | `ArticlePage.onAnnotShortcut` 前置段 |
| L | 切换 AI 助手面板 | `ArticlePage.onAnnotShortcut` 前置段 |
| r | 切换笔记面板（在笔记内按即收起自身） | `ArticlePage.onAnnotShortcut` 前置段 |
| i | 开关书签索引面板 | `ArticlePage.onAnnotShortcut` 前置段 |

守卫：焦点在 INPUT / TEXTAREA 内时，单字母（T / L / r / i）与 Ctrl+R / Space 不触发（保护输入）；Ctrl+Shift+Z 按正文习惯无视输入框仍生效。笔记英文行的 e / w 标注仍由 `NotePanel` 原有监听处理。

## 技术栈

| 层级       | 技术                                      | 版本  |
| ---------- | ----------------------------------------- | ----- |
| 前端框架   | Vue 3 (Composition API +`<script setup>`) | ^3.5  |
| UI 组件库  | Element Plus（全局注册，中文 locale）     | ^2.14 |
| 构建工具   | Vite                                      | ^8.0  |
| 状态管理   | Pinia                                     | ^3.0  |
| 路由       | Vue Router                                | ^5.0  |
| 后端框架   | Express                                   | ^5.2  |
| 数据库     | MySQL (mysql2/promise)                    | ^3.22 |
| 代码格式化 | Prettier                                  | 3.8.3 |
| 单元测试   | Vitest + @vue/test-utils + jsdom          | —     |
| E2E 测试   | Playwright                                | —     |

其他集成：

- **有道词典** — 服务端 HTML 解析，LRU 缓存 2000 条，请求去重，8 秒超时
- **TTS 发音** — 服务端代理有道 dictvoice，MP3 缓存 500 条，Keep-Alive 连接池
- **Python 3.11** — 虚拟环境为项目父目录下的 `.venv`（当前机器 `D:\PythonFiles\.venv`），后端用 `child_process.spawn` 调用 `pythonw.exe` 无窗口运行脚本
- **PyMuPDF + reportlab** — PDF 导出：reportlab 两端对齐排版，PyMuPDF 写 Highlight / Underline 注释
- **腾讯元宝 / 豆包** — 右侧 iframe 嵌入用于翻译/提问
- **VS Code / CodeBuddy** — 组件检查器点击后直接 `spawn` 编辑器 exe 并 `--goto` 定位（`vite.config.js` 自定义中间件，避免弹 cmd 黑窗）

## 脚本命令

| 命令                 | 说明                                       |
| -------------------- | ------------------------------------------ |
| `npm run dev`        | 启动 Vite 开发服务器（前端，监听 0.0.0.0） |
| `npm run dev:server` | 启动 Express 后端                          |
| `npm run build`      | 生产构建                                   |
| `npm run preview`    | 预览生产构建                               |
| `npm run test:unit`  | 运行 Vitest 单元测试                       |
| `npm run test:e2e`   | 运行 Playwright E2E 测试                   |
| `npm run format`     | Prettier 代码格式化                        |

## 数据库表（5 张）

| 表               | 说明                                              |
| ---------------- | ------------------------------------------------- |
| `folders`        | 文件夹（含`deleted_at` 支持回收站）               |
| `articles`       | 文章（含 `notes` 笔记生文本（`MEDIUMTEXT`）、`deleted_at` 回收站；`type` / `marks` 由后端启动 IIFE 幂等补列） |
| `annotations`    | 批注（highlight/underline 两种类型）              |
| `favorites`      | 收藏（article_id 主键，级联删除）                 |
| `canvas_strokes` | 画布笔迹（JSON 存储，每篇文章一条）               |

> `paragraph_notes` 等旧列已从当前 SQL 备份与代码中移除；`annotations.type` 当前只写入 `highlight` / `underline`（`sentence` 为历史取值）。

## 文档

| 文件                                                | 说明                                                 |
| --------------------------------------------------- | ---------------------------------------------------- |
| [ARCHITECTURE.md](./markdown/ARCHITECTURE.md)       | 项目架构文档（详细架构、API 列表、数据流、组件关系） |
| [ANNOTATION_MIRROR.md](./markdown/ANNOTATION_MIRROR.md) | 正文 / 笔记英文行批注互为镜像的实现说明          |
| [GIT_GUIDE.md](./markdown/GIT_GUIDE.md)             | Git 使用指南                                         |
| [TXT_IMPORT.md](./markdown/TXT_IMPORT.md)           | TXT 文章批量导入指南（`scripts/reimport_all.cjs`）   |
| [PDF_EXPORT.md](./markdown/PDF_EXPORT.md)           | PDF 导出功能（两阶段实现、批注定位、踩坑记录）       |
| [FOLDER_IMPORT_EXPORT.md](./markdown/FOLDER_IMPORT_EXPORT.md) | 文件夹数据导入 / 导出方案与实现说明（P0 + P1 已实现） |
| [MySQL连接配置说明.md](./docs/MySQL连接配置说明.md) | 数据库配置说明（含表结构 DDL）                       |
| [python-env.md](./docs/python-env.md)               | Python 虚拟环境说明                                  |
| [recycle-bin.md](./docs/recycle-bin.md)             | 回收站功能说明                                       |
| [migrate-to-new-pc.md](./docs/migrate-to-new-pc.md) | 换电脑部署指南（整包复制：重装依赖 / 导入数据库 / 启动验证） |
