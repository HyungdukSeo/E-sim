#!/bin/bash
echo "========================================================"
echo "   Mantis CR Ultra Search & AI Hub 시작 중... (Mac/Linux)"
echo "========================================================"

# 1. 포트 충돌 방지: 기존 3001, 5173 포트가 점유되어 있으면 자동 정리
PORT_PIDS=$(lsof -ti:3001,5173 2>/dev/null)
if [ ! -z "$PORT_PIDS" ]; then
    echo "[Info] 기존에 실행 중이던 이전 프로세스($PORT_PIDS)를 안전하게 정리합니다..."
    kill -9 $PORT_PIDS 2>/dev/null
    sleep 1
fi

# 2. node_modules 설치 확인
if [ ! -d "node_modules" ]; then
    echo "[Info] 필수 라이브러리를 설치합니다..."
    npm install
fi

echo "[Info] 로컬 웹서버 및 백엔드 API를 시작합니다..."
echo "[Info] 종료하시려면 이 터미널 창에서 Ctrl + C 를 누르시면 됩니다."
echo "--------------------------------------------------------"

# 3. 2초 뒤 브라우저 자동 오픈 (Mac)
(sleep 2 && open "http://localhost:5173" 2>/dev/null || xdg-open "http://localhost:5173" 2>/dev/null) &

# 4. 서버 및 클라이언트 포그라운드 실행
npm run dev
