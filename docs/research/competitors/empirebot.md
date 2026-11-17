# EmpireBot (empirebot.win): competitive research

Researched 2026-11-16 and 2026-11-17 with two accounts:

- **A real customer account** on the `full` tier, with one GGE castle linked (`xxton618xx`, server IN, level 1020). This account reached the bot dashboard.
- **A disposable account** that is verified, has no castle linked, and has not started its trial.

Every non-GET request was blocked in the browser, except the panel login. The only WebSocket frames allowed out were the app's own log reads (`GetLogs`). Dialogs, tabs and dropdowns were opened and closed. Nothing was saved, toggled, started or linked. `/admin.html` was not opened.

Screenshots, page text and the route-by-route audit are in [`.audit/empirebot/`](../../../.audit/empirebot/README.md). Shot numbers below refer to `.audit/empirebot/shots/`.

## Summary

- **Product.** A small Italian hosted bot for Goodgame Empire. There are three parts:
  - `empirebot.win` is a one-page "site coming soon" splash. Its only button is "ENTRA NEL PANNELLO".
  - `panel.empirebot.win` is the customer panel. It has login and register, access expiry, your castles, "+ Aggiungi castello" and change password.
  - The bot dashboard is a React SPA served by **a separate container for each customer, on a raw IP and port over plain HTTP** (`http://213.136.88.65:8052`). "Apri dashboard" goes to `/entra?uuid=<uuid>`, which sets a `uuid` cookie. That cookie is the only auth on the dashboard.
- **Hosting model.** You link a castle in the panel with a server, your GGE username and your GGE password. The operator runs a bot instance for your account and records it on your subscription (`istanza_porta: 8052`, `istanza_username: cliente10`). The bot logs in server-side and runs 24/7. Nothing is installed locally.
- **It is a fork of GGE-BOT, our own codebase.**
  - The WebSocket `ActionType` values 0–19 match `packages/bot-core/actions.json` exactly.
  - Frames use the same `[error, action, data]` layout. For example, the castle terminal sends `[0,5,{id,name}]` for `GetLogs`.
  - Plugin names match ours (`attackBarronsFirePeaks`, `sharedBarronAttackLogic`, `sellStoredEquipment`, `ggeBot`).
  - The attack payload carries a `"GGEBOT":{"version":1}` block.
  - They added action types 20–50: attack, spy, event and error logs, blacklist, stats, an attack queue, profiles, auto-tune with rollback, plugin states, and "AI proposal" approve and reject.
- **Tiers: `super`, `full` and `lite`.**
  - The in-app glossary says the tier "decides which plugin pages you see".
  - The dashboard code also lets the operator fix plugin option values and min/max limits for non-super tiers: "Fixed values set by the administrator: editable only with the super tier".
  - Only `full` (the real account) and `trial` (the disposable account) were observed.
- **Trial.** 4 days, starting when you link your first castle, not at sign-up. The banner reads "collega il tuo primo castello per attivare 4 giorni gratis". The real account's record matches this: created 2026-11-04, trial ended 2026-11-08, then `full` until 2026-12-08.
- **Pricing.**
  - There are no public prices.
  - Since 1 November 2026 access has an expiry date, and the banner says "Per estenderlo contattaci" (contact us to extend). No contact channel is listed anywhere.
  - Every account record has a `paypal_subscription_id` field. It is empty on both accounts, so PayPal billing looks planned but not live.
  - **Each account may link one castle** (`max_castelli: 1` on both trial and full). The full account shows "Hai raggiunto il numero di castelli permessi per il tuo account. Scrivici per sbloccarne altri" (you have reached your castle limit; write to us to unlock more). The linked castle shows "INCLUSO".
- **Scale.** Very small. The real account is user id 10 with instance `cliente10`. The disposable account, created 2026-11-16, is user id 13. That suggests about 13 registered users. There are no docs, FAQ, changelog, Discord, YouTube or social links. A web search found nothing.
- **Version.** The dashboard reports `{"tier":"full","version":"2.0.024","scadeIl":"2026-12-08"}` from `/api/info`. This was unchanged between the two passes.

## Dashboard navigation

- **Sidebar:** Dashboard, Castelli, Plugin, Castello (movement map), Chat coa, Posta, Statistiche, Logs, Builder Attacchi, Preset Gioco, Biglietti eventi, Biglietti neri, Classifica coa, Equipaggiamento, Strumenti.
- **Configurazione group:** Profili (F/M/A), Info / Guida, Impostazioni.
- **Routes not in the sidebar:** castle detail, castle errors, castle monitor, saved builder templates, combat calculator, traffic sniffer.
- **Header:**
  - Cmd+K palette with navigation actions, castles and plugins (57–58)
  - Sub-user activation scheduler (54)
  - Notifications bell (55)
  - Theme toggle
  - Avatar menu (56)
- **Footer:** "Connesso al bot · 127.0.0.1:3001" and a floating "LIVE · ✓ BOT" pill.

## Feature inventory

Free/Paid key:

- **Free:** available in the panel without a trial.
- **Full:** seen on the paid `full` tier. The trial presumably unlocks the same features, but this was not verified because the disposable account has no castle.
- **Tier-dependent:** the tier decides which plugin pages exist, and non-super tiers can have operator-fixed values. Which plugins belong to `lite` is unknown.

| Category | Feature | Options seen | Free/Paid | Evidence |
|---|---|---|---|---|
| Account/billing | Sign-up and email verification | Email, password and confirmation (min 8 characters). The verification link comes from `no-reply@empirebot.win` and expires after about 48 h. Until you verify, a banner says you cannot link castles, with a "Rinvia email" (resend) button | Free | Panel UI, first pass |
| Account/billing | Trial and expiry | "PROVA GRATUITA" badge. 4-day trial from the first castle link. The account page shows the days left ("21 giorni rimanenti (scade il 08/12/2026)"). You extend access by contacting the operator. A PayPal subscription field exists but is unused | Trial free; extension paid (manual) | disposable-01, 45, `/api/auth/me` |
| Account/billing | Castle limit | One castle per account on both trial and full. "Scrivici per sbloccarne altri" | Paid to raise (manual) | 45 |
| Account/billing | Change password, logout | Current password, new password, repeat | Free | disposable-03 |
| Account linking | Add castle | Server dropdown with 39 zones, "Nome castello (username GGE)" and password. The zones, with the N of their `EmpireEx_N` instance: AE 33, ARAB 35, ASIA 36, AU 22, BG 16, BR 20, CN 27, CZ 4, DE 2, EG 34, ES 8, ES 38, FR 3, GB 19, GR 28, HANT 37, HIS 25, HU 12, HU 17, IN 26, INTERNATIONAL (plain `EmpireEx`, 7, 43), IT 9, JP 24, KR 23, LT 29, NL 11, PL 5, PT 6, RO 15, RU 14, SA 32, SK 18, SKN 13, TR 10, US 21, WORLD 46, WORLD 49 | Free (starts trial) | disposable-02 |
| Account linking | Change credentials | 🔑 Credenziali dialog on the castle page. The GGE username is prefilled and the new password is blank ("leave empty to keep") | Full | 53 |
| Multi-account | Castle list | Counters: main, ghost, online, peace, error, offline, inactive. Tabs: Principali, 👻 Ghost, Archiviati. Filters: All, Online, Pace, Errori, Offline, plus search. Avvia tutti, Ferma tutti, Nuovo castello, Collega Discord. Per-castle stop, ghost and archive buttons | Full | 05 |
| Multi-account | Sub-user activation schedule | Header 🕒 dialog. Pick a date and time and one or more sub-users, with an "only event sub-users (OR/BTH)" filter and a note, then "Salva su disco". Lists programmed schedules | Full | 54 |
| Dashboards | Main dashboard | Live, Ieri and Settimana tabs. KPIs: castles online, attacks 24h, errors 7d, spies 7d. Hourly chart, Top Castelli, recent activity. **The chart and the activity feed are hard-coded demo data** ("Demo-FR", "Demo-DE") | Full | 04 |
| Dashboards | Castle overview | Live, refreshed every 2 s. Level, attacks today, attacks/h, power, coins and rubies with deltas, troops (total, attack, defence), tools (attack, defence), incoming attacks, incoming Khan fury, outgoing attacks, commanders free and out of 50, barons ready, feathers, relic shards, and time skips 1m–24h | Full | 30, 46 |
| Dashboards | Overseers | Each overseer (wood, stone, food, honey, mead, meat, plunder, toll, instructor) with time left or "scaduto" (expired), and a per-overseer auto-buy toggle that renews under 14 days with rubies. Warning: "the game never asks for confirmation on rubies" | Full | 47 |
| Dashboards | Defence history | Flee and gate-open history over 14 days. Counters for requests sent and severe vs. "bot" errors, with a reset button | Full | 47 |
| Dashboards | Production per castle | One tab per castle, outpost and kingdom. Stock and net/h for each resource, with negative food in red. Recruitment status | Full | 48 |
| Dashboards | Global materials, construction and events | Upgrade materials (screws, gunpowder, saws and so on), construction tokens and coins, rare materials, Samurai and Khan currencies, and the events you play, with points and time left | Full | 49 |
| Commanders | Commander grid | Commanders 1–50, each marked home or out ("50 totali · 42 fuori · 8 a casa"). Plugins pick commanders with a whitelist such as "33-45" | Full | 50, 71 |
| Dashboards | Live monitor | Polls `/api/state` every 5 s. Castles, movements, incoming, outgoing, important errors, requests sent. Running events (28) with points and countdown. Castle table, incoming attacks, outgoing movements | Full | 32 |
| Dashboards | Movement map | Canvas map for each castle and kingdom, with zoom, fit, a "solo i miei" (mine only) filter and a legend. Below it is a movement list | Full | 07, 67 |
| Plugins | Castle × plugin matrix | 64 plugin rows, each with a dot to toggle. States: active, blocked by peaceGuard, off. Test files and internal modules are listed as plugins (`movementWorkflow.test`, `phase2Integration.test`, `MarchManager`) | Tier-dependent | 06, 66 |
| Plugins | Per-plugin options | Castle page plugin table by category, with x/y active counts. Each row has a **Configura** dialog: grouped options, an ⓘ help tip per option, and the raw option key shown under each label | Tier-dependent (super can edit fixed values) | 70–74 |
| Plugins | Profiles F/M/A | **F** Farm (barracks, toolsmith, feast, no PvP). **M** Medio (adds Nomads, Samurai, Khan, Daimyo, Storm forts, GE forts and barons). **A** Avanzato (adds foreign kingdoms, continuous spying, perpetualAttack). The "applied to 7/4/1 castles" counts are static | Full | 19 |
| Plugins | Config save, load and copy | Per castle: 💾 save the config, 📂 load a saved config, 📋 copy it to other castles. GGE credentials are never exported. Archive the castle, or delete it permanently | Full | 52 |
| Attacks: barons | attackBarrons × 4 kingdoms (GE, BS, EW, FP) | Horse: feathers or coins. Time skips, upgrade towers, wall tools, shields, dogs, food troops only. Flanks to attack (left, middle, right, courtyard). Commander whitelist, number of waves, target search radius (±X/Y). Formation mode (template) and template name. Delete reports | Full | 71 |
| Attacks: fortresses | attackFortresses × 3 kingdoms | Same plugin family as barons | Full | 66 |
| Attacks: event camps | attackNomads, attackKhan, khanDefence, attackSamurai, attackDaimyo, attackBloodcrows, attackForeign, attackBerimondKingdom, orPotenzaEntry (OR, EID 90) | "Soft" plugins (Nomads, Samurai) are separate from "hard" boss plugins (Khan, Daimyo). The event orchestrator never toggles the bosses | Full | 41, 72 |
| Attacks: PvP | perpetualAttack, sabotaggio, presaAvamposti (capture enemy outposts) | Marked 🚨 as peace-breaking across the UI. peaceGuard turns them off while the peace dove is up | Full | 41 |
| Events | **crescita** (event orchestrator) | Active, and dry-run. Turn plugins on and off with events. Let tickets run automatically. Log every change. Choose which events to manage: Berimond kingdom, foreigners, Nomads, Samurai, Berimond invasion, Bloodcrows. Times to re-check events. Restart on state change. **Event time window** (from, to). Pause barons and forts during the event until a points threshold is reached | Full | 72 |
| Events | Other event plugins | autoEventDifficulty (max unlocked difficulty), eventogacha (opens gacha tickets at a set time or N minutes before the event ends), spendAffluence, tempestaPunti, salaLeggende, kingdomLeague. Ticket histories on the Biglietti eventi and Biglietti neri pages | Full | 14, 15, 41 |
| Defence | **stationOnHit** (flee and reinforce) | Three modes: AUTO (nearest ally with peace ≥ N s), fixed coordinates per kingdom, ally name (legacy). Minimum attacker power, minimum troops in castle and in the attack, a minimum per troop type, stationing hours (12 free, more with feathers), commander whitelist, troop slots per commander (cap 10), max commanders in parallel (5), minimum ally peace seconds, prefer ally outposts. Separate toggles for main castles, outposts and captures. Attack troops only, or "walls only" defence. Early return when the horn fades. Flee X s before impact (minimum 20). Flee during server maintenance | Full | 73 |
| Defence | Other defence plugins | peaceGuard, autoOpenGates (rubies, 6h/12h, when a player attacks and the flee failed), hospital (fills heal slots), spegniFiamme (asks the alliance to put out fires), khanDefence | Full | 41 |
| Scheduling | **pianoOrari** | Weekly on/off: day checkboxes Mon–Sun, start time, end time, check every N minutes | Full | 74 |
| Scheduling | Other | shutoffTimer, the crescita event window, and the sub-user activation schedule | Full | 54, 72 |
| Anti-ban | antiBan plugin, throttling | antiBan is in the matrix. Commands are throttled because of the game's 30-minute flood lock. The attack-rate calculator in plugin options warns "under 4 s: the threshold beyond which bans are documented". No proxy or human-delay settings are visible | Full | 06, 43, bundle strings |
| Economy | Recruitment and production | barracks (multi-tier cascade, respects productionGuard), toolsmith, blacksmith, strumenti (tools at the researched level only), buyTools, feast, raccogliCittadini (collect citizens), supervisori (renew overseers with rubies), buySpeedGlobalEffect, autoOpenChests, skips. Recruitment pauses when food goes negative | Full | 41, 43 |
| Equipment | Equipment optimiser and scrapping | Commander or castellan. Old, ARE, Relic or New sets. Tick effects to maximise and effects to cap (about 18 groups). Proposes 25 sets, with search depth 8, 12, 16 or 20, optionally including gems. Relic and gem scrapping use AND-ed criteria (wall/gate/moat effects, plunder, travel speed, under N stars and so on), with a "Guarda chi colpisce" preview before selling. sellStoredEquipment sells normal pieces | Full | 17, 69 |
| Attack builder | Attack template builder | One template per sub. Kingdom, target, description. Modes: Auto, Template or Game preset (in-game slots 1–30). "Manda esatto" (send exactly, no clamping), copy last wave, fill to commander cap (experimental). Wave editor with left, middle and right tool and troop slots. Pickers: 526 tools, 253 troops (Attack, Defence, All), 44 support tools. Courtyard wave with 8 slots, by quantity or %. PTT=1 vassal option. **Live preview of the raw `%xt%…%cra%` string**, with Copy | Full | 12, 61–65 |
| Attack builder | Game-preset cache | The 30 in-game attack presets for each sub, captured with `gas` at login, plus a reload button | Full | 13, 68 |
| Tools | Combat calculator | Attack from a saved template. Defence entered by hand or loaded from a saved spy report. Melee and ranged verdicts. Says plainly it is not the game formula | Full | 33 |
| Alliance | Chat, leaderboard, help | Alliance chat for each castle, with sending. Alliance leaderboard by power or event (topAllianceFeed). helpRequests and allianceRanking plugins | Full | 08, 16 |
| Mail | In-game mail | Inbox and Sent (last 10, players only), with sending | Full | 09 |
| Logs | Terminal, logs, errors, stats | Per-castle live terminal with level and plugin filters, pause scroll and refresh. Global log (**demo data**). The errors page splits "gravi" (severe) from "bot / non ora" (the game said not now). Stats for 24h, 7d and 30d: attacks, success rate, events, errors, per-castle summary, top server error codes. reportCleaner deletes NPC battle reports | Full | 10, 11, 31, 51 |
| Dev tools | Traffic sniffer | Every packet in and out, filtered by castle, direction, command, errors only and text. Pause and clear. Needs `"sniffer": true` in `ggeConfig.json` (off on this container) | Full | 34 |
| Guidance | Info / Guida hub | Full-text search. **Configuratore**: 4 questions (goal, castle size, keep peace, event window) produce "turn on", "keep off" and recommended values, with a 24 h timeline. **Controlla un castello** lints a castle's saved config ("Nessun problema trovato con le regole conosciute"). 12 goal recipes, the plugin catalogue by category, a 21-term glossary, a 5-step "how it works", and 14 symptom → fix checklists | Full | 20, 40–44, 59–60 |
| Notifications | Sound and Discord | Sound beep on important events. Discord integration for notifications, slash commands and a chat bridge (not connected here). The header bell opened no panel | Full | 21, 55 |
| Settings/UI | Panel settings | Theme (dark gaming or light). Language: IT, EN, DE, ES, FR. Live WebSocket with reconnect. Password on start. Backend WebSocket endpoint override. Cmd+K palette | Full | 21, 57 |
| External | Strumenti | Links to danadum event rankings, Generals Forum calculators, GGE Tracker and Maxy's Empire Toolkit | Full | 18 |

## Gated or unreachable areas

- **Anything behind a save or a toggle was not exercised.** That covers plugin saves, matrix toggles, start and stop, peace mode, config import and copy, schedules, equipment apply and scrap, and chat and mail send. The options are documented from the dialogs. Their runtime behaviour is not.
- **Tier differences.** Only `full` and `trial` were seen. Which plugins `lite` hides, and which values are operator-fixed for non-super tiers, is not visible from a full account.
- **The trial's feature set.** The disposable account was not linked to a castle, by rule, so the trial dashboard was never opened.
- **Traffic stream.** The sniffer is off on this container, so the page shows no packets.
- **Profiles data.** The Profili page asks for its list over WebSocket (`ProfileList`), which was blocked. The page shows the static bundle descriptions.
- **`/admin.html`** returns 200 on the panel. It was not opened.
- **Pricing.** No price list or checkout exists. Extensions and extra castles go through "contattaci" with no listed channel.

## Notable for a competitor

- **It is our code with a large layer on top.** EmpireBot shares our protocol, plugin names and payload format. Most of its value is the UI and the plugins it added:
  - a castle page with live economy, overseers, production, commanders and a terminal
  - per-plugin option dialogs with help tips
  - the crescita event orchestrator with a time window and points threshold
  - stationOnHit flee with an AUTO ally finder
  - a weekly schedule (pianoOrari)
  - an equipment optimiser with scrap previews
  - a template builder with a raw `cra` preview
  - an Info hub with a configurator and a config linter

  Our own audit's "Ideas to bring into GGE-BOT" list in `.audit/empirebot/README.md` maps these onto our code.
- **Guidance is a real strength.** The Configuratore turns four plain questions into "turn on, keep off, use these values". The linter checks saved configs against known mistakes. The Problemi checklists start from symptoms ("ATTACK_TOO_MANY_UNITS", "Il bot non recluta"). Error pages separate real failures from the game's "not now" replies.
- **Operator controls show up in the tier design.** Plugins are hidden by tier, and option values can be pinned by the admin unless you are `super`. That is a way to sell safety and to upsell. The config copy-to-other-castles feature is useful for multi-account players, but each account is capped at one castle.
- **Weak spots:**
  - The dashboard is served over plain HTTP on a raw IP, with a cookie UUID as the only auth.
  - The main dashboard and Logs show hard-coded demo data.
  - Static numbers appear as live data: sidebar badges "12 castles, 72 plugins", "x/70" plugin counts, profiles "applied to 7/4/1 castles".
  - Test files and internal modules are listed as user plugins.
  - The header bell does nothing visible.
  - The UI mixes Italian and English.
  - One castle per account.
  - Billing is manual, with no contact channel.
  - There are no public docs or community, and only about 13 users.
- **Trial design.** The 4-day clock starts at the first castle link, not at sign-up, so users do not lose trial days during setup.
- **Server list.** The 39-zone list maps zone codes to `EmpireEx_N` instances, including newer ones (`EmpireEx_43`, `_46`, `_49`, HANT `_37`, ES `_38`). It is a useful cross-check for our own list.
