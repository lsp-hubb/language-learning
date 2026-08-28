"""
停止全部服务（与 start-all.py 镜像，供 AI / 本机复用，非临时脚本）

停止顺序：前端(5173) -> 后端(3000) -> MySQL(自动探测服务名)
按端口定位监听进程并 taskkill；MySQL 通过 `net stop` 关闭（需管理员）。

运行方式：
  python "f:\\PythonProject\\Language-learning\\scripts\\stop-all.py"

说明：
  - 沙箱内 `taskkill` / `net stop` 等被拦截，本脚本用于本机实际运行。
  - 找不到监听进程的服务会跳过，不会报错。
"""

import os
import subprocess
import sys


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
        for n in names:
            if n.upper() == "MYSQL80":
                return n
        return names[0] if names else "MySQL80"
    except Exception:
        return "MySQL80"


def is_admin():
    """检测当前是否以管理员权限运行（Windows UAC 提权状态）。"""
    if not sys.platform.startswith("win"):
        return os.geteuid() == 0
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


# 与 start-all.py 保持一致的服务端口
SERVICES = [
    (5173, "frontend (vite)"),
    (3000, "backend (express)"),
]


def kill_by_port(port, label=""):
    """定位监听该端口的进程并 taskkill。返回是否找到并发送了结束信号。"""
    try:
        out = subprocess.run("netstat -ano", capture_output=True, text=True,
                             timeout=15, shell=True).stdout
    except Exception as e:
        print(f"[stop] netstat failed for {label}: {e}")
        return False
    pids = set()
    for ln in out.splitlines():
        if f":{port} " in ln and "LISTENING" in ln:
            parts = ln.split()
            # 行尾即 PID
            pid = parts[-1]
            if pid.isdigit():
                pids.add(pid)
    if not pids:
        print(f"[stop] {label} (port {port}) not running, skip")
        return False
    for pid in pids:
        try:
            subprocess.run(f"taskkill /PID {pid} /F", shell=True,
                           capture_output=True, text=True, timeout=15)
            print(f"[stop] {label} (port {port}) killed pid {pid}")
        except Exception as e:
            print(f"[stop] taskkill pid {pid} failed: {e}")
    return True


# 1. 按端口停止各服务（前端/后端）
for port, label in SERVICES:
    kill_by_port(port, label)

# 2. 停止 MySQL（Windows 服务，需管理员权限）
# MySQL 是开机自启的系统常驻服务，保持运行不影响开发，
# 因此未提权时明确跳过并说明，而不是报一个看似错误的信息。
MYSQL_SVC = detect_mysql_service()
if not is_admin():
    print(f"[stop] {MYSQL_SVC} skipped: stopping a Windows service requires "
          f"Administrator rights (current shell is not elevated).")
    print(f"[stop] {MYSQL_SVC} stays running - this is fine; start-all.py will "
          f"detect it is already up.")
else:
    try:
        res = subprocess.run(f"net stop {MYSQL_SVC}", shell=True, capture_output=True,
                             text=True, timeout=30)
        if res.returncode == 0:
            print(f"[stop] {MYSQL_SVC} stopped")
        else:
            msg = (res.stderr or res.stdout or "").strip()
            if "没有启动" in msg or "not started" in msg or "service is not" in msg:
                print(f"[stop] {MYSQL_SVC} not running, skip")
            else:
                print(f"[stop] {MYSQL_SVC} stop failed:", msg)
    except Exception as e:
        print(f"[stop] {MYSQL_SVC} stop error:", e)

print("[stop] done")
