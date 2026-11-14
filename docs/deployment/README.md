# Deploying GGE Command

One Linux host running Docker Compose: Caddy (HTTPS), the API, the runner, Postgres, Prometheus, Grafana and a nightly backup job.

Running [Dokploy](https://dokploy.com) on the server? Follow [dokploy.md](dokploy.md) instead; it uses `infra/docker-compose.dokploy.yml`.

Before you start, know that running bots against Goodgame Empire breaks its terms of service and can get game accounts banned, and that whoever runs this server holds other people's game passwords (sealed; see [security.md](security.md)).

## What you need

- A host with 2 vCPU and 4 GB RAM for up to about 30 bots. Each bot is a worker thread; measure with the "Worker heap" panel and raise `MAX_ACCOUNTS` to match ([observability.md](observability.md)).
- Docker Engine 24+ with the Compose plugin.
- A domain with three DNS A/AAAA records pointing at the host: `app.`, `admin.` and `grafana.` under it.
- Ports 80 and 443 open (Caddy uses 80 for the certificate challenge).

## First deploy

1. Get the code on the host.
   ```sh
   git clone <your fork> gge && cd gge
   ```
2. Create the settings file and fill it in ([env.md](env.md) explains each line).
   ```sh
   cp infra/.env.example infra/.env
   openssl rand -hex 32   # use one for POSTGRES_PASSWORD, another for GRAFANA_ADMIN_PASSWORD
   ```
3. Generate the game-password key pair and paste both lines into `infra/.env`.
   ```sh
   docker compose --env-file infra/.env -f infra/docker-compose.yml run --rm --no-deps migrate node tools/dev/keygen.ts
   ```
   Store `SEAL_PRIVATE_KEY` somewhere safe and separate from your backups: without it no stored game password can be opened ([backup-restore.md](backup-restore.md)).
4. Build and start.
   ```sh
   docker compose --env-file infra/.env -f infra/docker-compose.yml up -d --build
   ```
   `migrate` runs the database migrations and exits; the API and the runner start after it succeeds. The runner downloads the game's item data and server list on first boot.
5. Create the first admin.
   ```sh
   docker compose --env-file infra/.env -f infra/docker-compose.yml exec -e GGE_ADMIN_PASSWORD='a long password' api \
     node apps/api/src/cli/create-admin.ts --username yourname
   ```
6. Sign in at `https://admin.<domain>`, create an invite, and open the signup link it gives you to make a player account at `https://app.<domain>`.

## Check it

| Check | Expect |
|---|---|
| `curl https://app.<domain>/healthz` | `{"ok":true}` |
| Admin app, Overview | The runner's heartbeat is a few seconds old |
| `docker compose ... ps` | Every service `running` (or `healthy`); `migrate` exited 0 |
| `https://grafana.<domain>` | The GGE folder has Fleet, Game traffic and API dashboards |

## Next

- Day-to-day operation, upgrades and rollback: [operations.md](operations.md)
- Metrics, dashboards and alerts: [observability.md](observability.md)
- Backups and the restore drill: [backup-restore.md](backup-restore.md)
- Moving from the old single-process bot: [migration-from-legacy.md](migration-from-legacy.md)
