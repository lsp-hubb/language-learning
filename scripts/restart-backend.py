"""
专门重启后端服务（stop + start 后端，不影响 MySQL / 前端 / PDF 服务）

适用场景：只改了 server/ 下的后端代码，无需重启整套服务，跑这个即可让改动生效。

流程：定位监听 3000 的进程 -> 校验映像名必须是 node.exe 才 taskkill 强杀 ->
      轮询确认端口释放 -> 以 DETACHED 方式重新拉起 server/index.js
      （日志写 logs/backend.log）-> 轮询等待 3000 端口就绪 + /api/health 返回 200 ->
      确认「监听 3000 的 PID 就是本次拉起的新进程」。

运行方式：
  python "D:\\PythonFiles\\Language-learning\\scripts\\restart-backend.py"

说明：
  - 与 start-all.py 同源：路径自动推导（项目根 = 本脚本上级的上级），自动探测 node，
    子进程 DETACHED 脱离终端，日志落 logs/backend.log，便于排错。
  - 仅动后端；MySQL / 前端 / PDF 保持原样，避免无谓中断。
  - 不做「假成功」：kill 失败 / 端口未释放 / 非 node 进程占用 3000 / 新进程启动即退出 /
    健康检查失败 / 监听者不是新进程，均打印 ERROR 并以非零码退出。否则旧进程仍监听 3000
    时，新 node 会因 EADDRINUSE 秒退，而端口就绪与 health 200 都可能来自旧进程，
    表现为「改了代码却还在跑旧模块」。
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


def listening_pids(port):
    """返回当前监听该端口的 PID 集合；netstat 失败返回 None（区别于「端口空闲」）。

    必须区分这两种情况：把「探测失败」当成「端口空闲」会放过仍在监听的旧进程，
    后续启动的新 node 会因 EADDRINUSE 退出，却又被误判为重启成功。
    """
    try:
        r = subprocess.run("netstat -ano", capture_output=True, text=True,
                           timeout=15, shell=True)
        if r.returncode != 0:
            print(f"[restart-backend] netstat failed (rc={r.returncode})")
            return None
        out = r.stdout
    except Exception as e:
        print(f"[restart-backend] netstat failed: {e}")
        return None
    pids = set()
    for ln in out.splitlines():
        # ":3000 " 后必须是空白，避免把 30000 等端口误判；LISTENING 只出现在监听行
        if f":{port} " in ln and "LISTENING" in ln:
            pid = ln.split()[-1]
            if pid.isdigit():
                pids.add(pid)
    return pids


def port_up(port):
    pids = listening_pids(port)
    return pids is not None and bool(pids)


def pid_image_name(pid):
    """用 tasklist 取 PID 的映像名（小写）；查不到 / 命令被拦截时返回空串。

    /FO CSV /NH 首列即映像名形如 "node.exe"，不依赖系统语言的提示文案；
    本地化的「没有运行的任务匹配指定标准」不含 .exe，会被判为查不到。
    """
    try:
        r = subprocess.run(f'tasklist /FI "PID eq {pid}" /FO CSV /NH',
                           shell=True, capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            return ""
        out = r.stdout.strip()
        if not out:
            return ""
        first = out.splitlines()[0].split(",")[0].strip().strip('"').lower()
        return first if first.endswith(".exe") else ""
    except Exception:
        return ""


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
        pids = listening_pids(port)
        # None = netstat 探测失败，不能当成「端口已释放」
        if pids is not None and not pids:
            print(f"[restart-backend] {name} released (port {port}, after {attempt} check(s))")
            return True
        if time.time() >= deadline:
            print(f"[restart-backend] {name} STILL listening / undetectable "
                  f"(port {port}, timeout {timeout}s)")
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
    return p


def kill_by_port(port, label=""):
    """只杀监听该端口的 node.exe。返回 True 表示「可以安全继续」。

    端口空闲时返回 True（无需杀）；非 node 进程占用、映像名查不到、
    netstat / taskkill 失败一律返回 False —— 保守拒绝，绝不误杀别的服务。
    """
    pids = listening_pids(port)
    if pids is None:
        print(f"[restart-backend] ERROR: netstat failed for {label}, "
              "cannot identify the process holding the port - refuse to kill")
        return False
    if not pids:
        print(f"[restart-backend] {label} (port {port}) not running, nothing to kill")
        return True

    # 缺陷 2：确认监听者确实是 node.exe，否则宁可中止也不强杀
    for pid in pids:
        image = pid_image_name(pid)
        if image != "node.exe":
            print(f"[restart-backend] ERROR: port {port} held by pid {pid} "
                  f"({image or 'unknown / tasklist unavailable'}), not node.exe - refuse to kill")
            return False

    ok = True
    for pid in pids:
        try:
            r = subprocess.run(f"taskkill /PID {pid} /F", shell=True,
                               capture_output=True, text=True, timeout=15)
            if r.returncode == 0:
                print(f"[restart-backend] {label} (port {port}) killed pid {pid}")
            else:
                detail = (r.stdout + r.stderr).strip().replace("\n", " ")
                print(f"[restart-backend] ERROR: taskkill pid {pid} failed "
                      f"(rc={r.returncode}): {detail or 'no output'}")
                ok = False
        except Exception as e:
            print(f"[restart-backend] ERROR: taskkill pid {pid} failed: {e}")
            ok = False
    return ok


# ===== 1. 停止现有后端 =====
print("[restart-backend] === step 1/3: stop backend ===")
was_up = port_up(BACKEND_PORT)
if not kill_by_port(BACKEND_PORT, "backend (express)"):
    print("[restart-backend] FAILED: old backend not stopped, nothing restarted "
          "(see ERROR above; logs/backend.log)")
    sys.exit(1)
if was_up and not wait_for_port_down(BACKEND_PORT, timeout=10, interval=0.5, label="backend"):
    print("[restart-backend] FAILED: port 3000 still occupied; old backend may still be running")
    sys.exit(1)

# ===== 2. 重新拉起后端 =====
print("[restart-backend] === step 2/3: start backend ===")
proc = launch([NODE, "server/index.js"], label="backend", logfile="backend.log")
if not wait_for_port(BACKEND_PORT, timeout=15, interval=1.0, label="backend"):
    print("[restart-backend] FAILED: backend did not start listening (see logs/backend.log)")
    sys.exit(1)

# ===== 3. 健康检查（端口就绪 ≠ 应用就绪：还需连 MySQL 建表）+ 新进程身份校验 =====
print("[restart-backend] === step 3/3: health check ===")
backend_ok = wait_for_http_ok(HEALTH_URL, timeout=15, interval=1.0, label="backend health")

# 端口 LISTENING 与 health 200 都可能来自「没被杀掉的旧进程」：
# 只有监听者恰好是本次拉起的新 PID、且新进程仍存活，才能断定新代码已生效。
listener_pids = listening_pids(BACKEND_PORT)
expected_pid = str(proc.pid)
alive = proc.poll() is None

errors = []
if not backend_ok:
    errors.append("backend health not OK")
if not alive:
    errors.append(f"new backend process (pid {expected_pid}) exited, see logs/backend.log")
if listener_pids is None or listener_pids != {expected_pid}:
    shown = sorted(listener_pids) if listener_pids else "none / netstat failed"
    errors.append(f"port {BACKEND_PORT} served by {shown}, expected pid {expected_pid}")

print(f"[restart-backend] backend port {BACKEND_PORT}:", "UP" if listener_pids else "DOWN")
if errors:
    for e in errors:
        print(f"[restart-backend] ERROR: {e}")
    print("[restart-backend] FAILED: backend may still be running the OLD code, check logs/backend.log")
    sys.exit(1)
print("[restart-backend] done")
