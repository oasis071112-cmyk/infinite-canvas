# 构建 Vite 前端产物。生产环境可通过 Compose 参数切换可信镜像源。
ARG NODE_IMAGE=node:22-bookworm-slim
ARG NGINX_IMAGE=nginx:1.27-alpine
ARG BUN_VERSION=1.3.13

FROM ${NODE_IMAGE} AS web-build

ARG BUN_VERSION

WORKDIR /app/web
RUN npm install --global "bun@${BUN_VERSION}" --no-audit --no-fund
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN bun run build

# 运行镜像：提供静态前端，并把同源 /api 转发到 Compose 内部的 Node 服务。
FROM ${NGINX_IMAGE}

COPY --from=web-build /app/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY web/docker-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 3000
