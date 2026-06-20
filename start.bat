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
echo       Waiting for backend (port 3000)...
set back_wait=0
:back_loop
timeout /t 2 /nobreak >nul
netstat -ano | findstr ":3000 " | findstr LISTENING >nul 2>nul
if %errorlevel% equ 0 goto back_ok
set /a back_wait+=1
if %back_wait% lss 15 goto back_loop
echo [WARN] Backend not ready after 30s, continuing...
:back_ok
echo       [OK] Backend ready.
echo.

echo [2/2] Starting Frontend Dev Server...
start "LanguageLearning-Client" cmd /k "cd /d "%PROJECT_DIR%" && title Frontend Client && npm run dev"
echo       Waiting for frontend (port 5173)...
set front_wait=0
:front_loop
timeout /t 2 /nobreak >nul
netstat -ano | findstr ":5173 " | findstr LISTENING >nul 2>nul
if %errorlevel% equ 0 goto front_ok
set /a front_wait+=1
if %front_wait% lss 15 goto front_loop
echo [WARN] Frontend not ready after 30s, continuing...
:front_ok
echo       [OK] Frontend ready.
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
timeout /t 1 /nobreak >nul
start "" "http://localhost:5173"

exit
