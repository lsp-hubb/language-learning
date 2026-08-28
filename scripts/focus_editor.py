"""
将编辑器窗口前置（供 Vite 组件检查器调用）

背景
----
点击组件 → Vite 中间件 spawn `Code.exe --goto` 打开源码。
但 VS Code 通常会**复用已有窗口**，窗口虽已打开却不置前，用户还得手动 Alt+Tab。
本脚本在其后运行，把目标编辑器窗口提到最前面。

Windows 前台锁定限制
--------------------
非前台进程直接调用 `SetForegroundWindow` 会被系统忽略（仅任务栏图标闪烁）。
本脚本用两级策略绕过：
  1) `AttachThreadInput` 把本线程挂到当前前台线程的输入队列
  2) 模拟一次 Alt 按键（Windows 允许紧跟其后的 SetForegroundWindow 生效）

用法
----
  pythonw focus_editor.py --process Code.exe --file <绝对路径> --root <项目根> [--timeout 8]
  pythonw focus_editor.py --list          # 调试：列出所有顶层窗口

退出码
------
  0 = 成功前置  1 = 未找到窗口  2 = 找到但前置失败  3 = 参数错误
"""

import argparse
import os
import sys
import time

# 中文 Windows 控制台默认 GBK，窗口标题可能含无法编码的字符（如 \u200b），
# 需强制 UTF-8 并容错，否则 print 直接抛 UnicodeEncodeError 中断脚本。
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    import win32api
    import win32con
    import win32gui
    import win32process
except ImportError:
    sys.stderr.write("[focus] pywin32 未安装，无法前置窗口\n")
    sys.exit(3)


def list_windows():
    """列出所有可见的顶层窗口（调试用）。"""
    rows = []

    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd)
        if not title:
            return
        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            import ctypes
            # 取进程名：用 QueryFullProcessImageName
            buf = ctypes.create_unicode_buffer(1024)
            size = ctypes.wintypes.DWORD(1024) if hasattr(ctypes, "wintypes") else None
            h = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
            name = ""
            if h:
                import ctypes.wintypes as wt
                sz = wt.DWORD(1024)
                if ctypes.windll.kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(sz)):
                    name = os.path.basename(buf.value)
                ctypes.windll.kernel32.CloseHandle(h)
        except Exception:
            pid, name = 0, ""
        rows.append((pid, name, title))

    import ctypes.wintypes  # noqa: F401
    win32gui.EnumWindows(cb, None)
    return rows


def find_hwnd(process_name, keywords, partial=False):
    """查找顶层窗口：进程名匹配，且标题依次尝试包含 keywords（越靠前优先级越高）。

    返回 (hwnd, matched_keyword)；找不到返回 (None, None)。
    """
    target_proc = (process_name or "").lower()
    found = {}  # keyword -> hwnd

    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd) or ""
        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
        except Exception:
            return
        if not pid:
            return
        # 校验进程名
        try:
            import ctypes
            import ctypes.wintypes as wt
            buf = ctypes.create_unicode_buffer(1024)
            sz = wt.DWORD(1024)
            h = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
            if not h:
                return
            ok = ctypes.windll.kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(sz))
            ctypes.windll.kernel32.CloseHandle(h)
            if not ok:
                return
            if target_proc and os.path.basename(buf.value).lower() != target_proc:
                return
        except Exception:
            return
        # 按优先级记录命中的关键词
        for kw in keywords:
            if kw and kw.lower() in title.lower():
                if kw not in found:
                    found[kw] = hwnd
                break

    win32gui.EnumWindows(cb, None)
    for kw in keywords:
        if kw in found:
            return found[kw], kw
    return None, None


def force_foreground(hwnd):
    """强制把窗口提到最前。绕过 Windows 前台锁定。"""
    # 1) 最小化则先还原，否则确保可见
    try:
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        else:
            win32gui.ShowWindow(hwnd, win32con.SW_SHOW)
    except Exception:
        pass

    # 2) 先直接尝试（若本进程恰好有前台权限则一次成功）
    try:
        win32gui.SetForegroundWindow(hwnd)
        win32gui.BringWindowToTop(hwnd)
        if win32gui.GetForegroundWindow() == hwnd:
            return True
    except Exception:
        pass

    # 3) 绕过前台锁定：附加到前台线程 + 模拟 Alt 键
    cur_thread = win32api.GetCurrentThreadId()
    fg_thread = None
    try:
        fg = win32gui.GetForegroundWindow()
        fg_thread, _ = win32process.GetWindowThreadProcessId(fg)
        if fg_thread and fg_thread != cur_thread:
            win32process.AttachThreadInput(fg_thread, cur_thread, True)
    except Exception:
        fg_thread = None

    try:
        # 模拟 Alt 按下/抬起，解锁接下来的一次 SetForegroundWindow
        win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
        try:
            win32gui.SetForegroundWindow(hwnd)
            win32gui.BringWindowToTop(hwnd)
        finally:
            win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
    except Exception:
        pass
    finally:
        if fg_thread:
            try:
                win32process.AttachThreadInput(fg_thread, cur_thread, False)
            except Exception:
                pass

    return win32gui.GetForegroundWindow() == hwnd


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--process", default="Code.exe")
    ap.add_argument("--file", default="")
    ap.add_argument("--root", default="")
    ap.add_argument("--timeout", type=float, default=8.0)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--help", action="store_true")
    args, _ = ap.parse_known_args()

    if args.help:
        print(__doc__)
        return 0

    if args.list:
        for pid, name, title in list_windows():
            print(f"{pid:>7}  {name:<20}  {title}")
        return 0

    if not args.file and not args.root:
        sys.stderr.write("[focus] 需要 --file 或 --root\n")
        return 3

    # 关键词优先级：文件名 > 项目目录名 > 编辑器自身标题特征
    keywords = []
    if args.file:
        keywords.append(os.path.basename(args.file))
    if args.root:
        keywords.append(os.path.basename(os.path.normpath(args.root)))
    keywords.append("Visual Studio Code")
    keywords = [k for k in keywords if k]

    deadline = time.time() + max(0.5, args.timeout)
    hwnd, kw = None, None
    # 轮询：VS Code 打开新文件后窗口标题需要一点时间更新
    while time.time() < deadline:
        hwnd, kw = find_hwnd(args.process, keywords)
        if hwnd:
            break
        time.sleep(0.15)

    if not hwnd:
        sys.stderr.write(f"[focus] 未找到窗口: process={args.process} keywords={keywords}\n")
        return 1

    ok = force_foreground(hwnd)
    if ok:
        print(f"[focus] 已前置: {win32gui.GetWindowText(hwnd)!r} (match={kw!r})")
        return 0
    sys.stderr.write(f"[focus] 找到窗口但前置失败: {win32gui.GetWindowText(hwnd)!r}\n")
    return 2


if __name__ == "__main__":
    sys.exit(main())
