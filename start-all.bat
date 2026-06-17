@echo off
title Language Learning - Start All
chcp 65001 >nul

echo ============================================
echo   Language Learning - Start All
echo ============================================
echo.

:: ===== 1. MySQL =====
echo [1/3] MySQL80 Startup
sc query MySQL80 | find "RUNNING" >nul
if %errorlevel% neq 0 (
    echo       MySQL80 is not running - starting...
    echo       (A UAC prompt may appear - please click Yes)
    powershell -Command "Start-Process cmd -ArgumentList '/c net start MySQL80' -Verb RunAs -Wait" 2>nul
    timeout /t 3 /nobreak >nul
    sc query MySQL80 | find "RUNNING" >nul
    if %errorlevel% neq 0 (
        echo [FAILED] MySQL80 could not be started.
        echo          Open MySQL Workbench manually or check Windows Services.
    ) else (
        echo [OK] MySQL80 is now running.
    )
) else (
    echo [OK] MySQL80 is already running.
)
echo.

:: ===== 2. Cleanup =====
echo [2/3] Cleaning up previous Node processes...
taskkill /f /im node.exe 2>nul 1>nul
taskkill /fi "WINDOWTITLE eq Backend Server" /f 2>nul 1>nul
taskkill /fi "WINDOWTITLE eq Frontend Client" /f 2>nul 1>nul
timeout /t 3 /nobreak >nul
echo       Done.
echo.

set PROJECT_DIR=%~dp0

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set "LAN_IP=%%a"
    goto :found_ip
)
:found_ip
set LAN_IP=%LAN_IP: =%

:: ===== 3. Start Backend =====
echo [3/3] Starting services...
echo.
echo       Starting Backend Server...
start "LanguageLearning-Server" cmd /k "cd /d "%PROJECT_DIR%" && title Backend Server && npm run dev:server"
echo       Backend started - Port 3000
echo.

timeout /t 2 /nobreak >nul

echo       Starting Frontend Dev Server...
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
echo [4/3] Opening browser...
timeout /t 3 /nobreak >nul
start "" "http://localhost:5173"

exit
