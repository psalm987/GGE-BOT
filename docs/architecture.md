# Architecture

GGE Command runs Goodgame Empire bots for many players from one server. Players manage their game accounts in a web app; a separate runner keeps one bot worker alive for each account a player has started.

```
 app.<domain>  ──┐         ┌─ /rpc, /admin/rpc ──────► api ──┐
 admin.<domain> ─┼─ Caddy ─┤                                 ├─► Postgres ── NOTIFY gge_desired ──► runner ──► one worker thread
 grafana.<domain>┘         └─ /connection/websocket ─► centrifugo ◄─ centrifugo_outbox ◄─ api, runner       per game account
                                                                                                            (packages/bot-core)
```

## Parts

| Path | Role |
|---|---|
| `apps/api` | Fastify + oRPC. The player contract at `/rpc`, the admin contract at `/admin/rpc`. Sign-in, sessions, email verification and password reset (Resend), accounts, audit. Signs the tokens that let a browser open the live-update socket. |
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
| `infra` | Docker Compose, Caddy, Centrifugo, Prometheus and Grafana. |

## How the pieces talk

The API and the runner never call each other. Postgres is the only channel.

1. A player starts an account; the API sets `game_accounts.desired_state = 'running'`.
2. A trigger sends `NOTIFY gge_desired`. Triggers also fire on plugin settings and on a user's status, so an admin disabling a user or force-stopping an account reaches the runner the same way.
3. The runner reconciles: it loads every account that should run (wanted, with an active owner) and starts, restarts or stops workers to match. It also reconciles every 30 seconds in case a notification was missed.
4. Workers report back through the runner, which writes `bot_status`, `bot_logs` and `bot_runs`.
5. Each of those writes also queues an event for the browser. See [Live updates](#live-updates).

## Live updates

Centrifugo is the only path that carries changes to the browser as they happen.

The process that changes the data also inserts one row per event into `centrifugo_outbox`, in the same transaction. An event is therefore sent exactly when its change is saved. Centrifugo reads the rows in `id` order, delivers each to the websocket at `/connection/websocket`, and deletes the row. The runner deletes rows older than one hour, so the table stays small while Centrifugo is down.

| Writer | Event | Channel |
|---|---|---|
| Runner | `status`: a bot's whole status row | `personal:user#<ownerId>` |
| Runner | `log`: one log line, with its untranslated `parts` | `bot:<accountId>` |
| Runner, API | `account`: an account was started or stopped | `personal:user#<ownerId>` |
| API | a `disconnect` for one user, when a session of theirs ends | none |

The API publishes an `account` event for every start and stop it makes: a player's own, a lowered plan limit, an admin's force stop, and a disabled user. A second tab or device therefore shows the change at once.

The player app opens one socket per tab with a token from `realtime.connectionToken`, valid for 15 minutes. Each player has one channel, `personal:user#<userId>`, that only that user can subscribe to. The app subscribes to `bot:<accountId>` while that account's log is open. To subscribe, the app needs a token from `realtime.subscriptionToken`, which the API gives only to the account's owner. `packages/contracts/src/realtime.ts` defines the channel names and the event schemas (`UserEvent`, `BotChannelEvent`). The app ignores an event that doesn't match its schema.

Centrifugo keeps a few minutes of history for each channel, so a socket that reconnects gets the events it missed. If the gap is longer than the history, the app refetches the account list or the log page.

While the socket is down, the app shows **Reconnecting…** and refetches the account list every 15 seconds. A deployment without Centrifugo (`CENTRIFUGO_TOKEN_SECRET` unset) works the same way, without the badge: the API answers `NOT_IMPLEMENTED` to a token request and the app stops asking.

## Bot lifecycle in the runner

| Event | Runner does |
|---|---|
| Account wanted, no worker | Queue a start. Starts are spaced `START_GAP_MS` apart. |
| Password, server, event mode or set of plugins changed | Restart the worker (a new login). |
| Only plugin options changed | Push them into the running worker. |
| Worker exits unexpectedly or reports a fatal error | Retry with exponential backoff and jitter (5 s doubling to 5 min). |
| Worker sends nothing for 90 s | End it, record the run as `stale`, and retry. |
| 8 failures in a row over 30 min, with the rest of the fleet healthy | Set the state to `crash_loop` and stop the account; wait for the owner to act. See [observability](deployment/observability.md#giving-up-on-a-crash-loop). |
| Worker reports `banned` or `auth_failed` | Stop the account (`desired_state = 'stopped'`); wait for the owner to act. |
| Shutoff timer plugin fires | Stop the account. |
| Account deleted, stopped, or owner disabled | Stop the worker. |

Every worker start is a `bot_runs` row, closed with the reason it ended.

## Secrets

Game passwords are sealed (X25519 + AES-256-GCM) with a public key the API holds. Only the runner holds the private key, so the API, its database rows, its logs and its admins can store a game password but never read it. Panel passwords are argon2id hashes; imported legacy hashes are PBKDF2 and are upgraded at the next sign-in. Sessions are random tokens in HttpOnly cookies; only their SHA-256 is stored. Email verification and password reset links use the same pattern: a random token in the email, its SHA-256 in `email_tokens`, claimed with one atomic update.
