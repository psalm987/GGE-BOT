# Operations

All commands run from the repository root. `dc` below means
`docker compose --env-file infra/.env -f infra/docker-compose.yml`.

## Upgrade

```sh
git pull
dc build
dc up -d
```

`migrate` runs before the API and runner restart. The runner stops every bot on SIGTERM (up to 60 s), records their runs as ended by `deploy`, and the new runner starts them again, spaced `START_GAP_MS` apart.

## Roll back

```sh
git checkout <previous tag or commit>
dc build && dc up -d
```

Migrations only move forward. If the release you are leaving added a migration, restore the backup taken before the upgrade ([backup-restore.md](backup-restore.md)) instead of rolling the code back on its own. Take a manual dump before every upgrade that includes migrations:

```sh
dc exec backup pg_dump -h postgres -U gge -d gge --format=custom --file=/backups/pre-upgrade.dump
```

## Logs

```sh
dc logs -f api runner      # service logs (JSON from the API)
```

A player's bot log is in the player app (account, Logs tab) and in the `bot_logs` table. The runner keeps the last 500 lines per account and nothing older than 7 days.

## Health

| Signal | Where |
|---|---|
| API up | `GET /healthz` returns `{"ok":true}`; compose healthcheck |
| Runner up | Admin app overview shows a heartbeat under 60 s old; Grafana alert "Runner stopped reporting" |
| Bots | Admin app overview counts by state; Grafana "Fleet" dashboard |

## Only one runner

The runner takes a Postgres advisory lock at start. A second runner (for example `dc up --scale runner=2`) logs "Another runner holds the lock" and exits. That is intended: two runners would log the same game account in twice.

## Common situations

| Situation | Do |
|---|---|
| A player's bot shows **Wrong password** | They update the game password in the account's settings and press Start. The runner does not retry on its own. |
| A bot shows **Banned** | The ban end is stored with the status. The runner will not restart it; the player decides when to start it again. |
| Many bots show **Error … retrying** | Check `dc logs runner` and the Game traffic dashboard. A game client update often shows as every login failing: set `GAME_CLIENT_VERSION`. |
| Need to stop one player's bots now | Admin app, Users, Disable: it signs them out and stops all their bots. |
| Need to stop everything | `dc stop runner`. Bots stop; their desired state is kept, so `dc start runner` brings them back. |

## Disk

Postgres, Prometheus (15 days) and the backups volume grow. `docker system df -v` shows volume sizes. Bot logs are pruned hourly; audit log and run history are kept.
