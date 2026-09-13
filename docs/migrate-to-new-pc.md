# 换电脑部署指南（整包复制）

> 适用场景：把本项目**所有文件整体拷贝**到一台新电脑（不是 `git clone`），并重新下载 / 配置依赖后运行。
> 核心原则：**源码可复制，依赖与虚拟环境必须在新机器上重建**。

---

## 0. 一分钟速览

| 步骤 | 做什么 |
| --- | --- |
| 1 | 新电脑安装 **Node.js**（^20.19.0 或 ≥22.12.0）、**MySQL 8.0**、**Python 3.11** |
| 2 | 复制项目源码（**不要**复制 `node_modules`、`.venv`、`mysql-data`） |
| 3 | 项目根执行 `npm install`（重建 Node 依赖） |
| 4 | 在**项目父目录**创建 `.venv` 并 `pip install`（重建 Python 依赖） |
| 5 | 按需重建 `.env`（数据库连接） |
| 6 | 启动 MySQL → 导入 `db/language_learning.sql` |
| 7 | 运行 `python scripts/start-all.py` → 浏览器访问 http://localhost:5173 |

---

## 1. 新电脑需要安装的东西

| 依赖 | 版本要求 | 下载 / 说明 |
| --- | --- | --- |
| **Node.js** | `^20.19.0 \|\| >=22.12.0` | https://nodejs.org/ （Vite 8 的硬性要求，版本不符会启动失败） |
| **MySQL** | 8.0 | https://dev.mysql.com/downloads/installer/ ，安装为 Windows 服务，服务名建议 `MySQL80` |
| **Python** | 3.11.x | https://www.python.org/downloads/ ，安装时勾选 **Add python.exe to PATH** |
| **Git**（可选） | — | https://git-scm.com/ ，仅当需要版本管理 |
| **VS Code / CodeBuddy**（可选） | — | 用于 Ctrl+I 组件检查器跳转源码；不装不影响主功能 |

> `.env` 中的 `DB_PASSWORD` 默认为**空**（对应 root 空密码）。若新机器 MySQL 的 root 设了密码，见 5.2 节修改。

---

## 2. 拷贝哪些文件（关键）

**需要复制：**

```
Language-learning/
├── src/  server/  scripts/  public/  db/  docs/  markdown/  e2e/
├── package.json  package-lock.json
├── index.html  jsconfig.json
├── vite.config.js  vitest.config.js  playwright.config.js
├── start.bat  start-mysql.bat
├── .env                    # 环境变量（重要，见 5.2）
└── db/language_learning.sql # 数据库备份（重要，见 5.4）
```

**不要复制（或复制后删除，都是可再生成的）：**

| 目录 / 文件 | 原因 |
| --- | --- |
| `node_modules/` | 含平台相关二进制（esbuild/rollup 等），跨机器必须重装 |
| `.venv/`（若在项目内 / 父目录） | 虚拟环境**不可移植**：`pyvenv.cfg` 与 `Scripts\*.exe` 记录绝对路径 |
| `mysql-data/` | MySQL 数据目录，复用风险高（见 第 8 节） |
| `dist/` `coverage/` `test-results/` `playwright-report/` | 构建 / 测试产物 |
| `__pycache__/` | Python 缓存 |

> 若通过 **U 盘 / 压缩包**整体复制，建议先删掉上面这些再打包，体积会小很多。
> `.gitignore` 已排除 `node_modules`、`.env`、`mysql-data`（但**文件复制不受 .gitignore 影响**，需手动排除）。

---

## 3. 放置项目

放哪个盘 / 哪个目录都可以，`start-all.py`、`stop-all.py`、`vite.config.js` 都会**自动推导路径**，搬家不会失效。

但有两处**硬编码路径**需要按新机器修改（都不影响主功能，详见 5.3）：

- `server/index.js` → `/api/run-python`（工具栏「启动 Python 脚本」功能）
- `scripts/reimport_all.cjs` → `TXT_DIR`（TXT 批量导入脚本）

---

## 4. 安装 Node 依赖（前端 + 后端）

在项目根目录：

```powershell
cd <新项目路径>\Language-learning
npm install
```

- 若复制时带上了旧的 `node_modules`，请先删除再执行 `npm install`。
- `package-lock.json` 可保留，能保证依赖版本与原机器一致。

验证：

```powershell
node -v     # 应输出 v20.19+ 或 v22.12+
npm -v
```

---

## 5. 安装 Python 依赖

Python 用于三件事：**PDF 导出服务（5057）**、**一键启停脚本**、**组件检查器窗口置前**（可选）。

### 5.1 创建虚拟环境并安装依赖

`scripts/start-all.py` 探测顺序是：`<项目父目录>\.venv\Scripts\python.exe` → PATH 中的 `python`。
因此**推荐把 venv 建在项目父目录**（与原机器 `F:\PythonProject\.venv` 的布局一致）：

```powershell
cd <新项目父目录>
python -m venv .venv
.\.venv\Scripts\activate

# 必需：PDF 导出服务（5057）
pip install fastapi "uvicorn[standard]" PyMuPDF reportlab

# 可选：组件检查器跳转后把编辑器窗口置前（scripts/focus_editor.py）
pip install pywin32
```

> 也可建在项目根 `.venv`，但那样 `start-all.py` 只能回退到 PATH 里的 `python`——
> 需先 `activate` 再运行，或把该 venv 的 `Scripts` 加入 PATH。

验证 PDF 依赖：

```powershell
python -c "import fitz, reportlab, fastapi, uvicorn; print('python deps OK')"
```

### 5.2 配置 `.env`

若复制过来的 `.env` 存在则直接检查；不存在则在**项目根**新建（该文件在 `.gitignore` 中，不会被 Git 跟踪）：

```ini
# MySQL 数据库连接配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=          # 新机器 MySQL root 有密码时填这里
DB_NAME=language_learning

# 服务端端口
SERVER_PORT=3000
```

### 5.3 修正硬编码路径（可选）

**（1）`server/index.js` 的 `/api/run-python`** —— 写死了原机器路径，**只有点击工具栏「启动 Python 脚本」时才用到**：

```js
const SCRIPTS = {
  'clipboard_to_txt': 'F:\\PythonProject\\Python\\clipboard_to_txt.py',
}
const pythonBin = 'F:\\PythonProject\\.venv\\Scripts\\pythonw.exe'
const proc = spawn(pythonBin, [scriptPath], {
  cwd: 'F:\\PythonProject\\Python',
  ...
})
```

**（2）`scripts/reimport_all.cjs` 的 `TXT_DIR`** —— 仅用于 TXT 文章批量导入：

```js
const TXT_DIR = 'F:\\PythonProject\\temp\\2021.10分散';
```

不改也不影响阅读 / 查词 / 批注 / PDF 等主功能；要用就把这些路径改成新机器的实际路径。

---

## 6. 配置 MySQL 并导入数据

### 6.1 启动 MySQL 服务

```powershell
sc query MySQL80                # 查看状态
net start MySQL80               # 未运行时以管理员启动
```

或双击项目根的 `start-mysql.bat`（会自动请求 UAC 提权）。

### 6.2 导入数据库备份

`db/language_learning.sql` 是完整 `mysqldump`，**内部已含 `CREATE DATABASE language_learning` 与 `USE`**，无需提前建库：

```powershell
mysql -u root < db\language_learning.sql
# root 有密码时：
mysql -u root -p < db\language_learning.sql
```

验证：

```powershell
mysql -u root -e "USE language_learning; SHOW TABLES;"
```

应看到 `folders / articles / annotations / favorites / canvas_strokes` 等表。

> `articles.notes` 列即使备份中缺失，后端启动时会用 `ALTER TABLE ... ADD COLUMN notes TEXT` 幂等补齐，无需手动处理。

---

## 7. 启动与验证

### 7.1 一键启动（推荐）

```powershell
python scripts\start-all.py
```

脚本会：MySQL(3306) → 后端(3000) → 前端(5173) → PDF 服务(5057)，每个服务**带延时循环检测**（最多各等 10s）确认就绪后，才打开浏览器。

正常输出示例：

```
[start] mysql ready (port 3306, after 1 check(s))
[start] backend ready (port 3000, after 2 check(s))
[start] frontend ready (port 5173, after 3 check(s))
[start] pdf-service ready (port 5057, after 1 check(s))
[start] backend health OK: {"status":"ok",...}
[start] opened browser: http://localhost:5173/
```

停止：

```powershell
python scripts\stop-all.py
```

> 备选：`start.bat`（只起前后端，不含 MySQL 与 5057）。
> ⚠️ `stop-all.py` 会尝试停止 MySQL；若该实例上还跑着**其他项目**的库，请勿使用，改为手动关闭前后端窗口。

### 7.2 端口一览

| 端口 | 服务 | 绑定 |
| --- | --- | --- |
| 3306 | MySQL80 | `127.0.0.1` |
| 3000 | Express 后端 | `localhost`（前端经 Vite 代理 `/api`） |
| 5173 | Vite 前端 | `0.0.0.0`（本机 + 局域网） |
| 5057 | PDF 导出服务 | `127.0.0.1`（仅本机） |

### 7.3 初始化数据表

首次访问 http://localhost:5173 时前端会自动调用 `POST /api/init` 建表；也可手动：

```powershell
curl -X POST http://localhost:3000/api/init
```

### 7.4 局域网访问（可选）

放行 5173 入站：

```powershell
netsh advfirewall firewall add rule name="Vite5173" dir=in action=allow protocol=TCP localport=5173
```

其他设备访问 `http://<本机IP>:5173`。注意 **5057（PDF 导出）仅监听本机，局域网设备用不了**。

---

## 8. 关于直接用旧 MySQL 数据目录（不推荐）

原机器的 MySQL `datadir` 指向项目内的 `mysql-data/`。理论上把该目录一起复制后，让 MySQL 服务指向它即可原样恢复，但：

- 数据库版本必须完全一致（本备份为 **MySQL 8.0.46**）；
- 需以管理员修改服务 `--datadir` 或 `my.ini`，路径不同还可能遇到表空间路径校验；
- MySQL 8.0 若在 datadir 里残留同名空目录，`CREATE DATABASE` 会报 `ER_SCHEMA_DIR_EXISTS`。

**推荐做法**：新机器正常安装 MySQL → 用第 6.2 节的 `db/language_learning.sql` 导入，简单可靠。

---

## 9. 常见问题排查

| 现象 | 原因 / 解决 |
| --- | --- |
| `npm install` 或 `npm run dev` 报平台二进制错误（esbuild/rollup） | 旧 `node_modules` 残留：删除后重新 `npm install` |
| Vite 启动即退出 / 提示 Node 版本不符 | Node 版本没到 `^20.19.0 \|\| >=22.12.0`，升级 Node |
| 后端 `/api/health` 返回 500 | MySQL 没起、`.env` 连不上、或库没导入 → 见第 6 节 |
| `start-all.py` 报 `pdf-service NOT ready` / `/health` 返回 `ok:false` | 缺 `PyMuPDF` / `reportlab`：`pip install PyMuPDF reportlab` |
| 5057 进程静默退出、端口不通 | 用 `python.exe` 而不是 `pythonw.exe` 启动（`start-all.py` 已处理） |
| 组件检查器跳转后编辑器不置前 | 缺 `pywin32`：`pip install pywin32`；或设 `VITE_FOCUS_EDITOR=0` 关闭该行为 |
| `start-all.py` 找不到 Python | venv 不在版本探测路径：按 5.1 放到项目父目录，或先 `activate` 再运行 |
| 工具栏「启动 Python 脚本」无效 | `server/index.js` 中硬编码路径未改（见 5.3） |
| TXT 批量导入路径不对 | 改 `scripts/reimport_all.cjs` 顶部的 `TXT_DIR` |
| MySQL 报 `ER_SCHEMA_DIR_EXISTS` | datadir 残留同名目录，删除该空目录后重试（需管理员） |

---

## 10. 迁移自检清单

- [ ] Node.js 版本满足 `^20.19.0 || >=22.12.0`
- [ ] 已删除旧 `node_modules` 并重新 `npm install`
- [ ] 已在**项目父目录**创建 `.venv` 并安装 `fastapi/uvicorn/PyMuPDF/reportlab`（+ `pywin32`）
- [ ] `.env` 存在且 `DB_*` 与新机器 MySQL 一致
- [ ] MySQL80 服务运行中，`language_learning` 库已由 `db/language_learning.sql` 导入
- [ ] `python scripts/start-all.py` 输出四个服务 ready + `backend health OK`
- [ ] 浏览器能打开 http://localhost:5173 并正常读写文章
- [ ] （可选）已修正 `server/index.js`、`scripts/reimport_all.cjs` 的硬编码路径
- [ ] （可选）已放行防火墙 5173 供局域网访问

---

## 附：相关文档

- [README.md](../README.md) — 安装 / 功能 / 端口 / 快捷键总览
- [ARCHITECTURE.md](../markdown/ARCHITECTURE.md) — 架构、API、数据流
- [python-env.md](./python-env.md) — Python 虚拟环境与三个 Python 用途
- [MySQL连接配置说明.md](./MySQL连接配置说明.md) — 数据库配置与表结构
- [PDF_EXPORT.md](../markdown/PDF_EXPORT.md) — PDF 导出实现与依赖
