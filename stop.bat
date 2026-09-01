@echo off
chcp 65001 >nul
title Mantis CR Ultra Search & AI Hub - Stop
cls
echo =======================================================================
echo    Mantis CR Ultra Search & AI Hub 종료 중...
echo =======================================================================
echo.

:: Kill node processes running on port 3001
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001') do (
    taskkill /f /pid %%a >nul 2>nul
)

echo [OK] Mantis CR Hub 서버가 정상 종료되었습니다.
echo.
timeout /t 2 /nobreak >nul
