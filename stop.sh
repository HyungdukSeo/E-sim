#!/bin/bash
echo "========================================================"
echo "   Mantis CR Ultra Search & AI Hub 서비스 종료 중..."
echo "========================================================"

PORT_PIDS=$(lsof -ti:3001,5173 2>/dev/null)
if [ ! -z "$PORT_PIDS" ]; then
    kill -9 $PORT_PIDS 2>/dev/null
    echo "[성공] 실행 중이던 프로세스($PORT_PIDS)가 모두 정상 종료되었습니다."
else
    echo "[안내] 현재 실행 중인 Mantis Hub 프로세스가 없습니다."
fi
