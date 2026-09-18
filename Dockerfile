# Agent API 镜像（Node + 已编译 server；runtime 由 sidecar/外部提供）
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json

RUN npm ci

COPY . .

RUN npm run build -w server

FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# workspaces 布局需要 root + 各包 package.json 才能 npm ci
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/client/package.json ./client/package.json
RUN npm ci --omit=dev \
  && npm cache clean --force

# 已编译 server + 内置技能（BUILTIN_SKILL_DIR 指望它存在）
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/skills ./server/skills

USER node

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
