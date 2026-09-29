#!/bin/zsh

set -u

PROJECT_DIR="/Users/chenshengyu/Desktop/Planner"
SERVER_DIR="$PROJECT_DIR/server"
APP_URL="http://localhost:3000"
APP_FILE="$PROJECT_DIR/index.html"

printf '\033]0;企鹅计划后端\007'
cd "$SERVER_DIR" || {
  printf '\n无法进入项目目录：%s\n' "$SERVER_DIR"
  read -k 1 '?按任意键退出...'
  exit 1
}

# Reuse an already-running backend instead of starting a second copy.
if curl -sS --max-time 2 -o /dev/null "$APP_URL/"; then
  open "$APP_FILE"
  exit 0
fi

printf '正在启动企鹅计划后端...\n'
npm start &
server_pid=$!

ready=0
for attempt in {1..30}; do
  if curl -sS --max-time 2 -o /dev/null "$APP_URL/"; then
    ready=1
    break
  fi
  sleep 1
done

if (( ready )); then
  printf '\n后端已启动，正在打开计划软件：%s\n' "$APP_URL"
  open "$APP_FILE"
  printf '请保持此窗口打开，关闭窗口会停止本次后端进程。\n\n'
  wait "$server_pid"
else
  printf '\n后端启动失败，请检查上面的错误信息。\n'
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  read -k 1 '?按任意键退出...'
  exit 1
fi
