"""
启动全部服务（供 AI / 本机复用，非临时脚本，保留在项目内）

启动顺序：MySQL(3306) -> 后端(3000) -> 前端(5173)
已运行的服务会被跳过，不存在的服务才会拉起。
子进程均以 DETACHED 方式脱离终端，脚本退出后继续存活。

运行方式：
  python "f:\\PythonProject\\Language-learning\\scripts\\start-all.py"

说明：
  - 路径全部自动推导（项目根 = 本脚本所在目录的上级），并自动探测 node 解释器，
    不再硬编码绝对路径，项目整体搬家也不会失效。
  - 前端必须用 `node node_modules/vite/bin/vite.js`，不要用 `npm run dev`。
  - MySQL 服务名自动探测（优先 MySQL80）；若未起，尝试 net start（需管理员；失败仅告警）。
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
FRONTEND_PORT = 5173
MYSQL_PORT = 3306
PDF_PORT = 5057


def detect_node():
    """探测 node 可执行文件的绝对路径（Windows 上带 .exe 更稳妥）。"""
    for cand in ("node", "node.exe"):
        p = shutil.which(cand)
        if p:
            return p
    fallback = r"F:\Program Files\nodejs\node.exe"
    return fallback if os.path.exists(fallback) else "node"


def detect_mysql_service():
    """探测本机 MySQL 服务名（Windows），找不到则用 MySQL80 兜底。"""
    if not sys.platform.startswith("win"):
        return "mysql"
    try:
        out = subprocess.run(
            'sc query type= service state= all | findstr /I "MySQL"',
            shell=True, capture_output=True, text=True, timeout=15,
        ).stdout
        names = []
        for ln in out.splitlines():
            ln = ln.strip()
            if ln.startswith("SERVICE_NAME:"):
                names.append(ln.split(":", 1)[1].strip())
        # 优先 MySQL80，其次任意 MySQL*
        for n in names:
            if n.upper() == "MYSQL80":
                return n
        return names[0] if names else "MySQL80"
    except Exception:
        return "MySQL80"


NODE = detect_node()
MYSQL_SVC = detect_mysql_service()

print(f"[start] project root : {APP}")
print(f"[start] node         : {NODE}")
print(f"[start] mysql service: {MYSQL_SVC}")

if not os.path.isdir(APP):
    print(f"[start] FATAL: project root does not exist: {APP}")
    sys.exit(1)


def port_up(port):
    out = subprocess.run("netstat -ano", capture_output=True, text=True).stdout
    return any(f":{port} " in ln and "LISTENING" in ln for ln in out.splitlines())


def wait_for_port(port, timeout=10, interval=1.0, label=None):
    """带延时的循环探测端口：在 timeout 秒内每 interval 秒检测一次。

    避免"拉起过快"——进程刚 fork 出来、端口尚未 LISTENING 就被误判为 DOWN；
    或端口已监听但服务内部（MySQL 连接、建表等）尚未就绪。
    返回 True 表示在超时前检测到 LISTENING。
    """
    name = label or f"port {port}"
    deadline = time.time() + timeout
    attempt = 0
    while True:
        attempt += 1
        if port_up(port):
            print(f"[start] {name} ready (port {port}, after {attempt} check(s))")
            return True
        if time.time() >= deadline:
            print(f"[start] {name} NOT ready (port {port}, timeout {timeout}s)")
            return False
        time.sleep(interval)


def wait_for_http_ok(url, timeout=10, interval=1.0, label="health"):
    """带延时的循环探测 HTTP 就绪：仅当返回 200 才算就绪。

    后端启动后需连接 MySQL 并幂等建表，期间 /api/health 可能返回 500 或连接被拒；
    HTTPError（如 500）与 URLError（连接失败）均视为"未就绪"，继续重试直到超时。
    返回 True 表示超时前拿到 200。
    """
    deadline = time.time() + timeout
    attempt = 0
    last = "no attempt"
    while True:
        attempt += 1
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                body = r.read().decode(errors="replace")
                if r.status == 200:
                    print(f"[start] {label} OK: {body} (after {attempt} check(s))")
                    return True
                last = f"HTTP {r.status}"
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
        except Exception as e:
            last = str(e)
        if time.time() >= deadline:
            print(f"[start] {label} FAILED ({last}, timeout {timeout}s, {attempt} check(s))")
            return False
        time.sleep(interval)


def launch(args, cwd=APP, label="", extra_flags=0):
    p = subprocess.Popen(
        args, cwd=cwd, creationflags=DETACH | extra_flags,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    print(f"[start] {label} launched (pid {p.pid})")


def launch_hidden(args, cwd=APP, label=""):
    """无黑框启动 console 子进程（Windows）。

    DETACHED_PROCESS 与 CREATE_NO_WINDOW 互斥：DETACHED_PROCESS 会让
    python.exe（console 子系统）新建一个独立控制台窗口（即黑框），而
    CREATE_NO_WINDOW 才表示不创建窗口。二者叠加时 Windows 行为未定义，
    实测会弹出黑框。因此此处只用 CREATE_NO_WINDOW + CREATE_NEW_PROCESS_GROUP
    （脱离进程组，脚本退出后子进程仍存活），不含 DETACHED_PROCESS。
    """
    flags = subprocess.CREATE_NEW_PROCESS_GROUP
    if sys.platform.startswith("win"):
        flags |= getattr(subprocess, "CREATE_NO_WINDOW", 0)
    p = subprocess.Popen(
        args, cwd=cwd, creationflags=flags,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    print(f"[start] {label} launched hidden (pid {p.pid})")


def detect_mysqld():
    """探测 mysqld.exe 绝对路径（Windows），供免管理员直接启动使用。"""
    if not sys.platform.startswith("win"):
        return None
    for cand in (
        shutil.which("mysqld"),
        r"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe",
        r"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld",
    ):
        if cand and os.path.exists(cand):
            return cand
    return None


def detect_my_ini():
    """探测 MySQL 配置文件 my.ini 路径。"""
    for cand in (
        r"C:\ProgramData\MySQL\MySQL Server 8.0\my.ini",
        os.path.join(os.path.dirname(os.path.dirname(detect_mysqld() or "")), "my.ini"),
    ):
        if cand and os.path.exists(cand):
            return cand
    return None


def start_mysql():
    """启动 MySQL：优先 net start（管理员可用）；失败则直接拉起 mysqld（普通用户免管理员）。

    说明：本项目 datadir 在项目目录内（F:\\...\\mysql-data），普通用户可读写，
    因此可直接以当前用户运行 mysqld，无需管理员权限。
    """
    if port_up(MYSQL_PORT):
        print(f"[start] {MYSQL_SVC} already up")
        return

    # 1) 优先尝试 Windows 服务（管理员权限下可成功）
    try:
        subprocess.run(f"net start {MYSQL_SVC}", shell=True,
                       capture_output=True, text=True, timeout=30)
        if port_up(MYSQL_PORT):
            print(f"[start] {MYSQL_SVC} started via service")
            return
    except Exception:
        pass

    # 2) 回退：直接以当前用户启动 mysqld（免管理员）
    mysqld = detect_mysqld()
    ini = detect_my_ini()
    if not mysqld:
        print(f"[start] {MYSQL_SVC} start failed (may need admin); mysqld not found, skip")
        return
    args = [mysqld]
    if ini:
        args.append(f"--defaults-file={ini}")
    # CREATE_NO_WINDOW：抑制 mysqld 弹出 cmd 黑框（避免控制台窗口）
    no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform.startswith("win") else 0
    try:
        subprocess.Popen(
            args, creationflags=no_window | subprocess.CREATE_NEW_PROCESS_GROUP,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        # 给 mysqld 一点初始化时间，再确认端口
        time.sleep(3)
        if port_up(MYSQL_PORT):
            print(f"[start] mysqld started directly (no admin needed)")
        else:
            print(f"[start] mysqld launched but {MYSQL_PORT} not listening yet")
    except Exception as e:
        print(f"[start] mysqld direct start failed: {e}")


# 1. MySQL（拉起后循环等待 3306 监听，避免后续服务连不上库）
start_mysql()
wait_for_port(MYSQL_PORT, timeout=10, interval=1.0, label="mysql")

# 2. backend 3000（拉起后循环等待端口就绪，而非立即判定）
if not port_up(BACKEND_PORT):
    launch([NODE, "server/index.js"], label="backend")
    wait_for_port(BACKEND_PORT, timeout=10, interval=1.0, label="backend")
else:
    print("[start] backend already up")

# 3. frontend 5173
if not port_up(FRONTEND_PORT):
    launch([NODE, os.path.join("node_modules", "vite", "bin", "vite.js")],
           label="frontend")
    wait_for_port(FRONTEND_PORT, timeout=10, interval=1.0, label="frontend")
else:
    print("[start] frontend already up")


def detect_python():
    """
    探测 python.exe，用于拉起 PDF 导出服务。

    用 python.exe + CREATE_NO_WINDOW，而不是 pythonw.exe：
    pythonw 下 sys.stdout / sys.stderr 为 None，uvicorn 配置 logging 时会崩溃，
    且异常无处输出 —— 表现为进程静默退出。python.exe 保留完整输出（已重定向到
    DEVNULL，排错时可改成文件），CREATE_NO_WINDOW 则避免弹出控制台窗口。
    """
    for cand in (
        os.path.join(os.path.dirname(APP), ".venv", "Scripts", "python.exe"),
        shutil.which("python"),
    ):
        if cand and os.path.exists(cand):
            return cand
    return "python"


# 4. pdf-service 5057（PDF 导出；不在线时前端按钮会提示，不影响其他功能）
if not port_up(PDF_PORT):
    launch_hidden([detect_python(), os.path.join("server", "pdf_service.py")],
                  label="pdf-service")
    wait_for_port(PDF_PORT, timeout=10, interval=1.0, label="pdf-service")
else:
    print("[start] pdf-service already up")

# 5. 后端健康检查：带延时的循环重试。
#    后端进程端口就绪 ≠ 应用就绪 —— 它还需连接 MySQL 并幂等建表，
#    期间 /api/health 可能返回 500 或连接被拒，必须轮询到 200 才算真正可用。
backend_ok = wait_for_http_ok(
    f"http://127.0.0.1:{BACKEND_PORT}/api/health",
    timeout=10, interval=1.0, label="backend health",
)

# 6. 端口就绪汇总（此时均已经过轮询确认，非"拉起即判 UP"）
for port in (BACKEND_PORT, FRONTEND_PORT, PDF_PORT):
    print(f"[start] port {port}:", "UP" if port_up(port) else "DOWN")

# 7. 所有服务就绪后再打开网站（以默认浏览器访问前端）
FRONTEND_URL = f"http://localhost:{FRONTEND_PORT}/"
if port_up(FRONTEND_PORT):
    if not backend_ok:
        print("[start] WARNING: backend health not OK, opening frontend anyway")
    try:
        os.startfile(FRONTEND_URL)
        print(f"[start] opened browser: {FRONTEND_URL}")
    except Exception:
        # os.startfile 不可用（非 Windows）时回退到 webbrowser
        try:
            import webbrowser
            webbrowser.open(FRONTEND_URL)
            print(f"[start] opened browser (webbrowser): {FRONTEND_URL}")
        except Exception as e2:
            print("[start] open browser failed:", e2)
else:
    print("[start] frontend not up, skip opening browser")
