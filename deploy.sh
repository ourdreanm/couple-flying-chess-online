#!/usr/bin/env bash
# 情侣飞行棋在线版 · 一键部署脚本
#
# 用法（在服务器上）:
#   git clone https://github.com/ourdreanm/couple-flying-chess-online.git
#   cd couple-flying-chess-online
#   bash deploy.sh
#
# 可选：手动指定服务器公网 IP / 域名（自动获取失败时用）
#   bash deploy.sh 1.2.3.4
#   SERVER_IP=1.2.3.4 bash deploy.sh
#
# 可选：换端口（默认网页 8080，游戏服务 3001）
#   WEB_PORT=80 GAME_PORT=4000 bash deploy.sh 1.2.3.4
#
# 可选：直接指定 WebSocket 地址（绑域名+HTTPS 时用）
#   WS_URL=wss://game.example.com/ws bash deploy.sh game.example.com
#
set -euo pipefail
cd "$(dirname "$0")"

WEB_PORT="${WEB_PORT:-8080}"
GAME_PORT="${GAME_PORT:-3001}"

echo "=== 1/4 检查 Docker ==="
if ! command -v docker >/dev/null 2>&1; then
  echo "未检测到 Docker，正在安装..."
  curl -fsSL https://get.docker.com | sh
  (systemctl enable --now docker || sudo systemctl enable --now docker) 2>/dev/null || true
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "❌ Docker Compose 不可用。请安装 Docker 20.10+ 后重试。"
  exit 1
fi
echo "Docker 就绪: $(docker --version)"

echo "=== 2/4 确定服务器地址 ==="
if [ -n "${WS_URL:-}" ]; then
  echo "使用指定的 WebSocket 地址: ${WS_URL}"
  SERVER_HOST="${1:-${SERVER_IP:-}}"
else
  SERVER_HOST="${1:-${SERVER_IP:-}}"
  if [ -z "$SERVER_HOST" ]; then
    echo "正在自动获取公网 IPv4..."
    # 优先 IPv4(方便绑定域名、拼 WebSocket 地址)；拿不到再回退到默认线路
    SERVER_HOST="$(curl -4 -s --max-time 10 ifconfig.me || curl -s --max-time 10 ifconfig.me || true)"
  fi
  if [ -z "$SERVER_HOST" ]; then
    echo "❌ 无法自动获取公网 IP，请手动指定: bash deploy.sh 你的服务器IP"
    exit 1
  fi
  WS_URL="ws://${SERVER_HOST}:${GAME_PORT}"
fi
# docker compose 会自动读取项目目录下的 .env
cat > .env <<EOF
VITE_GAME_SERVER_URL=${WS_URL}
WEB_PORT=${WEB_PORT}
GAME_PORT=${GAME_PORT}
EOF
echo "服务器: ${SERVER_HOST}"
echo "网页端口: ${WEB_PORT}"
echo "游戏服务端口: ${GAME_PORT}"
echo "WebSocket: ${WS_URL}"

echo "=== 3/4 构建并启动 ==="
docker compose up -d --build

echo "=== 4/4 检查状态 ==="
sleep 3
docker compose ps

echo ""
echo "✅ 部署完成！"
echo "🎲 WebSocket: ${WS_URL}"
if [[ "${WS_URL}" == wss://* ]]; then
  _domain="${WS_URL#wss://}"
  _domain="${_domain%%/*}"
  echo "🌐 游戏地址(域名+HTTPS): https://${_domain}"
elif [ -n "${SERVER_HOST:-}" ]; then
  echo "🌐 游戏地址: http://${SERVER_HOST}:${WEB_PORT}"
fi
echo ""
echo "查看日志: docker compose logs -f"
echo "停止服务: docker compose down"
echo "更新代码后重新部署: git pull && bash deploy.sh ${SERVER_HOST}"
echo ""
echo "注意: 云服务器安全组/防火墙需放行 ${WEB_PORT} 和 ${GAME_PORT} 端口(TCP)。"
echo "如需域名+HTTPS，请看 DEPLOY.md 的 nginx 配置，把 .env 改为 wss://你的域名/ws 后重跑本脚本。"
