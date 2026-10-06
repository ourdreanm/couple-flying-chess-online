# ---- 构建阶段 ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
RUN npm prune --omit=dev

# ---- 运行阶段 ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
ENV PORT=3001
EXPOSE 3001
CMD ["node", "dist/index.js"]
