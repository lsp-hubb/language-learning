# Python 虚拟环境与后端调用说明

## 环境位置

```yaml
路径:     F:\PythonProject\.venv
Python:   3.11.x
可执行:   F:\PythonProject\.venv\Scripts\python.exe    # 有控制台窗口
无窗口:   F:\PythonProject\.venv\Scripts\pythonw.exe   # 无控制台窗口（GUI/后台脚本用）
```

该虚拟环境位于项目父目录 `PythonProject/` 下，与后端 Express 同机，可通过 Node.js `child_process` 直接调用。

## 已安装的关键包

| 类别 | 包 | 版本 |
|------|----|------|
| GUI 自动化 / Windows API | `PyAutoGUI`, `keyboard`, `pywin32` | — |
| Web 服务 | `fastapi`, `uvicorn` | — |
| PDF | `PyMuPDF` | 1.26.7 |
| PDF | `reportlab` | 4.4.5 |
| 网络 | `requests` | — |
| 图像 | `pillow` | — |
| 工具 | `pyperclip`, `python-dotenv` | — |

> 完整列表见 `pip list`。`pywin32` 是 `scripts/focus_editor.py` 的必需依赖；
> `PyMuPDF` 与 `reportlab` 是 PDF 导出的必需依赖。

---

## 一、后端启动脚本（`/api/run-python`）

Express 通过 `child_process.spawn` 启动**固定白名单**内的脚本：

```http
POST /api/run-python
Content-Type: application/json

{ "key": "clipboard_to_txt" }
```

```js
// server/index.js
const SCRIPTS = { 'clipboard_to_txt': 'F:\\PythonProject\\Python\\clipboard_to_txt.py' }
const pythonBin = 'F:\\PythonProject\\.venv\\Scripts\\pythonw.exe'   // pythonw 无黑窗
const proc = spawn(pythonBin, [SCRIPTS[key]], {
  cwd: 'F:\\PythonProject\\Python',
  detached: true,
  stdio: 'ignore',
})
proc.unref()                       // 父进程不等待，服务不被阻塞
res.json({ status: 'ok', message: '脚本已启动' })
```

- **只接受 `key`**，不接受任意脚本路径 → 避免任意代码执行
- 用 `pythonw.exe` 而非 `python.exe`，不会弹出黑色控制台窗口
- `detached + unref`：脚本独立于 Node 进程存活

### 前端调用（`src/api/index.js`）

```js
import { runPythonScript } from '@/api'

await runPythonScript('clipboard_to_txt')
```

调用方：阅读区左侧工具栏「启动脚本」→ `ArticlePage.onRunScript()`。

---

## 二、`scripts/focus_editor.py`（编辑器窗口置前）

组件检查器（Ctrl+I）点击组件后，Vite 中间件会 `spawn` 编辑器 exe 打开源码；VS Code 常复用已有窗口但**不置前**，故再用本脚本把它提到最前。

```bash
pythonw scripts/focus_editor.py --process Code.exe --file <源码绝对路径> --root <项目根> [--timeout 8]
pythonw scripts/focus_editor.py --list     # 调试：列出所有顶层窗口
```

**匹配窗口的关键词优先级**：文件名 → 项目目录名 → `"Visual Studio Code"`，并校验窗口所属进程名。

**绕过 Windows 前台锁定**（非前台进程直接 `SetForegroundWindow` 会被忽略）：
1. `AttachThreadInput` 挂到前台线程输入队列
2. 模拟一次 Alt 按下/抬起，解锁紧接着的 `SetForegroundWindow`
3. 轮询最多 8 秒等待窗口标题更新（VS Code 打开新文件后标题有延迟）

**退出码**：`0` 成功前置 / `1` 未找到窗口 / `2` 找到但前置失败 / `3` 参数错误或缺少 `pywin32`

> 依赖 `pywin32`；关闭该行为可设环境变量 `VITE_FOCUS_EDITOR=0`（见 `vite.config.js`）。
> 脚本内部强制 stdout/stderr 为 UTF-8 并容错，避免中文 GBK 控制台下 `print` 抛 `UnicodeEncodeError`。

---

## 三、PDF 导出服务（`server/pdf_service.py`，端口 5057）

FastAPI 服务，把 `server/pdf_export.py`（reportlab 排版 + PyMuPDF 标注）封装成 HTTP 接口，
供前端工具栏的「📄 PDF」按钮调用。

```bash
# 独立启动（通常由 scripts/start-all.py 统一拉起）
python server/pdf_service.py
curl http://127.0.0.1:5057/health
# {"ok":true,"engine":"pymupdf","version":"1.26.7"}
```

- **监听 `127.0.0.1`**：只服务本机，局域网设备无法访问
- **`ok:false`** 表示 `PyMuPDF` 未安装，此时 `/api/export-pdf` 返回 500
- 依赖 `fastapi` / `uvicorn` / `PyMuPDF` / `reportlab`
- 详细接口与实现见 [PDF_EXPORT.md](../markdown/PDF_EXPORT.md)

> ⚠️ **不要用 `pythonw.exe` 启动本服务**：`pythonw` 下 `sys.stdout` / `sys.stderr`
> 均为 `None`，uvicorn 配置 logging 时会崩溃且异常无处输出，表现为**进程静默退出、端口不通**。
> 服务内已有 devnull 兜底，但 `start-all.py` 仍统一用 `python.exe` + `CREATE_NO_WINDOW`
> （既无控制台窗口，又保留可重定向的输出便于排错）。

---

## 四、一键启停脚本

```bash
python scripts/start-all.py   # MySQL(3306) → 后端(3000) → 前端(5173) → PDF(5057) → 打开浏览器
python scripts/stop-all.py    # 前端(5173) → 后端(3000) → PDF(5057) → MySQL
```

- 项目根由脚本自身位置推导，node / python 与 MySQL 服务名自动探测
- 端口已监听则跳过，不重复拉起
- 前端固定 `node node_modules/vite/bin/vite.js`（不经 `npm run dev`）
- PDF 服务用 `python.exe` + `CREATE_NO_WINDOW`（见上一节的 `pythonw` 警告）
- MySQL 先用 `net start`；非管理员失败时回退为直接启动 `mysqld`（`CREATE_NO_WINDOW` 抑制黑框）
- 子进程全部 `DETACHED`，脚本退出后服务继续存活

> ⚠️ `stop-all.py` 会停止 MySQL。若该实例还服务其他项目，请只手动关闭前后端。

---

## 注意事项

- `/api/run-python` 与 PDF 服务的 Python 路径目前硬编码在
  `server/index.js` 与 `scripts/start-all.py`，后续可提取到 `.env`（`PYTHON_PATH`）
- `spawn` 适用于长输出流脚本；短命令可用 `exec`
- 被调脚本不应长时间阻塞（建议 <30s）
- 所有脚本路径为固定值，不来自用户输入
- 改了 `server/pdf_export.py` 后需**重启 5057 服务**才生效（服务启动时导入模块）
