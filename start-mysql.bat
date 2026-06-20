@echo off
title MySQL Startup
chcp 65001 >nul

echo ============================================
echo   MySQL80 Startup
echo ============================================
echo.

sc query MySQL80 | find "RUNNING" >nul
if %errorlevel% neq 0 (
    echo MySQL80 is not running - starting...
    echo (A UAC prompt may appear - please click Yes)
    powershell -Command "Start-Process cmd -ArgumentList '/c net start MySQL80' -Verb RunAs -Wait" 2>nul
    timeout /t 3 /nobreak >nul
    sc query MySQL80 | find "RUNNING" >nul
    if %errorlevel% neq 0 (
        echo [FAILED] MySQL80 could not be started.
        echo Open MySQL Workbench manually or check Windows Services.
    ) else (
        echo [OK] MySQL80 is now running.
    )
) else (
    echo [OK] MySQL80 is already running.
)

echo.
if "%1" neq "nopause" pause
