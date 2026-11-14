# Metrics, dashboards and alerts

Prometheus scrapes the API (`api:3000/metrics`) and the runner (`runner:9464/metrics`) every 15 seconds and keeps 15 days. Grafana at `https://grafana.<domain>` reads Prometheus and, for run history, Postgres. Neither metrics endpoint is reachable from outside: Caddy routes only the apps, `/rpc`, `/admin/rpc` and `/healthz`.

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
| `bot_workers` | runner, from `bot_status` | `state` |
| `bot_worker_heap_bytes` | runner, from each worker | `stat` (max, avg) |
| `http_request_duration_seconds` | API | `method`, `route`, `status_code` |
| Node defaults (`nodejs_*`, `process_*`) | API, runner | none |

No metric carries an account id or name. Per-account detail (status, logs, run history) lives in Postgres and the apps.

Run history is product data, not a metric: every bot start is a `bot_runs` row with `started_at`, `ended_at` and `end_reason` (`stopped`, `restart`, `crash`, `error`, `banned`, `auth_failed`, `shutoff`, `deploy`, `runner_lost`). Players see their last runs in the account drawer; the admin overview and the Fleet dashboard aggregate them.

## Alerts

Three Grafana-managed rules are provisioned from `infra/grafana/provisioning/alerting/rules.yml`:

| Rule | Fires when |
|---|---|
| Runner stopped reporting | `runner_heartbeat.beat_at` is more than 2 minutes old for 2 minutes |
| Bots are crashing | More than 10 runs ended in `crash` or `error` in the last hour, for 10 minutes |
| Event loop lag over 200 ms | API or runner p99 lag above 0.2 s for 5 minutes |

To get them in Discord, create a webhook (channel settings, Integrations, Webhooks), put its URL in `GRAFANA_ALERT_DISCORD_WEBHOOK` and recreate the `grafana` service. On start the image then provisions a Discord contact point and makes it the default notification policy, so every alert, firing and resolved, posts to that channel. The provisioned policy can't be edited in the UI; change `infra/grafana/discord-alerting/` instead.

With the variable empty, Grafana evaluates the rules but delivers nowhere. They show as firing under Alerting, Alert rules, and nobody is told. Emptying it after a start with it set leaves the Discord contact point and policy in Grafana's database; add `deleteContactPoints` and `resetPolicies` entries to a provisioning file to remove them. To use email or another channel instead, add it under Alerting, Contact points and set it as the default notification policy.

## Measuring a change to the bot

Changes that alter how bots talk to the game (scheduling, caching, request sizes) should quote numbers. Record at least 24 hours on the current version from Game traffic (messages per second by command, reply time p95, cache hit ratio) and Fleet (crashes, heap), deploy, record the same window, and put both in the pull request. A difference smaller than the day-to-day spread of the baseline is not a result.
