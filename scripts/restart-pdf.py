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
  定位监听 5057 的进程 -> 校验映像名必须是 python.exe ->
  杀掉「主进程 + uvicorn 子进程」整棵树（taskkill /F /T，且绝不向上杀到本脚本自身）->
  轮询确认端口释放 -> 用能 import fastapi/uvicorn/fitz/reportlab 的 python 重新拉起 ->
  轮询等待 5057 就绪 + /health 返回 ok:true ->
  确认「启动后监听 5057 的 PID 与启动前的旧 PID 完全不相交」（防旧进程「假成功」）

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


def listening_pids(port):
    """返回当前监听该端口的 PID 集合；netstat 失败返回 None（区别于「端口空闲」）。

    必须区分这两者：把「探测失败」当成「端口空闲」会放过仍在监听的旧进程，
    后续拉起的新服务会因 EADDRINUSE 退出，却又被误判为重启成功（旧进程仍在服务）。
    """
    try:
        r = subprocess.run("netstat -ano", capture_output=True, text=True,
                           timeout=15, shell=True)
        if r.returncode != 0:
            print(f"[restart-pdf] netstat failed (rc={r.returncode})")
            return None
        out = r.stdout
    except Exception as e:
        print(f"[restart-pdf] netstat failed: {e}")
        return None
    pids = set()
    for ln in out.splitlines():
        if f":{port} " in ln and "LISTENING" in ln:
            pid = ln.split()[-1]
            if pid.isdigit():
                pids.add(pid)
    return pids


def pid_image_name(pid):
    """用 tasklist 取 PID 的映像名（小写）；查不到 / 命令被拦截时返回空串。

    /FO CSV /NH 首列即映像名形如 "python.exe"，不依赖系统语言提示文案；
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


def parent_of(pid):
    """返回 pid 的父进程 PID（int）或 None（wmic 不可用时）。"""
    try:
        r = subprocess.run(
            f'wmic process where "ProcessId={pid}" get ParentProcessId /value',
            shell=True, capture_output=True, text=True, timeout=15)
        for ln in r.stdout.splitlines():
            ln = ln.strip()
            if ln.upper().startswith("PARENTPROCESSID="):
                val = ln.split("=", 1)[1].strip()
                return int(val) if val.isdigit() else None
    except Exception:
        pass
    return None


def _my_ancestors():
    """当前进程及其所有祖先 PID 集合，用于避免误杀脚本自身所在进程树。"""
    try:
        me = os.getpid()
        ancestors = {me}
        cur = me
        for _ in range(20):
            p = parent_of(cur)
            if not p or p in ancestors or p <= 4:  # 4 = System 空闲进程
                break
            ancestors.add(p)
            cur = p
        return ancestors
    except Exception:
        return {os.getpid()}


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
    """只杀监听该端口的 python.exe（PDF 服务）。返回 True 表示「可以安全继续」。

    端口空闲时返回 True（无需杀）；netstat 探测失败、监听者不是 python.exe、
    taskkill 失败一律返回 False —— 保守拒绝，绝不误杀别的服务，也避免假成功。
    """
    try:
        out = subprocess.run("netstat -ano", capture_output=True, text=True,
                             timeout=15, shell=True).stdout
    except Exception as e:
        print(f"[restart-pdf] ERROR: netstat failed for {label}: {e} - refuse to kill")
        return False
    pids = set()
    for ln in out.splitlines():
        if f":{port} " in ln and "LISTENING" in ln:
            pid = ln.split()[-1]
            if pid.isdigit():
                pids.add(pid)
    if not pids:
        print(f"[restart-pdf] {label} (port {port}) not running, nothing to kill")
        return True

    # 确认监听者确实是 python.exe（PDF 服务），否则宁可中止也不强杀
    for pid in pids:
        image = pid_image_name(pid)
        if image != "python.exe":
            print(f"[restart-pdf] ERROR: port {port} held by pid {pid} "
                  f"({image or 'unknown / tasklist unavailable'}), not python.exe - refuse to kill")
            return False

    # PDF 服务实际由 uvicorn 子进程（而非 launch 返回的主进程）监听端口，
    # 必须杀掉「主进程 + 其子进程」整棵树，否则旧子进程会继续占用端口导致假成功。
    # 但绝不能向上杀到本脚本自身及其祖先进程树。
    ancestors = _my_ancestors()
    targets = set()
    for pid in pids:
        parent = parent_of(pid)
        if parent and parent not in ancestors:
            targets.add(parent)   # 杀服务主进程（连同其下 uvicorn 子进程）
        else:
            targets.add(pid)      # 无父信息或父即脚本自身时，直接杀监听者本身
    ok = True
    for target in targets:
        try:
            r = subprocess.run(f"taskkill /PID {target} /F /T", shell=True,
                               capture_output=True, text=True, timeout=15)
            if r.returncode == 0:
                print(f"[restart-pdf] {label} (port {port}) killed process tree pid {target}")
            else:
                detail = (r.stdout + r.stderr).strip().replace("\n", " ")
                print(f"[restart-pdf] ERROR: taskkill pid {target} failed "
                      f"(rc={r.returncode}): {detail or 'no output'}")
                ok = False
        except Exception as e:
            print(f"[restart-pdf] ERROR: taskkill pid {target} failed: {e}")
            ok = False
    return ok


PY = detect_python()
print(f"[restart-pdf] project root : {APP}")
print(f"[restart-pdf] python       : {PY}")

if not os.path.isdir(APP):
    print(f"[restart-pdf] FATAL: project root does not exist: {APP}")
    sys.exit(1)

# ===== 1. 停止现有 PDF 服务 =====
print("[restart-pdf] === step 1/3: stop pdf-service ===")
# 记录启动前已在监听 5057 的 PID（含 uvicorn 子进程），供 step 3 做「旧进程是否残留」校验
OLD_PIDS = listening_pids(PDF_PORT) or set()
was_up = bool(OLD_PIDS)
if not kill_by_port(PDF_PORT, "pdf-service"):
    print("[restart-pdf] FAILED: old pdf-service not stopped, nothing restarted "
          "(see ERROR above; logs/pdf-service.log)")
    sys.exit(1)
if was_up and not wait_for_port_down(PDF_PORT, timeout=10, interval=0.5, label="pdf-service"):
    print("[restart-pdf] FAILED: port 5057 still occupied; old pdf-service may still be running")
    sys.exit(1)

# ===== 2. 重新拉起 =====
print("[restart-pdf] === step 2/3: start pdf-service ===")
launch_hidden([PY, os.path.join("server", "pdf_service.py")], label="pdf-service")
if not wait_for_port(PDF_PORT, timeout=15, interval=1.0, label="pdf-service"):
    print("[restart-pdf] FAILED: pdf-service did not start listening (see logs/pdf-service.log)")
    sys.exit(1)

# ===== 3. 健康检查 + 新进程身份校验（端口就绪 ≠ 应用就绪，更 ≠ 新代码生效）=====
print("[restart-pdf] === step 3/3: health check ===")
healthy = wait_for_health_ok(timeout=15, interval=1.0)

# 防旧进程「假成功」：启动后监听 5057 的 PID 集合，必须与 step 1 记录的 OLD_PIDS
# 完全不相交（没有任何旧 PID 残留）—— 只要监听者全是「启动新进程后才出现的新 PID」，
# 就能断定新代码已生效，无论 PDF 服务把 uvicorn 跑在主进程还是派生子进程（实测为
# 子进程监听、主进程启动）来绑定端口。
new_pids = listening_pids(PDF_PORT)
errors = []
if not healthy:
    errors.append("/health not ok (old code still running or deps missing)")
if new_pids is None:
    errors.append("netstat 不可用，无法确认监听者身份")
elif not new_pids:
    errors.append("port 5057 not listening after start")
elif not new_pids.isdisjoint(OLD_PIDS):
    overlap = sorted(OLD_PIDS & new_pids)
    errors.append(f"port {PDF_PORT} still served by old pid(s) {overlap} (stop failed)")
else:
    # 监听者必须是 python.exe（PDF 服务），排除别的服务恰好占用 5057
    for pid in new_pids:
        if pid_image_name(pid) != "python.exe":
            errors.append(f"port {PDF_PORT} held by pid {pid} "
                          f"({pid_image_name(pid) or 'unknown'}) which is not python.exe")
            break

print(f"[restart-pdf] pdf port {PDF_PORT}:", "UP" if new_pids else "DOWN")
if errors:
    for e in errors:
        print(f"[restart-pdf] ERROR: {e}")
    print("[restart-pdf] FAILED: pdf-service may still be running the OLD code, check logs/pdf-service.log")
    sys.exit(1)
print("[restart-pdf] done")
