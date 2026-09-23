#!/bin/bash
# 本地一条命令启动：数据库、接口、页面。前端构建后继续监听，保存即更新 dist。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
WEB="$ROOT/trace-web/trace"
PIDFILE="/tmp/qms-vite-watch.pid"
LOG="/tmp/qms-vite-watch.log"

cd "$ROOT"
echo "启动数据库、接口和页面..."
docker compose up -d

cd "$WEB"
if [ ! -d node_modules ]; then
  echo "安装前端依赖..."
  npm install
fi

echo "构建前端..."
npx vite build

if [ -f "$PIDFILE" ]; then
  old="$(cat "$PIDFILE" || true)"
  if [ -n "${old}" ] && kill -0 "$old" 2>/dev/null; then
    kill "$old" 2>/dev/null || true
    pkill -P "$old" 2>/dev/null || true
  fi
fi

echo "监听前端改动..."
nohup npx vite build --watch >>"$LOG" 2>&1 </dev/null &
echo $! >"$PIDFILE"
disown || true

echo "已启动：http://127.0.0.1:5178/html/trace/"
echo "改前端保存后刷新浏览器即可。日志：$LOG"
echo "改 Python 接口后执行：docker restart trace-api-local"
