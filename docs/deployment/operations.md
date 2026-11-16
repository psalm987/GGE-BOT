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

## Proxies

Without proxies, every bot connects to the game from the server's one address. Add proxies in the admin app, under **Proxies**, to spread the accounts over several addresses.

**Add a proxy.** Enter a label, a URL, and the number of accounts the proxy may carry. The URL is `scheme://user:password@host:port`. The scheme is `http`, `https`, `socks5`, or `socks5h`, and the port is required. Use `socks5h` for a SOCKS proxy: the proxy then looks up the game's hostname, and the server's DNS never sees it.

**The URL is write-only.** The API seals the URL with `SEAL_PUBLIC_KEY`, the same way as a game password, and only the runner can open it. The admin app, the API, and the audit log show `scheme://host:port` and nothing else. To change the credentials, edit the proxy and enter the whole URL again. An empty URL field keeps the stored URL.

**How accounts are assigned.**

- The runner gives each started account the enabled proxy that has the fewest accounts and is under its limit.
- An account keeps its proxy, also while it is stopped, so the account returns on the same address. A stopped account still counts toward the limit.
- An event twin has no proxy of its own. The twin connects through the proxy of its main account.
- To choose a proxy yourself, use the **Proxy** column on the **Accounts** page. A pin can put more accounts on a proxy than its limit. The limit applies only to what the runner assigns. Select **Unassigned** to let the runner choose again.
- An account that finds no proxy with room connects directly. Set `PROXY_REQUIRED=true` to refuse the direct connection. The account then shows "No proxy is free" until a proxy has room.

**A failing proxy is turned off.** A bot that can't reach its proxy, is refused by it, or gets no answer within 30 seconds ends its run with a `PROXY_` reason, such as `PROXY_ECONNREFUSED`, `PROXY_AUTH`, or `PROXY_TIMEOUT`. After 5 such failures in a row, the runner turns the proxy off and records the reason. The accounts of that proxy move to another proxy at their next start. A bot that logs in through the proxy resets the count. Two kinds of failure do not count:

- The proxy answered that it could not reach the game. That failure is recorded as `SOCKET_ERROR`, like a failure on a direct connection.
- Most of the bots are failing at once: at least 5 bots ended early in the last 10 minutes, and they are at least half of the bots started in that time. The cause is then more likely the game or the network than each proxy. The **Last error** column still shows the failure.

**Turn a proxy back on.** Fix the cause, then switch **Enabled** on in the **Proxies** table. The switch clears the failure count and the reason. Accounts that moved away stay on their new proxy.

**Delete a proxy.** The accounts of a deleted proxy are left unassigned, and the runner assigns each one again at its next start.

A bot restarts when its proxy gets a new URL or when its account moves to another proxy.

## Common situations

| Situation | Do |
|---|---|
| A player's bot shows **Wrong password** | They update the game password in the account's settings and press Start. The runner does not retry on its own. |
| A bot shows **Banned** | The ban end is stored with the status. The runner will not restart it; the player decides when to start it again. |
| Many bots show **Error … retrying** | Check `dc logs runner` and the Game traffic dashboard. A game client update often shows as every login failing: set `GAME_CLIENT_VERSION`. |
| Need to stop one player's bots now | Admin app, Users, Disable: it signs them out and stops all their bots. |
| Need to stop everything | `dc stop runner`. Bots stop; their desired state is kept, so `dc start runner` brings them back. |

## Disk

Postgres, Prometheus (15 days) and the backups volume grow. `docker system df -v` shows volume sizes. The runner deletes old rows once an hour, in batches so no single delete holds a long lock:

| Data | Kept |
|---|---|
| Bot logs | 7 days, and at most the newest 500 lines per account |
| Run history | 90 days from start. A run that is still open is never deleted. |
| Audit log | `AUDIT_RETENTION_DAYS` days (default 365) |
| Notifications | Read: 30 days. Any: 180 days. |
| Sessions, sign-in challenges | Until they expire |
| Email tokens | 1 day past expiry |
| Live-update outbox | 1 hour |

To keep the audit log longer or shorter, set `AUDIT_RETENTION_DAYS` in `infra/.env` and run `dc up -d runner`. The next hourly run applies it.
