# ---- 构建阶段 ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_GAME_SERVER_URL
ENV VITE_GAME_SERVER_URL=${VITE_GAME_SERVER_URL}
RUN npm run build

# ---- 运行阶段：nginx 托管静态页面 ----
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
