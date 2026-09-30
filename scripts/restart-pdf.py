"""
专门重启 PDF 导出服务（stop + start 5057，不影响 MySQL / 前端 / 后端）

适用场景
--------
只改了 Python 侧的导出代码（server/pdf_service.py、server/pdf_export.py、
server/notes_pdf_export.py 等），跑这个即可让改动生效。

为什么不能只跑 start-all.py：
  服务启动时一次性导入模块，改完必须重启；而 start-all.py 是按端口幂等的
  （5057 已监听就打印 "pdf-service already up" 后跳过），**不会**换成新代码 ——
  表现为「明明改了代码、服务也显示正常，导出结果却还是旧的」。

流程
----
  定位监听 5057 的进程 -> taskkill 强杀 -> 轮询确认端口释放 ->
  用能 import fastapi/uvicorn/fitz/reportlab 的 python 重新拉起 ->
  轮询等待 5057 就绪 + /health 返回 ok:true

运行方式
--------
  python "D:\\PythonFiles\\Language-learning\\scripts\\restart-pdf.py"

说明
----
  - python 解释器探测与 start-all.py 同源：优先项目父目录的 .venv，
    但实际 spawn 跑一次 import 验证依赖齐全，缺依赖的残留 venv 会被跳过。
  - 用 python.exe + CREATE_NO_WINDOW 启动（不用 pythonw：其 stdout 为 None，
    uvicorn 配置 logging 时会静默崩溃）。
  - 沙箱内 taskkill / netstat 可能被拦截，本脚本用于本机实际运行。
"""

import json
import os
import sys
import time
import shutil
import subprocess
import urllib.request
import urllib.error

# 项目根目录：本脚本位于 <项目根>/scripts/，故取上级目录
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(SCRIPT_DIR)

PDF_PORT = 5057
HEALTH_URL = f"http://127.0.0.1:{PDF_PORT}/health"


def _python_can_run_pdf(py):
    """校验某 python 能否真正跑 pdf_service.py（需 fastapi / uvicorn / PyMuPDF / reportlab）。

    与 start-all.py 同源：必须检查 returncode —— subprocess.run 在子进程非零退出时
    不抛异常，漏判会误把缺依赖的残留 venv 当成可用。
    """
    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform.startswith("win") else 0
        r = subprocess.run(
            [py, "-c", "import fastapi, uvicorn, fitz, reportlab"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=flags, timeout=30,
        )
        return r.returncode == 0
    except Exception:
        return False


def detect_python():
    """探测可用的 python.exe：优先项目父目录的 .venv，其次 PATH 里的 python。"""
    for cand in (
        os.path.join(os.path.dirname(APP), ".venv", "Scripts", "python.exe"),
        shutil.which("python"),
    ):
        if cand and os.path.exists(cand) and _python_can_run_pdf(cand):
            return cand
    return "python"


def port_up(port):
    out = subprocess.run("netstat -ano", capture_output=True, text=True).stdout
    return any(f":{port} " in ln and "LISTENING" in ln for ln in out.splitlines())


def wait_for_port(port, timeout=15, interval=1.0, label=None):
    """轮询等待端口 LISTENING。返回 True 表示超时前就绪。"""
    name = label or f"port {port}"
    deadline = time.time() + timeout
    attempt = 0
    while True:
        attempt += 1
        if port_up(port):
            print(f"[restart-pdf] {name} ready (port {port}, after {attempt} check(s))")
            return True
        if time.time() >= deadline:
            print(f"[restart-pdf] {name} NOT ready (port {port}, timeout {timeout}s)")
            return False
        time.sleep(interval)


def wait_for_port_down(port, timeout=10, interval=0.5, label=None):
    """轮询等待端口释放（进程已退出）。返回 True 表示已释放。"""
    name = label or f"port {port}"
    deadline = time.time() + timeout
    attempt = 0
    while True:
        attempt += 1
        if not port_up(port):
            print(f"[restart-pdf] {name} released (port {port}, after {attempt} check(s))")
            return True
        if time.time() >= deadline:
            print(f"[restart-pdf] {name} STILL listening (port {port}, timeout {timeout}s)")
            return False
        time.sleep(interval)


def wait_for_health_ok(timeout=15, interval=1.0):
    """轮询 /health，要求 ok == true（ok:false 表示依赖缺失，导出会 500）。"""
    deadline = time.time() + timeout
    attempt = 0
    last = "no attempt"
    while True:
        attempt += 1
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=3) as r:
                body = r.read().decode(errors="replace")
                if r.status == 200:
                    try:
                        ok = bool(json.loads(body).get("ok"))
                    except Exception:
                        ok = False
                    print(f"[restart-pdf] health: {body} (after {attempt} check(s))")
                    if ok:
                        return True
                    last = "ok=false (依赖缺失，导出会返回 500)"
                else:
                    last = f"HTTP {r.status}"
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
        except Exception as e:
            last = str(e)
        if time.time() >= deadline:
            print(f"[restart-pdf] health FAILED ({last}, timeout {timeout}s, {attempt} check(s))")
            return False
        time.sleep(interval)


def launch_hidden(args, cwd=APP, label=""):
    """无黑框启动（CREATE_NO_WINDOW + 脱离进程组），与 start-all.py 同源。

    不用 DETACHED_PROCESS：它会让 python.exe 新建控制台窗口（黑框），
    且与 CREATE_NO_WINDOW 叠加时行为未定义（实测弹黑框）。
    """
    flags = subprocess.CREATE_NEW_PROCESS_GROUP
    if sys.platform.startswith("win"):
        flags |= getattr(subprocess, "CREATE_NO_WINDOW", 0)
    p = subprocess.Popen(
        args, cwd=cwd, creationflags=flags,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    print(f"[restart-pdf] {label} launched hidden (pid {p.pid})")
    return p


def kill_by_port(port, label=""):
    """定位监听该端口的进程并 taskkill。返回是否找到并发送了结束信号。"""
    try:
        out = subprocess.run("netstat -ano", capture_output=True, text=True,
                             timeout=15, shell=True).stdout
    except Exception as e:
        print(f"[restart-pdf] netstat failed for {label}: {e}")
        return False
    pids = set()
    for ln in out.splitlines():
        if f":{port} " in ln and "LISTENING" in ln:
            pid = ln.split()[-1]
            if pid.isdigit():
                pids.add(pid)
    if not pids:
        print(f"[restart-pdf] {label} (port {port}) not running, nothing to kill")
        return False
    for pid in pids:
        try:
            subprocess.run(f"taskkill /PID {pid} /F", shell=True,
                           capture_output=True, text=True, timeout=15)
            print(f"[restart-pdf] {label} (port {port}) killed pid {pid}")
        except Exception as e:
            print(f"[restart-pdf] taskkill pid {pid} failed: {e}")
    return True


PY = detect_python()
print(f"[restart-pdf] project root : {APP}")
print(f"[restart-pdf] python       : {PY}")

if not os.path.isdir(APP):
    print(f"[restart-pdf] FATAL: project root does not exist: {APP}")
    sys.exit(1)

# ===== 1. 停止现有 PDF 服务 =====
print("[restart-pdf] === step 1/3: stop pdf-service ===")
was_up = port_up(PDF_PORT)
kill_by_port(PDF_PORT, "pdf-service")
if was_up:
    wait_for_port_down(PDF_PORT, timeout=10, interval=0.5, label="pdf-service")

# ===== 2. 重新拉起 =====
print("[restart-pdf] === step 2/3: start pdf-service ===")
launch_hidden([PY, os.path.join("server", "pdf_service.py")], label="pdf-service")
wait_for_port(PDF_PORT, timeout=15, interval=1.0, label="pdf-service")

# ===== 3. 健康检查（端口就绪 ≠ 依赖齐全：ok:false 时导出会 500）=====
print("[restart-pdf] === step 3/3: health check ===")
healthy = wait_for_health_ok(timeout=15, interval=1.0)

print(f"[restart-pdf] pdf port {PDF_PORT}:", "UP" if port_up(PDF_PORT) else "DOWN")
print("[restart-pdf] done" + ("" if healthy else " (WARNING: /health not ok, 导出接口会返回 500)"))

if not healthy:
    sys.exit(1)
