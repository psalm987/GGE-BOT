# Run a bot

The user presses **Start** on a game account. The server spawns a worker that logs into the live Goodgame Empire server and runs the enabled plugins; the row shows live status counters, **Logs** shows the last 25 log lines, **Resources** shows castle resources, and **Stop** ends it. A running account whose worker dies is restarted after `secondsTillRestartBot` (10 s).

## Sub-features

- `run-start` **Start** sets `SubUsers.state = 1` and spawns a worker; the button turns red **Stop**.
- `run-stop` **Stop** sets `state = 0` and terminates the worker.
- `run-logs` **Logs** opens a backdrop streaming the worker's log ring buffer (25 entries); clicking the backdrop closes it and stops streaming.
- `run-status` the **Status** cell shows non-zero counters pushed by the worker (`StatusUser`); a red row border means `hasError`.
- `run-resources` **Resources** shows per-castle resources from the last status.
- `run-restart` a running worker that exits is respawned after 10 s while `state` is still 1.
- `run-autostart` accounts left at `state = 1` start again when the server restarts.
- `run-kill` the worker can stop itself (e.g. Shutoff timer) and flip the account to stopped (`KillBot`).

## How to get to it (user POV)

- Users table row buttons **Start**/**Stop**, **Logs**, **Resources**.
- Restarting the server (`gge-verify down` + `up` keeps nothing, so autostart needs a manual restart of the same instance dir).

## Driving it with Playwright (drive.js)

Preconditions:

- `gge-verify doctor NAME` is healthy.
- **The user asked for a live run in this session**, and supplied which account to use. This logs into a real game account on the real servers.
- The account's server `ID`: the `value` of the `<instance>` in `~/.cache/gge-bot-verify/instances/NAME/app/1.xml` whose name matches (e.g. `credentials/credentials.json` says `india 1`; find the matching `instanceLocaId`/`instanceName`).

- **Start, observe, stop.** Run `node .claude/skills/verify/scripts/drive.js NAME start-bot --live --game-name N --game-pass P --server ID`. It adds the account, clicks **Start**, expects **Stop** and `state: 1` in `db-after-start.json`, waits 20 s, screenshots **Logs** (`NN-start-bot-logs.png`) and the row status, clicks **Stop**, expects `state: 0` in `db-after-stop.json`. `server.log` lines prefixed `[N]` are the worker's log.
- **Without --live** the step fails immediately with a message. That is the safe default, not a bug.

## Gotchas

- Never run this as a side effect of verifying something else. Bot logins can get the game account flagged or banned.
- `ws-frames.log` redacts `"pass"` values, and `db-*.json` omit the `pass` column, but the GetUsers WebSocket frames really do send each account's game password to the browser. Never paste raw frames from DevTools into evidence.
- A wrong password or bad server shows up as error log lines and repeated worker restarts every 10 s, not as a UI error. Check `server.log` and **Logs** before calling a start successful; a red **Stop** button only proves `state = 1`.
- The worker exits on 6 timeouts or pauses its socket after 8 `LORD_IS_USED`-class errors (`ggeBot.js`); a quiet log after that is a stalled bot, not a healthy one.
- `run-restart` and `run-autostart` are not scripted. `run-autostart` needs the same instance dir restarted, which `gge-verify` does not do; start `node main.js` again in `~/.cache/gge-bot-verify/instances/NAME/app` by hand and record its pid in `instances/NAME/pid` so `down` can clean it up.
