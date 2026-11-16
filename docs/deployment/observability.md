# Metrics, dashboards and alerts

Prometheus scrapes the API (`api:3000/metrics`), the runner (`runner:9464/metrics`) and Centrifugo (`centrifugo:8000/metrics`, job `centrifugo`) every 15 seconds and keeps 15 days. Grafana at `https://grafana.<domain>` reads Prometheus and, for run history, Postgres. Neither metrics endpoint is reachable from outside: Caddy routes only the apps, `/rpc`, `/admin/rpc`, `/healthz` and Centrifugo's `/connection/websocket`.

Sign in to Grafana as `admin` with `GRAFANA_ADMIN_PASSWORD`. Dashboards live in the GGE folder and are provisioned from `infra/grafana/dashboards/`; edit the JSON there, not in the UI.

## Dashboards

| Dashboard | Shows | Use it to |
|---|---|---|
| Fleet | Bots by state, bots needing attention, worker heap (max and average), runner event-loop lag, runs ended in 24 h by reason, fleet uptime % | See health at a glance; size `MAX_ACCOUNTS` from heap per worker |
| Game traffic | Messages sent per second by command, reply time p95 by command, rate-limiter wait, map cache hit ratio | Spot slow commands and wasted requests; compare before and after a bot change |
| API | Requests per second by route and status, latency p95, event-loop lag | Check the API under load |

## Metrics

| Metric | From | Labels |
|---|---|---|
| `bot_messages_total` | workers | `direction` (in, out), `command` |
| `bot_game_rtt_seconds` | workers | `command` |
| `bot_send_wait_seconds` | workers | none |
| `bot_gaa_cache_total` | workers | `result` (hit, miss) |
| `bot_inbound_gap_seconds` | workers | none |
| `bot_workers` | runner, from `bot_status` | `state` |
| `bot_worker_heap_bytes` | runner, from each worker | `stat` (max, avg) |
| `http_request_duration_seconds` | API | `method`, `route`, `status_code` |
| Node defaults (`nodejs_*`, `process_*`) | API, runner | none |

No metric carries an account id or name. Per-account detail (status, logs, run history) lives in Postgres and the apps.

Run history is product data, not a metric: every bot start is a `bot_runs` row with `started_at`, `ended_at` and `end_reason` (`stopped`, `restart`, `crash`, `error`, `stale`, `banned`, `auth_failed`, `shutoff`, `deploy`, `runner_lost`). Players see their last runs in the account drawer; the admin overview and the Fleet dashboard aggregate them.

## Liveness

A bot is shown as running only while it proves it:

- **The worker can watch its connection.** With `INBOUND_STALE_MS` set, a logged-in bot that hears nothing from the game for that long ends its run with `CONNECTION_STALE` and is retried. It is off by default, because nobody has yet measured how quiet a healthy bot gets. `bot_inbound_gap_seconds` records the longest silence in each 30-second window; after a few days of data, set `INBOUND_STALE_MS` to about 3 times its p99.
- **The runner watches its workers.** Each worker sends a heartbeat every 30 seconds, from the moment it starts. The runner ends a worker that has sent nothing for 90 seconds, records the run as `stale`, and retries it. A check that itself runs more than 15 seconds late is skipped, because a busy runner can't tell which workers are silent.
- **`bot_status.heartbeat_at`** ("Last seen" in the player app) is refreshed by each heartbeat from a logged-in bot.

## Giving up on a crash loop

An account that can never start stops retrying. After 8 failures in a row spanning at least 30 minutes, the runner sets the account's state to `crash_loop` ("Stopped after repeated crashes"), records the last failure in `last_error`, and sets `desired_state = 'stopped'`. The owner starts it again by hand. A run that lasts 10 minutes clears the count.

Only failures the account can cause count:

| Failure | Counts toward giving up |
|---|---|
| A crash, running out of memory, a `stale` run (the worker stopped responding), or a fatal error the bot reported | Yes, unless the fleet is failing together |
| `SOCKET_ERROR:*`, `CONNECTION_STALE`, `LOGIN_TIMEOUT`, `TOO_MANY_TIMEOUTS`, `CLIENT_VERSION_REJECTED`, the event server not found, `PROXY_*` | Never. These are the game, the network or the setup, so they retry with backoff for as long as they last, and a game outage never stops a player's bot. |

The fleet is failing together when at least 5 accounts ended a run early in the last 10 minutes and they are at least half of the accounts started in that time. While that holds, nobody is given up on, so a bad deploy doesn't stop every bot.

## Alerts

Four Grafana-managed rules are provisioned from `infra/grafana/provisioning/alerting/rules.yml`:

| Rule | Fires when |
|---|---|
| Runner stopped reporting | `runner_heartbeat.beat_at` is more than 2 minutes old for 2 minutes |
| Bots are crashing | More than 10 runs ended in `crash`, `error` or `stale` in the last hour, for 10 minutes |
| Event loop lag over 200 ms | API or runner p99 lag above 0.2 s for 5 minutes |
| Live updates are not being delivered | `centrifugo_outbox` holds more than 5000 rows, or its oldest row is more than 5 minutes old, for 2 minutes. Centrifugo is down or can't reach Postgres. Check `docker compose logs centrifugo`. |

To get them in Discord, create a webhook (channel settings, Integrations, Webhooks), put its URL in `GRAFANA_ALERT_DISCORD_WEBHOOK` and recreate the `grafana` service. On start the image then provisions a Discord contact point and makes it the default notification policy, so every alert, firing and resolved, posts to that channel. The provisioned policy can't be edited in the UI; change `infra/grafana/discord-alerting/` instead.

With the variable empty, Grafana evaluates the rules but delivers nowhere. They show as firing under Alerting, Alert rules, and nobody is told. Emptying it after a start with it set leaves the Discord contact point and policy in Grafana's database; add `deleteContactPoints` and `resetPolicies` entries to a provisioning file to remove them. To use email or another channel instead, add it under Alerting, Contact points and set it as the default notification policy.

## Measuring a change to the bot

Changes that alter how bots talk to the game (scheduling, caching, request sizes) should quote numbers. Record at least 24 hours on the current version from Game traffic (messages per second by command, reply time p95, cache hit ratio) and Fleet (crashes, heap), deploy, record the same window, and put both in the pull request. A difference smaller than the day-to-day spread of the baseline is not a result.
