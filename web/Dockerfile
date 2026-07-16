### -------- Build stage: produce Node SSR bundle + static assets --------
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* bunfig.toml* ./
RUN bun install --frozen-lockfile || bun install
COPY . .
# Force node-server preset; @lovable.dev/vite-tanstack-config auto-forces
# cloudflare-module when DEV_SERVER__PROJECT_PATH is set (Lovable sandbox),
# so unset it here to make sure Docker builds emit `.output/`.
RUN rm -rf dist .output && \
    unset DEV_SERVER__PROJECT_PATH LOVABLE_SANDBOX && \
    bun run build && \
    test -f .output/server/index.mjs || (echo "ERROR: SSR entry .output/server/index.mjs missing" && ls -la .output .output/server 2>/dev/null && exit 1) && \
    test -d .output/public || (echo "ERROR: static output .output/public missing" && exit 1)

### -------- SSR runtime image (Node) -----------------------------------
# Runs the TanStack Start SSR server on port 3000. The `web` (nginx) container
# proxies to this service.
FROM node:20-alpine AS ssr
WORKDIR /app
COPY --from=build /app/.output ./.output
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]

### -------- Nginx static / reverse-proxy image ------------------------
# Serves /health and proxies:
#   /api/*  -> api  container (fastify, port 4000)
#   /*      -> ssr  container (node ssr,  port 3000)
FROM nginx:1.27-alpine AS web
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/*
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
