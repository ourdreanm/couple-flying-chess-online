# ---- 构建阶段 ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# 注: 不用 npm ci,因为仓库里没有 package-lock.json(文件太大无法通过 API 推送)
RUN npm install --no-audit --no-fund
COPY . .
ARG VITE_GAME_SERVER_URL
ENV VITE_GAME_SERVER_URL=${VITE_GAME_SERVER_URL}
RUN npm run build

# ---- 运行阶段：nginx 托管静态页面 ----
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
