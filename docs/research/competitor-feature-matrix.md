# Competitor feature matrix

This document compares GGE-BOT with four other Goodgame Empire bots, feature by feature. For each feature it records whether this repo has it fully, partly or not at all, and points to the code.

Researched 2026-11-16. The detailed per-site reports are in [competitors/](competitors/).

## How the research was done

- One research agent explored each site with a headless browser.
- **Read-only.** The agents created no automations, presets or attacks, saved no settings, and linked no game accounts.
- **No supplied logins.** The EmpireBot credentials that were supplied belong to a third party, so they were not used.
- **Disposable accounts** were made where a sign-in revealed more. They are stored in the gitignored `credentials/inspirations.json`, and are not in this repo.
- **Game login wall.** Every hosted bot hides its per-account control panel until a real GGE login is linked. So most competitor settings come from their official guides, inline help text and settings dialogs opened without a linked account. None of their paid behaviour was verified in game.

| Site | What it is | What could be seen |
|---|---|---|
| [CitadelOps](competitors/citadelops.md) (citadelops.app) | Hosted cloud bot for GGE and Empire: Four Kingdoms | Public site, plus the full signed-in setup guide (about 25 routines, setting by setting). Control panel gated. |
| [The Squire Bot](competitors/squirebot.md) (thesquirebot.com) | Hosted cloud bot | Dashboard with about 30 modules; many config dialogs open without a game account. Per-account pages gated; BTH and Outer Realms add-ons locked in the trial. |
| [Bot Config Builder](competitors/netlify-config-builder.md) (netlify) | Static config generator for a self-hosted Python bot that is not published | Everything, because there is no backend. Settings only, nothing about how the bot behaves at runtime. |
| [EmpireBot](competitors/empirebot.md) (empirebot.win) | Small Italian hosted bot; the panel looks like it has about 13 users | Only sign-up, the add-castle form and the server list. Every bot feature is gated. |

## Pricing and business model

| | CitadelOps | Squire Bot | Config Builder | EmpireBot | GGE-BOT |
|---|---|---|---|---|---|
| Trial | 7 days per game account, all features, starts at first game login | 2 days of the Green plan, without the BTH and Outer Realms modules | n/a (free) | 4 days, starting when the first castle is linked | None |
| Price | $20 for 30 days per account; $75 for 5, $100 for 10 | Green 12 credits, BTH +4 credits; price per credit not public | Free | Not published | Plans set by an admin (`users.max_bots`) |
| Checkout | Manual, via Discord | Manual, via Discord | — | Manual ("contact us") | None |
| Extras | Credits never expire, can be transferred, auto-renew, referral code | Limit on how many accounts run at once | — | — | — |
| Community size | Discord, about 100 members | Discord, about 490 members | None | None | — |

Nobody has a self-serve checkout. Payment and a free trial are an open opportunity, not a gap where we are behind.

## Legend

**Competitor columns** (C = CitadelOps, S = Squire Bot, B = Config Builder):

- ● seen in the UI or the signed-in guide
- ◐ advertised only, behind a game login or a paid plan
- blank: not offered or not seen

EmpireBot is left out of the matrix because none of its features could be seen.

**GGE-BOT status:**

- ✅ Implemented and covers the core of what competitors offer.
- 🟡 Partial: the feature exists but lacks notable options or behaviour that competitors have. The gap is described in the Notes column.
- ❌ Not implemented.

## Feature matrix

### Attacks and events

| Feature | C | S | B | GGE-BOT | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Robber-baron / kingdom tower attacks | ● | ◐ | ● | ✅ | `plugins/attack/attackBarrons*.js`, 4 kingdoms. Missing: scan radius with a preview of towers in range (C: up to 1,820 tiles), waves up to 30 (C), "maiden-supported only" (C). |
| Force-level towers | ● | ◐ | | 🟡 | `upgradeTowers` option in the baron plugins. No separate levelling mode. |
| Kingdom fortresses (Glacier / Sands / Peaks) | ● | ● | ● | 🟡 | `attackFortresses*.js` exposes only `commanderWhiteList`. Missing: per-kingdom hit limits (S), per-kingdom presets (S, B), distance (B), automatic Direwolf buying (C), picking the fastest commander per fort (C). There is no Great Empire fortress plugin. |
| Reserve commander for a fort that is about to free up | | ● | ● | ❌ | The commander pool (`plugins/commander.js`) has no reservation. |
| Nomad / Samurai camps | ● | ● | | ✅ | `attackNomads.js`, `attackSamurai.js`: difficulty, score shutoff, chests. Missing: advisor attacks (C), skip mode on one camp at fixed coordinates (S), camp management (C). |
| Daimyo | ◐ (coming soon) | ● | | ❌ | `AreaType.daimyoCastle` is defined but unused. |
| Khan | ● | ● | | 🟡 | `attackKhan.js` has the rage trigger and score shutoff. Missing: automatic defense presets and tools (C, S), tablets-only mode and rage optimiser (S), pause after N taunts (S), medal shop (S), cap on the rage chain (C), stop before the event ends (C). The legacy README admits "does not replenish your defences". |
| Foreign Lords / Bloodcrow invasion | ● | ● | | ❌ | Locale keys `attackForeign` and `attackBloodcrows` are orphaned; `AreaType.bloodcrowCastle` is unused. |
| Glory event attacks with banner and chest pick lists | | ● | ● | ❌ | S and B both have ordered banner/chest lists and per-wave templates. |
| Dethrone with a ruby cap | | ● | ● | ❌ | B shows the ruby cost of every dethrone level. |
| Berimond Invasion (red/blue camps) | | ● | | ✅ | `attackBerimondInvasion.js`: reputation, no event tools, low-value chests. Missing: choosing the camp side (S). `wavesTillChests` is declared but never read. |
| Battle for Berimond: towers, troop sending, camp builder | ● | ◐ | ● | ❌ | `berikingdom.js` was deleted (commit 33d8642). B can also unlock Berimond, choose a camp and build tents, HQ and training grounds. |
| Berimond PvP (player camps) | ● (beta) | ◐ | | ❌ | |
| Storm Islands forts | ● | ● | ● | ✅ | `attackStormForts.js`: easy and hard per level. Missing: map-coverage view (C), priority by distance (S), minimum troops kept after launch (C). |
| Storm aquamarine shop | ● | ● | | ✅ | `buyCoins`, `buyDecoration`, `buyXP`. S also buys 5 h and 24 h skips and dummy peasants, and lets you choose the decoration. |
| Feed resources, food and mead into Storm | ● | ● | ● | 🟡 | `meadReplaceStorm.js` sends mead only. `resourceSendStorm.js` sends Storm wood and stone *out* to other castles. No thresholds, reserves or choice of source castle. |
| Send troops and tools to Storm | ● | ● | ● | ❌ | |
| Storm castle building (keep, storehouse, ships, demolish, blueprint) | ● | ● | ● | ❌ | `upgradeStormForts` depends on `plugins-extra/upgradeStormCargo.js`, which is not in the repo. |
| Rift Raid (alliance boss) | ● | ● | | ❌ | S coordinates many accounts in groups and has "Retreat all". |
| Beyond the Horizon / Outer Realms | | ◐ (paid add-on) | | ❌ | Only event-twin login handling exists (`apps/runner/src/event-server.ts`). |
| Manual attacks on alliance targets (spy, then attack) | ● | | | ❌ | |
| Incoming-attack defense: evacuate, gates, recall | ● | ◐ | | ❌ | C "Auto Station", S "Alert + Autostation". |
| Sheltering troops with allies on a random timer | ● | | | ❌ | C "Auto Bird", with presets per calendar period. |
| Monitor captured assets | | ◐ | | ❌ | |
| Support Empire: Four Kingdoms | ● | | | ❌ | |

### Attack engine and commanders

| Feature | C | S | B | GGE-BOT | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Random delay between attacks | ● | | | ✅ | `attack.js`: Box–Muller value, base 15–600 s plus variance 10–600 s, doubled after a rejection. C's minimum is 4 s. |
| Daily attack cap | ● | | ● | ✅ | `attackLimit`, default 3500; event twins are exempt. C and B use 3,500–4,700. |
| Hourly caps per bot, kingdom or level | | | ● | 🟡 | Fixed at 120 attacks/hour globally; users cannot change it. |
| Attack priority across modules | ● | | | 🟡 | One shared queue exists, but users cannot order modules. C lets users drag-to-reorder, and older work rises in priority as it waits. |
| Automatic wave builder | ● | ● | ● | 🟡 | `attackLeft/Middle/Right/Courtyard`, `attackWaves`, `foodTroopsOnly`. Missing: unit order (fastest, strongest or weakest first), mead-only troop supply, a per-wave tool policy (S, B). |
| Attack presets (in-game slots 1–30 or saved on the dashboard) | ● | ● | ● | ❌ | No preset support. `attack.js:112` has `RW: //TODO: SET THIS UP PROPERLY`. |
| Support tools and courtyard soldiers | | ● | ● | ❌ | |
| Horse travel (coin or feather) | ● | ● | ● | ✅ | `useCoin`, `useFeather`. C also offers horses paid with rubies. |
| Commander whitelist and priority | ● | ● | ● | ✅ | `commanderWhiteList` ranges, backed by a TLA+-verified pool. B orders commanders by priority. |
| Commander gear auto-equip, loadouts, legend-skill presets | ● | ◐ | | ❌ | |
| Time-skip policy (types, amounts to keep, "smart skips") | ● | ● | ● | 🟡 | `plugins/skips.js` has per-type toggles. Missing: how many of each skip to keep (C), spending the largest skips first and only for time above the free window (B). |
| Event difficulty and score shutoff | ● | ● | ● | ✅ | |
| Stop before the event ends | ● | | | ❌ | |

### Economy and castle management

| Feature | C | S | B | GGE-BOT | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Recruitment | ● | ● | ● | ❌ | `barracks.js` was deleted (commit cba9d0c). C and S use stock targets counted across the whole account. |
| Tool production | ● | ● | ● | ❌ | Locale keys `toolsmith` and `buyTools` are orphaned. |
| Buying tools (armourer), coin-overflow burn | ● | ● | | ❌ | S spends coins on tools before they pass the 2.147 billion coin cap and are lost. |
| Crafting: refinery, toolsmith, dragon buildings | ● | ● | ● | ❌ | |
| Hospital healing | ● | ● | ● | ❌ | `hospitalInventory` is parsed in `protocols.js` but never used. |
| Building goals and upgrades | ● | ● | | ❌ | `removeBuildings.js` was deleted. |
| Wall and gate ring levels, repair order, repair through alliance help | ◐ | ● | | ❌ | |
| Construction items, saved decoration layouts | ● | | | ❌ | |
| Food and mead balance across kingdoms | ● | ◐ | | 🟡 | Mead to Storm only. |
| Moving resources between castles or kingdoms | ● | ● | ● | ❌ | Only the Storm routes above. |
| Feasts | ● | ◐ | | ✅ | `plugins/feast.js`, based on food thresholds. |
| Selling equipment and gems | ● | ◐ | | ✅ | `plugins/sellStoredEquipment.js` keeps relic, unique and set items. |
| Forging equipment | | ◐ | | ❌ | |
| Event and blacksmith shop rules | ● | ● | | ❌ | S has 4 launch rules, currency floors, per-event spend caps and a catalogue that can be edited offline. |
| Personal ruby-offer buyer | ● | ● | | ❌ | |
| Keeping boosters, specialists and the 50% speed booster active | ● | ◐ | ● | ❌ | |
| Wheel, gacha and fortune-teller spins | ● | ● | | 🟡 | `misc.js` takes the Fortune Teller only (event 117, when rubies ≥ 100). |
| Daily login, alliance and VIP rewards; tax | ● | | | 🟡 | `misc.js` completes 7 fixed quests. No daily rewards or tax. |
| Mailbox cleanup | | ◐ | | 🟡 | `misc.js` deletes only message type 67. |
| Bring troops home before events | ● | | | ❌ | C uses the game's event forecast and moves troops 18 h ahead. |

### Alliance and social

| Feature | C | S | B | GGE-BOT | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Answering alliance help requests | ● | | ● | ✅ | `plugins/helpRequests.js`. |
| Alliance chat bridge | | ◐ | | 🟡 | `plugins/discord/chat.js` loads only when `DISCORD_TOKEN` is set. S shows chat in its dashboard instead. |
| Discord incoming-attack alerts | ● | ● | | 🟡 | `plugins/discord/incomingAttacks.js` exists, but in the new stack `apps/runner/src/supervisor.ts:108` never passes `discordData`, and the `discord_links` table is unused. C updates one card per castle live and pings a backup role. |
| Discord slash commands | ● | | | 🟡 | `slashCommands.js` (rankings) never registers in the new stack. C has `/status`, `/link`, `/boost`. |
| World intel, leaderboards, history | ● | | | 🟡 | Ranking slash commands only. |
| PvP coach and shared PvP leaderboard | ● | | | ❌ | |

### Platform, dashboard and safety

| Feature | C | S | B | GGE-BOT | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Several game accounts per login | ● | ● | | ✅ | `users.max_bots`; event twins run free. |
| Live castle view: troops, resources, queues | ● | ● | | 🟡 | The worker already sends `bot_status.resources` (cash, gold, aqua, food, mead, `attackDailyCount`), but no UI shows it. |
| Logs | ● | ● | | ✅ | `LogsPanel`. C and S filter by level, source and result and follow logs live; we did not check whether ours matches. |
| Stats and history (hits today, might, event scores) | ● | ● | | 🟡 | Run history plus Grafana (operations only). Players see no game stats. |
| Status and waiting reason per routine | ● | | | ❌ | C shows lines like "Waiting · no free commander". We show status only for the whole account. |
| Setup checklist, recommended setup, Simple vs Advanced mode | ● | | | ❌ | |
| Run for a set time | ● | | | ✅ | `plugins/shutoffTimer.js` (whole bot only). |
| Weekly calendar or run windows | ● | | | ❌ | The `game_accounts.schedule` column exists but nothing uses it; `intervalTimer.js` was deleted. |
| Import and export settings | ● | | ● | ❌ | |
| Edit settings while the bot is offline | ● | ● | ● | ✅ | Config is stored in the database and pushed to the running worker. |
| In-app and email bot alerts | | | | ✅ | Uncommitted work: notifications bell plus `notification-mailer.ts`. **No competitor sends email.** |
| Personal Discord bot alerts | | ● | | ❌ | |
| User-set reconnect delay | ● | | ● | 🟡 | The supervisor backs off from 5 s to 5 min; users cannot change it. |
| Safety lock that pauses after unknown rejections | ● | | | 🟡 | Halts after 3 rejections in a row or `ATTACK_TOO_MANY_UNITS`, but stops the whole attack queue instead of one routine for a set time. |
| Proxies | | | | ❌ | No competitor offers them either. |
| UI languages | ● (5) | | | ✅ | 6 locales in bot-core. |
| Trial, self-serve billing, referral | ● | ● | | ❌ | See the pricing section. |
| Event-server (twin) handling | | ● | | ✅ | `apps/runner/src/event-server.ts`. |
| Social or passkey sign-in | ● | ● | | 🟡 | Email and password with Turnstile only. C uses passkeys, Google and Discord; S uses Discord. |
| Two-factor sign-in for players | | | | 🟡 | Admins only. No competitor offers it to players. |
| Server list coverage | ● | ● | | ? | Our servers live in the database `servers` table. Check them against the 39 worlds in [empirebot.md](competitors/empirebot.md) and [citadelops.md](competitors/citadelops.md); EmpireBot lists the `EmpireEx_N` zone names. |

## Where GGE-BOT is ahead

- **Email and in-app bot alerts** (once the uncommitted work ships). Competitors only use Discord.
- **Pacing.** Box–Muller delays, a send rate of 5 per second, and caching of map lookups. Squire and the Config Builder expose no humanization at all.
- **Operations.** Prometheus and Grafana alerting, crash-loop handling, and game passwords sealed so that only the runner can read them.
- **Admin two-factor sign-in, and an audit log.**
- **Free rides for event-twin accounts** on the main account's plan.

## Biggest gaps, by how many competitors have them

1. **Attack presets and a fuller wave builder.** All three competitors with visible settings have them, and many features depend on them (fortresses, Berimond, Khan defense).
2. **Recruitment and tool production with stock targets.** All three.
3. **Crafting and the hospital.** All three.
4. **Storm Islands logistics and building.** All three: sending troops, tools and resources in, plus cargo ships and the keep.
5. **Battle for Berimond.** All three.
6. **Foreign Lords and Bloodcrow invasions.** C and S.
7. **Incoming-attack defense (evacuate, gates).** C and S.
8. **Building goals and repair.** C and S.
9. **Shop and ruby-offer rules.** C and S.
10. **A dashboard showing game data.** The data is already sent and only needs to be displayed.
11. **Run windows (calendar).** The schema column already exists.
12. **Discord alerts in the new runner.** The plugins exist; only `discordData` is missing from the worker data.

Items 10–12 are cheap, because the groundwork is already in the repo.

## Limits of this research

- Competitor control panels were not reached, because every hosted bot needs a real GGE login. A row marked ● for C means "documented in CitadelOps's official signed-in guide", not "seen working".
- EmpireBot's features are unknown. Seeing them would need a throwaway GGE account, or the account owner's consent to use the supplied login.
- The Config Builder covers only one bot's settings schema. The Python bot it configures was not available. 20 settings that its example config contains are hidden from the page, and only 3 of them could be identified.
- The Squire Bot trial did not include the BTH and Outer Realms modules, so those are known only from marketing text.
