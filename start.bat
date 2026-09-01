@echo off
chcp 65001 >nul
title Mantis CR Ultra Search & AI Hub
cls
echo =======================================================================
echo    Mantis CR Ultra Search & AI Hub v1.0.0 (Windows Launcher)
echo =======================================================================
echo.

:: 1. Check Node.js installation
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js가 설치되어 있지 않습니다.
    echo Node.js 공식 홈페이지(https://nodejs.org/)에서 LTS 버전을 설치해주세요.
    echo.
    pause
    exit /b 1
)

:: 2. Auto-install production dependencies if missing
if not exist "node_modules" (
    echo [INFO] 최초 실행에 필요한 모듈을 설치 중입니다... (1~2분 소요)
    call npm install --production
    if %errorlevel% neq 0 (
        echo [ERROR] 모듈 설치 중 오류가 발생했습니다. 네트워크 연결을 확인해주세요.
        pause
        exit /b 1
    )
    echo [OK] 모듈 설치 완료!
    echo.
)

:: 3. Open browser automatically after 2 seconds in background
start /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3001"

:: 4. Start Server
echo [INFO] Mantis CR Hub 로컬 웹서버가 구동됩니다.
echo [INFO] 브라우저 주소: http://localhost:3001
echo [INFO] 종료하시려면 이 창에서 Ctrl + C 를 누르시거나 창을 닫으시면 됩니다.
echo -----------------------------------------------------------------------
echo.

node server/index.js
pause
