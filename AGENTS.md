# AGENTS.md: GGE-BOT codebase map

Read this before changing anything. It covers what the system does, how a request moves through it, where state lives, and the traps that bit previous changes. Known bugs and the web-platform plan are in [docs/GAPS_AND_ROADMAP.md](docs/GAPS_AND_ROADMAP.md).

## What this is

A headless automation client for **Goodgame Empire (GGE)**, the HTML5 build. It does not drive a browser. Each game account gets a Node worker thread that opens a raw WebSocket to the GGE game server, speaks the game's SmartFox-style protocol (`%xt%` messages), and runs plugins that send commands such as attacks, feasts, skips, and equipment sales.

A small Express + WebSocket server in the main thread hosts a dashboard, which is a separate React app in another repo. It stores users in SQLite and starts or stops one worker per game account. Discord integration (alerts, chat relay, slash commands) is optional.

- Runtime: Node ≥ 22.5, which provides `node:sqlite` `DatabaseSync` and `util.getCallSites`. Plain CommonJS JavaScript, with no TypeScript, build step, tests, or linter.
- Upstream: `darrenthebozz/GGE-BOT`, about 2,000 commits, nearly all by one author. The README calls it "a botting service that lets you run cheat tools on multiple accounts at once".
- About 5k lines of real code. `assets.json` (7k lines) and `err.json` are data tables.

## Repos this one depends on (not in this tree)

| Path | Source | Role | In git here? |
|---|---|---|---|
| `website/` | `darrenthebozz/GGE-BOT-Website` | React dashboard. `main.js` serves `website/build`, and i18n reads `website/public/locales` | No (gitignored, cloned by start scripts) |
| `plugins-extra/` | `darrenthebozz/GGE-BOT-Extra-Plugins` (private, needs `gh auth`) | Paid or private plugins: `externalEventHelper.js` (`recruitTroops`), `upgradeStormCargo.js`, `discord/extraSlashCommands.js` | No |
| `plugins-personal/` | user-local | Extra plugins with the same contract | No |
| `items/`, `lang/`, `1.xml`, `ItemsVersion.properties` | Downloaded from `empire-html5.goodgamestudios.com` at boot | Game data tables (units, horses, effects, event camps) and the server list | No (generated) |
| `ggeConfig.json`, `user.db` | Generated on first run | Config and SQLite DB | No (gitignored) |

**The bot cannot start without `items/`**, because `protocols.js` `require`s `./items/*.json` at load time. Boot fetches them. Offline boot fails.

## Process model

```
start_*.sh / .bat ── git pull, clone website + plugins-extra, npm i, build website
        │
        ▼
main.js  (main thread, one process)
  ├─ Express (HTTP or HTTPS on webPort, default 3001)
  │    ├─ POST /api            login (id:0) / signup (id:1) → returns uuid
  │    ├─ GET  /discordAuth    Discord OAuth callback, links guild to user
  │    ├─ /ggeProxyEmpire5     reverse proxy to empire-html5.goodgamestudios.com
  │    ├─ /1.xml, /assets.json
  │    └─ static website/build
  ├─ WebSocketServer (same port, upgrade)  ← the dashboard's live channel
  ├─ SQLite user.db: Users (dashboard logins), SubUsers (game accounts + plugin config)
  ├─ discord.js Client (optional)
  └─ botMap: SubUser.id → Worker
          │  postMessage([ActionType, payload])
          ▼
ggeBot.js  (one worker_thread per running game account)
  ├─ WebSocket wss://<gameURL>/  ← the game connection
  ├─ sendXT()        rate limited to 5 msgs/sec
  ├─ xtHandler       EventEmitter keyed by game command name
  ├─ waitForResult() promise that waits for a reply by command key + predicate
  ├─ requires protocols.js (game model) once "load" fires
  └─ requires every enabled plugin file
```

Workers are isolated. Each has its own module cache, so `protocols.js`, `commander.js`, and the `attack.js` queue are per-account singletons. The main thread loads the same plugin files only to read their `module.exports` metadata. See the plugin contract below.

## Dashboard ↔ main protocol

Each WebSocket frame is a JSON array `[errorType, actionType, payload]`. The codes are in [errors.json](errors.json) and [actions.json](actions.json).

- **Auth:** the dashboard calls `POST /api {id:0,email_name,password}` and gets a `uuid` back. The frontend stores it as a cookie `uuid=...`. Every later WebSocket connection and the Discord callback authenticate **only** by that cookie ([main.js:712](main.js#L712)). There is no session expiry, rotation, or CSRF protection.
- **Actions the server handles** ([main.js:758-862](main.js#L758-L862)): `GetUsers`, `AddUser`, `RemoveUser`, `SetUser` (save config and start, stop, restart, or hot-reload the worker), `GetLogs` (subscribe to one bot's 25-line ring buffer).
- **Server pushes:** `GetUsers` (account list + visible plugin metadata), `StatusUser` (resources, level, request/error counts), `GetLogs`, `GetChannels` (Discord channels).

`SetUser` logic ([main.js:792-842](main.js#L792-L842)):
- `state == 0` stops the worker.
- No worker yet: create one.
- Any plugin's `state` flipped: kill the worker and recreate it, keeping the log buffer.
- Otherwise: hot-reload. It sends `SetPluginOptions`, and the worker deep-merges the new values into `botConfig` and emits `configModified`. **Most plugins read options once at require time and ignore `configModified`**, so a hot reload often has no effect until the next restart.

## Main ↔ worker protocol

Messages are `postMessage([ActionType.X, ...])`.

Worker to main:
- `Started`: game login succeeded and the `sei` event list arrived.
- `GetLogs`: `[level, messageParts]`.
- `StatusUser`
- `KillBot`: sets DB state to 0 and terminates the worker, so it will **not** auto-restart.
- `SetUser`: stores a new password.
- `RemoveUser`
- `GetExternalEvent` reply.

Main to worker: `SetPluginOptions`, `StatusUser` (request a status push), `GetExternalEvent`.

**Lifecycle:**
- On worker `exit`, if DB `state` is still 1, main recreates it after `secondsTillRestartBot` (default 10s) ([main.js:589-605](main.js#L589-L605)).
- Worker exits are deliberate and common. Socket close or error calls `process.exit(0)` ([ggeBot.js:228-235](ggeBot.js#L228-L235)), and so does the 6th `TIMED_OUT` ([ggeBot.js:112-116](ggeBot.js#L112-L116)).
- So "crash and restart in 10s" is the normal recovery path, not an exception.

## Game protocol (ggeBot.js)

1. Open `wss://{gameURL}/`. Send the XML `verChk` (`ver v="166"`), then `login z="{gameServer}"` after `apiOK`. On `joinOK`, send `roundTrip` + `vck`.
2. The `vck` reply triggers `retry()`, which sends `lli` (login). It uses the password, or a login token `lt` if set ([ggeBot.js:330-372](ggeBot.js#L330-L372)). The payload carries hardcoded client constants (`CONM`, `RTM`, `AID`, `SID`, `PLFID`).
3. `lli` result handling ([ggeBot.js:376-421](ggeBot.js#L376-L421)):
   - `0`: emit `earlyLoad`, start a 60s `pin` keepalive, and wait for `sei`. Then post `Started` and emit `load` after 4.5s. Fallback: emit `load` after 30s × `timeoutMultiplier` if `sei` never arrives.
   - `453`: cooldown. Retry after `CD` seconds.
   - `IS_BANNED`: log the remaining ban time and retry after `RS` seconds.
   - `INVALID_LOGIN_TOKEN`: retry up to 30 times.
   - Anything else: set `status.hasError` and send `KillBot` after 8s.
4. Incoming `%xt%<zone>%<cmd>%<?>%<result>%<json>%` is split into `cmd` and `result`. The JSON goes to `xtHandler.emit(cmd, obj, result)`. `gbd` is a bundle, so each of its keys is re-emitted as its own command with result 0.

**Outgoing:** `sendXT(cmd, jsonString)` waits on a `limiter` token (5 per second per worker) and writes `%xt%{gameServer}%{cmd}%1%{json}%`.

**Request/response:** `waitForResult(key, timeoutMs, predicate)` registers a listener on `xtHandler` and resolves `[obj, result]` when the predicate returns true. Things to know:
- The timeout is `timeoutMs × timeoutMultiplier × 5`. With the default multiplier of 5 that is **25×** the number you pass, so a 10s timeout really waits about 250s.
- Replies are matched by command name plus your predicate, never by request id. Concurrent requests with the same command key can steal each other's replies unless the predicate checks coordinates or ids. That is why most callers pass predicates like `obj.AAM.M.TA[1] == x`.
- The side effect `checkForIssues` pauses the socket (`webSocket.pause()`) after 8 "important" errors or on `MOVEMENT_HAS_NO_UNITS` / `CANT_START_NEW_ARMIES`. A paused socket stalls the worker silently until the 60s keepalive or a timeout kills it.

**Error codes:** `err.json` maps numeric result to name, and code also looks names up the other way (`err["INVALID_LOGIN_TOKEN"]`). It is the canonical vocabulary for failures. Attack code throws these strings.

### Command glossary (observed in code)

| Cmd | Meaning | Where |
|---|---|---|
| `lli` | login | ggeBot.js |
| `vck` | version check | ggeBot.js |
| `pin` | keepalive | ggeBot.js |
| `sei` | active event list; drives `eventStart`/`eventStop` | protocols.js, ggeBot.js |
| `glt`, `tlep` | get/enter temp-server (external event) login token | ggeBot.js |
| `gaa` | get area (map rectangle) | protocols.js `getAreaInfo` |
| `ssi` | spy info for a single map tile, or storm-island info with `{}` | protocols.js |
| `fnm` | find next map object of type T | protocols.js |
| `msd` | skip a target's cooldown with a skip item | protocols.js `skipTarget` |
| `cra` | create attack (send army); reply has `AAM` movement | attack plugins |
| `gam` / `cat` | movement lists / new movement | protocols.js `Movement` |
| `gli` | lord (commander) list | commander.js |
| `jca` | join castle (switch active castle) | protocols.js `setCastle` |
| `dcl`, `gcl`, `hru`, `gpc`, `kpi`, `kgt`, `msk`, `kut` | castle list, resources, kingdom transfers, skips | protocols.js |
| `gcu`, `sce` | currencies / resource updates | protocols.js, ggeBot.js |
| `gpi`, `gxp`, `gal`, `gai` | player info, XP/level, alliance, attack counter (`AC`, threshold `ACTH`) | ggeBot.js, attack.js |
| `sede` | event difficulty select | Nomads, Samurai, Khan |
| `sbp` | storm (aqua) purchase | attackStormForts |
| `qsc`, `dms`, `ftl` | collect quest, delete message, fortune teller | misc.js |
| `aha` | alliance help | helpRequests.js |
| `gei`, `ggm`, `seq`, `sge` | equipment/gems inventory and sell | sellStoredEquipment.js |
| `bfs` | feast | protocols.js `startFeast` |
| `acm` | alliance chat message | discord/chat.js |
| `hgh`, `ain`, `gpe`, `wsp` | highscores, alliance info, player info, whisper/search | protocols.js, slashCommands.js |

## Game-state model (protocols.js)

`protocols.js` parses replies into domain objects and keeps the worker's view of the world in memory:

- `castles[]`: `CastleInfo` (EventEmitter) per owned castle across kingdoms. Holds `areaInfo`, `unitInventory`, resources, `getProductionData`, and `unlockedHorses`. It emits `resourceUpdate`.
- `movements[]` + `movementEvents`: every army movement seen. Emits `outgoing`, `returning`, and `return`. The return is scheduled with `setTimeout(totalTime − elapsed)`. Commander availability and the "wait for troops" logic both depend on these events.
- `resources`: global currencies (coins, rubies, skips, pegasus tickets…) filled from `gcu`/`sce`.
- `map` + `MapObject`: a cache of map tiles held by WeakRef + FinalizationRegistry. `clientPreSpyInfo` trusts entries younger than 10s.
- `KingdomID`: `greatEmpire`, `burningSands`, `everWinterGlacier`, `firePeaks`, `stormIslands`, … `AreaType` holds map tile types (baron, fortress, mainCastle, externalKingdom, …).
- `setCastle(castle, callback)`: **the global serialization point** ([protocols.js:1387](protocols.js#L1387)). The game has one "active castle" per session. Every action that needs a specific castle or kingdom goes through this queue. It sends `jca` only when the castle changes, then runs `callback`. Queued callbacks drain grouped by castle. Anything that awaits a long-lived promise inside a `setCastle` callback blocks every other plugin on that account.

## Plugin contract

Each `.js` under `plugins/` is discovered recursively by [plugins/index.js](plugins/index.js). Files with "discord" in the path are skipped when no Discord token is configured. The same file runs in two contexts.

```js
// 1. Main thread: export metadata only, then stop.
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        force: false,        // true = always enabled, user can't turn off
        hidden: false,       // true = not shown in dashboard
        pluginOptions: [     // rendered by the dashboard
            { type: "Checkbox" | "Text" | "Select" | "Time" | "Channel" | "Label",
              key: "optionKey", default: "...", selection: [...] }
        ]
    }

// 2. Worker: real behaviour.
const { botConfig, events, xtHandler, sendXT, waitForResult } = require('../ggeBot.js')
const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}
events.on('load', () => { /* start loops */ })
```

- The plugin **key** is the file basename without extension. Subfolder paths are dropped, so two plugins with the same basename collide.
- Option values arrive as strings from the dashboard. Code parses them with `parseInt`, `Number`, or `[, ""].includes(x)` checks for empty values. Empty options get `default` filled in by main before the worker starts.
- `force: true` plugins (`attack.js`, `misc.js`) load for every account.
- At startup, main deletes plugin keys from a user's saved config when the file no longer exists ([main.js:673-691](main.js#L673-L691)).
- Lifecycle events on `ggeBot.events`: `earlyLoad` (login OK), `load` (event data ready, the usual start point), `eventStart`/`eventStop` (from `sei` diffs), `configModified`, `unload`, `sentLLI`.

## Feature inventory

**Attacks** ([plugins/attack/](plugins/attack/)). Everything funnels through `attack.js`:
- `waitToAttack(cb)`: **one FIFO queue per account shared by every attack plugin.** After each successful `cra` it waits `boxMullerRandom(attackDelaySeconds, attackDelaySeconds + attackDelayRandomizationSeconds)`, defaults 4.5 and 2.5. It also takes a token from an hourly limiter of about 442 attacks per hour. It refuses with `ATTACK_LIMIT_REACHED` once the `gai.AC` daily counter reaches `attackLimit` (default 3500).
- `getAttackInfo(...)`: builds the `cra` payload (waves, flanks, tools, courtyard `RW`, horse `HBW`, feather `PTT`). Wave count comes from player level plus commander bonuses. Slot limits come from formulas copied out of the client (`getMaxAttackers`, `getAmountSoldiersFlank/Front`, `getMaxUnitsInReinforcementWave`).
- `assignUnit(slot, units, max)`: greedy fill that mutates the in-memory inventory.

| Plugin | Target | Shared logic |
|---|---|---|
| `attackBarrons{GreatEmpire,BurningSands,EverWinterGlacier,FirePeaks}` | Robber-baron NPC castles within ±50 tiles, nearest first; optional time-skip / tower upgrade | `sharedBarronAttackLogic.js` |
| `attackFortresses{BurningSands,EverWinterGlacier,FirePeaks}` | NPC fortresses (fixed level per kingdom) | `sharedFortressAttackLogic.js`, which **forces `useCoin` and `useFeather` on** |
| `attackNomads`, `attackSamurai`, `attackKhan` | Event camps; picks difficulty via `sede`, chest preferences, score shutoff | event JSON tables in `items/` |
| `attackBerimondInvasion` | Berimond invasion event | – |
| `attackStormForts` | Storm Islands forts; optional cargo upgrade via a plugins-extra file | – |

The pattern in every attack plugin:
1. `waitForCommanderAvailable(whitelist)`. It blocks until a lord returns, tracked through `movementEvents`.
2. `waitToAttack(async () => pick target → build waves → sendXT('cra') → waitForResult('cra', predicate))`.
3. On errors: `NO_MORE_TROOPS` waits for any returning movement to that castle. `LORD_IS_USED`, `COOLING_DOWN`, `TIMED_OUT`, `MISSING_UNITS`, and `ATTACK_TOO_MANY_UNITS` retry. Anything else is rethrown.

**Economy and utility:**
- `feast.js`: food feasts above thresholds.
- `meadReplaceStorm.js`: replaces mead when 2.1h of mead remain.
- `resourceSendStorm.js`: hidden.
- `skips.js`: which skip sizes may be spent; exports `spendSkip` and `haveEnoughSkips`.
- `sellStoredEquipment.js`: sells stored equipment and gems.
- `helpRequests.js`: alliance help.
- `misc.js`, forced: auto-collect quests `[3000,3002,3019,3490,84,186,30]`, delete message type 67, take the fortune teller reward.

**Account control:**
- `shutoffTimer.js`: sends `KillBot` after N hours, which turns the bot off permanently, with no restart.
- `intervalTimer.js`: start/stop schedule. **Dead code.** It returns at line 8, and the code below it uses event names main never emits.

**Discord** ([plugins/discord/](plugins/discord/)): incoming and outgoing attack alerts with rendered previews (`imageGen.js` + `units.js` with `pureimage`/`sharp`), two-way alliance-chat relay, fortress/aqua island/aqua tower alerts, and slash commands for event leaderboards and loot. **Each worker logs its own discord.js Client in with the shared bot token** ([plugins/discord/discord.js:23](plugins/discord/discord.js#L23)).

**External events** (Battle for Berimond, Outer Realms, temp servers): when `SubUser.externalEvent` is set, main boots a throwaway worker on the home server, asks it for `sei`/`glt` (`GetExternalEvent`), picks the temp-server URL and zone from the reply, and terminates it. Then it boots the real worker against the temp server with `tempServerData`, which `retry()` uses to send `tlep` ([main.js:472-579](main.js#L472-L579)).

## Config (`ggeConfig.json`)

`webPort`, `fontPath`, `privateKey`/`cert` (enable HTTPS), `signupToken` (empty means open signup), `discordToken`, `discordClientId`, `discordClientSecret`, `timeoutMultiplier` (default 5, scales every `waitForResult`), `secondsTillRestartBot` (10), `debug`, and optionally `skipUTF8Validation`. Worker files `require("./ggeConfig.json")` directly, so a missing file crashes workers.

## Conventions and gotchas

- **Logging:** inside workers, `console` is replaced by `mngLog` ([ggeBot.js:27-61](ggeBot.js#L27-L61)). The first argument is usually an **i18n key**, not English, such as `console.log("hittingTargetAttack", ...)`, and every string part goes through `i18n.__`. The keys live in `website/public/locales/*.json`, in the other repo. Add a key there when you add a message.
- **Loose equality and `[, ""].includes(x)`** for "undefined or empty string" appear everywhere. Keep that semantics when you refactor.
- **Module-level state is per worker.** Don't assume a singleton across accounts.
- **Top-level `return`** in plugin files is legal only because CommonJS wraps modules in a function. Don't convert plugins to ESM without changing the contract.
- **Most loops are `while (true)`** with no cancellation, and recovery is "let the worker die". Treat any new long-running loop the same way, or build real cancellation first.
- **No tests exist.** Verify behaviour only against a live game account, by running the bot and reading the per-bot log in the dashboard. A run needs network access to GGS and a working `website/` build.
- `.githooks/post-merge` touches `update` and runs `npm i`. `pre-push` runs `npm-check-updates -u`, which rewrites `package.json` to the latest dependencies on every push.

## Running locally

```bash
./start_linux.sh        # clones website/, builds it, npm i, node main.js, opens http://127.0.0.1:3001
# or, once website/build exists:
node --no-warnings main.js
```

On first boot, sign up in the dashboard with the `signupToken` (empty by default), add a game account (name, password, server id from `1.xml`), enable plugins, and toggle it on.
