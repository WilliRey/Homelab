# syntax=docker/dockerfile:1
# Versions below were checked against Docker Hub / PyPI on 2026-11-06.
ARG NODE_IMAGE=node:24.22.2-bookworm-slim

FROM ${NODE_IMAGE} AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM ${NODE_IMAGE} AS server
WORKDIR /src/server
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# Deno is the JS runtime yt-dlp needs to solve YouTube's JS challenges.
FROM denoland/deno:bin-2.9.8 AS deno

FROM ${NODE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deno /deno /usr/local/bin/deno
# yt-dlp is pinned for a reproducible build; jobs/ytdlpUpdater.ts upgrades it daily at runtime.
# bgutil-ytdlp-pot-provider must match the bgutil sidecar image tag in docker-compose.yml.
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir "yt-dlp[default]==2026.10.26" "bgutil-ytdlp-pot-provider==2.0.2" \
 && chown -R node:node /opt/venv
ENV PATH=/opt/venv/bin:$PATH NODE_ENV=production
WORKDIR /app
COPY --from=server /src/server/dist ./dist
COPY --from=server /src/server/node_modules ./node_modules
COPY --from=server /src/server/package.json ./
COPY --from=web /src/web/dist ./public
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","dist/index.js"]
