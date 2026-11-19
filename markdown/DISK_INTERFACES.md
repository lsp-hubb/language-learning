# Language Learning — 磁盘 / 运行时接口清单

> 本文只盘点「与本机磁盘、操作系统、外部运行时真正打交道」的接口——Python 解释器、文件路径、进程启停、EXE 探测、端口占用、本地缓存与下载。纯业务逻辑（增删改查接口、快捷键、UI 交互）不属于本文范围，见 [ARCHITECTURE.md](./ARCHITECTURE.md)。
>
> 文中路径以项目根 `d:\PythonFiles\Language-learning`（下称 `<项目根>`）为基准；`server/` 下文件同时给出相对路径与行号，便于 `code` 跳转。

## 给接手 AI 的阅读指引

- **要定位某个接口**：直接跳 [§12 接口逐项卡片](#12-接口逐项卡片ai-接手主参考)，每个接口都有唯一 ID 与固定字段（位置 / 作用 / 当前值 / 覆盖方式 / 移植动作 / 失败症状）。
- **要按任务反查「改哪里」**：看 [§12.1 任务速查表](#121-任务速查表改什么--去哪改)。
- **要把项目搬到新电脑**：按 [§13 移植执行清单](#13-移植执行清单ai-执行用) 逐步勾选，每步都给出接口 ID 与验证方法。
- **要理解原理与背景**：§1–§11 是按主题组织的详解与可行性评估，作为卡片章节的补充说明。
- **行号会漂移**：所有 `文件:行号` 基于本次核对时的代码。若跳转后行号不对，用接口卡片里给出的**代码特征串**（如 `PYTHON_HOME`、`PORT = 5057`）全文搜索重新定位。

---

## 0. 一句话总览

| 类别 | 触点 | 落点 |
|------|------|------|
| Python 解释器 | 3 处独立探测 | `<父目录>\.venv\Scripts\python.exe` / `pythonw.exe`、`PATH`、`ProgramFiles` |
| 数据表 | MySQL 8.0 服务 | `datadir` = `<项目根>\mysql-data\`，随项目走 |
| 磁盘缓存 | Edge TTS 音频 | `server\.tts-cache\<sha256>.json`，跨重启常驻 |
| 文档产物 | PDF 导出 | **全内存** `BytesIO` → HTTP 响应字节，不落盘 |
| 日志 | 启动 / 重启脚本 | `<项目根>\logs\*.log`（运行时创建，已 gitignore） |
| 配置 | `.env` | 项目根，需自行新建，已 gitignore |
| 浏览器下载 | 文件夹包 / PDF | `Blob` + `URL.createObjectURL` + `<a download>.click()` |
| 本地状态 | `localStorage` | 9 个键，见 §5.7 |
| 端口 | 3306 / 3000 / 5173 / 5057 | 启停脚本用 `netstat -ano` + `taskkill` 管理 |

---

## 1. 端口与服务总览

| 端口 | 服务 | 实现 | 绑定地址 | 由谁拉起 | 磁盘关联 |
|------|------|------|----------|----------|----------|
| 3306 | MySQL 8.0 | `mysqld.exe` + 服务 | 本机 | `start-all.py` / `net start MySQL80` | `datadir=<项目根>\mysql-data` |
| 3000 | Express 后端 | `node server/index.js` | 所有网卡（`app.listen(PORT)` 未指定 host） | `start-all.py` / `restart-backend.py` | 加载 `.env`；写 TTS 磁盘缓存、日志 |
| 5173 | Vite 前端 | `node node_modules/vite/bin/vite.js` | `0.0.0.0`（LAN 可达） | `start-all.py` | 探测编辑器 EXE / pythonw；打印 LAN IP |
| 5057 | PDF 服务 | `<venv>\python.exe server/pdf_service.py` | `127.0.0.1`（仅本机） | `start-all.py` / `restart-pdf.py` | 全内存处理，不写盘 |

- 端口常量：`scripts/start-all.py:39-42`（`BACKEND_PORT=3000 / FRONTEND_PORT=5173 / MYSQL_PORT=3306 / PDF_PORT=5057`）。
- 端口占用判定统一为：`netstat -ano` 中匹配 `:<port> ` + `LISTENING`，取行末 PID。证据：`scripts/start-all.py:101-103`、`scripts/stop-all.py:69-81`、`scripts/restart-backend.py:83-99`、`scripts/restart-pdf.py:92-108`。
- 后端监听：`server/index.js:23` `const PORT = process.env.SERVER_PORT || 3000`；`:1332-1333` `app.listen(PORT)`。
- 前端代理：`vite.config.js:203-208` `/api → http://localhost:3000`（`changeOrigin:true`）。
- 5057 绑定：`server/pdf_service.py:91` `PORT = 5057`；`:264` `uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")`。
- 局域网地址：由 Vite 启动横幅输出（如 `Network: http://192.168.1.23:5173`）；`README.md:218` 给出 `ipconfig | findstr /i "IPv4"` 手动查法。防火墙放行：`README.md:221-227` 的 `netsh advfirewall firewall add rule name="Vite5173" ... localport=5173`。

---

## 2. Python 运行时接口

项目里有多条彼此独立的 Python 调用链，各自解析解释器路径，互不相通。换机时逐条检查。原「后端拉起 GUI 脚本」链（`POST /api/run-python` + `PYTHON_SCRIPT_DIR` + `clipboard_to_txt.py`）已随按钮改造整体移除，相关代码与配置项均已清除。

### 2.2 后端朗读合成：Edge TTS 子进程

| 项 | 值 |
|----|----|
| 源文件 | `server/ttsCache.js:9-18`（常量）、`server/index.js:1090`（`synthTtsBatch()`） |
| Python 脚本 | `:971` `READ_TTS_SCRIPT = <server 目录>\tts_synth.py`（与后端同目录，随项目走） |
| 可执行文件 | `:1101` `<PYTHON_HOME>\Scripts\python.exe`（**python.exe，因为要读 stdout**） |
| 启动方式 | `:1109-1116` `spawn(..., { stdio:['pipe','pipe','pipe'], windowsHide: true, env:{...process.env, PYTHONUTF8:'1', PYTHONIOENCODING:'utf-8'} })` |
| 无黑窗 | `windowsHide: true` → `CREATE_NO_WINDOW`；注释明确不能用 `pythonw`（stdout 为 `None`） |
| 传参 / 取参 | `:1142` 向 `stdin` 写一行 JSON；stdout 读一行 JSON；脚本侧 `server/tts_synth.py:90-95` `sys.stdin/stdout.reconfigure(encoding='utf-8')`、`:32-34` `_json_dump()` 用 `ensure_ascii=True` 纯 ASCII 输出 |
| 超时 | `:1121-1124` `30000 + 3*20000 + 3000 = 93s`，超时 `proc.kill()` |
| 状态查看（只读） | `:1296` `POST /api/tts/read/status` + `:1000` `readTtsDiskHas()`：仅查内存 / 磁盘 `.json` 存在性 / 进行中合成，**不 spawn、不合成**（供「音频准备情况查看器」） |

### 2.3 Vite 探测 pythonw：编辑器窗口置前

- `vite.config.js:2` `import { spawn, execSync } from 'node:child_process'`。
- `vite.config.js:84-95` `canRunFocus()`：`execSync('"<pyw>" -c "import win32gui"', { windowsHide: true })` 实测候选 pythonw 能否导入 `pywin32`。
- `vite.config.js:97-115` `resolvePythonw()` 候选顺序：`<项目根>\.venv\Scripts\pythonw.exe` → `<父目录>\.venv\Scripts\pythonw.exe` → `where pythonw`，逐个 `canRunFocus` 校验。
- `vite.config.js:115-118` `pythonw = resolvePythonw()`；`focusEnabled = (process.env.VITE_FOCUS_EDITOR === '1')`，**默认关闭**。
- `vite.config.js:166-171` `spawn(pythonw, [focusScript, '--process', procName, '--file', pathname, '--root', APP_ROOT], { detached:true, windowsHide:true, stdio:'ignore' })` + `unref()`。
- 被调脚本 `scripts/focus_editor.py`：`:34-47` stdout/stderr `reconfigure(encoding='utf-8', errors='replace')`；缺 `pywin32` 时 `sys.exit(3)`。

### 2.4 启动 / 重启脚本中的 Python 探测

| 脚本 | 探测逻辑 |
|------|----------|
| `scripts/start-all.py:315-333` `detect_python()` | 优先 `<父目录>\.venv\Scripts\python.exe` → `shutil.which("python")`；文档串明确「python.exe + CREATE_NO_WINDOW，不用 pythonw」 |
| `scripts/start-all.py:291-312` `_python_can_run_pdf()` | `subprocess.run([py,'-c','import fastapi, uvicorn, fitz, reportlab'], creationflags=CREATE_NO_WINDOW, timeout=30)` 检查 `returncode==0` |
| `scripts/restart-pdf.py:30-31,52-78` | 同 `start-all.py`，PDF 服务用 `python.exe` + `CREATE_NO_WINDOW` |
| `scripts/bat/start-all.bat:46,50-52` | `set PYTHONUTF8=1`；`VENV_PY=D:\PythonFiles\.venv\Scripts\python.exe`，不存在回退 `python`；`:20-21` 注释警告不要改成 pythonw |
| `scripts/bat/stop-all.bat:50-56` | 同上 |
| `server/pdf_service.py:47-60` | 文档给出启动命令 `"D:\PythonFiles\.venv\Scripts\python.exe" server\pdf_service.py`；`:57-60` `sys.stdout/stderr is None` 时用 `open(os.devnull,'w')` 兜底（pythonw 场景） |

### 2.5 其它硬编码 Python 相关路径

- `scripts/reimport_all.cjs:8` `const TXT_DIR = process.env.TXT_DIR || 'D:\\PythonFiles\\temp\\2021.10分散';`（一次性 TXT 导入脚本，非日常运行路径）。
- 全仓搜索**未发现** `sys.executable` 的使用——所有路径由 `PYTHON_HOME` / `detect_python()` / `shutil.which` 推导。

---

## 3. 磁盘文件与目录接口

### 3.1 MySQL 数据目录与服务

| 项 | 证据 | 说明 |
|----|------|------|
| 服务名 | `scripts/start-all.py:66-86` `detect_mysql_service()` | `sc query type= service state= all \| findstr /I "MySQL"`，优先 `MySQL80`，否则首个 `MySQL*`，兜底 `"MySQL80"` |
| `mysqld.exe` 路径 | `scripts/start-all.py:200-211` `detect_mysqld()` | `shutil.which("mysqld")` → `C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe` 等 |
| `my.ini` 路径 | `scripts/start-all.py:214-222` `detect_my_ini()` | `C:\ProgramData\MySQL\MySQL Server 8.0\my.ini` 或从 mysqld 目录反推 |
| datadir | `scripts/start-all.py:228-229` 注释、`docs/migrate-to-new-pc.md:264-273` | `datadir=D:/PythonFiles/Language-learning/mysql-data`，**数据随项目走** |
| 启动流程 | `scripts/start-all.py:225-268` `start_mysql()` | 先 `net start {MYSQL_SVC}`；失败回退 `Popen([mysqld, --defaults-file=...], creationflags=CREATE_NO_WINDOW\|CREATE_NEW_PROCESS_GROUP)`；`time.sleep(3)` 后复查 3306 |
| 停止流程 | `scripts/stop-all.py:99-125` | 管理员 `net stop {MYSQL_SVC}`；非管理员 `kill_by_port(3306, ...)` 强杀 mysqld（服务账号运行时可能失败） |
| 数据备份 | `db/language_learning.sql:1-5` | MySQL dump 8.0.46，Host `127.0.0.1`，Database `language_learning`（约 308 KB，Git 跟踪） |
| 备份命令 | `README.md:260`、`markdown/ARCHITECTURE.md:1225`、`docs/MySQL连接配置说明.md:252` | `mysqldump -u root --databases language_learning > db/language_learning.sql` |
| Git 忽略 | `.gitignore:46-48` | `mysql-data/`、`migrate-mysql.ps1`、临时 SQL 忽略 |

### 3.2 Edge TTS 磁盘缓存（`server/.tts-cache/`）

刷新页面 / 重启后端都不丢音频，是「点播秒开」的关键。

| 项 | 证据 | 说明 |
|----|------|------|
| 目录 | `server/ttsCache.js:12`（`READ_TTS_DISK`），启动时 `mkdirSync` 同文件 `:13`；`server/index.js` 从该模块导入 | `<server 目录>\.tts-cache`，共享模块供 `index.js` 与 `folderBundle.js` 复用（P3 音频随包迁移） |
| 文件命名 | `ttsCache.js:27-36` `readTtsDiskFile()` | `<sha256>.json`，内容为 `{ audio: base64, words: [...] }` |
| key 生成 | `ttsCache.js:16-18` `readTtsKey()` | `sha256(\`${text}\0${voice}\0${rate}\`)`，与文章 / 文件夹 ID 无关 |
| 音色集合 | `ttsCache.js:10-11` | `READ_TTS_VOICES` 三音色 × `READ_TTS_RATE='+0%'`（决定 key universe） |
| 原子写 | `ttsCache.js:49-61` `writeTtsDiskFile()`（返回是否成功） | 先写 `<key>.json.<pid>.tmp`，再 `renameSync(tmp, file)`，避免半截文件；导入边车时统计写失败数 |
| 无用缓存清理 | `server/index.js:1036` `cleanupUnusedTtsCache()`（起止约 `:1036-1079`）、`:1081` `cleanupTtsCacheAfterDelete()` | `collectLiveTtsKeys()` 读 `SELECT content FROM articles`（含回收站）按前端规则切段 × 三音色算 key 集合；`readdirSync` 目录，不在集合中的 `.json` 与 1 分钟前的 `.tmp` 用 `unlinkSync` 删除；并发调用合并补跑。删除类额外走 `cleanupTtsCacheAfterDelete()`：立即清 + 25s 延迟补清一次（覆盖「前端取消在途请求后，后端合成仍完成写盘」晚于首轮清理的竞态，定时器 unref） |
| 随包迁移（P3） | `server/index.js` `app.use('/api/folders/export-audio', audioExportRouter)`、`server/folderBundle.js` 的 `buildAudioSidecar/validateAudioSidecar/writeAudioSidecar` | 主包 v2 内嵌 `audioManifest`，勾选才生成 `.llaudio.json` 边车；导入在 DB 事务提交后落盘；详见 `markdown/FOLDER_IMPORT_EXPORT.md §13` |
| 独立音频导入 | `server/index.js` `app.use('/api/tts/import-sidecar', audioSidecarImportRouter)`（自带 100mb 解析，挂在全局 2mb 前）、`server/folderBundle.js` `validateAudioSidecarForImport` | 文本先导入、音频后补的可选步骤：body 仅 `audioSidecar`，用 `collectLiveTtsKeys()` 当前库 live keys 作白名单（无主包对象），校验通过后原子写盘；超 100MB 返回 413 |
| 触发时机 | `server/index.js:1327`（启动）、`:397`（正文变更）、`:507`（文章硬删，延迟补清）、`:297`（文件夹永久删，延迟补清） | 服务启动、`PUT /api/articles/:id` 正文真变、文章 / 文件夹永久删除后异步执行；删除类含 25s 延迟补清；软删 / 恢复不触发 |
| 命中顺序 | `ARCHITECTURE.md:942` | 内存 → 磁盘（回填内存）→ 合成（写回两级）；响应头 `X-Cache: HIT/DISK/DEDUP/MISS` |
| Git 忽略 | `.gitignore:58-59` | `.tts-cache/` |

### 3.3 PDF 导出：全内存，不落盘

| 项 | 证据 |
|----|------|
| 服务 | `server/pdf_service.py:154-173, 235-239` `fitz.open(stream=data)` / `doc.set_toc()` / `doc.tobytes(garbage=3, deflate=True)` |
| 排版 | `server/pdf_export.py:35-42,177,473-476,571` `import fitz` / `reportlab`、`io.BytesIO()`、`fitz.open(stream=...)` + `tobytes(...)` |
| 笔记片段 | `server/notes_pdf_export.py:425-441,478,632-640` 同样 `BytesIO` / `fitz.open(stream=...)` |
| 响应 | `server/pdf_service.py:244-257` `Content-Disposition: attachment; filename=...; filename*=UTF-8''...`（RFC 5987 双写，支持中文文件名），PDF 字节直接进 HTTP 响应 |
| 文件名清洗 | `server/pdf_service.py:135-145` `_safe_filename()` 清 `\/:*?"<>\|` 并截断 80 字符；`_ascii_filename()` 生成 latin-1 回退名 |
| CLI 例外 | 手动执行时 `server/pdf_export.py:577-601`、`server/notes_pdf_export.py:646-674` 接受 `--input` / `--out`，用 `open(...,'wb')` 写盘；服务运行路径**不写盘** |

> 服务路径下未发现 `tempfile` 或显式 PyMuPDF 临时文件；前端下载见 §5.6。

### 3.4 日志、`.env`、缓存文件

| 文件 | 产生者 | 说明 |
|------|--------|------|
| `logs/backend.log`、`logs/frontend.log` | `scripts/start-all.py:156-178` `launch()`；`scripts/restart-backend.py:186-203` | `os.makedirs(<项目根>\logs)`，以 `open(...,'w',encoding='utf-8')` 覆盖写 |
| `logs/start-all.log`、`logs/stop-all.log` | `scripts/bat/start-all.bat:8,54-58`、`scripts/bat/stop-all.bat:7,58-62` | 批处理把脚本 stdout/stderr 重定向进去（覆盖写） |
| `logs/pdf-service.log` | ⚠️ 仅 `scripts/restart-pdf.py:318,328,362` 错误信息提及 | `launch_hidden()`（`:236-239`）实际 DEVNULL，**该日志不会产生** |
| `.env` | 用户自行新建 | 项目根，已 gitignore（`.gitignore:17`）；仓库中**没有**实际文件，示例见 `docs/MySQL连接配置说明.md:34-46`、`docs/migrate-to-new-pc.md:129-143`、`ARCHITECTURE.md:1286-1301` |
| `__pycache__/`、`*.pyc` | Python 运行时 | `.gitignore:54-56` 忽略；当前磁盘上未发现 |
| `db/language_learning.sql` | `mysqldump` | Git 跟踪的数据备份，见 §3.1 |

> `.gitignore:1-3` 忽略 `logs` 与 `*.log`；当前磁盘上 `logs/` 目录尚不存在，运行时创建。

---

## 4. 启动 / 停止 / 重启脚本接口

### 4.1 `scripts/start-all.py`（主入口）

- 顺序：`MySQL(3306) → 后端(3000) → 前端(5173) → PDF(5057)`，端口已监听则跳过（`:4-10`）。⚠️ 跳过 = **不重新加载代码**，改完 `server/*` 要用 `restart-*.py` 或先停干净。
- Node 探测 `detect_node()`（`:45-63`）：`shutil.which('node'/'node.exe')` → `%ProgramFiles%\nodejs\node.exe` → `C:\Program Files\nodejs\node.exe` → `D:\Program Files\nodejs\node.exe` → 回退 `"node"`。
- 就绪检测（避免「拉起过快」误判）：
  - `port_up()` / `wait_for_port(port, timeout=10, interval=1.0)`（`:101-124`）：轮询 `netstat` 直到 LISTENING。
  - `wait_for_http_ok('/api/health', timeout=10, interval=1)`（`:127-153`）：仅 HTTP 200 算就绪，`HTTPError`/`URLError` 继续重试。
- 启动细节：
  - 后端：`:276-280` `launch([NODE, "server/index.js"], logfile="backend.log")`，`DETACHED_PROCESS`。
  - 前端：`:283-288` `launch([NODE, "node_modules/vite/bin/vite.js"], logfile="frontend.log")`，`DETACHED_PROCESS`（明确不用 `npm run dev`）。
  - PDF：`:337-340` `launch_hidden([detect_python(), "server/pdf_service.py"])`，`CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP`。
  - 子进程标志：`:34-37` `DETACH = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`；`:181-197` `launch_hidden()` 用 `CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW`，stdout/stderr=DEVNULL（与 DETACHED 互斥）。
- 健康检查：`:344-350` `wait_for_http_ok('http://127.0.0.1:3000/api/health', timeout=10)`；`:352-354` 汇总 3000/5173/5057 的 UP/DOWN。
- 打开浏览器：`:356-371` `os.startfile('http://localhost:5173/')`，异常回退 `import webbrowser; webbrowser.open(...)`。浏览器在端口 + 健康检查全部结束后才打开；后端未健康时仅告警仍打开。

### 4.2 `scripts/stop-all.py`

- 顺序：`5173 → 3000 → 5057 → MySQL`（`:4-5`）。
- `is_admin()`（`:47-55`）：`ctypes.windll.shell32.IsUserAnAdmin()`；非 Windows `os.geteuid()==0`。
- `SERVICES = [(5173,'frontend (vite)'), (3000,'backend (express)'), (5057,'pdf-service (pymupdf)')]`（`:58-63`）。
- `kill_by_port()`（`:66-92`）：`netstat -ano` 取 LISTENING 行末 PID → `taskkill /PID {pid} /F`。
- MySQL：管理员 `net stop`（`:99-116`，识别「没有启动/not started」）；非管理员 `kill_by_port(3306, ...)`（`:117-125`）。
- ⚠️ 5057 可能有多个残留 python 进程，脚本只杀占端口那个（`:7-10`）。

### 4.3 `scripts/restart-backend.py`（仅重启 3000）

- 流程（`:6-9,18-21,247-290`）：定位 3000 监听者 → 校验必须是 `node.exe`（`:107-124` `tasklist /FI "PID eq {pid}" /FO CSV /NH`，只接受 `.exe` 结尾）→ `taskkill /PID {pid} /F`（`:206-244`）→ `wait_for_port_down(timeout=10, interval=0.5)`（`:127-159`）→ `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` 重启（写 `logs/backend.log`）→ 等端口 + `/api/health` 200 → **校验监听 PID 等于新进程且 `proc.poll() is None`**（`:271-282`，防「旧代码假成功」），否则 `sys.exit(1)`。
- `listening_pids()`（`:76-99`）：`netstat` 失败返回 `None`（与「端口空闲」区分）。

### 4.4 `scripts/restart-pdf.py`（仅重启 5057）

- 流程（`:16-20,311-364`）：5057 监听者必须是 `python.exe`（`:111-128`）→ 杀**主进程 + uvicorn 子进程整棵树**（`taskkill /PID {target} /F /T`，`:288`；绝不向上杀自身祖先）→ 等端口释放 → `launch_hidden()` 重启 → `/health` 要求 JSON `ok:true`（`:164-224`）→ 新旧 PID 集合必须不相交（`:339-356`）。
- `parent_of()`（`:131-161`）：`wmic process where "ProcessId={pid}" get ParentProcessId /value`；`_my_ancestors()` 收集自身最多 20 层祖先（`p<=4` 排除）。

### 4.5 双击入口（`.bat`）

- `scripts/bat/start-all.bat`：`:32-38` 首次运行写 `%TEMP%\ll_run_hidden.vbs`（VBS `ws.Run "<bat> __hidden", 0, False`），用 `wscript //nologo` 隐藏自身，规避双击弹 cmd 黑窗；`:42-58` `chcp 65001`、`PYTHONUTF8=1`、硬编码 `PROJECT_DIR=D:\PythonFiles\Language-learning` 与 `VENV_PY=D:\PythonFiles\.venv\Scripts\python.exe`、创建 `logs`、重定向到 `start-all.log`。
- `scripts/bat/stop-all.bat`：`:36-42,46-62` 同样的自隐藏 + UTF-8 + 硬编码路径 + `stop-all.log`；`:25-28` 注明非管理员 `net stop` 会失败，停 MySQL 需管理员。
- ⚠️ 这两个 bat 把 `PROJECT_DIR` / `VENV_PY` 写死，换机需改这两行（与 `.py` 脚本的自动探测不同）。

---

## 5. EXE / 编辑器 / 浏览器启动接口

### 5.1 编辑器 EXE 探测：`resolveEditorExe()`（`vite.config.js:11-56`）

必须拿到真正 `.exe` 而非 `code.cmd`，否则经 `cmd.exe` 会弹黑窗（注释 `:14-21`）。

候选顺序（`existsSync` 命中即返回，`:33`）：

1. `D:\Program Files\Microsoft VS Code\Code.exe`（`:26`）
2. `C:\Program Files\Microsoft VS Code\Code.exe`（`:27`）
3. `%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe`（`:28`）
4. `D:\Programs\CodeBuddy CN\CodeBuddy CN.exe`（`:29`）
5. `C:\Program Files\CodeBuddy\CodeBuddy.exe`（`:30`）
6. `%LOCALAPPDATA%\Programs\CodeBuddy\CodeBuddy.exe`（`:31`）
7. `where code` / `where CodeBuddy`（`:36-44`），从 `<安装目录>\bin\code.cmd` 反推 `Code.exe`（`:48-51`）
8. 找不到返回 `not-found`（`:55`），启动时打印警告（`:58-63`）

### 5.2 无黑窗打开编辑器：Vite 插件 `no-window-open-in-editor()`（`vite.config.js:126-193`）

- 拦截 Vite 内置 `/__open-in-editor` 请求（`:133-135`），解析 `path:line:col`（`:143-153`）。
- `spawn(editorExe, args, { detached:true, windowsHide:true, stdio:'ignore' })` + `unref()`（`:155-160`），绕开 `cmd.exe`。
- 按 `VITE_FOCUS_EDITOR=1` 决定是否再 spawn `pythonw focus_editor.py`（`:164-171`，见 §2.3）。
- 插件注册顺序最前（`:182-183`）；devtools `launchEditor: editorExe || 'code'`（`:191`）。
- 触发者：Vite 组件检查器（`Ctrl+I`，`toggleComboKey: 'control-i'`，`:195-209`）。

### 5.3 编辑器窗口置前：`scripts/focus_editor.py`

- CLI：`pythonw focus_editor.py --process Code.exe --file <路径> --root <项目根> [--timeout 8]`（`:1-25,205-210`）；退出码 0/1/2/3。
- 依赖 `win32api / win32con / win32gui / win32process`（pywin32，`:40-47`）。
- `find_hwnd()`（`:83-142`）：按进程名 + 标题关键词（文件名 > 项目目录名 > "Visual Studio Code"）找可见顶层窗口，取面积最大者，跳过 <200×200 的弹层。
- `force_foreground()`（`:145-202`）：`ShowWindow(SW_RESTORE/SW_SHOW)` → `SetForegroundWindow` / `BringWindowToTop` → `AttachThreadInput` → 模拟 Alt 按下/抬起；明确**绝不调用 `SW_HIDE`**。
- 轮询窗口标题最多 8 秒（`:237-244`），最多 5 次前置重试（`:250-256`）。

### 5.4 浏览器启动

`scripts/start-all.py:356-371`：`os.startfile('http://localhost:5173/')`，异常回退 `webbrowser.open(...)`。

### 5.5 `package.json` 脚本与运行时

`package.json:7-13`：`dev: vite`、`dev:server: node server/index.js`、`build`、`preview`、`test:unit: vitest`、`test:e2e: playwright test`、`format: prettier ... src/`；`engines.node: ^20.19.0 || >=22.12.0`（`:36-38`）。依赖含 `dotenv ^17.4.2`（`:16-24`）。

---

## 6. 前端磁盘相关接口

### 6.1 浏览器下载（Blob → 本地文件）

| 产物 | 证据 | 流程 |
|------|------|------|
| PDF | `src/components/PdfExportButton.vue:14,162-183` | `PDF_SERVICE='http://127.0.0.1:5057'` 直连 → `fetch` → `URL.createObjectURL(await res.blob())` → 动态 `<a download>` + `a.click()` → 40s 后 `revokeObjectURL`；文件名取自 `Content-Disposition` |
| 文件夹包（`.llfolder.json`） | `src/utils/folderBundle.js:70-79` | `new Blob([text], {type:'application/json;charset=utf-8'})` → `createObjectURL` → `a.download='…llfolder.json'` + `a.click()` → 1s 后 revoke |

### 6.2 文件上传 / 100 MB 限制

- `src/components/FolderImportDialog.vue:13` `limitMB = MAX_BUNDLE_BYTES / 1024 / 1024`；`<input type="file" accept=".json,.llfolder.json,application/json">`（`:140-146`）与拖拽 `onDrop`（`:65-95`）。
- `src/utils/folderBundle.js` 顶部 `MAX_BUNDLE_BYTES = 100*1024*1024`（v2 增 `SUPPORTED_BUNDLE_VERSIONS=[1,2]`、边车常量）；`readBundleFile()` 检查 `file.size` → `file.text()` + `JSON.parse` → format/version 校验；P3 增 `exportAudioSidecar()` / `readAudioSidecarFile()`。
- 后端：`server/index.js:66` 音频边车导出路由、`:41` `/api/folders/import`、`:93` `/api/tts/import-sidecar` 均注册在全局 `express.json({limit:'2mb'})` **之前**（各自带 100mb 解析）；`server/folderBundle.js` 的 `createImportRouter()` 含校验 / 导入路由与 `createImportRouter` 内的边车落盘（DB 提交后）。
- 前端超时：`src/api/index.js:74-90` `validateFolderBundle` / `importFolder` 放宽到 120000 ms。

### 6.3 页面关闭兜底投递：`sendCanvasStrokesBeacon()`

`src/api/index.js:182-199`：`new Blob([body])` + `navigator.sendBeacon(url, blob)`，失败回退 `fetch(..., { keepalive: true })`。用于 `pagehide` / `visibilitychange(hidden)` 时补投画布笔迹。

### 6.4 音频 Blob 内存缓存

`src/composables/useReadAloud.js:50,61,63`、`useWordTts.js:27-28,52`、`useAnnotations.js:75-76,498`：`URL.createObjectURL(blob)` / `revokeObjectURL`，均为**内存**缓存，不写盘（持久化靠服务端 `.tts-cache`）。

### 6.5 `localStorage` 键全量（9 个）

| 键 | 位置 | 用途 |
|----|------|------|
| `sidePanelState` | `src/App.vue:112,116,127` | 右侧 AI 面板当前站点 `{site}` |
| `lastPage` | `src/App.vue:137`、`src/views/ArticlePage.vue:537`、`src/stores/fileExplorer.js:145-146` | 最后浏览页面 `article:<id>` / `folder:<id>`，重启恢复 |
| `lastFolderId` | `src/stores/fileExplorer.js:145-146,153` | 最后浏览文件夹 ID |
| `fontSize` | `src/views/ArticlePage.vue:309,312` | 阅读字号 12–32（默认 16） |
| `readerScroll:<articleId>` | `src/views/ArticlePage.vue:345,348,355` | 正文滚动位置（200ms 防抖） |
| `noteMarkedView` | `src/components/NotePanel.vue:330,334,342` | 集中卡片当前视图 `annotations`/`vocab`/`favorites` |
| `noteScroll:<articleId>` | `src/components/NotePanel.vue:436,573,593` | 笔记面板滚动位置 |
| `_manual_word_card_pos` | `src/components/ManualWordCard.vue:76,80,86` | 手动查词卡片位置 `{x,y}` |
| `read-aloud-voice` | `src/composables/useReadAloud.js:15,19,30` | 当前朗读音色 ShortName |

> 历史遗留键：`_canvas_strokes_<articleId>`（`src/components/DrawCanvas.vue:238-242`）代码中只剩 `getItem` 兜底回退，**已无 `setItem` 写入方**，等价于只读残留；`note_marks_<articleId>` 已彻底废弃（重点改入库 `articles.marks`）。

---

## 7. 配置 / 环境变量接口

### 7.1 代码实际读取的环境变量

| 变量 | 读取位置 | 默认值 / 用途 |
|------|----------|---------------|
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | `server/db.js:5-9` | `localhost` / `3306`（无效回退）/ `root` / `''` / `language_learning` |
| `SERVER_PORT` | `server/index.js:23` | `3000` |
| `PYTHON_HOME` | `server/index.js:962` | `D:\PythonFiles\.venv`（朗读 TTS 子进程用） |
| `VITE_API_BASE_URL` | `src/api/index.js:1-2` | `/api` |
| `VITE_FOCUS_EDITOR` | `vite.config.js:118` | 未设（默认关闭编辑器置前） |
| `LOCALAPPDATA` | `vite.config.js:24` | 定位 VS Code / CodeBuddy 用户级安装 |
| `TXT_DIR` / `FOLDER_ID` | `scripts/reimport_all.cjs:8,10` | `D:\PythonFiles\temp\2021.10分散` / 空 |
| `ProgramFiles` | `scripts/start-all.py:55`、`scripts/restart-backend.py:56` | `C:\Program Files` |
| `PYTHONUTF8` | `scripts/bat/*.bat:46/50` | `1`（启动 PDF 服务前设置） |
| `PYTHONIOENCODING` | `server/index.js:1116`（注入子进程） | `utf-8` |

### 7.2 配置文件

- `server/index.js:3` `import 'dotenv/config'` 加载项目根 `.env`。
- `vite.config.js:195-209` `@` alias → `./src`；`server: { host:'0.0.0.0', port:5173 }`；`/api` 代理。
- `jsconfig.json:1-8` `@/* → ./src/*`，排除 `node_modules` / `dist`。
- `vitest.config.js:1-14` `mergeConfig(viteConfig, ...)`、`environment:'jsdom'`、排除 `e2e/**`——⚠️ vitest 也会加载 `vite.config.js` 里的编辑器 / pythonw 探测与插件。
- `playwright.config.js:13-44,100-109` `testDir:'./e2e'`；`baseURL = CI ? http://localhost:4173 : http://localhost:5173`；`webServer.command = CI ? 'npm run preview' : 'npm run dev'`；`reuseExistingServer: !CI`。

### 7.3 `.gitignore` 中与磁盘相关的忽略项

`.gitignore`：`logs`、`*.log`（1-3）、`node_modules`、`dist`、`.env`（17）、`mysql-data/`（47）、临时 SQL（51-52）、`__pycache__/`/`*.py[cod]`（55-56）、`.tts-cache/`（59）、`.tmp_desktop_bat.ps1`（62）。

---

## 8. 换机迁移检查清单（硬编码路径汇总）

按「改动成本」排序，逐项核对：

1. **`.env`**：新建并填 `DB_PASSWORD` 等，见 `docs/MySQL连接配置说明.md`。
2. **MySQL datadir**：把 `mysql-data/` 整目录随项目复制，并确认 `my.ini` 的 `datadir` 指向新路径、`NT AUTHORITY\NetworkService` 有写权限，见 `docs/migrate-to-new-pc.md:264-273`。
3. **`server/index.js:962`**：`PYTHON_HOME` 常量（或用同名环境变量覆盖）。
4. **`scripts/bat/start-all.bat` / `stop-all.bat`**：`PROJECT_DIR`、`VENV_PY` 两行写死路径。
5. **`scripts/reimport_all.cjs:8,10`**：`TXT_DIR` / `FOLDER_ID`（仅用一次性导入时）。
6. **编辑器 / pythonw 探测**：`vite.config.js:26-31` 的 VS Code / CodeBuddy 候选路径、`:99-104` 的 `.venv` 候选路径（一般靠 `where` 兜底，不必改）。
7. **`.tts-cache/`**：可选随项目迁移；不迁移也能重建（下次朗读重新合成）。
8. **`db/language_learning.sql`**：数据备份，Git 同步；新库需先 `/api/init` 或导入 SQL，再重启后端补列。
9. **`netsh` 防火墙放行 5173**（LAN 访问需要，见 §1）。

> ⚠️ 本节只是「显式接口」清单。**整包迁移能否跑起来还取决于 §10 的隐式依赖**（venv / pip 包 / PID 字体 / MySQL ACL / SSH / WMIC 等），务必一起看。若想把这些接口收敛到单一配置文件，见 §11 可行性评估。

完整迁移步骤见 [docs/migrate-to-new-pc.md](../docs/migrate-to-new-pc.md) 与 [ARCHITECTURE.md](./ARCHITECTURE.md)「换电脑后恢复数据」。

---

## 9. 文档与磁盘现状不一致（核对记录）

| # | 现象 | 实际 |
|---|------|------|
| 1 | 文档示例 `.env` | 仓库中**没有**实际 `.env` 文件（已 gitignore），需自行新建 |
| 2 | 日志 `logs/*.log` | 当前磁盘无 `logs/` 目录，运行时才创建 |
| 3 | `restart-pdf.py` 错误信息提到 `logs/pdf-service.log` | `launch_hidden()` 输出 DEVNULL，该日志**不会**生成 |
| 4 | `README.md:118` 提到根目录 `start.bat` | 当前不存在；实际入口是 `scripts/bat/start-all.bat` / `stop-all.bat` |
| 5 | `.gitignore` 忽略 `__pycache__` / `*.pyc` | 当前磁盘未发现任何 `.pyc` 文件 |
| 6 | `ARCHITECTURE.md` 等记录 Python 路径 | 与 `server/index.js:962` 实际默认值一致（`D:\PythonFiles\.venv`） |

---

## 10. 上一版遗漏的移植风险项（补充核查）

> 以下为「整包拷到另一台 Windows 电脑后能否直接跑」专门复查出的项。§1–§9 覆盖的是路径 / 端口 / 脚本等**显式接口**，本节是**隐式依赖**——它们不会出现在“接口清单”里，却同样决定移植成败。按风险从高到低排列。

### 10.1 运行时依赖没有清单（最高风险）

| 事实 | 证据 | 迁移后果 |
|------|------|----------|
| 项目内**没有** `requirements.txt` / `requirements-dev.txt` | 全仓搜索 `requirements*.txt` → 0 个文件 | 新机没有自动化安装依据，只能照文档手工 `pip install`，漏装即静默失效 |
| 唯一的 pip 安装说明 | `docs/python-env.md:29-34` `pip install fastapi "uvicorn[standard]" PyMuPDF reportlab` / `pywin32` / `edge-tts` | 无版本锁定，新机装到不兼容版本（如 PyMuPDF 新版 `import fitz` 弃用）行为不一致 |
| Python 侧依赖分布 | `server/pdf_service.py:65-67,70,80,262`（fastapi/fitz/uvicorn）、`server/pdf_export.py:35-42`（fitz/reportlab 全套）、`server/notes_pdf_export.py:80-87`、`server/tts_synth.py:20`（edge_tts） | 缺包时 PDF `/health` 返回 `ok:false`、导出 500；缺 edge_tts 时朗读每次 spawn 失败 |
| Python 脚本**不读** `.env` | 全仓 `*.py` 无 `import dotenv`；dotenv 只在 Node 侧 `server/db.js:2` | 别以为 `.env` 里的 Python 变量会自动生效，Python 环境变量须由父进程注入 |
| npm 侧 | `package.json:15-24` 运行时依赖、`:25-35` devDeps 含 `@playwright/test`、`:36-38` `engines.node: ^20.19.0 \|\| >=22.12.0` | Node 版本不满足时 Vite 直接退出；`node_modules`（`.gitignore:10`）不会随 Git 迁移，须 `npm install` |
| Playwright 浏览器二进制 | `playwright.config.js:48-65` 定义 chromium/firefox/webkit；全仓无 `npx playwright install` / `PLAYWRIGHT_BROWSERS_PATH` | 浏览器装在 `%LOCALAPPDATA%\ms-playwright`（用户目录，不在项目内），新机 `npm run test:e2e` 报 "Executable doesn't exist"，须手动 `npx playwright install` |

### 10.2 venv 在项目外且绑定旧机绝对路径（整包复制必丢）

- `d:/PythonFiles/.venv/pyvenv.cfg:1` `home = D:\Program Files\Python311`、`:4` `executable = D:\Program Files\Python311\python.exe`、`:5` `command = ... -m venv d:\PythonFiles\.venv`、`:2` `include-system-site-packages = false`。
- venv 位于**项目父目录**（`d:\PythonFiles\`），整包复制项目文件夹根本带不走；即使连 `.venv` 一起复制，`home`/`executable` 指向旧机 Python 绝对路径且禁用系统包，新机 Python 装在别处即整个 venv 失效。
- 项目内**无本地 venv**（`Language-learning/.venv` 不存在），没有随项目走的备用解释器。
- 已装包绑在旧 venv：`site-packages` 下有 `fastapi-0.141.1`、`pymupdf-1.28.2`、`reportlab`、`edge_tts-7.3.1`、`pywin32`。其中 **pywin32 的系统注册 DLL 需在新机重装**，否则 `win32gui` 导入失败（影响 §5 编辑器置前与 §2.3 pythonw 探测）。
- 迁移结论：**不要试图复制 venv**，新机用 `python -m venv` 重建 + `pip install`（配合 10.1 的清单）。

### 10.3 PDF 中文字体依赖阅读器 CID 替换（非嵌入）

- `server/pdf_export.py:56` 与 `server/notes_pdf_export.py:94` 用 `"cjk_font": "STSong-Light"`（reportlab 内置 CID 中文字体，**不嵌入字形**）。
- `server/pdf_export.py:80-89` `_ensure_cjk()` 注册失败时静默降级（`cjk_ok=False`），中文不套字体、排版退化但不报错；`:97-108` `_markup_cjk()` 注释指出该字体宽度度量与渲染不一致（实测 ASCII：Helvetica 111.87pt vs STSong-Light 95.25pt）。
- `server/pdf_export.py:111-124` `_normalize_text()` 把特殊连字符换成 ASCII，注释明确「只有导出 PDF 才会变黑框」。
- `server/notes_pdf_export.py:54-56` 注释：reportlab 内置字体和系统常见字体**都缺 IPA 音标字形**（Vera 仅覆盖 2/24 常用码位），故音标被移到 PDF 注释 `/Contents` 而非页面文字；`:151-158`、`:471-491` 注册失败时 `wordWrap="CJK"` 关闭，长中文行溢出单元格。
- 全仓**无** `TTFont` 调用、无 `C:\Windows\Fonts\...` 绝对路径、无 `msyh/simsun/simhei` 引用——中文完全靠阅读器做 CID 字体替换。
- 迁移后果：新机 PDF 阅读器/系统缺对应中文字形时，中文显示空白或方框（tofu），混排右边界与下划线位置漂移。**这是唯一无法靠「改配置文件」解决、只能靠换字体文件/换阅读器缓解的项。**

### 10.4 网络 / 外部服务可达性

| 功能 | 证据 | 无外网表现 |
|------|------|-----------|
| 有道联想词 | `server/index.js:650` `https://dict.youdao.com/suggest?...`（5s 超时） | 502 + 「联想词服务暂时不可用」 |
| 有道查词 | `server/index.js:738` `https://dict.youdao.com/result?...`；`:594-637` `fetchYoudaoHtml()` 8s 超时 + 3 次重试 + 伪装 Chrome UA | 等满 8s 重试 3 次才报错，明显卡顿 |
| 单词发音 | `server/index.js:873` `https://dict.youdao.com/dictvoice?...`；`:891-896` `warmupTts()` 后台预热失败**完全静默** | 无声，且无提示 |
| 逐段朗读 | `server/tts_synth.py:20,38-40,65-70` edge-tts 走微软在线 WebSocket（端点在库内固定）+ 3 次重试/20s 超时 | 每段带 `error`，前端报「TTS 进程退出」 |
| 侧边栏 AI | `src/App.vue:107-110` 元宝/豆包/千问/DeepSeek 四个 `https://...` | iframe 空白或需外部打开 |
| 非网络项 | `src/components/DrawCanvas.vue:1004` SVG data URI 里的 `http://www.w3.org/2000/svg` 只是命名空间，不请求网络 | 无需处理 |

> 这些 URL 全为硬编码，但属**外部 SaaS**，不是“新机接口”，一般无需随迁移修改；只需保证新机 DNS/代理/防火墙放通 443 与 WebSocket。

### 10.5 编码 / 区域设置

- `server/index.js:1116` 只给 TTS 子进程注入 `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`；PDF 服务等其它 Python 进程未覆盖，GBK locale 新机上中文参数/错误回传可能乱码。
- `server/tts_synth.py:27-34,91-95` 已做 UTF-8 + `ensure_ascii=True` + `reconfigure` 防护，但依赖父进程注入。
- `scripts/bat/start-all.bat:42,46` `chcp 65001` + `set PYTHONUTF8=1`；`:44-45` 注释说明日志重定向按控制台代码页（中文 Windows 为 GBK）输出。`stop-all.bat:9-10` 明确「bat 故意纯英文，中文注释在某些代码页会破坏 cmd 解析」。
- `server/pdf_export.py:585`、`notes_pdf_export.py:653` 从 stdin 读时未指定编码，GBK 控制台下中文文章内容可能解码错误。
- `server/db.js:4-13` 连接池**未设 `charset`/`timezone`**；`db/language_learning.sql:10-12` 备份导入时强制 `SET NAMES utf8mb4` + `TIME_ZONE='+00:00'`，但运行期会话不设时区 → 新机系统时区不同则 `TIMESTAMP` 显示值整体偏移。
- `src/stores/fileExplorer.js:173` `localeCompare` 中文排序依赖浏览器/OS locale。

### 10.6 MySQL / Git / OS 命令的隐含假设

- **MySQL datadir ACL**：复制 `mysql-data/` 后 NTFS 权限不会自动带上 `NT AUTHORITY\NetworkService` 写入权，MySQL 以服务账号启动会因无法写 datadir 失败（需在 `my.ini` 改 `datadir` 并 `icacls` 授权，见 `docs/migrate-to-new-pc.md:264-273`）。
- **`my.ini` 探测**：`scripts/start-all.py:214-222` 只找 `C:\ProgramData\MySQL\MySQL Server 8.0\my.ini` 或从 mysqld 目录反推；新机 MySQL 装在其它盘时找不到，`--defaults-file` 缺失会用错 datadir/字符集。
- **误杀风险**：`stop-all.py:122` 非管理员走 `kill_by_port(3306, ...)`，若新机 3306 被其它软件占用会强杀外部进程。
- **Git/SSH**：`.git/config:8-10` `origin = git@github.com:lsp-hubb/language-learning.git`，新机需配 GitHub SSH key + 放通出站 22；`markdown/GIT_GUIDE.md:5-6` 写明“本机 HTTPS 被阻断，勿改回 HTTPS”，若新机网络恰好相反会卡死，需按新机网络改策略。`:18-20` 仓库级 Git 身份 `language-learning-local / local@...` 会随文件夹复制。
- **已淘汰的 Windows 命令**：`scripts/restart-pdf.py:135` 用 `wmic process ... get ParentProcessId` 取父进程——**Win11 / Server 2022 起 WMIC 被移除**，取不到父进程时脚本保守拒绝 kill，无法重启 PDF 服务。
- **脚本宿主**：两个 `.bat` 用 `%TEMP%\ll_run_hidden.vbs` + `wscript //nologo` 自隐藏，新机组策略禁用脚本宿主时双击失败或弹黑窗。
- **无注册表依赖**：全仓搜 `winreg`/`RegOpenKey` → 0 命中，此项不构成迁移风险。

---

## 11. 「单一接口文件」能否作为移植开关？— 可行性评估

用户目标：**改一个文件 → 新机直接跑**。分两层看，结论不同。

### 11.1 当前配置的分散程度（为什么现在做不到）

完整重配置（端口 + 路径 + EXE）需改 **14 个文件**，且端口常量跨多文件重复：

| 端口 | 重复位置 |
|------|----------|
| 3000 | `vite.config.js:205`（proxy）、`scripts/start-all.py:39`、`scripts/stop-all.py:61`、`scripts/restart-backend.py:42`、`server/index.js:23` |
| 5057 | `src/components/PdfExportButton.vue:14`（前端）、`server/pdf_service.py:91,264`、`scripts/start-all.py:42`、`stop-all.py:62`、`restart-pdf.py:48` |
| 5173 | `vite.config.js:202`、`playwright.config.js:37,107`、`scripts/start-all.py:40,357`、`scripts/stop-all.py:60` |
| 3306 | `server/db.js:6`、`scripts/start-all.py:41`、`scripts/stop-all.py:122`、`reimport_all.cjs:25` |

- **项目里没有任何中央配置模块**（无 `config.js` / `config.py` / `settings.*` / `constants.*`，无 `.env` / `.env.example`）。
- **已经可以 env 覆盖的**：DB 五项、后端端口 `SERVER_PORT`、`PYTHON_HOME`、`TXT_DIR`、`FOLDER_ID`、`LOCALAPPDATA`、`VITE_FOCUS_EDITOR`、`CI`。
- **完全不可 env 覆盖的**：PDF 端口 5057、前端端口 5173、代理目标 3000、四个 Python 启停脚本里的端口、MySQL 服务名、两个 bat 的 `PROJECT_DIR`/`VENV_PY`、前端 `PDF_SERVICE`。

### 11.2 结论：**部分可行，但「只改一个文件、零重建、全端生效」目前做不到**

✅ **可以用一个文件统一的部分**（成本：增加适配代码，不改架构）：
- 四个端口 + DB 连接 + `PYTHON_HOME`/`TXT_DIR`：这些本就是常量或已 env 化，统一写进一份 `.env`（Node 侧已有 `dotenv@^17.4.2`），再让 4 个 Python 脚本读它（引入 `python-dotenv` 或手写十几行解析），两个 bat 改为 `%~dp0..` 相对推导 + 从同一文件读取。**收敛到 1 个 `.env` 现实可行。**
- 路径/EXE 类大多是「动态探测 + 硬编码兜底」（`where code`、`shutil.which`），真正必须改的硬编码只剩 bat 的 `PROJECT_DIR`/`VENV_PY`、`server/index.js` 的 `PYTHON_HOME` 默认值、`reimport_all.cjs` 的 `TXT_DIR`——可归到同一文件。

❌ **无法靠单一接口文件解决的部分**（必须另做安装/环境步骤）：
1. **venv / pip 依赖**（§10.1–10.2）：必须在新机 `python -m venv` + `pip install`，无法用“改配置”代替；除非引入 `requirements.txt` 并在启动脚本里自动建 venv/装包。
2. **MySQL 服务 / datadir / ACL**（§10.6）：服务名、`my.ini`、`icacls` 授权是 OS 层设置，不是应用配置能覆盖的。
3. **PDF 中文字体**（§10.3）：CID 非嵌入字形，取决于阅读器/系统，改配置无效。
4. **前端两处硬编码**：
   - `src/components/PdfExportButton.vue:14` `PDF_SERVICE = 'http://127.0.0.1:5057'` 是**打包进产物的字符串**；
   - `src/api/index.js:2` `BASE_URL` 用 `import.meta.env.VITE_API_BASE_URL`（**构建期**变量）。
   改这两处**必须重新 `npm run build`**。除非改造成运行时下发配置（例如同源 `GET /api/config` 或启动时注入 `window.__CONFIG__`），那属于架构改造，不是“编辑配置文件”。

### 11.3 建议的落地路径（若决定做）

分三步，前两步收益最大、风险最低：

1. **低成本、立即做**：新建 `requirements.txt`（锁版本）+ `.env.example`（含全部端口 / 路径 / DB 变量），把 `markdown/DISK_INTERFACES.md` 作为“字段含义 + 新机取值”的唯一说明文档。此时“改一个文件”= 改 `.env`，但**仍需**手工装依赖和改 bat。
2. **中等改造**：让 4 个 Python 启停脚本读 `.env`，bat 改相对路径；把前端 `PDF_SERVICE` 与 API base 改为运行时从后端 `/api/config` 拉取。做完这步才能真正“一份 `.env` 走天下、无需 rebuild”。
3. **可选加固**：启动脚本自动建 venv + `pip install -r requirements.txt`；PDF 中文字体改为嵌入 TTF（需随项目带字体文件，注意授权）。

> 文档定位建议：`markdown/DISK_INTERFACES.md` 继续作为**接口语义的唯一权威说明**（每个接口是什么、在哪定义、移植时要填什么）；真正被程序读取的“值”收敛到 `.env`。两者一一对应，避免文档与配置两套真相。

---

## 12. 接口逐项卡片（AI 接手主参考）

本章把全文所有磁盘 / 运行时接口拆成**独立卡片**，每张卡片有唯一 `ID` 与固定 6 字段，便于快速检索与逐项核对：

| 字段 | 含义 |
| --- | --- |
| 位置 | `文件:行号` + 代码特征串（行号漂移时靠特征串搜索） |
| 作用 | 这个接口在运行时到底做什么 |
| 当前值 | 本机现网值（移植时就是要把这些值换成新机的） |
| 覆盖方式 | 能否用环境变量 / 配置改，还是必须改源码 |
| 移植动作 | 新机上具体要做什么 |
| 失败症状 | 没配对时用户 / 日志会看到什么（用于反向定位） |

> ID 规则：`PATH` 路径、`PORT` 端口、`ENV` 环境变量、`FILE` 文件目录、`PROC` 进程命令、`EXE` 可执行文件、`FE` 前端本地、`DEP` 依赖、`NET` 网络、`LOC` 编码区域。

### 12.1 任务速查表（改什么 → 去哪改）

| 想做的事 | 涉及接口 ID | 主改位置 |
| --- | --- | --- |
| 换 Python 解释器 / 虚拟环境 | `PATH-01` `PATH-04` `PATH-10` `ENV-03` | `server/index.js:962`、两个 `.bat`、`scripts/start-all.py:328` |
| 换数据库连接（密码 / 端口 / 库名） | `ENV-01` `PORT-01` | 项目根 `.env`（新建）、`server/db.js:5-9` |
| 改后端端口 | `PORT-02` `ENV-02` | `.env` 的 `SERVER_PORT` + `vite.config.js:205` 代理 target |
| 改前端端口 | `PORT-03` | `vite.config.js:202`、`start-all.py:40,357`、`stop-all.py:60`、`playwright.config.js:37,107` |
| 改 PDF 端口 | `PORT-04` `FE-01` | `server/pdf_service.py:91`、`PdfExportButton.vue:14`、`start-all.py:42`、`stop-all.py:62`、`restart-pdf.py:48` |
| 换 MySQL 数据目录 / 服务名 | `FILE-01` `PROC-06` `PATH-11` `PATH-12` | `my.ini` 的 `datadir` + ACL 授权 + `start-all.py:66-86,214-222` |
| 换编辑器（VS Code→Cursor 等） | `EXE-01` `EXE-02` `EXE-03` | `vite.config.js:26-31`、`focus_editor.py:207` |
| 装依赖 / 补 pip 包 | `DEP-01` `DEP-02` `DEP-03` `DEP-04` | 新机 `python -m venv` + `pip install`、`npm install`、`npx playwright install` |
| 解决 PDF 中文方框 | `PATH-12` `FILE-06` | `pdf_export.py:56`/`notes_pdf_export.py:94` 字体 + 阅读器 |
| 解决中文日志乱码 | `LOC-01` `LOC-02` `LOC-03` | `chcp 65001`、`PYTHONUTF8`、`server/index.js:1116` |
| 无外网时哪些功能失效 | `NET-01`~`NET-05` | 有道 / edge-tts / AI 站点 URL（通常不动，只需放通网络） |
| 让改一个配置就能移植 | §11.3 + `ENV-01`~`ENV-10` | 需架构改造，见 §11 可行性评估 |

### 12.2 路径 / 解释器类（PATH）

#### `PATH-01` Python 主目录常量 `PYTHON_HOME`

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/index.js:962` `const PYTHON_HOME = process.env.PYTHON_HOME \|\| 'D:\\PythonFiles\\.venv'` |
| 作用 | 后端 Edge TTS 合成子进程的解释器根目录 |
| 当前值 | `D:\PythonFiles\.venv`（项目父目录，**不在项目文件夹内**） |
| 覆盖方式 | ✅ 环境变量 `PYTHON_HOME`（改 `.env` 即可，无需改源码） |
| 移植动作 | 新机建 venv 后，在 `.env` 写 `PYTHON_HOME=<新venv绝对路径>`；或改此行默认值 |
| 失败症状 | 朗读报错「TTS 进程退出」，后端日志出现「Python 解释器不存在」 |

#### `PATH-04` TTS 解释器 `python.exe`

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/index.js:1101`（存在性校验）、`:1109`（spawn）`path.join(PYTHON_HOME, 'Scripts', 'python.exe')` |
| 作用 | Edge TTS 朗读合成子进程的解释器，需读 stdout，**必须用 python.exe 不用 pythonw** |
| 当前值 | `D:\PythonFiles\.venv\Scripts\python.exe` |
| 覆盖方式 | 间接：随 `PATH-01` 变化 |
| 移植动作 | 确认新 venv 内有 `Scripts\python.exe` 且装了 `edge_tts` |
| 失败症状 | 朗读按钮报错；日志「Python 解释器不存在」或 TTS 子进程退出码非 0 |

#### `PATH-05` Edge TTS 脚本 `tts_synth.py`

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/index.js:971` `READ_TTS_SCRIPT = <server目录>\tts_synth.py` |
| 作用 | 单进程批量合成音频 + 词边界的 Python 脚本 |
| 当前值 | `server/tts_synth.py`（随项目走，不需迁移改动） |
| 覆盖方式 | 无（随项目路径推导） |
| 移植动作 | 确认脚本随项目拷贝；装好 `edge_tts` |
| 失败症状 | 找不到脚本 → spawn 失败 → 朗读报错 |

#### `PATH-06` TTS 磁盘缓存目录

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/ttsCache.js:12` `READ_TTS_DISK = <server目录>\.tts-cache`；`:13` `mkdirSync` |
| 作用 | 存 `<sha256>.json`（音频 base64 + 词边界），跨重启 / 刷新常驻 |
| 当前值 | `server\.tts-cache\`（随项目走，已 gitignore） |
| 覆盖方式 | 无（固定 server 目录下） |
| 移植动作 | 可选：随项目拷贝以保留音频；不拷也能重建（下次朗读重新合成） |
| 失败症状 | 目录不可写时合成结果无法落盘，每次朗读都重新在线合成（慢但不崩） |

#### `PATH-07` TXT 导入源目录 `TXT_DIR`

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/reimport_all.cjs:8` `process.env.TXT_DIR \|\| 'D:\\PythonFiles\\temp\\2021.10分散'` |
| 作用 | 一次性 TXT 批量导入脚本的源目录（非日常运行路径） |
| 当前值 | `D:\PythonFiles\temp\2021.10分散` |
| 覆盖方式 | ✅ 环境变量 `TXT_DIR` |
| 移植动作 | 仅用导入功能时设 `TXT_DIR=<新目录>`；`:17-21` 会校验目录存在，不存在直接退出 |
| 失败症状 | 控制台「TXT 目录不存在」并 exit(1) |

#### `PATH-08` bat 项目根 `PROJECT_DIR`

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/bat/start-all.bat:49`、`stop-all.bat:53` `set "PROJECT_DIR=D:\PythonFiles\Language-learning"` |
| 作用 | 双击入口用来定位项目根（**写死，不受脚本自身位置推导保护**） |
| 当前值 | `D:\PythonFiles\Language-learning` |
| 覆盖方式 | ❌ 必须改源码（bat 文件两行） |
| 移植动作 | 换成新机项目绝对路径，或改为 `set "PROJECT_DIR=%~dp0.."` 相对推导 |
| 失败症状 | 双击 bat 后 `cd` 到不存在的旧盘符，脚本找不到、静默失败或弹黑窗 |

#### `PATH-09` bat Python 路径 `VENV_PY`

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/bat/start-all.bat:50`、`stop-all.bat:54` `set "VENV_PY=D:\PythonFiles\.venv\Scripts\python.exe"` |
| 作用 | 双击入口启动 `start-all.py` 用的解释器（不存在则回退 `python`） |
| 当前值 | `D:\PythonFiles\.venv\Scripts\python.exe` |
| 覆盖方式 | ❌ 必须改源码 |
| 移植动作 | 换新机 venv 路径或留空走 PATH；注意注释警告**不要改成 pythonw** |
| 失败症状 | 回退到 PATH 的 python（若未装依赖则 PDF 服务启动失败） |

#### `PATH-10` 旧 venv 配置 `pyvenv.cfg`

| 字段 | 内容 |
| --- | --- |
| 位置 | `d:/PythonFiles/.venv/pyvenv.cfg:1,4,5` `home = D:\Program Files\Python311`、`executable = ...`、`command = ... -m venv d:\PythonFiles\.venv` |
| 作用 | 定义 venv 绑定的基础解释器（**绝对路径 + 禁用系统包**） |
| 当前值 | 绑定 `D:\Program Files\Python311`，位于项目父目录 |
| 覆盖方式 | ❌ 不可覆盖；**不要复制 venv** |
| 移植动作 | 新机用 `python -m venv <新路径>` 重建 + `pip install`（见 `DEP-01`） |
| 失败症状 | 复制旧 venv 到新机后所有 Python 命令因找不到旧路径系统 Python 而失效 |

#### `PATH-11` mysqld.exe 路径

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/start-all.py:200-211` `detect_mysqld()` 候选 `C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe` 等 |
| 作用 | 非管理员 / net start 失败时直接拉起 mysqld |
| 当前值 | 优先 PATH，其次 `C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe` |
| 覆盖方式 | ❌ 硬编码候选列表（一般靠 PATH 命中） |
| 移植动作 | MySQL 装在自定义目录时把新路径加入候选或 PATH |
| 失败症状 | 找不到 mysqld → 回退分支无法启动数据库 → 端口 3306 不通 |

#### `PATH-12` my.ini 路径

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/start-all.py:214-222` `detect_my_ini()` 候选 `C:\ProgramData\MySQL\MySQL Server 8.0\my.ini` |
| 作用 | 提供 `--defaults-file`，决定 datadir / 字符集 |
| 当前值 | `C:\ProgramData\MySQL\MySQL Server 8.0\my.ini` |
| 覆盖方式 | ❌ 硬编码候选 + 从 mysqld 目录反推 |
| 移植动作 | 换盘符 / 自定义安装时更新候选；确认 `datadir` 指向新 `mysql-data` |
| 失败症状 | 找不到 my.ini → 不带配置启动 → 用错 datadir，表现为「数据全没了」 |

#### `PATH-13` Node.exe 探测

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/start-all.py:45-63`、`restart-backend.py:52-63` `detect_node()` |
| 作用 | 定位启动前后端用的 node |
| 当前值 | 优先 PATH，兜底 `%ProgramFiles%\nodejs\node.exe` / `C:\` / `D:\` |
| 覆盖方式 | ❌ 硬编码兜底（靠 PATH 优先命中） |
| 移植动作 | 确保新机 node 在 PATH 且满足 `engines`（见 `DEP-02`） |
| 失败症状 | 最终回退字符串 `"node"` 找不到 → 前后端都起不来 |

### 12.3 端口类（PORT）

#### `PORT-01` MySQL 端口 3306

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/db.js:6`、`scripts/start-all.py:41`、`stop-all.py:122`、`reimport_all.cjs:25` |
| 作用 | 数据库连接端口 + 启停脚本的端口探测 / 强杀目标 |
| 当前值 | `3306` |
| 覆盖方式 | 部分：`DB_PORT` 可改 db.js / reimport（`.env`）；**启停脚本里写死** |
| 移植动作 | 改端口需同时改 4 处；默认建议保留 3306 |
| 失败症状 | 端口不一致 → 后端连不上库；`stop-all.py` 强杀占 3306 的其它进程（有害） |

#### `PORT-02` 后端端口 3000

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/index.js:23`（`SERVER_PORT`）、`vite.config.js:205`（代理 target）、`start-all.py:39`、`stop-all.py:61`、`restart-backend.py:42` |
| 作用 | Express 监听 + Vite `/api` 代理目标 + 健康检查地址 |
| 当前值 | `3000` |
| 覆盖方式 | 部分：`SERVER_PORT` 可改后端；**代理 target 与脚本写死** |
| 移植动作 | 改端口须同步 `vite.config.js:205` 的 target，否则前端 `/api` 全 404 |
| 失败症状 | 代理指向旧端口 → 前端请求 500/404；健康检查失败 |

#### `PORT-03` 前端端口 5173

| 字段 | 内容 |
| --- | --- |
| 位置 | `vite.config.js:202`、`start-all.py:40,357`、`stop-all.py:60`、`playwright.config.js:37,107` |
| 作用 | Vite 监听（`0.0.0.0`，LAN 可达）+ 浏览器打开地址 + E2E baseURL |
| 当前值 | `5173`（CI 预览用 4173） |
| 覆盖方式 | ❌ 硬编码，需改多处 |
| 移植动作 | 改端口须同步浏览器 URL、停止脚本、E2E 配置；LAN 访问需防火墙放行（见 §1） |
| 失败症状 | 浏览器打开旧端口无响应；E2E 测试连不上 |

#### `PORT-04` PDF 服务端口 5057

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/pdf_service.py:91,264`、`src/components/PdfExportButton.vue:14`、`start-all.py:42`、`stop-all.py:62`、`restart-pdf.py:48` |
| 作用 | FastAPI PDF 服务（仅 `127.0.0.1`）+ 前端直连地址 |
| 当前值 | `5057` |
| 覆盖方式 | ❌ 全硬编码；前端那处还需**重新构建**（见 `FE-01`） |
| 移植动作 | 改端口要改 5 处；一般保持默认，确保 5057 未被占用 |
| 失败症状 | PDF 按钮红灯「服务未启动」；导出无反应 |

#### `PORT-05` 预览端口 4173

| 字段 | 内容 |
| --- | --- |
| 位置 | `playwright.config.js:37,107` |
| 作用 | CI 环境下 `npm run preview` 的端口 |
| 当前值 | `4173` |
| 覆盖方式 | ❌ 硬编码 |
| 移植动作 | 一般不动；仅 CI 流水线端口冲突时改 |
| 失败症状 | E2E 在 CI 连不上预览服务 |

### 12.4 环境变量类（ENV）

#### `ENV-01` 数据库连接五项

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/db.js:5-9`（`DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`） |
| 作用 | MySQL 连接池参数；Python 脚本不读此处 |
| 当前值 | `localhost` / `3306` / `root` / 空（实际密码在 `.env`） / `language_learning` |
| 覆盖方式 | ✅ 全部 env（`.env` 由 `server/index.js:3` 的 `dotenv/config` 加载） |
| 移植动作 | 新建项目根 `.env`，按新机 MySQL 填写（示例见 §7.1 / 迁移文档） |
| 失败症状 | 密码错 → 后端所有 DB 接口 500；`.env` 丢失 → 静默用空密码 root，报「连不上但不知为何」 |

#### `ENV-02` 后端端口 `SERVER_PORT`

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/index.js:23` `process.env.SERVER_PORT \|\| 3000` |
| 作用 | 覆盖后端监听端口（见 `PORT-02`） |
| 当前值 | 未设（用 3000） |
| 覆盖方式 | ✅ env |
| 移植动作 | 若改端口，`.env` 写 `SERVER_PORT`，同时改 `vite.config.js:205` |
| 失败症状 | 只改 env 不改代理 → 前端不通 |

#### `ENV-03` Python 路径两项

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/index.js:962`（`PYTHON_HOME`） |
| 作用 | 覆盖 `PATH-01` |
| 当前值 | 未设（用硬编码默认值） |
| 覆盖方式 | ✅ env |
| 移植动作 | 推荐在 `.env` 设这个值，避免改源码 |
| 失败症状 | 未设且默认值指向旧机 → 见 `PATH-01` 症状 |

#### `ENV-04` 前端 API 基址 `VITE_API_BASE_URL`

| 字段 | 内容 |
| --- | --- |
| 位置 | `src/api/index.js:1-2` `import.meta.env?.VITE_API_BASE_URL \|\| '/api'` |
| 作用 | 前端 API 请求的基址 |
| 当前值 | `/api`（同源，走 Vite 代理） |
| 覆盖方式 | ✅ 但为**构建期**变量（`import.meta.env`） |
| 移植动作 | 默认同源无需改；独立部署后端时设该值并**重新构建** |
| 失败症状 | 指错基址 → 所有 API 404 |

#### `ENV-05` 编辑器置前开关 `VITE_FOCUS_EDITOR`

| 字段 | 内容 |
| --- | --- |
| 位置 | `vite.config.js:118` |
| 作用 | 是否启用 `focus_editor.py` 窗口置前 |
| 当前值 | 未设（默认关闭） |
| 覆盖方式 | ✅ env（`=1` 开启） |
| 移植动作 | 需要置前功能且新机装了 pywin32 时设 `=1` |
| 失败症状 | 未装 pywin32 时设了也静默失效（脚本 exit(3)） |

#### `ENV-06` `LOCALAPPDATA`

| 字段 | 内容 |
| --- | --- |
| 位置 | `vite.config.js:24` `process.env.LOCALAPPDATA \|\| ''` |
| 作用 | 定位用户级 VS Code / CodeBuddy 安装目录（见 `EXE-01`） |
| 当前值 | 系统提供 |
| 覆盖方式 | ✅ 系统环境变量（一般不用手动改） |
| 移植动作 | 无需改；新机用户目录自动不同 |
| 失败症状 | 缺失时少一组候选路径，靠 `where code` 兜底 |

#### `ENV-07` TXT 导入 `TXT_DIR` / `FOLDER_ID`

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/reimport_all.cjs:8,10` |
| 作用 | 一次性导入的源目录与目标文件夹 ID |
| 当前值 | `TXT_DIR` 见 `PATH-07`；`FOLDER_ID` 空（**必须显式设置**） |
| 覆盖方式 | ✅ env |
| 移植动作 | 用导入功能时两个都要设 |
| 失败症状 | `FOLDER_ID` 空 → 控制台报错 exit(1)（`:12-15`） |

#### `ENV-08` `ProgramFiles`

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/start-all.py:55`、`restart-backend.py:56` |
| 作用 | node.exe 兜底路径的基准 |
| 当前值 | 系统提供，回退 `C:\Program Files` |
| 覆盖方式 | ✅ 系统环境变量 |
| 移植动作 | 无需改 |
| 失败症状 | 见 `PATH-13` |

#### `ENV-09` 编码变量 `PYTHONUTF8` / `PYTHONIOENCODING`

| 字段 | 内容 |
| --- | --- |
| 位置 | 两个 `.bat:46/50` 设 `PYTHONUTF8=1`；`server/index.js:1116` 向 TTS 子进程注入两者 |
| 作用 | 保证 Python 子进程 stdout/stderr 用 UTF-8，避免中文乱码 |
| 当前值 | `1` / `utf-8`（仅 TTS 子进程由 Node 注入） |
| 覆盖方式 | ✅ env（但 PDF 服务等其它 Python 进程未被 Node 注入，靠 bat 或系统环境） |
| 移植动作 | GBK locale 新机上建议系统级设 `PYTHONUTF8=1` |
| 失败症状 | 中文日志乱码或 `UnicodeEncodeError`（见 `LOC-01`~`03`） |

#### `ENV-10` `CI`

| 字段 | 内容 |
| --- | --- |
| 位置 | `playwright.config.js:25,27,29,37,43,106-108`（8 处） |
| 作用 | 切换 E2E 的 baseURL / webServer 命令 / 端口 |
| 当前值 | 未设（本地 dev 模式） |
| 覆盖方式 | ✅ env（CI 系统自动设） |
| 移植动作 | 无需改 |
| 失败症状 | 无 |

### 12.5 文件 / 目录类（FILE）

#### `FILE-01` MySQL 数据目录 `mysql-data/`

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/start-all.py:228-229` 注释；`docs/migrate-to-new-pc.md:264-273` 的 `my.ini datadir` |
| 作用 | 数据库实际数据文件，设计为随项目走 |
| 当前值 | `<项目根>\mysql-data`（已 gitignore） |
| 覆盖方式 | ❌ 由 `my.ini` 的 `datadir` 决定 |
| 移植动作 | 拷目录 + 改 my.ini datadir + **`icacls` 给 `NT AUTHORITY\NetworkService` 写权限** |
| 失败症状 | 无 ACL → MySQL 以服务账号启动失败；datadir 指错 → 数据「消失」 |

#### `FILE-02` 数据库备份 `db/language_learning.sql`

| 字段 | 内容 |
| --- | --- |
| 位置 | `db/language_learning.sql:1-5`（dump 8.0.46 / utf8mb4） |
| 作用 | Git 跟踪的数据备份；新机可导入恢复 |
| 当前值 | 约 308 KB |
| 覆盖方式 | 文件本身（用 `mysqldump` 重新生成） |
| 移植动作 | 用 Git 同步；新库导入后需 `/api/init` 或重启后端补列（见 §8.8） |
| 失败症状 | 未导入 / 未补列 → 表不存在或缺 `marks`/`type` 列 → 接口报错 |

#### `FILE-03` `.env` 配置文件

| 字段 | 内容 |
| --- | --- |
| 位置 | 项目根 `.env`（`server/index.js:3` 加载）；当前磁盘**不存在** |
| 作用 | 集中存 DB 连接、Python 路径、端口覆盖 |
| 当前值 | 无（需自行新建；示例见 `docs/MySQL连接配置说明.md:34-46`） |
| 覆盖方式 | 文件本身 |
| 移植动作 | 新机新建并填写；已 gitignore，不会随仓库过去 |
| 失败症状 | 见 `ENV-01` |

#### `FILE-04` 日志目录 `logs/`

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/start-all.py:156-178` `launch()`；两个 `.bat` 重定向 |
| 作用 | 后端 / 前端 / 启停脚本的输出日志 |
| 当前值 | `<项目根>\logs`（当前磁盘不存在，运行时创建） |
| 覆盖方式 | 无（固定项目根下） |
| 移植动作 | 无需改；排查问题时看这里 |
| 失败症状 | 无日志时先确认是否绕过 bat 直接跑 .py（此时无重定向） |

#### `FILE-05` `__pycache__/` / `*.pyc`

| 字段 | 内容 |
| --- | --- |
| 位置 | Python 运行时生成；`.gitignore:54-56` 忽略 |
| 作用 | 字节码缓存 |
| 当前值 | 当前磁盘未发现 |
| 覆盖方式 | 无 |
| 移植动作 | 不随项目拷；跨机 Python 版本不同可能需删旧缓存 |
| 失败症状 | 极少数情况因旧 pyc 与新源码不符导致行为异常，删除即可 |

#### `FILE-06` PDF 字体（隐式依赖）

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/pdf_export.py:56`、`notes_pdf_export.py:94` `"cjk_font": "STSong-Light"`（reportlab 内置 CID 字体，**不嵌入字形**） |
| 作用 | 中文 PDF 排版 |
| 当前值 | `STSong-Light`（无外部字体文件，全仓无 `TTFont` 调用） |
| 覆盖方式 | ❌ 需改代码换字体 |
| 移植动作 | 确认新机 PDF 阅读器有中文字形；缺字时改嵌入 TTF（见 §10.3） |
| 失败症状 | 中文显示空白或方框（tofu），混排右边界漂移 |

#### `FILE-07` Playwright 浏览器二进制

| 字段 | 内容 |
| --- | --- |
| 位置 | 默认 `%LOCALAPPDATA%\ms-playwright`（项目外用户目录）；`playwright.config.js:48-65` 定义项目 |
| 作用 | E2E 测试的浏览器 |
| 当前值 | 用户目录下（不在项目内） |
| 覆盖方式 | 环境变量 `PLAYWRIGHT_BROWSERS_PATH`（当前未用） |
| 移植动作 | 新机执行 `npx playwright install` |
| 失败症状 | E2E 报 "Executable doesn't exist" |

#### `FILE-08` Git 配置 `.git/config`

| 字段 | 内容 |
| --- | --- |
| 位置 | `.git/config:8-10` SSH origin、`:18-20` 本地 Git 身份 |
| 作用 | 版本推送与提交身份 |
| 当前值 | `git@github.com:lsp-hubb/language-learning.git`；身份 `language-learning-local` |
| 覆盖方式 | `git remote set-url` / `git config user.*` |
| 移植动作 | 新机配 GitHub SSH key + 放通出站 22；按新机网络决定 SSH/HTTPS（见 `NET-05`） |
| 失败症状 | `git pull/push` 认证失败或超时 |

### 12.6 进程 / 命令类（PROC）

#### `PROC-01` `start-all.py` 启动顺序

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/start-all.py:4-10,39-42,225-371` |
| 作用 | 依次拉 MySQL(3306)→后端(3000)→前端(5173)→PDF(5057)，已监听则跳过 |
| 当前值 | 端口常量见 §12.3；`DETACHED_PROCESS` 脱离终端 |
| 覆盖方式 | 无（改端口即改 §12.3 各接口） |
| 移植动作 | 跑一次验证四个端口都 UP；注意「跳过 = 不重载代码」 |
| 失败症状 | 改了代码却没生效（因端口已监听被跳过）→ 用 `restart-*.py` |

#### `PROC-02` `stop-all.py` 停止顺序

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/stop-all.py:4-5,58-125` |
| 作用 | 依次停 5173→3000→5057→MySQL |
| 当前值 | 端口见 `:60-62`；MySQL 走 `net stop` 或强杀 3306 |
| 覆盖方式 | 无 |
| 移植动作 | 非管理员停 MySQL 会失败；若 3306 被别的软件占用会误杀（谨慎） |
| 失败症状 | MySQL 停不掉（服务账号 / 权限）；误杀外部数据库 |

#### `PROC-03` `restart-backend.py`

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/restart-backend.py:247-290` |
| 作用 | 校验监听者必须 `node.exe` → 杀 → 等释放 → 重启 → 健康检查 → 校验新 PID |
| 当前值 | 端口 3000，健康检查 `/api/health` |
| 覆盖方式 | 无 |
| 移植动作 | 改完 `server/index.js` 用它；新机确认 `tasklist`/`netstat` 可用 |
| 失败症状 | 监听者非 node.exe 时拒绝重启；命令被安全软件禁用时全失效 |

#### `PROC-04` `restart-pdf.py`

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/restart-pdf.py:16-20,311-364` |
| 作用 | 杀 python.exe 主进程 + uvicorn 子进程树 → 重启 → `/health` 要求 ok:true |
| 当前值 | 端口 5057 |
| 覆盖方式 | 无 |
| 移植动作 | 新机若为 Win11/Server2022，`wmic` 被移除会导致取父进程失败（见 `PROC-06`） |
| 失败症状 | 无法重启 PDF 服务；新旧 PID 有交集时脚本 exit(1) |

#### `PROC-05` bat 自隐藏机制

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/bat/start-all.bat:32-38`、`stop-all.bat:36-42` |
| 作用 | 写 `%TEMP%\ll_run_hidden.vbs`，用 `wscript //nologo` 重启自身隐藏 cmd 黑窗 |
| 当前值 | 固定临时文件名 `ll_run_hidden.vbs` |
| 覆盖方式 | 无 |
| 移植动作 | 确认新机未禁用脚本宿主（wscript/cscript） |
| 失败症状 | 禁用脚本宿主时双击失败或弹黑窗；同名残留 vbs 可能执行旧内容 |

#### `PROC-06` Windows 内置命令依赖

| 字段 | 内容 |
| --- | --- |
| 位置 | 各脚本的 `netstat -ano`（`start-all.py:101-103` 等）、`taskkill /PID ... /F`、`sc query`、`net start/stop`、`tasklist`、`wmic`（`restart-pdf.py:135`） |
| 作用 | 端口探测、进程查杀、服务查询 |
| 当前值 | 依赖 PATH 中的系统命令 |
| 覆盖方式 | 无 |
| 移植动作 | **重点**：Win11/Server2022 的 `wmic` 已移除，需改写 `parent_of()` |
| 失败症状 | 命令不可用 → 服务探测 / 停止全失效；`restart-pdf.py` 保守拒绝 kill |

#### `PROC-07` 浏览器打开

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/start-all.py:356-371` `os.startfile(...)` → 回退 `webbrowser.open(...)` |
| 作用 | 服务就绪后打开前端页面 |
| 当前值 | `http://localhost:5173/` |
| 覆盖方式 | 间接：随 `PORT-03` |
| 移植动作 | 确认新机默认浏览器关联正常 |
| 失败症状 | `os.startfile` 是 Windows 专有；关联异常时打开错误程序或无反应 |

#### `PROC-08` MySQL 服务名

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/start-all.py:66-86`、`stop-all.py:25-44` `detect_mysql_service()` |
| 作用 | 定位 MySQL Windows 服务名 |
| 当前值 | 优先 `MySQL80`，探测 `sc query ... findstr "MySQL"`，兜底 `MySQL80` |
| 覆盖方式 | ❌ 自动探测 + 兜底 |
| 移植动作 | 新机服务名不同且探测受限时走 `mysqld` 直接拉起分支 |
| 失败症状 | 服务名错 → `net start` 失败；但会回退直接拉起 mysqld |

### 12.7 EXE / 编辑器类（EXE）

#### `EXE-01` 编辑器 EXE 探测

| 字段 | 内容 |
| --- | --- |
| 位置 | `vite.config.js:11-56` `resolveEditorExe()`，候选 `:26-31` |
| 作用 | 组件检查器「打开到编辑器」取真正 `.exe`（非 `code.cmd`）避免弹黑窗 |
| 当前值 | VS Code（D:/C: 安装 + `%LOCALAPPDATA%`）、CodeBuddy 多个候选 + `where code` 反推 |
| 覆盖方式 | ❌ 硬编码候选列表 |
| 移植动作 | 新机编辑器在其它位置 / 换 Cursor 时，把新路径加进候选（靠 `where` 兜底） |
| 失败症状 | 全部落空返回 `not-found` → 跳转可能弹 cmd 黑窗 |

#### `EXE-02` 无黑窗打开编辑器插件

| 字段 | 内容 |
| --- | --- |
| 位置 | `vite.config.js:126-193` `no-window-open-in-editor()` |
| 作用 | 拦截 `/__open-in-editor`，`spawn(editorExe, ..., {windowsHide:true})` 绕开 cmd.exe |
| 当前值 | 插件注册顺序最前；devtools `launchEditor: editorExe \|\| 'code'` |
| 覆盖方式 | 无（依赖 `EXE-01` 的结果） |
| 移植动作 | 无需单独改；确认 `EXE-01` 能解析到 exe |
| 失败症状 | 编辑器 EXE 未找到时降级为 `code`，可能弹黑窗 |

#### `EXE-03` `focus_editor.py` 窗口置前

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/focus_editor.py:1-25,205-210`；调用在 `vite.config.js:166-171` |
| 作用 | 用 pywin32 + ctypes 找编辑器窗口并置前 |
| 当前值 | 默认进程名 `Code.exe`，超时 8s；由 `VITE_FOCUS_EDITOR=1` 开启 |
| 覆盖方式 | CLI `--process` 参数（默认 Code.exe 写死在 `:207`） |
| 移植动作 | 换成别的编辑器时改 `:207` 默认值或传 `--process`；装 pywin32 |
| 失败症状 | 缺 pywin32 → exit(3) 静默；进程名不匹配 → 找不到窗口；RDP 断开取不到窗口 |

### 12.8 前端本地类（FE）

#### `FE-01` PDF 服务直连地址

| 字段 | 内容 |
| --- | --- |
| 位置 | `src/components/PdfExportButton.vue:14` `const PDF_SERVICE = 'http://127.0.0.1:5057'`；消费 `:102,162` |
| 作用 | 前端直连 PDF 服务（不经 Vite 代理，因为返回二进制流） |
| 当前值 | `http://127.0.0.1:5057` |
| 覆盖方式 | ❌ **硬编码 + 构建期产物**，改后必须 `npm run build` |
| 移植动作 | 改 `PORT-04` 时同步此处并重新构建；LAN 设备用不了 PDF（仅 127.0.0.1） |
| 失败症状 | 地址错 → 按钮红灯「请先运行 scripts/start-all.py」 |

#### `FE-02` 浏览器下载（Blob）

| 字段 | 内容 |
| --- | --- |
| 位置 | `PdfExportButton.vue:162-183`、`src/utils/folderBundle.js:70-79` |
| 作用 | PDF / 文件夹包导出：`Blob` → `createObjectURL` → 动态 `<a download>.click()` |
| 当前值 | PDF 40s 后 revoke；文件夹包 1s 后 revoke |
| 覆盖方式 | 无（纯前端） |
| 移植动作 | 无需改 |
| 失败症状 | 下载无反应时检查浏览器下载权限 / Content-Disposition |

#### `FE-03` localStorage 键（9 个）

| 字段 | 内容 |
| --- | --- |
| 位置 | 见 §6.5 全量表（`sidePanelState`/`lastPage`/`lastFolderId`/`fontSize`/`readerScroll:*`/`noteMarkedView`/`noteScroll:*`/`_manual_word_card_pos`/`read-aloud-voice`） |
| 作用 | 浏览器本地状态（重启恢复、面板偏好、滚动位置等） |
| 当前值 | 存于浏览器 profile，随浏览器走不随项目走 |
| 覆盖方式 | 无（浏览器本地） |
| 移植动作 | 无需迁移；新机等于全新状态（正常） |
| 失败症状 | 无（最多状态不恢复） |

#### `FE-04` 上传 / beacon 兜底

| 字段 | 内容 |
| --- | --- |
| 位置 | `FolderImportDialog.vue:13,65-95,140-146`、`folderBundle.js:6,27-48`、`src/api/index.js:74-90,182-199` |
| 作用 | 文件夹包 100MB 上传校验 + 页面关闭时 `sendBeacon` 兜底投递笔迹 |
| 当前值 | `MAX_BUNDLE_BYTES=100MB`，导入超时 120s |
| 覆盖方式 | 无 |
| 移植动作 | 无需改 |
| 失败症状 | 超限文件被前端预检拒绝；beacon 失败回退 `fetch keepalive` |

### 12.9 依赖 / 网络 / 编码类（DEP / NET / LOC）

#### `DEP-01` pip 依赖（无清单）

| 字段 | 内容 |
| --- | --- |
| 位置 | 项目内**无** `requirements.txt`；唯一说明 `docs/python-env.md:29-34` |
| 作用 | PDF 服务 / 朗读 / 置前功能的 Python 包 |
| 当前值 | venv 内装了 fastapi 0.141.1 / pymupdf 1.28.2 / reportlab / edge_tts 7.3.1 / pywin32 |
| 覆盖方式 | 装包（无版本锁） |
| 移植动作 | 新机 `python -m venv` + `pip install fastapi "uvicorn[standard]" PyMuPDF reportlab pywin32 edge-tts`（建议补 `requirements.txt` 锁版本） |
| 失败症状 | PDF `/health` ok:false 或导出 500；朗读每次 spawn 失败；置前静默失效 |

#### `DEP-02` npm 依赖与 Node 版本

| 字段 | 内容 |
| --- | --- |
| 位置 | `package.json:15-38`（依赖 + `engines.node ^20.19.0 \|\| >=22.12.0`）；`node_modules` 已 gitignore |
| 作用 | 前端 + 后端运行依赖 |
| 当前值 | 本机已 `npm install` |
| 覆盖方式 | 装包 |
| 移植动作 | 新机先确认 Node 版本，再 `npm install`（旧 node_modules 含平台二进制，别直接拷） |
| 失败症状 | Node 版本不符 Vite 退出；缺依赖启动报模块找不到 |

#### `DEP-03` pywin32

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/focus_editor.py:40-47` import win32gui 等；`vite.config.js:84-95` 实测 `import win32gui` |
| 作用 | 编辑器窗口置前 + `canRunFocus()` 探测 |
| 当前值 | 装在旧 venv，含系统注册 DLL |
| 覆盖方式 | 装包（新机必须重装，不能只拷文件） |
| 移植动作 | 新 venv 内 `pip install pywin32` |
| 失败症状 | 置前功能静默失效（exit(3)）；`resolvePythonw()` 跳过该候选 |

#### `DEP-04` Playwright 浏览器（见 `FILE-07`）

#### `NET-01` 有道查词

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/index.js:738`、`fetchYoudaoHtml()` `:594-637`（8s 超时 + 3 次重试） |
| 作用 | 单词释义查询 |
| 当前值 | `https://dict.youdao.com/result?...` |
| 覆盖方式 | ❌ 硬编码（一般不动） |
| 移植动作 | 确保新机 DNS/代理/防火墙放通 443；被拦截时等满 8s×3 才报错 |
| 失败症状 | 查词卡显示中文错误；明显卡顿 |

#### `NET-02` 有道联想词

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/index.js:650-657`（5s 超时） |
| 作用 | 手动查词卡联想词 |
| 当前值 | `https://dict.youdao.com/suggest?...` |
| 覆盖方式 | ❌ 硬编码 |
| 移植动作 | 放通网络 |
| 失败症状 | 502 +「联想词服务暂时不可用」 |

#### `NET-03` 有道发音

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/index.js:873,891-896` |
| 作用 | 单词英 / 美发音代理 |
| 当前值 | `https://dict.youdao.com/dictvoice?...` |
| 覆盖方式 | ❌ 硬编码 |
| 移植动作 | 放通网络 |
| 失败症状 | 发音无声；后台预热失败**完全静默**（无提示） |

#### `NET-04` Edge TTS

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/tts_synth.py:20,38-40,65-70`（端点在库内固定） |
| 作用 | 逐段朗读在线合成（微软 WebSocket） |
| 当前值 | 三音色 Andrew / Emma / Ryan |
| 覆盖方式 | ❌ 库内固定 |
| 移植动作 | 放通 443 + WebSocket；装 `edge_tts` |
| 失败症状 | 每段带 error，前端报「TTS 进程退出」 |

#### `NET-05` AI 站点与 Git 远端

| 字段 | 内容 |
| --- | --- |
| 位置 | `src/App.vue:107-110` 四个 AI URL；`.git/config:8-10` SSH origin |
| 作用 | 侧边栏 AI iframe + 版本推送 |
| 当前值 | 元宝 / 豆包 / 千问 / DeepSeek；`git@github.com:...` |
| 覆盖方式 | ❌ 硬编码 |
| 移植动作 | AI 站点一般不动；Git 按新机网络选 SSH（22）/ HTTPS（443），见 §10.6 |
| 失败症状 | iframe 空白；`git pull/push` 认证失败或超时 |

#### `LOC-01` bat 代码页

| 字段 | 内容 |
| --- | --- |
| 位置 | `scripts/bat/start-all.bat:42`、`stop-all.bat:46` `chcp 65001` |
| 作用 | 让 cmd 输出 / 重定向日志用 UTF-8 |
| 当前值 | 65001；bat 文件故意纯英文（避免代码页解析问题） |
| 覆盖方式 | 无 |
| 移植动作 | 不要往 bat 里加中文注释 / echo |
| 失败症状 | 中文内容在特定代码页导致 cmd 解析失败 |

#### `LOC-02` PDF 输入编码

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/pdf_export.py:585`、`notes_pdf_export.py:653`（CLI stdin 读取未指定编码） |
| 作用 | CLI 模式读文章正文 |
| 当前值 | 依赖控制台编码 |
| 覆盖方式 | 无 |
| 移植动作 | GBK 控制台下手动调用 CLI 时需留意中文解码 |
| 失败症状 | 中文文章乱码（仅 CLI 手动调用，服务路径收 JSON 不受影响） |

#### `LOC-03` 数据库字符集 / 时区

| 字段 | 内容 |
| --- | --- |
| 位置 | `server/db.js:4-13`（未设 charset/timezone）；`db/language_learning.sql:10-12`（导入时 `utf8mb4` + UTC） |
| 作用 | 连接字符集与时区 |
| 当前值 | 依赖 mysql2 与服务端默认值 |
| 覆盖方式 | 可在 `createPool` 加 `charset:'utf8mb4'`, `timezone:'+00:00'`（当前未设） |
| 移植动作 | 新机建库用 `utf8mb4_unicode_ci`；系统时区不同会致 TIMESTAMP 偏移 |
| 失败症状 | emoji / 部分中文写入失败；时间显示整体偏移 |

---

## 13. 移植执行清单（AI 执行用）

按顺序执行，每步做完勾选。括号内为涉及接口 ID，可跳回 §12 卡片看细节。

- [ ] **1. 安装基础运行时**：确认 Node 满足 `^20.19.0 || >=22.12.0`（`DEP-02`）；安装 MySQL 8.0（`PROC-08`）；确认有 Python 3.11（`PATH-10`）。
- [ ] **2. 重建 Python 环境**：`python -m venv <新路径>` → 激活 → `pip install fastapi "uvicorn[standard]" PyMuPDF reportlab pywin32 edge-tts`（`DEP-01/03`、`PATH-10`）。**不要复制旧 venv**。
- [ ] **3. 安装前端依赖**：`npm install`（`DEP-02`）；需要 E2E 再 `npx playwright install`（`FILE-07`）。
- [ ] **4. 恢复数据库**：建库 `utf8mb4_unicode_ci` → 导入 `db/language_learning.sql` → 确认 `datadir` 与 ACL（`FILE-01/02`、`LOC-03`）。若整包拷 `mysql-data`，改 `my.ini datadir` + `icacls` 授权 `NetworkService`。
- [ ] **5. 新建 `.env`**：按新机填 `DB_HOST/PORT/USER/PASSWORD/NAME`，需要时加 `SERVER_PORT`、`PYTHON_HOME`（`FILE-03`、`ENV-01/02/03`）。
- [ ] **6. 修双击 bat 硬编码**：`start-all.bat`/`stop-all.bat` 的 `PROJECT_DIR`、`VENV_PY` 改新路径或改相对推导（`PATH-08/09`）。
- [ ] **7. 核对端口未被占用**：3306 / 3000 / 5173 / 5057（`PORT-01`~`04`）；冲突时按 §12.3 同步改所有位置（PDF 端口还要重新构建前端）。
- [ ] **8. 核对编辑器路径**（可选）：换编辑器时改 `vite.config.js` 候选与 `focus_editor.py:207`；需要置前则装 pywin32 并设 `VITE_FOCUS_EDITOR=1`（`EXE-01/03`、`ENV-05`、`DEP-03`）。
- [ ] **9. 网络可达性**：放通有道 443、edge-tts WebSocket、AI 站点、Git SSH 22（`NET-01`~`05`）。
- [ ] **10. 首次启动验证**：`python scripts/start-all.py`（或双击 bat）→ 确认 4 个端口 UP + `/api/health` 200 → 浏览器自动打开（`PROC-01/07`）。
- [ ] **11. 功能冒烟**：登录首页刷新不丢数据 → 打开文章 → 查词 / 朗读 / PDF 导出 / 画布各点一次，按 §12 卡片「失败症状」反查问题。
- [ ] **12. Win11/Server2022 特别检查**：`wmic` 是否可用；不可用则改写 `restart-pdf.py` 的 `parent_of()`（`PROC-04/06`）。

> 完成 1–11 后项目即可正常运行；第 12 步只影响「重启 PDF 服务」这一运维操作。若希望「以后只改一个文件就能移植」，需按 §11.3 做架构改造（当前做不到零重建）。
