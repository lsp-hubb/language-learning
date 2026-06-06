@echo off
title Language Learning - Quick Start
chcp 65001 >nul

echo ============================================
echo   Language Learning - Quick Start
echo ============================================
echo.

echo [0] Cleaning up previous processes...
:: 强制终止所有 Node 进程
taskkill /f /im node.exe >nul 2>&1
:: 关闭旧的 Backend/Frontend 窗口（匹配标题和窗口名）
taskkill /fi "WINDOWTITLE eq Backend Server*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Frontend Client*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq LanguageLearning-Server*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq LanguageLearning-Client*" /f >nul 2>&1
:: 等待进程完全退出
timeout /t 3 /nobreak >nul
echo       Done.

:::: Get the script directory (project root)
set PROJECT_DIR=%~dp0

:::: Get LAN IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set "LAN_IP=%%a"
    goto :found_ip
)
:found_ip
set LAN_IP=%LAN_IP: =%

echo.
echo [1/2] Starting Backend Server (MySQL API)...
start "LanguageLearning-Server" cmd /k "cd /d "%PROJECT_DIR%" && title Backend Server && npm run dev:server"
echo       Backend started - Port 3000
echo.

timeout /t 2 /nobreak >nul

echo [2/2] Starting Frontend Dev Server (Vite)...
start "LanguageLearning-Client" cmd /k "cd /d "%PROJECT_DIR%" && title Frontend Client && npm run dev"
echo       Frontend started - Port 5173
echo.

echo ============================================
echo   All services started successfully!
echo.
echo   Local:    http://localhost:5173
if defined LAN_IP echo   Network:  http://%LAN_IP%:5173
echo.
echo   Close the corresponding window to stop
echo ============================================

echo.
echo [3/3] Opening browser...
timeout /t 3 /nobreak >nul
start "" "http://localhost:5173"

exit
