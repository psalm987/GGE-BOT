# Metrics, dashboards and alerts

Prometheus scrapes the API (`api:3000/metrics`), the runner (`runner:9464/metrics`), Centrifugo (`centrifugo:8000/metrics`, job `centrifugo`) and node_exporter (`node-exporter:9100`, job `node`, host CPU, memory, disk and network) every 15 seconds and keeps 15 days. Grafana at `https://grafana.<domain>` reads Prometheus and, for run history, Postgres. No metrics endpoint is reachable from outside: Caddy routes only the apps, `/rpc`, `/admin/rpc`, `/healthz` and Centrifugo's `/connection/websocket`.

Sign in to Grafana as `admin` with `GRAFANA_ADMIN_PASSWORD`. Dashboards live in the GGE folder and are provisioned from `infra/grafana/dashboards/`; edit the JSON there, not in the UI.

## Dashboards

| Dashboard | Shows | Use it to |
|---|---|---|
| Fleet | Bots by state, bots needing attention, worker heap (max and average), runner event-loop lag, runs ended in 24 h by reason, fleet uptime % | See health at a glance; size `MAX_ACCOUNTS` from heap per worker |
| Game traffic | Messages sent per second by command, reply time p95 by command, rate-limiter wait, map cache hit ratio, longest silence from the game server p95 | Spot slow commands and wasted requests; compare before and after a bot change |
| Attacks | Attacks per hour by outcome, refusals by reason (goal 0), idle time share by cause, queue pauses, round trip and queue wait | See whether attacking is throttled by commanders, the daily cap or refusal pauses, and spot refusal spikes after a change |
| API | Requests per second by route and status, latency p95, event-loop lag | Check the API under load |
| Plugins | Daily bonus and tax collection outcomes per hour, share that succeeded, accounts with each plugin on | Notice a plugin the game keeps refusing |
| Realtime | Connected clients, users and subscriptions, connections, messages and disconnects, outbox events processed, outbox backlog and oldest row age | Check live updates reach players; see why they stall |
| Run history | Runs and failures per day by end reason, fleet uptime and restarts over the range, run length by end reason, failures by server, accounts by state | Find which servers or reasons cause failures over days |
| Host | CPU, load, memory, disk used and free, disk I/O, network | Size the host; catch a filling disk before it stops Postgres |
| Bans | Accounts banned now, bans per day and by server, days since each account's last ban, bans in the last 7 days | Watch the number humanization is meant to lower; spot a server where bans cluster |
| Humanization trial | Bans, auth failures and crashes per 100 running accounts, and runs per account, for trial accounts against the rest | Judge a `BOT_HUMANIZE_ACCOUNTS` trial; paste the same ids into the `trial_accounts` box |
| Proxies | Accounts per proxy against its limit, accounts with no proxy, the pool's health and last errors, proxy failures per hour by reason | Catch a dead or full proxy before bots fall back or stop |
| Notifications and email | Notifications per day by kind, each day's email outcome, why emails were skipped or failed, emails stuck pending | Notice a broken mail sender or players hitting the daily cap |
| Players | Verified share, players with a running bot, signups per day, players by plan use, self-deletions, accounts outside their plan | Follow growth; see whether the email gate stalls signups |
| Security | Recovery codes used, admin sign-ins, credential and account changes by kind, the last 50 security events | Spot an unexpected recovery code or a burst of resets |
| Schedules | Accounts with a schedule, runs ended by a closing window, scheduled accounts by state | Confirm run windows behave once players use them |

Every dashboard links to the others from its top bar. The Postgres panels read through the `grafana_ro` role when `GRAFANA_DB_PASSWORD` is set, so they never see sessions, tokens, 2FA secrets, password hashes or sealed values.

## Metrics

| Metric | From | Labels |
|---|---|---|
| `bot_messages_total` | workers | `direction` (in, out), `command` |
| `bot_game_rtt_seconds` | workers | `command` |
| `bot_send_wait_seconds` | workers | none |
| `bot_gaa_cache_total` | workers | `result` (hit, miss) |
| `bot_daily_bonus_total` | workers with the Daily login bonus plugin on | `result` (claimed, refused, no_reply, already, no_offer) |
| `bot_tax_collect_total` | workers with the Tax collector plugin on | `result` (collected, refused, no_reply) |
| `bot_inbound_gap_seconds` | workers | none |
| `bot_workers` | runner, from `bot_status` | `state` |
| `bot_worker_heap_bytes` | runner, from each worker | `stat` (max, avg) |
| `http_request_duration_seconds` | API | `method`, `route`, `status_code` |
| Node defaults (`nodejs_*`, `process_*`) | API, runner | none |

No metric carries an account id or name. Per-account detail (status, logs, run history) lives in Postgres and the apps.

Run history is product data, not a metric: every bot start is a `bot_runs` row with `started_at`, `ended_at` and `end_reason` (`stopped`, `restart`, `crash`, `error`, `stale`, `banned`, `auth_failed`, `shutoff`, `deploy`, `runner_lost`, `schedule`). `schedule` means that the account's run window closed, which is a normal stop and not a failure. Players see their last runs in the account drawer; the admin overview and the Fleet dashboard aggregate them.

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

Seven Grafana-managed rules are provisioned, five from `infra/grafana/provisioning/alerting/rules.yml` and two Postgres rules from `rules-postgres.yml`:

| Rule | Fires when |
|---|---|
| Runner stopped reporting | `runner_heartbeat.beat_at` is more than 2 minutes old for 2 minutes |
| Bots are crashing | More than 10 runs ended in `crash`, `error` or `stale` in the last hour, for 10 minutes |
| Event loop lag over 200 ms | API or runner p99 lag above 0.2 s for 5 minutes |
| Live updates are not being delivered | `centrifugo_outbox` holds more than 5000 rows, or its oldest row is more than 5 minutes old, for 2 minutes. Centrifugo is down or can't reach Postgres. Check `docker compose logs centrifugo`. |
| Disk over 90% full | A host filesystem (node_exporter, tmpfs and overlay excluded) is more than 90% used for 10 minutes. The alert names the mount point. Free space before Postgres stops accepting writes; the Host dashboard shows which mount is growing. |
| Bans spiking | More runs ended `banned` in the last hour than the larger of 3 and 2% of the accounts that ran in that hour. The game may be detecting the bot: check the Bans dashboard and consider stopping the fleet. |
| A proxy was switched off automatically | The runner turned a proxy off after repeated connection failures in the last 10 minutes. The alert names it and the reason; its accounts move to another proxy with room. Turn it back on under Proxies in the admin app once it works. |

To get them in Discord, create a webhook (channel settings, Integrations, Webhooks), put its URL in `GRAFANA_ALERT_DISCORD_WEBHOOK` and recreate the `grafana` service. On start the image then provisions a Discord contact point and makes it the default notification policy, so every alert, firing and resolved, posts to that channel. The provisioned policy can't be edited in the UI; change `infra/grafana/discord-alerting/` instead.

With the variable empty, Grafana evaluates the rules but delivers nowhere. They show as firing under Alerting, Alert rules, and nobody is told. Emptying it after a start with it set leaves the Discord contact point and policy in Grafana's database; add `deleteContactPoints` and `resetPolicies` entries to a provisioning file to remove them. To use email or another channel instead, add it under Alerting, Contact points and set it as the default notification policy.

## Measuring a change to the bot

Changes that alter how bots talk to the game (scheduling, caching, request sizes) should quote numbers. Record at least 24 hours on the current version from Game traffic (messages per second by command, reply time p95, cache hit ratio) and Fleet (crashes, heap), deploy, record the same window, and put both in the pull request. A difference smaller than the day-to-day spread of the baseline is not a result.

### Humanization flags

Seven flags change traffic that a real game client would never send. All are off by default. `BOT_HUMANIZE` on the runner turns them on by name, and each one has its own number to watch.

| Flag | What changes | What to compare before and after |
|---|---|---|
| `pin_jitter` | The keep-alive `pin` goes out every 60 seconds give or take 6, instead of exactly every 60. | `bot_messages_total{direction="out",command="pin"}` stays near one per bot per minute. `bot_inbound_gap_seconds` does not grow. |
| `measured_timing` | The login reports the connect time and the round-trip time that this connection took, instead of 212 ms and 25 ms for every bot. The connect time is kept between 50 and 3000 ms and the round trip between 5 and 1000 ms. | Logins still succeed: no rise in runs that end as `auth_failed` or `error`. |
| `lognormal_delays` | The wait between two attacks follows a log-normal curve across the configured range, never below `attackDelaySeconds`. About 3% of waits are a break 2 to 6 times as long. | The rate of `bot_messages_total{direction="out",command="cra"}`. Expect about 8% fewer attacks per hour from a bot whose attack queue is always full. |
| `map_grid` | Map scans ask for 13×13-tile boxes on the client's grid, up to 49 around the castle, and stop at 30 targets. Without the flag a scan is one 101×101 request, or 169 of them for fortresses and storm forts. A grid scan that finds nothing falls back to the old scan and logs "The grid scan found no targets". | The rate of `gaa` in `bot_messages_total`, the hit ratio of `bot_gaa_cache_total`, and the rate of `cra`. Fortress bots should send fewer `gaa`, and nomad, samurai, Berimond, and robber-baron bots more. |
| `nch` | After login the bot sends the client's second keep-alive, an `nch` with no payload, about every 32 seconds give or take 4. Without the flag the bot never sends `nch`. The bot does not wait for a reply. | `bot_messages_total{direction="out",command="nch"}` is near two per bot per minute. `bot_inbound_gap_seconds` does not grow. |
| `login_sequence` | The login follows the client's. The XML frames use the client's quoting. The `pin` loop starts when the socket opens. The bot sends a `vln` name check 6 to 12 seconds after `vck`, and `lli` 8 to 16 seconds after `vln`. After login it sends the client's ten requests: `gbl`, `jca`, `alb`, `sli`, `gie`, `asc`, `sie`, `ffi`, `kli`, and `gcs`. A login takes 14 to 28 seconds longer, and `TIMEOUT_MULTIPLIER` scales these waits. | Logins still succeed: no rise in runs that end as `auth_failed` or as `error` with `LOGIN_TIMEOUT`. |
| `attack_dialog` | Before each `cra` the bot sends `adi`, `gas`, and `gdi`, as the client does while a player sets up an attack. The three requests add 5 to 17 seconds to each attack. The bot does not wait for their replies. | The rates of `adi`, `gas`, and `gdi` in `bot_messages_total` equal the rate of `cra`. Expect fewer attacks per hour from a bot whose attack queue is always full. No rise in `LORD_IS_USED` in the logs. |

For every flag, also compare the runs that end as `banned`. A lower ban rate is the reason the flags exist, and bans are rare, so 24 hours on a few accounts cannot show a difference. Use the short trial to find breakage and the fleet-wide weeks to judge bans.

To try a flag on a few accounts:

1. Record 24 hours of the numbers above with the flag off.
2. Set `BOT_HUMANIZE` to the flag and `BOT_HUMANIZE_ACCOUNTS` to a comma list of account ids, then restart the runner. Accounts that are not on the list keep every flag off.
3. Record the same window and compare. Metrics carry no account label, so the fleet numbers move only by the share of accounts on the list. Judge the listed accounts themselves by their run history (`end_reason` in `bot_runs`) and their logs.
4. To apply the flag to every account, empty `BOT_HUMANIZE_ACCOUNTS` and restart the runner.

Turn on one flag at a time. Two flags changed together cannot be told apart in the numbers.
