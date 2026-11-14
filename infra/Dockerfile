# One image definition, three targets: node (api, runner, migrate, tools) and web (Caddy with both apps).
# The TypeScript services run from source with Node's type stripping, so there is no build step for them.

FROM node:24-bookworm-slim AS deps
RUN corepack enable 2>/dev/null || npm install -g pnpm@11.9.0
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/bot-core/package.json packages/bot-core/
COPY packages/contracts/package.json packages/contracts/
COPY packages/crypto/package.json packages/crypto/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/runner/package.json apps/runner/
COPY apps/client/package.json apps/client/
COPY apps/admin/package.json apps/admin/
COPY tools/dev/package.json tools/dev/
COPY tools/import-sqlite/package.json tools/import-sqlite/
RUN pnpm install --frozen-lockfile

FROM deps AS web-build
COPY . .
ARG VITE_CLIENT_URL
ARG VITE_GRAFANA_URL
RUN pnpm --filter @gge/client build && pnpm --filter @gge/admin build

FROM caddy:2.10-alpine AS web
# infra/Caddyfile terminates TLS itself; infra/Caddyfile.dokploy serves plain HTTP behind Dokploy's Traefik.
ARG CADDYFILE=infra/Caddyfile
COPY ${CADDYFILE} /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/client/dist /srv/client
COPY --from=web-build /app/apps/admin/dist /srv/admin

FROM node:24-bookworm-slim AS node
# DejaVu is the font the Discord attack previews draw with (imageGen.js).
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data && chown node:node /data
WORKDIR /app
COPY --from=deps /app /app
COPY . .
ENV NODE_ENV=production \
    GGE_DATA_DIR=/data \
    FONT_PATH=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
USER node

# Monitoring and backup images carry their config, so nothing is bind-mounted
# from the checkout (a platform that re-clones on deploy would pull it away).
FROM prom/prometheus:v3.5.0 AS prometheus
COPY infra/prometheus/prometheus.yml /etc/prometheus/prometheus.yml

FROM grafana/grafana:12.1.0 AS grafana
COPY infra/grafana/provisioning /etc/grafana/provisioning
COPY infra/grafana/dashboards /var/lib/grafana/dashboards

FROM postgres:17-bookworm AS backup
COPY infra/backup/backup-loop.sh /backup/backup-loop.sh
