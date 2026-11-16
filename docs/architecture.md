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
| Runner | `notification`: a new notification, whole | `personal:user#<ownerId>` |
| API | `notifications_read`: the notifications a player just marked read | `personal:user#<userId>` |
| API | a `disconnect` for one user, when a session of theirs ends | none |

The API publishes an `account` event for every start and stop it makes: a player's own, a lowered plan limit, an admin's force stop, and a disabled user. A second tab or device therefore shows the change at once.

The player app opens one socket per tab with a token from `realtime.connectionToken`, valid for 15 minutes. Each player has one channel, `personal:user#<userId>`, that only that user can subscribe to. The app subscribes to `bot:<accountId>` while that account's log is open. To subscribe, the app needs a token from `realtime.subscriptionToken`, which the API gives only to the account's owner. `packages/contracts/src/realtime.ts` defines the channel names and the event schemas (`UserEvent`, `BotChannelEvent`). The app ignores an event that doesn't match its schema.

Centrifugo keeps a few minutes of history for each channel, so a socket that reconnects gets the events it missed. If the gap is longer than the history, the app refetches the account list or the log page.

While the socket is down, the app shows **Reconnecting…** and refetches the account list and the notifications every 15 seconds. A deployment without Centrifugo (`CENTRIFUGO_TOKEN_SECRET` unset) works the same way, without the badge: the API answers `NOT_IMPLEMENTED` to a token request and the app stops asking.

## Notifications

A player is notified when the runner stops a bot that only they can get going again. There are four kinds: `banned`, `auth_failed` (the game rejected the password), `crash_loop` (the runner gave up after repeated failures) and `shutoff` (the shutoff-timer plugin ended the run).

The runner's `store.endAccount` saves the status, sets the account to stopped and inserts the `notifications` row in one transaction, together with their three events. The row's `dedup_key` is `<kind>:<accountId>:<runId>`, so a worker that reports the same ending twice notifies once. The row's `data` copies the account's name and server, so the notification still reads right after the account is renamed or removed.

The player app shows them under the bell in the header. A `notification` event adds one to the open list and shows a toast. Marking one read in one tab clears it in the others through `notifications_read`.

The API also emails them. `apps/api/src/services/notification-mailer.ts` runs inside every API process and looks for due rows every 15 seconds:

- A player's rows are due once their newest pending row is 30 seconds old, so a burst shares one email. A steady stream can hold back the oldest row for at most 5 minutes. Each round sends one `bot_alerts` email per player, covering every row of theirs that is due.
- A round claims its rows with `FOR UPDATE SKIP LOCKED` and stamps `email_claimed_at`. Two API processes therefore never send the same row. A claim left by a process that died is taken over after 5 minutes.
- A row ends as `sent`, `skipped` or `failed` in `email_state`. It is skipped, with the reason in `email_error`, when the player is disabled, has no confirmed email, turned that kind off under **Settings**, or already got 20 notifications by email in the last 24 hours. A delivery that fails is tried again on the next round, and the row is `failed` after 5 attempts.

Players choose the kinds to be emailed about under **Settings**. Emails for `shutoff` are off until they turn them on. The choice is stored in `users.notification_prefs`, and a kind that is missing there takes its default.

The runner deletes read notifications after 30 days and every notification after 180 days.

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
| The account's run window closes | Stop the worker and record the run as `schedule`. The account stays wanted. |
| The account's run window opens | Queue a start, as for any wanted account. |

Every worker start is a `bot_runs` row, closed with the reason it ended.

## Run schedules

A player can limit an account to run windows, so the bot keeps the hours a person would. The schedule is the `game_accounts.schedule` JSON column. `null` means the account runs whenever it is started.

```json
{ "tz": "Europe/Berlin", "jitterMinutes": 10, "windows": [{ "days": [1, 2, 3, 4, 5], "start": "18:00", "end": "01:30" }] }
```

- `tz` is an IANA time zone. Every time in the schedule is wall-clock time in that zone.
- `days` are the weekdays a window starts on, where 0 is Sunday and 6 is Saturday.
- An `end` at or before `start` is on the next day. The window above starts on Friday at 18:00 and ends on Saturday at 01:30. A window whose `start` equals its `end` is refused.
- A schedule holds 1 to 14 windows. Windows that touch or overlap count as one stretch.

**One function decides.** `scheduleState(schedule, now, accountId)` in `packages/contracts/src/schedule.ts` returns whether the account is inside a window and when that next changes. The runner, the API and the Schedule tab's preview all call it, so they agree.

**Sleeping is derived, never stored.** An account is sleeping when `desired_state` is `running` and `scheduleState` says that the account is outside its windows. There is no `actual_state` for it.

- The runner leaves a sleeping account out of the accounts to run. Its reconcile then stops the worker when a window closes and starts one when a window opens. A stop for the schedule writes `actual_state = 'stopped'` and clears `last_error`.
- The reconcile runs on every change and every 30 seconds. Each one also finds the next start or stop among the wanted accounts. If that is less than 30 seconds away, the runner times one more reconcile for a second after it, so a window opens and closes on time.
- A sleeping account has no worker, so it takes no place under `MAX_ACCOUNTS`. A pending retry is cancelled and its backoff starts again.
- Failures still count across a sleep. The runner keeps each account's run of failures apart from its worker, so an account that fails in every short window is given up on after 8 failures over 30 minutes, like any other. The run of failures ends when a run lasts 10 minutes, the account's login changes, the owner stops the account, or the runner gives up.
- An error on a sleeping account is about a window that has closed. When an account that was refused, was waiting for room or was retrying goes to sleep, the runner writes `actual_state = 'stopped'` and clears `last_error` once. The player app leaves sleeping accounts out of **Need attention**.
- A sleeping account still counts toward its owner's plan. The plan is applied before the schedule, so a sleeping account never gives its place to a newer one.
- An event twin follows its own schedule, not its main's.
- The API returns `sleepingUntil`, the next start, on each account. The player app and the admin app's account tables show it as **Sleeping until Tue 08:07**, in the viewer's own time.
- A new account can be given a schedule when it is added. Its jitter depends on the account id, which doesn't exist yet, so the preview there shows the times as set and says by how much they vary.

**Jitter.** Each time a window comes round, its start and its end each move by a whole number of minutes between `-jitterMinutes` and `+jitterMinutes`. The amount is a hash of the account id, the local date the window starts on, the window's position in the list and the edge, so it differs from day to day and stays fixed within a day. Jitter never shortens a window below one minute. If jitter pushes two windows into each other, they run as one stretch.

**Daylight saving.** Two rules cover the days the clocks change.

- A time the clocks skip means the first instant after the skip. In Europe/Berlin on 2026-03-29, a 02:30 start is 03:00.
- A time the clocks show twice means the first of the two. In Europe/Berlin on 2026-10-25, a 02:30 start is the earlier 02:30, so a window from 02:30 to 03:30 lasts two hours.

## Secrets

Game passwords are sealed (X25519 + AES-256-GCM) with a public key the API holds. Only the runner holds the private key, so the API, its database rows, its logs and its admins can store a game password but never read it. Panel passwords are argon2id hashes; imported legacy hashes are PBKDF2 and are upgraded at the next sign-in. Sessions are random tokens in HttpOnly cookies; only their SHA-256 is stored. Email verification and password reset links use the same pattern: a random token in the email, its SHA-256 in `email_tokens`, claimed with one atomic update.
