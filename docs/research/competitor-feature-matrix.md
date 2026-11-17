# Competitor feature matrix

This document compares GGE-BOT with four other Goodgame Empire bots, feature by feature. For each feature it records whether this repo has it fully, partly or not at all, and points to the code.

First researched 2026-11-16. Deep pass with persisted screenshots on 2026-11-17. The per-site reports are in [competitors/](competitors/). Screenshots, page text and route tables are in the gitignored `.audit/<site>/` folders. They stay local because they show account details.

## How the research was done

- One research agent explored each site with a headless browser.
- **Read-only.** Every non-GET request was blocked in the browser, except the login call. The agents created no automations, presets or attacks, saved no settings, started nothing, and linked no game accounts.
- **Accounts:**
  - **EmpireBot:** the supplied customer account was used, at the user's request. It is on the `full` tier with one castle linked, so the whole bot dashboard was reachable. A disposable account was also used for the trial and panel state.
  - **The Squire Bot:** a disposable trial account. The supplied real account would not log in: the form wants a username, and only an email is on file.
  - **CitadelOps:** a disposable passkey account, with no game account linked.
  - **Config Builder:** no account needed.
  - All credentials live in the gitignored `credentials/inspirations.json`.
- **Game login wall.** Squire and CitadelOps hide their per-account control panels until a game login is linked.
  - Squire forms that did not render were read from the site's public client JS: labels, option lists, defaults and help text.
  - CitadelOps settings come from its signed-in setup guide and the guide's screenshots.
  - None of the competitors' paid behaviour was verified in game.

| Site | What it is | What could be seen |
|---|---|---|
| [CitadelOps](competitors/citadelops.md) (citadelops.app) | Hosted cloud bot for GGE and Empire: Four Kingdoms | Public site, Account Center, and the full signed-in setup guide (17 sections, about 25 routines) with its 42 screenshots. Command Center gated. |
| [The Squire Bot](competitors/squirebot.md) (thesquirebot.com) | Hosted cloud bot | About 30 modules. Main-realm config dialogs render on the trial. Per-account and BTH/Outers forms were read from the client JS. 128 screenshots. |
| [Bot Config Builder](competitors/netlify-config-builder.md) (netlify) | Static config generator for an unpublished self-hosted Python bot | Everything, because there is no backend. Settings only, nothing about runtime behaviour. 48 screenshots. |
| [EmpireBot](competitors/empirebot.md) (empirebot.win) | Small Italian hosted bot, about 13 users. **A fork of GGE-BOT** | The full bot dashboard of a paying account: castle page, every plugin's option dialog, attack builder, Info hub. About 70 screenshots. |

**EmpireBot is built on our code.** Its WebSocket action IDs 0–19, frame layout, plugin names and the `GGEBOT` block in the attack payload all match `packages/bot-core`. On top of that it adds action types 20–50 and about 60 plugins. Many EmpireBot rows below are therefore plugins we deleted, or never wrote, in the same codebase.

## Pricing and business model

| | CitadelOps | Squire Bot | Config Builder | EmpireBot | GGE-BOT |
|---|---|---|---|---|---|
| Trial | 7 days per game account, all features, starts at first game login | 2 days of the Green plan, without the BTH and Outer Realms modules | n/a (free) | 4 days, starting when the first castle is linked | None |
| Price | $20 for 30 days per account; $75 for 5, $100 for 10 | Green 12 credits, BTH +4 credits; price per credit not public | Free | Not published. Tiers `super` / `full` / `lite` | Plans set by an admin (`users.max_bots`) |
| Checkout | Manual, via Discord | Manual, via Discord | — | Manual ("contattaci", with no channel listed). An unused PayPal subscription field suggests one is planned | None |
| Account limits | One credit per game account | A licence cap on accounts running at once | — | **One castle per account**, on trial and on full | `users.max_bots`; event twins are free |
| Extras | Credits never expire, can be transferred, auto-renew, referral code | Share a game account with other users, with per-right access | — | Operator can pin plugin values on non-super tiers | — |
| Community size | Discord, about 100 members | Discord "FarmTheEmpire" | None | None (about 13 users) | — |

Nobody has a self-serve checkout. Payment and a free trial are an open opportunity, not a gap where we are behind.

## Legend

**Competitor columns** (C = CitadelOps, S = Squire Bot, B = Config Builder, E = EmpireBot):

- ● seen: rendered in the UI, or documented in CitadelOps's signed-in guide
- ◑ options read from the site's client JS; the form needs a linked game account or a higher plan, so it never rendered (Squire only)
- ◐ advertised only (marketing copy, or a plugin name with no visible options)
- blank: not offered or not seen

**GGE-BOT status:**

- ✅ Implemented and covers the core of what competitors offer.
- 🟡 Partial: the feature exists but lacks notable options or behaviour that competitors have. The gap is described in the Notes column.
- ❌ Not implemented.

## Feature matrix

### Attacks and events

| Feature | C | S | B | E | GGE-BOT | Notes |
|---|:-:|:-:|:-:|:-:|:-:|---|
| Robber-baron / kingdom tower attacks | ● | ◑ | ● | ● | ✅ | `plugins/attack/attackBarrons*.js`, 4 kingdoms. Missing: scan radius with a preview of towers in range (C: up to 1,820 tiles; E: ±X/Y), waves up to 30 (C), "maiden-supported only" (C). |
| Force-level towers | ● | ◑ | | ● | 🟡 | `upgradeTowers` option in the baron plugins (E has the same option). No separate levelling mode. S Leveller: an X,Y tower queue, a target level, and the victories needed. |
| Kingdom fortresses (Glacier / Sands / Peaks) | ● | ● | ● | ● | 🟡 | `attackFortresses*.js` exposes only `commanderWhiteList`. Missing: per-kingdom hit limits (S), per-kingdom presets (S, B), distance (B), automatic Direwolf buying (C), picking the fastest commander per fort (C). There is no Great Empire fortress plugin. |
| Reserve commander for a fort that is about to free up | | ● | ● | | ❌ | The commander pool (`plugins/commander.js`) has no reservation. |
| Nomad / Samurai camps | ● | ● | | ● | ✅ | `attackNomads.js`, `attackSamurai.js`: difficulty, score shutoff, chests. Missing: advisor attacks (C "Auto Advisor", S Berimond-style seeding), skip mode on one camp at fixed coordinates (S), camp levelling (C). |
| Daimyo | | ● | | ● | ❌ | `AreaType.daimyoCastle` is defined but unused. C's "coming soon" card is gone from its guide and site as of 2026-11-17. |
| Khan | ● | ● | | ● | 🟡 | `attackKhan.js` has the rage trigger and score shutoff. Missing: automatic defense presets and tools (C, S, E `khanDefence`), tablets-only mode and rage optimiser (S), pause after N taunts (S), medal shop (S), cap on the rage chain (C), stop before the event ends (C). |
| Foreign Lords / Bloodcrow invasion | ● | ● | | ● | ❌ | Locale keys `attackForeign` and `attackBloodcrows` are orphaned; `AreaType.bloodcrowCastle` is unused. E still ships both plugins. |
| Glory event attacks with banner and chest pick lists | | ● | ● | | ❌ | S and B both have ordered banner/chest lists and per-wave templates. |
| Dethrone with a ruby cap | | ● | ● | | ❌ | B shows the ruby cost of every dethrone level. |
| Berimond Invasion (red/blue camps) | | ● | | | ✅ | `attackBerimondInvasion.js`: reputation, no event tools, low-value chests. Missing: choosing the camp side (S). `wavesTillChests` is declared but never read. |
| Battle for Berimond: towers, troop sending, camp builder | ● | ◑ | ● | ● | ❌ | `berikingdom.js` was deleted (commit 33d8642); E kept it as `attackBerimondKingdom`. S has Tower Attack, Advisor Mode (seed each commander once, then the in-game advisor repeats), lane targeting, troop and tool refills, a camp builder, and loss limits. |
| Berimond PvP (player camps) | ● (beta) | ◑ | | | ❌ | S "Player Attack" tab. |
| Storm Islands forts | ● | ● | ● | | ✅ | `attackStormForts.js`: easy and hard per level. Missing: map-coverage view (C), priority by distance (S), minimum troops kept after launch (C). |
| Storm aquamarine shop | ● | ● | | | ✅ | `buyCoins`, `buyDecoration`, `buyXP`. S also buys 5 h and 24 h skips and dummy peasants, and lets you choose the decoration. |
| Feed resources, food and mead into Storm | ● | ● | ● | | 🟡 | `meadReplaceStorm.js` sends mead only. `resourceSendStorm.js` sends Storm wood and stone *out* to other castles. No thresholds, reserves or choice of source castle. |
| Send troops and tools to Storm | ● | ● | ● | | ❌ | |
| Storm castle building (keep, storehouse, ships, demolish, blueprint) | ● | ● | ● | | ❌ | `upgradeStormForts` depends on `plugins-extra/upgradeStormCargo.js`, which is not in the repo. |
| Rift Raid (alliance boss) | ● | ● | | | ❌ | S coordinates many accounts in groups and has "Retreat all". |
| Beyond the Horizon / Outer Realms modules | | ◑ (paid add-on) | | ◐ | ❌ | Only event-twin login handling exists (`apps/runner/src/event-server.ts`). S: Coin Farmer, BTH Blacksmith, Influence Farming, Event Recruiter, BTH Castle Builder, Equipment Manager, OR Storms, MP Builder. E: `orPotenzaEntry` only. |
| PvP on alliance or player targets | ● | | | ● | ❌ | C manual spy-then-attack. E `perpetualAttack`, `sabotaggio`, `presaAvamposti` (capture outposts), and continuous spying. |
| Incoming-attack defense: evacuate, station, gates | ● | ◑ | | ● | ❌ | C "Auto Station". S Alert + Autostation stations troops in protected alliance castles (24h before 12h, 9h, 2h protection), falls back to opening gates, and also stations on maintenance warnings and for 7 seasonal raids. E `stationOnHit` (AUTO ally finder, flee N s before impact) and `autoOpenGates`. |
| Pause peace-breaking modules while under peace | | | | ● | ❌ | E `peaceGuard`. E also marks peace-breaking actions 🚨 across the UI. |
| Sheltering troops with allies on a timer | ● | ◑ | | | ❌ | C "Auto Bird" with presets per calendar period. S can repeat 12-hour stationing. |
| Monitor captured assets | | ◑ | | | ❌ | S checks a list of X,Y every 1–12 h, can spy the occupier, sends Discord alerts, and can auto-break. |
| Support Empire: Four Kingdoms | ● | | | | ❌ | C connects to E4K's 35 worlds over raw TCP and to GGE over WebSocket. |

### Attack engine and commanders

| Feature | C | S | B | E | GGE-BOT | Notes |
|---|:-:|:-:|:-:|:-:|:-:|---|
| Random delay between attacks | ● | | | ◐ | ✅ | `attack.js`: Box–Muller value, base 15–600 s plus variance 10–600 s, doubled after a rejection. The opt-in `lognormal_delays` flag adds occasional 2–6× breaks (commit c7e11e4). C's minimum is 4 s. E has an `antiBan` plugin whose options were not visible. |
| Daily attack cap | ● | ◑ | ● | | ✅ | `attackLimit`, default 3500; event twins are exempt. S limits per realm by hit count or by coin cost, with a preview calculator. |
| Hourly caps per bot, kingdom or level | | | ● | | 🟡 | Fixed at 120 attacks/hour globally; users cannot change it. |
| Attack priority across modules | ● | | | | 🟡 | One shared queue exists, but users cannot order modules. C lets users drag-to-reorder, and older work rises in priority as it waits. |
| Automatic wave builder | ● | ● | ● | ● | 🟡 | `attackLeft/Middle/Right/Courtyard`, `attackWaves`, `foodTroopsOnly`. Missing: unit order (fastest, strongest or weakest first), mead-only troop supply, a per-wave tool policy (S, B), "fill to commander cap" (E). |
| Attack presets (in-game slots 1–30 or saved on the dashboard) | ● | ● | ● | ● | ❌ | No preset support. `attack.js:112` has `RW: //TODO: SET THIS UP PROPERLY`. E caches the 30 in-game presets at login (`gas`) and has a template builder that previews the raw `cra` string. S has dashboard-side Virtual Presets. |
| Support tools and courtyard soldiers | | ● | ● | ● | ❌ | 3 support-tool slots and 8 courtyard slots in S and E. |
| Horse travel (coin or feather) | ● | ● | ● | ● | ✅ | `useCoin`, `useFeather`. C also offers horses paid with rubies. |
| Commander whitelist and priority | ● | ● | ● | ● | ✅ | `commanderWhiteList` ranges, backed by a TLA+-verified pool. B orders commanders by priority. |
| Commander gear: auto-equip, loadouts, optimiser | ● | ◑ | | ● | ❌ | E has an equipment optimiser: pick effects to maximise or cap, and it proposes 25 sets with an option to wear them. S Equipment Manager (BTH) builds speed or coin-cost loadouts. |
| Time-skip policy (types, amounts to keep, "smart skips") | ● | ● | ● | ● | 🟡 | `plugins/skips.js` has per-type toggles. Missing: how many of each skip to keep (C), spending the largest skips first and only for time above the free window (B). |
| Event difficulty and score shutoff | ● | ● | ● | ● | ✅ | E `autoEventDifficulty` picks the highest unlocked difficulty. |
| Event orchestrator with a time window | | | | ● | ❌ | E `crescita` turns event plugins on and off as events start and end, within a time window, and pauses barons and forts until a points threshold is reached. |
| Stop before the event ends | ● | | | | ❌ | |

### Economy and castle management

| Feature | C | S | B | E | GGE-BOT | Notes |
|---|:-:|:-:|:-:|:-:|:-:|---|
| Recruitment | ● | ● | ● | ● | ❌ | `barracks.js` was deleted (commit cba9d0c); E kept it, and it pauses when food goes negative. C and S use stock targets counted across the whole account. |
| Tool production | ● | ● | ● | ● | ❌ | Locale keys `toolsmith` and `buyTools` are orphaned. E builds tools only at the researched level. |
| Buying tools (armourer), coin-overflow burn | ● | ● | | ● | ❌ | S spends coins on tools before they pass the 2.147 billion coin cap and are lost. |
| Crafting: refinery, toolsmith, dragon buildings | ● | ◑ | ● | | ❌ | |
| Hospital healing | ● | ● | ● | ● | ❌ | `hospitalInventory` is parsed in `protocols.js` but never used. |
| Building goals and upgrades | ● | ● | | | ❌ | `removeBuildings.js` was deleted. |
| Wall and gate ring levels, repair order, repair through alliance help | ◐ | ● | | | ❌ | S knows about the game's ~3 h throttle on alliance-help requests. |
| Decoration storage and layouts, construction items | ● | ◑ | | | ❌ | S keeps temporary castle items alive and stores or places decorations. |
| Food and mead balance across kingdoms | ● | ◑ | | | 🟡 | Mead to Storm only. S Food Manager rescues a kingdom main below N hours of food from the best donor castle. |
| Moving resources between castles or kingdoms | ● | ● | ● | | ❌ | Only the Storm routes above. |
| Feasts | ● | ◑ | | ● | ✅ | `plugins/feast.js`, based on food thresholds. |
| Selling equipment and gems | ● | ◑ | | ● | ✅ | `plugins/sellStoredEquipment.js` keeps relic, unique and set items. S: Keep / Sell / Forge per rarity with about 30 relic-bonus protections. E previews relic and gem scrap rules before selling. |
| Forging equipment | | ◑ | | | ❌ | |
| Event and blacksmith shop rules | ● | ● | | | ❌ | S has 4 launch rules, currency floors, per-event spend caps and a catalogue that can be edited offline. |
| Personal ruby-offer buyer | ● | ● | | | ❌ | |
| Keeping boosters, overseers and the speed booster active | ● | ◑ | ● | ● | ❌ | S per booster: Off, Keep active, or Buy on sale only, with a ruby floor. E `supervisori` renews overseers under 14 days, plus `buySpeedGlobalEffect`. |
| Wheel, gacha and fortune-teller spins | ● | ● | | ● | 🟡 | `misc.js` takes the Fortune Teller only (event 117, when rubies ≥ 100). E `eventogacha` opens tickets at a set time or N minutes before the event ends. |
| Daily login bonus and tax | ● | | | ◐ | ✅ | `plugins/loginBonus.js` and `plugins/taxCollector.js` (commit 3819786). `misc.js` completes 7 fixed quests. C also collects alliance and VIP rewards. E has `raccogliCittadini` (collect citizens) and `autoOpenChests`. |
| Mailbox cleanup | | ◑ | | ● | 🟡 | `misc.js` deletes only message type 67. S deletes "no battle" and NPC reports and never touches player or spy reports. |
| Bring troops home before events | ● | | | | ❌ | C uses the game's event forecast and moves troops 18 h ahead. |

### Alliance and social

| Feature | C | S | B | E | GGE-BOT | Notes |
|---|:-:|:-:|:-:|:-:|:-:|---|
| Answering alliance help requests | ● | | ● | ● | ✅ | `plugins/helpRequests.js`. E also asks the alliance to put out fires (`spegniFiamme`). |
| Alliance chat in the dashboard or Discord | | ◑ | | ● | 🟡 | `plugins/discord/chat.js` loads only when `DISCORD_TOKEN` is set. E shows chat per castle and can send. |
| In-game mail from the dashboard | | | | ● | ❌ | |
| Discord incoming-attack alerts | ● | ◑ | | ◐ | 🟡 | `plugins/discord/incomingAttacks.js` exists, but in the new stack `apps/runner/src/supervisor.ts` never passes `discordData`, and the `discord_links` table is unused. C updates one card per castle live and pings a backup role. |
| Discord slash commands | ● | | | ◐ | 🟡 | `slashCommands.js` (rankings) runs only on the legacy host; the runner doesn't load it. C has `/status`, `/link`, `/boost`. |
| World intel, leaderboards, history | ● | | | ● | 🟡 | Ranking slash commands only. E has an alliance leaderboard by power or event. |
| PvP coach and shared PvP leaderboard | ● | | | | ❌ | |

### Platform, dashboard and safety

| Feature | C | S | B | E | GGE-BOT | Notes |
|---|:-:|:-:|:-:|:-:|:-:|---|
| Several game accounts per login | ● | ● | | ● | ✅ | `users.max_bots`; event twins run free. E caps each account at one castle. |
| Share a game account with other users | ◐ | ◑ | | | ❌ | S grants rights one by one (read, settings, commanders, Discord, start/stop) and has a "hands off" lock while the owner plays. C's JS bundle has a role that cannot start or stop. |
| Live castle view: troops, resources, queues | ● | ◑ | | ● | 🟡 | The worker already sends `bot_status.resources` (cash, gold, aqua, food, mead, `attackDailyCount`), but no UI shows it. E's castle page shows the economy, commanders 1–50, overseers, production per castle and events, all live. |
| Movement map, incoming and outgoing attacks | | | | ● | ❌ | |
| Logs | ● | ● | | ● | ✅ | `LogsPanel`. C and S filter by level, source and result and follow logs live. E has a live terminal per castle. |
| Stats and history (hits today, might, event scores) | ● | ● | | ● | 🟡 | Run history plus Grafana (operations only). Players see no game stats. E shows the top server error codes. |
| Status and waiting reason per routine | ● | | | ◐ | ❌ | C shows lines like "Waiting · no free commander". E splits severe errors from the game's "not now" replies. We show status only for the whole account. |
| Setup guidance: checklist, recommended setup, wizard, config linter | ● | | | ● | ❌ | C has Simple vs Advanced mode and readiness checks. E has a 4-question configurator, a config linter, profiles F/M/A, and symptom → fix checklists. |
| Run for a set time | ● | | | ● | ✅ | `plugins/shutoffTimer.js` (whole bot only). |
| Weekly calendar or run windows | ● | | | ● | ✅ | Schedule windows with daily jitter (commit fc9f7cf, `ScheduleEditor.tsx`, `packages/contracts/src/schedule.ts`). E `pianoOrari` is per plugin; ours covers the whole bot. |
| Import, export and copy settings | ● | | ● | ● | ❌ | E saves, loads, and copies a castle's config to other castles. Our data export (commit 62e6104) is a GDPR dump, not a settings import. |
| Edit settings while the bot is offline | ● | ● | ● | | ✅ | Config is stored in the database and pushed to the running worker. |
| In-app and email bot alerts | | | | | ✅ | Notifications bell plus `apps/api/src/services/notification-mailer.ts` (commit e729f8c). **No competitor sends email.** |
| Personal Discord bot alerts | | ◑ | | ◐ | ❌ | S per account: webhook and/or DM, 8 event types, and an opt-in stats card. |
| User-set reconnect delay | ● | ◑ | ● | | 🟡 | The supervisor backs off from 5 s to 5 min; users cannot change it. S's main server waits 180 s between tries, and its event server makes 4 tries with a growing delay. |
| Safety lock that pauses after rejections | ● | ◑ | | | 🟡 | Halts after 3 rejections in a row or `ATTACK_TOO_MANY_UNITS`, but stops the whole attack queue instead of one routine. S stops a module after N refusals in 24 h and offers "Keep stopped" or "Bypass and restart". |
| Humanized client behaviour (ping jitter, real client build, map scan pattern) | | | | | ✅ | Opt-in flags (commits c7e11e4, 04668c8). No competitor exposes anything like it. |
| Proxies | | | | | ✅ | Admin-managed proxy pool (commit 6340886, `packages/bot-core/proxy.js`). No competitor offers proxies. |
| Raw traffic view | | | | ● | ❌ | E has a packet sniffer page, off by default. Admin or dev use only. |
| UI languages | ● (5) | | | ● (5) | ✅ | 6 locales in bot-core. |
| Trial, self-serve billing, referral | ● | ● | | ● | ❌ | See the pricing section. |
| Event-server (twin) handling | | ● | | ● | ✅ | `apps/runner/src/event-server.ts`. |
| Social or passkey sign-in | ● | ● | | | 🟡 | Email and password with Turnstile only. C uses passkeys, Google and Discord; S uses Discord. |
| Two-factor sign-in for players | | | | | 🟡 | Admins only. No competitor offers it to players. |
| Server list coverage | ● | ● | | ● | ? | Our servers live in the database `servers` table. Check them against the 39 worlds in [empirebot.md](competitors/empirebot.md) and [citadelops.md](competitors/citadelops.md); EmpireBot lists the `EmpireEx_N` zone names. |

## Where GGE-BOT is ahead

- **Email and in-app bot alerts.** Competitors only use Discord, and E's bell does nothing visible.
- **Pacing and humanization.** Box–Muller or log-normal delays, a send rate of 5 per second, ping jitter, the real client build at login, and a nearest-first map scan. Squire and the Config Builder expose no humanization. E has an `antiBan` plugin with no visible options.
- **Proxies and run windows with daily jitter.** No competitor offers proxies. C and E have calendars, but without jitter.
- **Security and operations.**
  - Game passwords are sealed so only the runner can read them.
  - Prometheus and Grafana alerting, and crash-loop handling.
  - Admin two-factor sign-in, and an audit log.
  - E serves each customer's dashboard over plain HTTP on a raw IP, with a cookie UUID as the only auth.
- **Player data controls.** Change email, export data, and self-delete.
- **Free rides for event-twin accounts** on the main account's plan.

## Biggest gaps, by how many competitors have them

All four competitors have:

1. **Attack presets and a fuller wave builder.** Fortresses, Berimond and Khan defense all depend on them.
2. **Recruitment and tool production.** E still has the `barracks` plugin we deleted.
3. **Hospital healing.** The data is already parsed.
4. **Battle for Berimond.** E still has the plugin we deleted.
5. **Keeping boosters and overseers active.**

Three of the four have:

6. **Crafting** (C, S, B).
7. **Storm Islands logistics and building** (C, S, B).
8. **Foreign Lords and Bloodcrow invasions** (C, S, E).
9. **Incoming-attack defense: station, flee, gates** (C, S, E).
10. **Commander gear and loadouts** (C, S, E).
11. **A dashboard showing game data** (C, S, E). The data is already sent and only needs to be displayed.

Two of the four have:

12. **Building goals and repair** (C, S).
13. **Shop and ruby-offer rules** (C, S).
14. **Daimyo** (S, E).
15. **Setup guidance: wizard, linter, recommended setups** (C, E).
16. **Discord alerts in the new runner** (C, S). The plugins exist; only `discordData` is missing from the worker data.

Items 11 and 16 are cheap, because the groundwork is already in the repo. Items 2 and 4 can start from our own git history (commits cba9d0c and 33d8642).

## Limits of this research

- **CitadelOps.** The Command Center was not reached. A ● for C means "documented in CitadelOps's official signed-in guide", not "seen working".
- **The Squire Bot.** ◑ rows were read from the site's client JS. Lists the server sends at runtime (full unit and tool lists, crafting recipes) are not in that JS. A Squire username for the supplied real account would allow rendered screenshots of these pages.
- **EmpireBot.** Only the `full` tier was seen. Which plugins `lite` hides, and which values the operator pins, is unknown. No plugin was run, so its runtime behaviour is unverified.
- **Config Builder.** It covers one bot's settings schema. The Python bot it configures was not available. 20 settings in its example config are hidden from the page, and only 3 of them could be identified.
- **GGE-BOT column.** It reflects the repo as of commit 3819786 (2026-11-17).
