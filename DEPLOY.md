# 🌐 在线联机版部署指南

这个版本在原项目基础上增加了**异地双人在线对战**：一方创建房间拿到 6 位房号，另一方输入房号加入，各自选主题后开始游戏。掷骰、走子、任务卡都由服务器权威结算，两边看到完全一致。

## 架构

```
浏览器（前端静态页）  --WebSocket-->  游戏服务器（Node.js, 端口 3001）
```

- `server/`：WebSocket 游戏服务器（房间管理、掷骰结算、任务卡抽取、断线重连），无数据库，房间放内存。
- 前端：构建时通过环境变量 `VITE_GAME_SERVER_URL` 知道去连哪个服务器。

## 方式一：Docker Compose 一键部署（推荐）

服务器上需要：Docker + Docker Compose。

```bash
# 1. 把项目传到服务器并进入目录
cd couple-flying-chess-online

# 2. 设置前端要连接的服务器地址（浏览器视角！）
#    - 如果只是本机/局域网体验，用服务器的局域网 IP：
export VITE_GAME_SERVER_URL="ws://192.168.1.100:3001"
#    - 如果有域名且配了 HTTPS（见下文），用：
#      export VITE_GAME_SERVER_URL="wss://game.你的域名.com/ws"

# 3. 启动
docker compose up -d --build

# 4. 查看日志确认
docker compose logs -f
```

启动后：

- 游戏页面：`http://服务器IP:8080`
- 游戏服务器：`ws://服务器IP:3001`

云服务器记得在安全组/防火墙放行 **8080** 和 **3001** 端口（TCP）。

```bash
# 常用管理命令
docker compose ps              # 查看状态
docker compose logs game-server # 只看游戏服务器日志
docker compose down             # 停止
```

## 方式二：手动部署（Node + pm2 + nginx）

适合已经有 nginx / 不想用 Docker 的服务器。需要 Node.js 18+。

```bash
# 1. 启动游戏服务器
cd server
npm ci --omit=dev --no-audit --no-fund
npm run build
# 用 pm2 守护（npm i -g pm2）
pm2 start dist/index.js --name feiqi-server
# 默认监听 3001，可用环境变量 PORT 修改：PORT=3001 pm2 start ...

# 2. 构建前端（注意 VITE_GAME_SERVER_URL 是构建时注入的！）
cd ..
VITE_GAME_SERVER_URL="wss://game.你的域名.com/ws" npm run build
# 把 dist/ 目录放到 nginx 的网站根目录，例如 /var/www/feiqi
```

## 域名 + HTTPS（推荐，手机浏览器体验最好）

手机浏览器在 `http` 下也能玩，但 `https` 更稳定。假设域名 `game.你的域名.com` 已解析到服务器，nginx 配置示例：

```nginx
server {
    listen 443 ssl;
    server_name game.你的域名.com;

    ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;

    root /var/www/feiqi;   # 前端 dist 目录
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }

    # WebSocket 反向代理：浏览器连 wss://game.你的域名.com/ws（注意 location 写 /ws，不要写 /ws/，否则 /ws 路径匹配不上）
    location /ws {
        proxy_pass http://127.0.0.1:3001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

这种情况下构建前端时：`VITE_GAME_SERVER_URL="wss://game.你的域名.com/ws"`。

> 注意：页面是 `https` 时，WebSocket 必须用 `wss://`，浏览器会拦截 `ws://`（混合内容）。

## 玩法说明

1. 一方点首页 **🌐 在线联机（异地双人） → 创建房间**，选自己是男方/女方，拿到 6 位房号。
2. 把房号发给 TA，TA 选择 **加入房间** 输入房号。
3. 两人**各自**选择自己的任务主题（主题库是各自手机/浏览器本地的，选好后会自动同步给对方）。
4. 房主点 **开始游戏**。之后轮流掷骰子，任务卡双方都能看到，由被执行方点接受/拒绝。
5. 一方断线（刷新/切后台）后，点 **恢复上次的房间** 可自动重连回来，进度不丢。
6. 对局结束点 **再来一局** 可直接重开（主题保留）。

## 验证服务器是否正常

```bash
cd server
npm run test:e2e   # 自动跑两个虚拟客户端完整打一局，全部通过即正常
```

## 服务器在国外时的说明

- **不用备案**：服务器在境外，不需要 ICP 备案，域名解析生效后直接可用。
- **拉镜像不用换源**：Docker Hub 直连即可，`docker compose up -d --build` 一步到位。
- `VITE_GAME_SERVER_URL` 填服务器的**公网 IP 或域名**，例如 `ws://1.2.3.4:3001`；
  配好域名 + HTTPS 后建议用 `wss://game.你的域名.com/ws`（见上文 nginx 配置）。
- 如果人在国内、服务器在国外：延迟一般在 150~300ms，回合制游戏不受影响；
  建议配好域名 + HTTPS/wss，比裸 IP 更稳定。
- 云厂商安全组记得放行 **8080**（页面）和 **3001**（游戏服务）TCP 端口。

## 常见问题

| 问题 | 排查 |
|---|---|
| 页面打不开 | 检查 8080 端口是否放行、`docker compose ps` 容器是否正常 |
| 点创建房间一直"连接中" | 前端连不上服务器：检查 `VITE_GAME_SERVER_URL` 是**浏览器视角**的地址；云服务器用公网 IP/域名，不要用 localhost（除非本机体验） |
| https 页面连不上 ws | 必须用 `wss://`，并确认 nginx 代理了 `/ws/` 且证书有效 |
| 房号不存在 | 房号 6 位不含易混淆字符（0/O/1/I）；房间 30 分钟无人会自动清理，过期需重建 |
| 换了服务器地址不生效 | `VITE_GAME_SERVER_URL` 是**构建时**注入的，改完要重新 `docker compose up -d --build` |
| 想改端口 | 服务器：`PORT` 环境变量；前端：重建时改 `VITE_GAME_SERVER_URL`，compose 里改 `ports` 映射 |

## 房间与数据说明

- 房间号 6 位，内存存储，无人 30 分钟或存在超 24 小时自动清理。
- 主题和任务存在**各自浏览器本地**（和原版一致），进房间时只把**选中的主题**同步给服务器用于抽卡。
- 服务器只做对局结算，不存任何账号数据。
