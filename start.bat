@echo off
echo ========================================================
echo    Mantis CR Ultra Search & AI Hub starting... (Windows)
echo ========================================================

if not exist "node_modules" (
    echo [Info] Installing dependencies...
    call npm install
)

echo [Info] Launching local server and web application...
call npm run dev
pause
