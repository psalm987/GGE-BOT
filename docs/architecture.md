# Architecture

GGE Command runs Goodgame Empire bots for many players from one server. Players manage their game accounts in a web app; a separate runner keeps one bot worker alive for each account a player has started.

```
 app.<domain>  ──┐                       ┌── NOTIFY gge_desired (triggers) ──► runner ──► one worker thread
 admin.<domain> ─┼─ Caddy ─► api ─► Postgres                                     │       per game account
 grafana.<domain>┘                       └◄── NOTIFY gge_bot (status, logs) ◄────┘       (packages/bot-core)
```

## Parts

| Path | Role |
|---|---|
| `apps/api` | Fastify + oRPC. The player contract at `/rpc`, the admin contract at `/admin/rpc`. Sign-in, sessions, accounts, invites, audit. Streams bot status and logs to players. |
| `apps/runner` | Supervises bot workers. Reads which accounts should run from Postgres, starts and stops workers, records status, logs and runs. Exactly one runs at a time (a Postgres advisory lock). |
| `apps/client` | The player app (Vite, React, Ant Design). |
| `apps/admin` | The admin app. |
| `packages/bot-core` | The bot itself: the game protocol (`protocols.js`), the worker entry point (`ggeBot.js`) and the plugins. JavaScript, run inside worker threads. |
| `packages/contracts` | Zod schemas and the two oRPC contracts shared by the API and the apps, plus the plugin-settings rules. |
| `packages/db` | Drizzle schema and migrations. |
| `packages/crypto` | Sealed boxes for game passwords. |
| `packages/ui` | The theme and shared React components. |
| `tools/dev` | `pnpm dev`: a local stack with demo data. |
| `tools/import-sqlite` | One-shot import from the legacy `user.db`. |
| `infra` | Docker Compose, Caddy, Prometheus and Grafana. |

## How the pieces talk

The API and the runner never call each other. Postgres is the only channel.

1. A player starts an account; the API sets `game_accounts.desired_state = 'running'`.
2. A trigger sends `NOTIFY gge_desired`. Triggers also fire on plugin settings and on a user's status, so an admin disabling a user or force-stopping an account reaches the runner the same way.
3. The runner reconciles: it loads every account that should run (wanted, with an active owner) and starts, restarts or stops workers to match. It also reconciles every 30 seconds in case a notification was missed.
4. Workers report back through the runner, which writes `bot_status`, `bot_logs` and `bot_runs` and sends `NOTIFY gge_bot`.
5. The API listens on `gge_bot` and streams each event to the player who owns that account.

## Bot lifecycle in the runner

| Event | Runner does |
|---|---|
| Account wanted, no worker | Queue a start. Starts are spaced `START_GAP_MS` apart. |
| Password, server, event mode or set of plugins changed | Restart the worker (a new login). |
| Only plugin options changed | Push them into the running worker. |
| Worker exits unexpectedly or reports a fatal error | Retry with exponential backoff and jitter (5 s doubling to 5 min). |
| Worker reports `banned` or `auth_failed` | Stop the account (`desired_state = 'stopped'`); wait for the owner to act. |
| Shutoff timer plugin fires | Stop the account. |
| Account deleted, stopped, or owner disabled | Stop the worker. |

Every worker start is a `bot_runs` row, closed with the reason it ended.

## Secrets

Game passwords are sealed (X25519 + AES-256-GCM) with a public key the API holds. Only the runner holds the private key, so the API, its database rows, its logs and its admins can store a game password but never read it. Panel passwords are argon2id hashes; imported legacy hashes are PBKDF2 and are upgraded at the next sign-in. Sessions are random tokens in HttpOnly cookies; only their SHA-256 is stored.
