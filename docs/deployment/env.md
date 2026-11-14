# Settings (infra/.env)

`infra/.env` holds every setting and secret. It is git-ignored; never commit it. Compose refuses to start while a required value is empty.

| Variable | Read by | Required | Meaning |
|---|---|---|---|
| `DOMAIN` | web, api, grafana | yes | Base domain. The apps live at `app.`, `admin.` and `grafana.` under it. |
| `ACME_EMAIL` | web | yes | Email for Let's Encrypt certificate notices. |
| `GGE_VERSION` | all | no | Image tag and the version the runner reports. Default `latest`. |
| `POSTGRES_PASSWORD` | postgres, api, runner, migrate, grafana, backup | yes | Database password. `openssl rand -base64 32`. |
| `SEAL_PUBLIC_KEY` | api | yes | Seals game passwords on write. From `tools/dev/keygen.ts`. |
| `SEAL_PRIVATE_KEY` | runner | yes | Opens game passwords to log bots in. Only the runner gets it. Back it up apart from the database. |
| `GRAFANA_ADMIN_PASSWORD` | grafana | yes | Grafana's `admin` login. |
| `GRAFANA_ADMIN_USER` | grafana | no | Default `admin`. |
| `MAX_ACCOUNTS` | runner | no | Most bots the runner will run at once. Default 50. Accounts past it show "The runner is at capacity". |
| `START_GAP_MS` | runner | no | Milliseconds between two bot logins. Default 2000. |
| `GAME_CLIENT_VERSION` | runner | no | The client version the bot announces. Set it when the game updates and logins start failing; default 166. |
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` | runner | no | Enables the Discord plugins. Each bot currently opens its own Discord connection with this token. |
| `BACKUP_KEEP_DAYS` | backup | no | Days of nightly dumps to keep on the host. Default 14. |

## Set inside the compose file (no need to touch)

| Variable | Service | Value |
|---|---|---|
| `DATABASE_URL` | api, runner, migrate | `postgres://gge:…@postgres:5432/gge` |
| `CLIENT_ORIGINS`, `ADMIN_ORIGINS` | api | `https://app.<DOMAIN>`, `https://admin.<DOMAIN>`. Requests from any other origin get 403. |
| `PORT` | api | 3000 (internal) |
| `METRICS_PORT` | runner | 9464 (internal) |
| `GGE_DATA_DIR` | runner | `/data`, the `gamedata` volume with items, language and server list |
| `FONT_PATH` | runner | DejaVu Sans, installed in the image |

Development-only switches: `COOKIE_SECURE=false` (api) lets cookies work over plain http; `REFRESH_GAME_DATA=false` (runner) skips downloading game data at boot. Never set either in production.
