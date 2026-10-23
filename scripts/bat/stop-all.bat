@echo off
REM ============================================================
REM  Language Learning - Stop all services (silent, no black window)
REM  Equivalent to: python scripts\stop-all.py
REM
REM  Stops frontend(5173) -> backend(3000) -> PDF(5057) -> MySQL(3306).
REM  Log file: logs\stop-all.log
REM
REM  NOTE: this file is intentionally pure English on purpose
REM  (Chinese comments/echo in .bat may break cmd parsing on some code pages).
REM
REM  Why the wscript self-restart:
REM    Double-clicking a .bat always makes cmd.exe create a console window.
REM    So on the first run (no "__hidden" arg) we write a tiny VBScript and
REM    run it with wscript.exe (GUI subsystem, never opens a window); that
REM    script re-launches THIS .bat with window style 0 (hidden), then we exit
REM    immediately. The real work runs in a hidden session, so nothing shows.
REM    python.exe inherits that hidden console, so it pops no window either.
REM    Do NOT switch to pythonw.exe: under pythonw sys.stdout is None, every
REM    print() is dropped and the log file would stay empty.
REM
REM    (goto instead of an (if ...) block: parentheses inside the VBScript
REM    would be parsed as the end of the block and break cmd parsing.)
REM
REM  MySQL: stopping the Windows service needs admin rights. Without admin
REM  the script falls back to force-killing mysqld on port 3306, which can
REM  fail if the service runs as NetworkService. Run this .bat as
REM  administrator when MySQL must be stopped reliably.
REM
REM  One more caveat: several python processes may compete for port 5057
REM  (e.g. one from the venv, one from the system python). Only the one that
REM  owns the port serves requests; this script kills that one. Leftover
REM  python processes do no harm but may grab the port on the next start.
REM ============================================================

if /i "%~1"=="__hidden" goto :main

set "VBS=%TEMP%\ll_run_hidden.vbs"
>  "%VBS%" echo Set ws = CreateObject^("WScript.Shell"^)
>> "%VBS%" echo ws.Run """%~f0"" __hidden", 0, False
wscript //nologo "%VBS%"
exit /b 0

:main

chcp 65001 >nul 2>&1

REM  Python writes stdout using the console code page (GBK on Chinese Windows)
REM  when redirected, which garbles any Chinese in the log. Force UTF-8 mode.
set PYTHONUTF8=1

REM Project root uses absolute paths so this .bat can be moved anywhere
set "PROJECT_DIR=D:\PythonFiles\Language-learning"
set "VENV_PY=D:\PythonFiles\.venv\Scripts\python.exe"

if exist "%VENV_PY%" (set "PY=%VENV_PY%") else (set "PY=python")

set "LOG_DIR=%PROJECT_DIR%\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM  ">" (overwrite, not append): keep only the latest run, so the log never grows forever
"%PY%" "%PROJECT_DIR%\scripts\stop-all.py" > "%LOG_DIR%\stop-all.log" 2>&1

exit /b 0
