"""
专门重启后端服务（stop + start 后端，不影响 MySQL / 前端 / PDF 服务）

适用场景：只改了 server/ 下的后端代码，无需重启整套服务，跑这个即可让改动生效。

流程：定位监听 3000 的 node 进程 -> taskkill 强杀 -> 轮询确认端口释放 ->
      以 DETACHED 方式重新拉起 server/index.js（日志写 logs/backend.log）->
      轮询等待 3000 端口就绪 + /api/health 返回 200。

运行方式：
  python "D:\\PythonFiles\\Language-learning\\scripts\\restart-backend.py"

说明：
  - 与 start-all.py 同源：路径自动推导（项目根 = 本脚本上级的上级），自动探测 node，
    子进程 DETACHED 脱离终端，日志落 logs/backend.log，便于排错。
  - 仅动后端；MySQL / 前端 / PDF 保持原样，避免无谓中断。
  - 沙箱内 taskkill / netstat 可能被拦截，本脚本用于本机实际运行。
"""

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

DETACH = (
    subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    if sys.platform.startswith("win") else 0
)

BACKEND_PORT = 3000
HEALTH_URL = f"http://127.0.0.1:{BACKEND_PORT}/api/health"


def detect_node():
    """探测 node 可执行文件的绝对路径（Windows 上带 .exe 更稳妥）。

    PATH 里找不到时按常见安装位置兜底（ProgramFiles 环境变量 + 常见盘符），
    不再写死单一盘符 —— 换机/换盘后旧盘符（如 F:\\）不存在会直接失效。
    """
    for cand in ("node", "node.exe"):
        p = shutil.which(cand)
        if p:
            return p
    pf = os.environ.get("ProgramFiles") or r"C:\Program Files"
    for fallback in (
        os.path.join(pf, "nodejs", "node.exe"),
        r"C:\Program Files\nodejs\node.exe",
        r"D:\Program Files\nodejs\node.exe",
    ):
        if os.path.exists(fallback):
            return fallback
    return "node"


NODE = detect_node()
print(f"[restart-backend] project root : {APP}")
print(f"[restart-backend] node         : {NODE}")

if not os.path.isdir(APP):
    print(f"[restart-backend] FATAL: project root does not exist: {APP}")
    sys.exit(1)


def port_up(port):
    out = subprocess.run("netstat -ano", capture_output=True, text=True).stdout
    return any(f":{port} " in ln and "LISTENING" in ln for ln in out.splitlines())


def wait_for_port(port, timeout=15, interval=1.0, label=None):
    """带延时的循环探测端口 LISTENING。返回 True 表示超时前就绪。"""
    name = label or f"port {port}"
    deadline = time.time() + timeout
    attempt = 0
    while True:
        attempt += 1
        if port_up(port):
            print(f"[restart-backend] {name} ready (port {port}, after {attempt} check(s))")
            return True
        if time.time() >= deadline:
            print(f"[restart-backend] {name} NOT ready (port {port}, timeout {timeout}s)")
            return False
        time.sleep(interval)


def wait_for_port_down(port, timeout=10, interval=0.5, label=None):
    """轮询等待端口从 LISTENING 变为空闲（进程已退出）。返回 True 表示已释放。"""
    name = label or f"port {port}"
    deadline = time.time() + timeout
    attempt = 0
    while True:
        attempt += 1
        if not port_up(port):
            print(f"[restart-backend] {name} released (port {port}, after {attempt} check(s))")
            return True
        if time.time() >= deadline:
            print(f"[restart-backend] {name} STILL listening (port {port}, timeout {timeout}s)")
            return False
        time.sleep(interval)


def wait_for_http_ok(url, timeout=15, interval=1.0, label="health"):
    """带延时的循环探测 HTTP 就绪：仅 200 算就绪（同 start-all.py）。"""
    deadline = time.time() + timeout
    attempt = 0
    last = "no attempt"
    while True:
        attempt += 1
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                body = r.read().decode(errors="replace")
                if r.status == 200:
                    print(f"[restart-backend] {label} OK: {body} (after {attempt} check(s))")
                    return True
                last = f"HTTP {r.status}"
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
        except Exception as e:
            last = str(e)
        if time.time() >= deadline:
            print(f"[restart-backend] {label} FAILED ({last}, timeout {timeout}s, {attempt} check(s))")
            return False
        time.sleep(interval)


def launch(args, cwd=APP, label="", logfile=None, extra_flags=0):
    """启动子进程（脱离终端，脚本退出后继续存活），stdout/stderr 写日志。"""
    if logfile:
        logs_dir = os.path.join(APP, "logs")
        os.makedirs(logs_dir, exist_ok=True)
        f = open(os.path.join(logs_dir, logfile), "w", encoding="utf-8", errors="replace")
        out = f
        err = subprocess.STDOUT
    else:
        out = subprocess.DEVNULL
        err = subprocess.DEVNULL
    p = subprocess.Popen(
        args, cwd=cwd, creationflags=DETACH | extra_flags,
        stdout=out, stderr=err,
    )
    suffix = f", log: logs/{logfile}" if logfile else ""
    print(f"[restart-backend] {label} launched (pid {p.pid}){suffix}")


def kill_by_port(port, label=""):
    """定位监听该端口的进程并 taskkill。返回是否找到并发送了结束信号。"""
    try:
        out = subprocess.run("netstat -ano", capture_output=True, text=True,
                             timeout=15, shell=True).stdout
    except Exception as e:
        print(f"[restart-backend] netstat failed for {label}: {e}")
        return False
    pids = set()
    for ln in out.splitlines():
        if f":{port} " in ln and "LISTENING" in ln:
            parts = ln.split()
            pid = parts[-1]
            if pid.isdigit():
                pids.add(pid)
    if not pids:
        print(f"[restart-backend] {label} (port {port}) not running, nothing to kill")
        return False
    for pid in pids:
        try:
            subprocess.run(f"taskkill /PID {pid} /F", shell=True,
                           capture_output=True, text=True, timeout=15)
            print(f"[restart-backend] {label} (port {port}) killed pid {pid}")
        except Exception as e:
            print(f"[restart-backend] taskkill pid {pid} failed: {e}")
    return True


# ===== 1. 停止现有后端 =====
print("[restart-backend] === step 1/3: stop backend ===")
was_up = port_up(BACKEND_PORT)
kill_by_port(BACKEND_PORT, "backend (express)")
if was_up:
    # 仅当之前在跑才等端口释放；原本没跑则直接进入启动
    wait_for_port_down(BACKEND_PORT, timeout=10, interval=0.5, label="backend")

# ===== 2. 重新拉起后端 =====
print("[restart-backend] === step 2/3: start backend ===")
launch([NODE, "server/index.js"], label="backend", logfile="backend.log")
wait_for_port(BACKEND_PORT, timeout=15, interval=1.0, label="backend")

# ===== 3. 后端健康检查（端口就绪 ≠ 应用就绪：还需连 MySQL 建表）=====
print("[restart-backend] === step 3/3: health check ===")
backend_ok = wait_for_http_ok(HEALTH_URL, timeout=15, interval=1.0, label="backend health")

print(f"[restart-backend] backend port {BACKEND_PORT}:", "UP" if port_up(BACKEND_PORT) else "DOWN")
print("[restart-backend] done" + ("" if backend_ok else " (WARNING: backend health not OK, check logs/backend.log)"))
