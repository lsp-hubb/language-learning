# Python 虚拟环境与后端调用说明

## 环境位置

```yaml
路径:     F:\PythonProject\.venv
Python:   3.11.3
可执行:   F:\PythonProject\.venv\Scripts\python.exe
```

该虚拟环境与项目同级目录（`Language-learning/` 的父目录 `PythonProject/` 下），与后端 Express 在同一台机器，可通过 `child_process` 直接调用。

## 已安装的关键包

| 类别 | 包 |
|------|----|
| GUI 自动化 | `PyAutoGUI`, `pynput`, `uiautomation`, `pygame` |
| PDF 处理 | `PyMuPDF`, `pypdf`, `PyPDF2`, `pdf2image`, `reportlab` |
| Office | `python-docx`, `openpyxl`, `xlrd`, `xlsxwriter`, `xlwt` |
| 网络 | `Flask`, `requests`, `selenium`, `Flask-CORS` |
| 数据处理 | `numpy`, `pandas`, `scipy`, `matplotlib` |
| 图像 | `pillow`, `fonttools` |
| 数据库 | `PyMySQL` |
| 打包 | `PyInstaller` |
| 其他 | `keyboard`, `pyperclip`, `python-dotenv` |

完整列表（80+ 个包）见 `pip list`。

## 后端调用方式

Express 后端通过 Node.js 内置的 `child_process.spawn` 执行 Python 脚本：

```js
import { spawn } from 'node:child_process'

// 调用示例
const python = spawn('F:\\PythonProject\\.venv\\Scripts\\python.exe', [
  'C:/path/to/script.py',
  'arg1', 'arg2'
])

python.stdout.on('data', (data) => { /* 处理输出 */ })
python.stderr.on('data', (data) => { /* 处理错误 */ })
python.on('close', (code) => { /* 脚本结束 */ })
```

### API 路由

```http
POST /api/run-python
Content-Type: application/json

{
  "script": "脚本绝对路径",
  "args": ["参数1", "参数2"]
}
```

### 前端调用

```js
import { request } from '@/api'

const res = await request('/run-python', {
  method: 'POST',
  body: JSON.stringify({
    script: 'C:/path/to/script.py',
    args: ['arg1']
  })
})
```

## 注意事项

- Python 路径后续可提取到 `.env` 环境变量（`PYTHON_PATH`）
- `spawn` 适用于大输出流脚本；短命令可用 `exec`
- 脚本不应长时间阻塞（建议 <30s），否则需考虑超时处理
- 所有脚本路径应为固定值，不来自用户输入（本地部署无安全风险）
