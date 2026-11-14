# Settings (infra/.env)

`infra/.env` holds every setting and secret. It is git-ignored; never commit it. Compose refuses to start while a required value is empty.

| Variable | Read by | Required | Meaning |
|---|---|---|---|
| `DOMAIN` | web, api, grafana | yes | Base domain. The apps live at `app.`, `admin.` and `grafana.` under it. |
| `ACME_EMAIL` | web | yes | Email for Let's Encrypt certificate notices. |
| `GGE_VERSION` | all | no | Image tag and the version the runner reports. Default `latest`. |
| `POSTGRES_PASSWORD` | postgres, api, runner, migrate, grafana, backup | yes | Database password. `openssl rand -hex 32`. |
| `SEAL_PUBLIC_KEY` | api | yes | Seals game passwords on write. From `tools/dev/keygen.ts`. |
| `SEAL_PRIVATE_KEY` | runner | yes | Opens game passwords to log bots in. Only the runner gets it. Back it up apart from the database. |
| `GRAFANA_ADMIN_PASSWORD` | grafana | yes | Grafana's `admin` login. |
| `GRAFANA_ADMIN_USER` | grafana | no | Default `admin`. |
| `GRAFANA_ALERT_DISCORD_WEBHOOK` | grafana | no | Discord webhook URL that receives every Grafana alert ([observability.md](observability.md#alerts)). Empty: alerts show in Grafana only. |
| `MAX_ACCOUNTS` | runner | no | Most bots the runner will run at once. Default 50. Accounts past it show "The runner is at capacity". |
| `START_GAP_MS` | runner | no | Milliseconds between two bot logins. Default 2000. |
| `GAME_CLIENT_VERSION` | runner | no | The client version the bot announces. Set it when the game updates and logins start failing; default 166. |
| `WORKER_MAX_OLD_MB` | runner | no | Heap cap per bot, in MB. Default 512. A bot that goes over is stopped and retried, and its run says "The bot ran out of memory". |
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` | runner | no | Enables the Discord plugins. Each bot currently opens its own Discord connection with this token. |
| `RESEND_API_KEY` | api | no | Resend API key. Without it the API logs each email (link included) instead of sending it, so verification and reset links only reach the log. |
| `EMAIL_FROM` | api | with the key | Sender, e.g. `GGE Bot <noreply@example.com>`. Its domain must be verified in Resend. |
| `TURNSTILE_SECRET_KEY` | api | no | Cloudflare Turnstile secret. Set it together with `VITE_TURNSTILE_SITE_KEY` to require a captcha on signup. Empty turns the captcha off. |
| `VITE_TURNSTILE_SITE_KEY` | web (build) | no | Turnstile site key, baked into the player app at build time. Empty hides the widget, so leave both unset or set both. |
| `BACKUP_KEEP_DAYS` | backup | no | Days of nightly dumps to keep, on the host and in Google Drive's `daily/`. Default 14. |
| `GDRIVE_CLIENT_ID` | backup | no | Google OAuth client ID (Desktop app) for off-site copies ([backup-restore.md](backup-restore.md#off-site-copies-on-google-drive)). |
| `GDRIVE_CLIENT_SECRET` | backup | no | Secret of that OAuth client. |
| `GDRIVE_TOKEN` | backup | no | The `token` JSON from `rclone config show gdrive`, in single quotes. Empty keeps dumps on the host only. |
| `BACKUP_PASSPHRASE` | backup | with `GDRIVE_TOKEN` | Encrypts the copies on Drive. Required when `GDRIVE_TOKEN` is set; the backup service refuses to start without it. Keep it in your password manager: without it the Drive copies can't be read. |
| `BACKUP_KEEP_MONTHS` | backup | no | Months to keep the first dump of each month in Drive's `monthly/`. Default 12. |
| `SENTRY_DSN` | api, runner | no | DSN of the `gge-bot-server` Sentry project. Empty turns server-side Sentry off. |
| `VITE_SENTRY_DSN` | web (build) | no | DSN of the `gge-bot-frontend` Sentry project, baked into both apps at build time. Empty turns browser Sentry off. |
| `SENTRY_AUTH_TOKEN` | web (build secret) | no | Sentry organization token. The web build uploads source maps with it so production stack traces stay readable, then deletes them. Empty skips the upload and builds no source maps. |

## Set inside the compose file (no need to touch)

| Variable | Service | Value |
|---|---|---|
| `DATABASE_URL` | api, runner, migrate | `postgres://gge@postgres:5432/gge`, with the password passed separately as `PGPASSWORD` so any characters work |
| `CLIENT_ORIGINS`, `ADMIN_ORIGINS` | api | `https://app.<DOMAIN>`, `https://admin.<DOMAIN>`. Requests from any other origin get 403. Emailed links point at the first client origin. |
| `PORT` | api | 3000 (internal) |
| `METRICS_PORT` | runner | 9464 (internal) |
| `GGE_DATA_DIR` | runner | `/data`, the `gamedata` volume with items, language and server list |
| `FONT_PATH` | runner | DejaVu Sans, installed in the image |

Development-only switches: `COOKIE_SECURE=false` (api) lets cookies work over plain http; `REFRESH_GAME_DATA=false` (runner) skips downloading game data at boot. Never set either in production.

## Email (Resend)

The API sends account email through [Resend](https://resend.com): address verification, password reset, and password-changed notices. Players can't run bots until they verify, so without a working sender new players are stuck. Before the first send, add your sending domain in the Resend dashboard and publish the SPF and DKIM DNS records it shows. Then set `RESEND_API_KEY` and `EMAIL_FROM` in `infra/.env` and recreate the `api` service.

To smoke-test, sign up with `delivered@resend.dev` and check the message in the Resend dashboard. A failed send never breaks a request; it is written to the API log and the audit log as `email.send_failed`.
