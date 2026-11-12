# GGE-BOT: gaps, issues, and the path to a hosted multi-user platform

Audience: whoever builds the next version, human or agent. Read [AGENTS.md](../AGENTS.md) first for how the current system works. Line references point at commit `1bf623d`.

## The goal

A web app where people sign up, link one or more game accounts, choose which automations run, and leave a bot running on its own. Requirements on top of what exists today:

1. **Concurrent features per account.** One bot loots NPC targets while it also recruits troops and builds tools. In this codebase, "multi-account" already means several game accounts per login. The new requirement is several jobs per account at the same time.
2. **Human pacing on every action.** There is a gap between actions. Start at 8s, lower it step by step to find the working floor, then lock that floor in as a threshold. Randomize every gap so it is never the same number twice.
3. **Automatic on/off sessions.** The bot takes breaks on its own instead of running 24/7.
4. A central dashboard to configure all of it.
5. Feature areas: event attacks and farming; NPC castles, towers, and fortresses; Nomads, Samurai, Berimond, and other events; resources, food, and recruitment; equipment and inventory; castle management and repetitive tasks.

---

## 1. Security issues that block hosting this for other people

Today the app is built for one operator on localhost. Each item below becomes a real incident once strangers share one instance.

| # | Issue | Where | Impact |
|---|---|---|---|
| S1 | **Game passwords are stored in plaintext** in `SubUsers.pass` | [main.js:77-88](../main.js#L77-L88), [main.js:105](../main.js#L105) | A leaked DB or backup means every user's game account is taken over |
| S2 | **Any logged-in user can crash the whole server.** The WebSocket handler is `async` with no try/catch. Sending malformed JSON, or a `SetUser` with someone else's account `id`, makes `getSpecificUser` read `row.plugins` on `undefined`. That is an unhandled rejection, which kills the process along with every user's bots | [main.js:758-793](../main.js#L758-L793), [main.js:108-115](../main.js#L108-L115) | Any tenant can take the service down |
| S3 | **Deleting a running account crashes main later.** `RemoveUser` deletes the row but leaves the worker running. When that worker eventually exits, `onTerminate` calls `getSpecificUser`, which throws inside the `exit` handler | [main.js:774-791](../main.js#L774-L791), [main.js:589-592](../main.js#L589-L592) | Delayed full outage |
| S4 | **Cross-tenant log read.** `GetLogs` looks up `botMap.get(id)` without checking that the account belongs to the caller | [main.js:843-858](../main.js#L843-L858) | Leaks another user's bot log (account name, targets, resources) |
| S5 | **The session is a permanent bearer UUID in a cookie.** No expiry, rotation, logout, or CSRF protection. The frontend sets the cookie, so it cannot be HttpOnly | [main.js:712](../main.js#L712), [main.js:353](../main.js#L353) | Anyone who steals the cookie owns the account forever |
| S6 | **Signup is open by default.** `signupToken` defaults to `""`, and `json.token != ""` passes when the request sends `token: ""` | [main.js:358](../main.js#L358) | Anyone can register |
| S7 | **Login blocks the event loop.** `pbkdf2Sync` with 600k iterations runs on the main thread, with no rate limit | [main.js:352](../main.js#L352), [main.js:362](../main.js#L362) | A handful of login requests per second freezes every user's dashboard and bot control. Also brute-force friendly |
| S8 | **Discord channels cross tenants.** Every user's bot uses the one shared Discord bot, and `channelID` is free text from the user. Any tenant can post alerts into another tenant's Discord channel, or relay that channel into their own alliance chat | [plugins/discord/chat.js:58-69](../plugins/discord/chat.js#L58-L69) and the other `channels.fetch(pluginOptions.channelID)` calls | Data leak and abuse across guilds |
| S9 | **Open reverse proxy** to `empire-html5.goodgamestudios.com` | [main.js:325-329](../main.js#L325-L329) | Your server's IP becomes a relay for anyone's traffic to GGS |
| S10 | **The start scripts run unreviewed upstream code.** Every launch does `git pull origin main` on this repo, the website, and the extra plugins, then runs it | [start_linux.sh](../start_linux.sh) | Supply-chain risk. For a hosted service you must pin and review what you deploy |
| S11 | The `pre-push` hook runs `npm-check-updates -u` and rewrites `package.json` to the latest major versions on every push | [.githooks/pre-push](../.githooks/pre-push) | Unreviewed dependency jumps |
| S12 | Discord OAuth: `loggedInUsers[uuid].forEach` throws when the user has no open tab, and `guild` may be undefined | [main.js:410-428](../main.js#L410-L428) | 500s, plus a half-linked state |

## 2. Correctness bugs in the current code

| # | Bug | Where |
|---|---|---|
| B1 | **The scheduler plugin is dead.** `intervalTimer.js` returns at line 8, so nothing after it runs. The code below emits `startBot` (main listens for `createBot`), listens for `userDelete` (main emits `userRemoved`), and compares `pluginOptions.endTimer` against a key named `stopTimer`. The one feature closest to "automatic on/off" does not work | [plugins/intervalTimer.js](../plugins/intervalTimer.js), [main.js:140](../main.js#L140), [main.js:670](../main.js#L670) |
| B2 | **The attack delay is truncated.** `parseInt("4.5")` gives 4 and `parseInt("2.5")` gives 2, so the gap is 4–6s instead of 4.5–7s. Decimal settings are silently ignored | [plugins/attack/attack.js:272-273](../plugins/attack/attack.js#L272-L273) |
| B3 | **The server's attack threshold is never used.** `attackLimit` is forced to 3500 when empty, so `attackLimit ?? attackThreshold` never falls back to `ACTH` | [plugins/attack/attack.js:236-248](../plugins/attack/attack.js#L236-L248) |
| B4 | **Pacing applies to attacks only.** Every other command (feast, sell, skip, help, quest collect, map scans) goes out at up to 5 per second with no jitter | [ggeBot.js:17](../ggeBot.js#L17), [ggeBot.js:63-70](../ggeBot.js#L63-L70) |
| B5 | **The fortress logic overrides the user.** It forces `useCoin = true` and `useFeather = true`, spending pegasus tickets whatever the settings say | [plugins/attack/sharedFortressAttackLogic.js:18-19](../plugins/attack/sharedFortressAttackLogic.js#L18-L19) |
| B6 | **The map cache never works.** The cache key repeats `fromX, fromY` instead of using `toX, toY`, and `if (response == 0)` compares an object to 0, so nothing is ever cached | [protocols.js:289](../protocols.js#L289), [protocols.js:329](../protocols.js#L329) |
| B7 | `safeWood` reads `SAFE_F`, which is the food value | [protocols.js:401](../protocols.js#L401) |
| B8 | The `msd` (skip target) reply predicate uses `\|\|`, so any `msd` reply matches, including one for a different target | [protocols.js:243-244](../protocols.js#L243-L244) |
| B9 | The `dms` handler builds arrow functions and never calls them, so movements are never removed on `dms` | [protocols.js:1304-1312](../protocols.js#L1304-L1312) |
| B10 | `clientGetAllianceByName` returns `clientGetAllianceByID(...)()`, which calls a Promise and throws a TypeError | [protocols.js:1339](../protocols.js#L1339) |
| B11 | External event reuse branch: `bot[0].id` on an object returned by `find`, comparing `user.name == e.id`, and assigning `gameURL`/`gameServer` the wrong way round onto `user` instead of `data` | [main.js:474-508](../main.js#L474-L508) |
| B12 | `timedOut` never resets, so the 6th timeout over a worker's whole life exits it, even if those timeouts were hours apart | [ggeBot.js:112-116](../ggeBot.js#L112-L116) |
| B13 | `checkForIssues` calls `webSocket.pause()` and leaves the worker silently stalled instead of restarting or reporting | [ggeBot.js:89-104](../ggeBot.js#L89-L104) |
| B14 | **Hot reload is mostly fake.** Plugins read `pluginOptions` once at require time, and `SetUser` only notices a plugin state flip for keys that were already in the old config | [main.js:808-836](../main.js#L808-L836) |
| B15 | `shutoffTimer` uses `KillBot`, which sets `state = 0`, so the bot never comes back. Users see it as "stopped for good" rather than "paused" | [plugins/shutoffTimer.js](../plugins/shutoffTimer.js), [main.js:609-611](../main.js#L609-L611) |
| B16 | Restarts never back off. Network failure means a reconnect every 10s forever, and many accounts reconnect at the same moment | [main.js:589-605](../main.js#L589-L605) |
| B17 | `ret` is an implicit global in `waitToAttack` | [plugins/attack/attack.js:258](../plugins/attack/attack.js#L258) |

## 3. Architectural limits for a hosted platform

- **One process does everything.** Web server, auth, SQLite, Discord, and every account's worker thread share one Node process. A bug in any of them takes down all users (see S2 and S3). You cannot scale the bot runners apart from the web tier.
- **Memory per account.** Each worker thread loads its own copy of `items/*.json`, `protocols.js`, and plugin state. One process caps out at a modest number of accounts. Plan for runner processes or containers that each hold N accounts.
- **SQLite with synchronous calls** on the request path. Fine for one operator, but it does not scale to many writers or multiple runner hosts.
- **No cancellation model.** Loops are `while (true)`, and the only way to stop one is to kill the worker. You cannot stop "looting" while "recruiting" keeps going. That is a direct blocker for per-feature on/off.
- **Matching replies by command name.** Two concurrent jobs that both use `gaa` or `cra` race for each other's replies unless every predicate is exact. More concurrency will make this worse.
- **No persistent bot state or history.** Logs are a 25-line in-memory ring buffer. Nothing records what the bot did yesterday, how many attacks it sent, loot totals, errors, or bans.
- **Discord runs N gateway sessions on one token.** Every worker logs the same bot in ([plugins/discord/discord.js:23](../plugins/discord/discord.js#L23)). Discord limits identifies per day, and duplicate sessions handle each interaction several times.
- **Brittle protocol constants.** `verChk v="166"` and the `lli` fields `CONM`, `RTM`, `AID`, `SID`, `PLFID` are hardcoded ([ggeBot.js:180](../ggeBot.js#L180), [ggeBot.js:330-372](../ggeBot.js#L330-L372)). A GGS client update breaks login for every user at once. You need a versioned protocol layer and a fast way to roll out fixes.
- **Key features live in a private repo.** Recruitment (`recruitTroops`), storm cargo upgrades, and extra slash commands come from `plugins-extra`, which you don't have. Recruitment is called only during Great Empire external events.
- **The dashboard is a separate repo** (`GGE-BOT-Website`) that was not reviewed here. The i18n keys every log line depends on live there too.
- **No tests, no types, no CI.** The damage formulas (`getAttackInfo`, `assignUnit`, wave and slot math) are pure functions that are easy to unit test, and they are the most valuable thing to lock down.
- **Upstream is winding down.** The README says new plugins are unlikely. Treat this repo as a reference implementation of the protocol, not a base you can keep merging from.

## 4. Feature coverage against your list

| Your area | What exists | Gap |
|---|---|---|
| Event attacks and farming | Nomads, Samurai, Khan, Berimond Invasion, Storm forts, all on the shared attack queue | Difficulty and chest logic per event is hand-coded. Every new event means copying a 400-line plugin |
| NPC castles, towers, fortresses | Barons in 4 kingdoms (±50 tiles, nearest first, optional time-skip and tower upgrade). Fortresses in 3 kingdoms. Storm tower and island alerts (Discord only) | No target prioritisation by loot value or travel time. Fixed 50-tile radius. Fortress logic forces premium horses (B5) |
| Nomads / Samurai / Berimond / others | Present. Battle for Berimond / Outer Realms through the temp-server flow | The temp-server flow is fragile (B11) and boots a throwaway worker on every start |
| Resources, food, recruitment | Feast, mead replace (Storm), resource send (hidden) | **No recruitment or tool production** in the open repo. Only a private hook used in GE external events. No resource balancing between castles or kingdoms |
| Equipment and inventory | Sell stored equipment and gems | No equip or optimise, no inventory view, no rules engine for what to keep |
| Castle management / repetitive tasks | Quest auto-collect (fixed list), alliance help, skips | **No building or upgrade queue**, no research, no hospital or healing, no defence setup |
| Central dashboard | Separate React app: per-account plugin toggles and options, live log, a few status numbers | No history, charts, schedules, per-feature status, or multi-tenant admin |
| Several features at once per account | Plugins already run at the same time in one worker. Attacks share one queue | No per-feature start/stop, no priorities, and pacing only covers attacks |

## 5. Running several features at once on one account

A game account has **one session** and one active castle at a time. A human with one client works the same way. So "loot NPCs and recruit at the same time" should not become two independent loops firing commands. It should be several **jobs** feeding one **per-account action governor**:

```
Account runtime (one game socket)
├── Job: NPC looting      ─┐
├── Job: recruit troops    ├─► propose next action (with priority)
├── Job: build tools       │
├── Job: feast / food      ─┘
│
└── Action governor (single queue per account)
      • picks the next action by priority and readiness
      • enforces the pacing policy (section 6) on every action
      • owns castle switching (replaces setCastle's ad-hoc queue)
      • respects the session schedule (paused = queue holds)
```

The design needs these properties:
- Each job exposes `start(signal)`, `stop()`, and `status()`, and honours an `AbortSignal`. Then one feature can be switched off without restarting the others or the session.
- The governor is the **only** caller of `sendXT` for player actions. Reads such as map scans and status refreshes can go through a lighter limiter, but they still count toward session activity.
- The castle-switch cost is visible to the scheduler. It batches actions per castle so it doesn't bounce between castles, which is both a waste and an unusual pattern.
- Replies are correlated per request, not per command name. Wrap `waitForResult` so each job's request has a unique predicate, or serialise same-command requests.

The current `waitToAttack` queue ([plugins/attack/attack.js:247](../plugins/attack/attack.js#L247)) and `setCastle` ([protocols.js:1387](../protocols.js#L1387)) are the starting points. Merge them and extend them to every action type.

## 6. Pacing and session schedule

This is your stated requirement, written as configuration the governor enforces. All values are per account and editable in the dashboard.

```yaml
pacing:
  minGapSeconds: 8          # starting value; lower it step by step during testing
  floorSeconds: null        # set once you've found the threshold; minGap can't go below it
  jitterSeconds: 3          # random spread added on top of minGap
  distribution: normal      # skewed/normal rather than uniform, so gaps cluster but vary
  appliesTo: [attack, recruit, build, feast, sell, skip, collect]   # every player action

sessions:
  enabled: true
  activeMinutes:  { min: 60, max: 180 }   # length of an "on" stretch, randomised each time
  breakMinutes:   { min: 20, max: 90 }    # length of an "off" stretch, randomised each time
  dailyActiveHours: { max: 14 }           # hard cap per 24h
  quietWindow: "02:00-08:00"              # local time when the account stays offline
  onBreak: disconnect                     # close the socket, not just idle
```

Implementation notes against today's code:
- Reuse `boxMullerRandom` ([plugins/attack/attack.js:214](../plugins/attack/attack.js#L214)) for the gap, and parse with `Number`, not `parseInt` (B2).
- Replace `intervalTimer.js` (B1) and `shutoffTimer.js` (B15). Session state belongs to the account runtime, not to a plugin. "Break" means stop the jobs, close the socket, and schedule a reconnect. It must not use `KillBot`, which turns the bot off for good.
- Add jitter to the restart delay too, so the 10s fixed reconnect (B16) doesn't line many accounts up on the same second.
- **Record what you test.** For each account, log the pacing values in effect and what happened: error codes, cooldown codes (`453`, `COOLING_DOWN`), and `IS_BANNED` results, which [ggeBot.js:383-388](../ggeBot.js#L383-L388) already surfaces. When you lower the gap from 8s, those records are the only real evidence for where to put the floor.

**Be realistic about what this buys you.** Gaps and breaks only change timing. The game server sees far more than timing: how many actions an account takes, how efficiently, for how many hours a day, over weeks. GGS's terms forbid bots, and players report bot bans even with delays. Treat bans as something that will happen to some users, and build for it:
- Detect `IS_BANNED` and login failures, stop that account, and tell the user in the dashboard.
- Never auto-retry a banned account in a loop.
- Tell users plainly that their accounts are at risk.

## 7. Target architecture

```
          ┌──────────────── Web tier ────────────────┐
Browser ─►│ Web app (dashboard + API)                │
          │  • real auth: sessions, HttpOnly cookie, │
          │    async argon2/scrypt, rate limits      │
          │  • tenants, roles, audit log             │
          │  • per-feature config validated by schema│
          └────────────┬───────────────▲─────────────┘
                       │ commands      │ status / logs (pub/sub)
                ┌──────▼───────────────┴──────┐
                │ Queue / bus (e.g. Redis)    │
                └──────┬───────────────▲──────┘
          ┌────────────▼───────────────┴─────────────┐
          │ Runner processes (N accounts each)       │
          │  supervisor: lease account, heartbeat,   │
          │  backoff restart, crash isolation        │
          │  account runtime = session + governor    │
          │  + jobs (section 5) + session scheduler  │
          └────────────┬─────────────────────────────┘
                       │
          Postgres: users, accounts (encrypted creds), feature config,
                    schedules, action history, loot/attack stats, bans
          Shared game-data cache (items JSON per game version)
          One Discord bot service (guild ownership verified per tenant)
```

Key decisions:
- **Credentials:** encrypt game passwords at rest with envelope encryption, using a key from KMS or an env-held master key. Prefer the token login (`lt`, already supported at [ggeBot.js:334](../ggeBot.js#L334)) so you hold a password as rarely as possible.
- **Isolation:** runner processes separate from the web tier. A crash in one account's job must not touch other accounts or the dashboard.
- **Port, don't fork.** Keep `protocols.js`, the attack formulas, and the event tables as the reference. Rewrite the runtime in TypeScript around the governor and job model, and bring the plugins over one at a time as jobs.
- **Observability:** structured logs per account, persisted. Metrics such as actions per hour, attacks, loot, and error codes. Sentry for crashes.
- **Tests:** unit tests for the pure maths (`getAttackInfo`, `assignUnit`, slot and wave formulas, `getLevel`). Recorded `%xt%` fixtures to replay login and attack flows without a live account.

## 8. Suggested order of work

1. **Harden what's there** (needed before anyone else logs in): S1–S9 and B12–B16. Stop trusting client-supplied account ids, wrap the WebSocket handler, encrypt credentials, add real sessions and rate limits, remove the open proxy, scope Discord channels to the tenant's verified guild.
2. **Governor and session scheduler** (section 6): every action paced, sessions on and off, and the test-and-record loop for finding the gap floor. Fix B2–B5.
3. **Job model** (section 5): cancellable jobs, per-feature on/off, request correlation.
4. **Split the runners from the web tier**, and move to Postgres plus a queue.
5. **Fill feature gaps:** recruitment and tool production, building queue, equipment rules, resource balancing, target prioritisation.
6. **Dashboard v2:** per-feature status, schedules, history and charts, admin views.

## 9. Risks to decide on up front

- **Terms of service:** automating GGE breaks Goodgame Studios' terms. Bans fall on your users' accounts, not on you.
- **Liability for a hosted service:** running bots for other people means holding their game credentials and operating a commercial cheat service against a named company. That carries account-security duties and real exposure to takedown or legal action. Commercial bot services for other games have been sued or shut down.
- **Protocol churn:** one client update can break every user at once. Budget for fast fixes.
- **Upstream licence:** the repo is MIT ([LICENSE](../LICENSE)), so reuse is allowed with attribution. The private `plugins-extra` and the website repo carry their own terms.
