@echo off
title Language Learning - Quick Start
chcp 65001 >nul

echo ============================================
echo   Language Learning - Quick Start
echo ============================================
echo.

echo [0] Cleaning up previous processes...
taskkill /f /im node.exe 2>nul 1>nul
taskkill /fi "WINDOWTITLE eq Backend Server" /f 2>nul 1>nul
taskkill /fi "WINDOWTITLE eq Frontend Client" /f 2>nul 1>nul
timeout /t 3 /nobreak >nul
echo       Done.

set PROJECT_DIR=%~dp0

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set "LAN_IP=%%a"
    goto :found_ip
)
:found_ip
set LAN_IP=%LAN_IP: =%

echo.
echo [1/2] Starting Backend Server...
start "LanguageLearning-Server" cmd /k "cd /d "%PROJECT_DIR%" && title Backend Server && npm run dev:server"
echo       Backend started - Port 3000
echo.

timeout /t 2 /nobreak >nul

echo [2/2] Starting Frontend Dev Server...
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
