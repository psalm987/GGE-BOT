# The Squire Bot (thesquirebot.com) — competitive research

First pass 2026-11-16, deep pass 2026-11-17. Both passes used the disposable trial dashboard account. The user's real account could not log in: the form takes a username, and the stored entry only has an email. No game account was added, and nothing was started, saved, bought or toggled. Every non-GET request except the login POST was blocked in the browser.

Screenshots, page text and an API/route table are in `.audit/squirebot/` (see its `README.md`).

Evidence column:

- **UI:** rendered in the dashboard and captured in `.audit/squirebot/`.
- **JS bundle:** these forms need a linked game account or a higher plan, so they never rendered. Their labels, option lists, defaults and help text were read from the site's public client JS chunks. They reflect what the UI offers, but nobody saw them rendered.
- **Marketing:** the landing page or Overview copy only.

## Summary

- **Product:** a hosted cloud bot. The tab title is "The Squire Bot" and the sidebar says "GGE Bot".
  - Next.js (Turbopack) with shadcn/Radix UI, a dark gold theme and 4 colour themes: Warm, Creme, Royal Green and Sharp.
  - You add game accounts (game username, game password, server). The bot logs in server-side and runs modules 24/7. Nothing is installed locally.
  - Data loads with REST GETs to `/api/*`. Each module stores one JSON config per account (`PUT /api/accounts/<acct>/config/<module>`). A WebSocket at `/ws` pushes stats, logs, notifications and account changes. Module pages also poll a `/status` endpoint every 3–15 s.
- **Sign-up:** username, email and password, or Discord OAuth. There is no captcha. Email verification is needed only "when requesting an extension".
- **Pricing model (credits, sold manually through Discord):**
  - Every new account gets a **free 2-day trial of the Green plan**. Overview showed "TIME LEFT 1d 14h until Nov 18, 03:15 PM".
  - **Green plan: 12 creds.** It covers all main-realm modules on all your accounts.
  - **BTH add-on: +4 creds.** It covers the Beyond the Horizon modules.
  - **Outers:** a future separate tier. Only MP Builder and OR Storms exist so far.
  - Licences card: "RUNNING 0 / 1 · 1 free · 0 saved". Licences cap how many accounts run at once. Saved but idle accounts are tracked separately (`/api/saved-accounts`).
  - Credit prices are not public. Locked modules show a full-page card: "Not included in your plan … Contact the admin (thesquire_2 or sekyra_) to add it." There is no self-serve checkout.
- **Trial scope:** Green only. Coin Farmer, BTH Blacksmith, Influence Farming, Equipment Manager, OR Storms and MP Builder were plan-locked. Event Recruiter and BTH Castle Builder showed their account picker.
- **Account sharing:** an owner can share a game account with other dashboard users. Rights are granted per capability: read, module settings, commanders/presets, account settings, Discord notifications, start/stop, page start. A shared user can change only the "commander choices" of a module. A "hands off" state blocks starts while the owner plays ("Owner is playing — starts are off.").
- **Community:** Discord server "FarmTheEmpire" (invite d8QRyuAAj2). The site links no docs, FAQ, changelog or YouTube.

## Navigation (full module list)

- Overview (Main / Outers-BTH views)
- Live View
- Account Manager group:
  - Castle Manager
  - Offer Buyer
  - Live Wheel Spin
  - Overseers
  - Food Manager
  - Messages
- Rift Raid
- Berimond
- Towers
- Leveller
- Armourer
- Blacksmith & Event Shops
- Nom/Sam/Daimyo
- Storms
- Fortress
- Khan
- Green Berimond
- Invasion Events
- Virtual Presets
- Outers/BTH group:
  - Coin Farmer
  - Blacksmith
  - Influence Farming
  - Recruiter
  - Castle Builder
  - Equipment Manager
  - OR Storms
  - MP Builder
- Utilities group:
  - Recruit, Tools & Heal
  - Refinery & Toolsmith
  - Auto-Feast
  - Equip Sell & Forge
- PvP Modules group:
  - Alert + Autostation
  - Asset Monitor
- Logs
- Account Settings

## Feature inventory

Free/Paid key:

- **Trial/Green:** available in the trial. In steady state it is the paid Green plan (12 creds), marked "paid – advertised, not verified".
- **BTH:** +4 creds, paid – advertised, not verified.
- **Outers:** future tier.

Shared building blocks used by many modules:

- **Waves dialog:**
  - Waves 1–4 are collapsible. Each wave picks an in-game Server Preset (Empty, or Preset 1–30).
  - Toggle between Manual Config and Virtual Preset.
  - 3 support-tool (AST) slots.
  - 8 courtyard (RW) unit + count rows.
  - "The 4th wave's config is repeated for every extra wave."
- **Autofill dialog:**
  - Fill sides: Left, Front, Right, Courtyard.
  - Waves: 1–4.
  - Tools (wave 1): the options depend on the module.
  - Unit order: Fastest, Strongest or Weakest first.
  - Troop supply: Food, Mead or All.
  - Min troops: a hard floor of one wave's base capacity always applies.
- **Per-module commander list:** semicolon-separated, e.g. "1;2;3". It is checked against the account's commander count and for duplicates.

| Category | Feature/plugin | Configurable options seen | Free/Paid | Evidence |
| --- | --- | --- | --- | --- |
| Attacks – event camps | **Nom/Sam/Daimyo** | **Mode:** Skip Mode (single target, uses skip items) or Cycle Mode (auto-scans nom/sam camps, no skips).<br>**Target camp:** X,Y, verified on start.<br>**Army:** Waves or Autofill (default "L·F·R · 4w · Combat tools (wave 1)").<br>**Commander indices:** default "1;2;3;4;5".<br>**Skip types:** 1m / 5m / 10m / 30m / 1h / 5h (default) / 24h. "Prefers abundant (≥999) largest skip".<br>**Horse:** Feather or Coin.<br>**Event difficulty:** Player's Current, Easy … Master+.<br>**Score shutoff:** 0 = off. | Trial/Green | UI |
| Attacks – Khan | **Khan** | **Difficulty:** as Nomads, plus Archmaster.<br>**Autofill:** "L·F·R+CY · 4w · Rage + booster waves". The dialog sets rage-wave and booster-wave counts, "Low-value boosters first", and ordered pick lists for rage tools and for tablet chests ("#1 drains first").<br>**Tablets-only mode:** never sends rage taunts.<br>**Rage optimiser:** sizes banners for the rage expected at landing.<br>**Pause at N incoming taunts.**<br>**Auto-Defense:** "Enable with Khan" (default on). Mode is Auto (Best Available) or Manual (Pick Tools). "Load Current" copies the in-game defense.<br>**Medal Shop:** buys renegade defense troops.<br>**Armourer thresholds:** Flaming Arrows, Hurling Rocks, Gate Reinforcement, Sharpened Stakes, bought in batches of 1000.<br>**Bodkin Arrowheads:** paid with tablets.<br>**Other:** score shutoff, skips, horse. | Trial/Green | UI |
| Attacks – Storms | **Storms** | **Forts:** Lv40H, 50H, 60H, 60E✓, 70H✓, 70E✓, 80H✓, 80E✓, by distance.<br>**Autofill:** "L·R · 3w · Wall tools · skip easy".<br>**Aquamarine auto-buy:** Coins, XP (spend all; skipped at legend level 950), 5H skips, 24H skips, dummy peasants.<br>**Decoration:** Off, Crab Rock, Tide Garden or Whale Lagoon.<br>**Tool stock:** ladders, rams, mantlets; 0 = off.<br>**Cargo ships:** build L1 and upgrade.<br>**Food/mead transfer to Storms:** threshold and minimum reserve, skips the cooldown.<br>**Troop transfer** from other castles. | Trial/Green | UI |
| Attacks – Fortress | **Fortress** | **Kingdoms:** Burning Sands, Everwinter, Fire Peaks. Each has a checkbox, a hit limit and its own Configure Waves dialog.<br>**Commander indices, horse.**<br>**Commander Reserve:** seconds before a fort frees. Holds commanders so other modules cannot take them. | Trial/Green | UI |
| Attacks – Green Berimond | **Green Berimond** | **Commanders, horse.**<br>**Army:** Autofill (event tools) or preset.<br>**Camp side:** All, Red only or Blue only.<br>**Event tools:** None, Reputation Mode or Low Value Chests.<br>Started from Overview → Quick Start. | Trial/Green | UI |
| Attacks – FC / Bloodcrows | **Invasion Events** (auto-detects the live event) | **Difficulty:** Classic … Archmaster (default Intermediate+).<br>**Score shutoff.**<br>**Minimum troops:** default 1000.<br>**Dethrone:** Off, Exile or ruby options.<br>**Attack under protection:** with a warning.<br>**Tooled waves:** 1–4 (default 2). Remaining waves carry Chest tools or Troops only.<br>**Per-wave template:** Moat (wall/gate/moat) or Shield (wall/gate/mantlet).<br>**Soldiers:** All, Food or Mead.<br>**Other:** beef troops, low-value chests, ordered chest pick list, 3 AST slots. | Trial/Green | UI |
| Attacks – Berimond | **Berimond** | **Tabs:** Tower Attack, Advisor Mode, Player Attack, Commander Config, Camp Builder.<br>**Tower Attack:**<br>- Waves dialog, skips (default 5 min), horse, "Stop when capital reached".<br>- **Troop transfers:** Threshold mode (one unit type from one source castle) or Priority mode (ordered unit list, auto-sourced from the castle with the most). Threshold 10–5000, default 100: refill when camp troops fall below capacity minus the threshold.<br>- **Tool transfers:** per tool, an amount (1000) and a trigger level (500).<br>- **Lanes:** top / middle / bottom (none = the game's closest tower). Middle-lane minimum rubies; side-lane points goal.<br>**Advisor Mode:** seeds each commander once and lets the bought in-game Advisor repeat the attacks ("9000 per commander"). Reseeds after defeats or tower rotation. Retires a commander after N defeats.<br>**Player Attack:** a target X,Y with the same army settings. Mutually exclusive with Tower Attack and Camp Builder.<br>**Camp Builder:** capacity cap (default 1000), PO target (100), skips, tent upgrade levels (default L2–4), optional storehouses. Stops when the event ends.<br>**Loss limits:** stop if one hit loses more than N troops (50 when ticked), or after N defeats (25). | Trial/Green | JS bundle |
| Attacks – towers | **Towers** ("Kingdom Towers") | **Tabs:** Kingdoms, Attack Config (summary), Commander Config (default 1–25).<br>**Per kingdom** (Green, Sands, Ice, Fire):<br>- Enable.<br>- Army: Waves or Autofill. Autofill tools: No tools, Ladders only, or Ladders + Rams + Mants.<br>- Tower filter: All, Maxed only, Non-maxed only.<br>- Max attacks: 1–50, default 10.<br>- Castles to attack from.<br>**Per castle:**<br>- Range: 10–200, default 50.<br>- Tools: 0–10k, default 2k; meaning not stated.<br>- Horse: Feather, Coin or Distance. Distance uses coin horse within N fields (default 15) and feather beyond.<br>- Loot priority: all, wood, stone, food or the kingdom's special resource.<br>- Army override. | Trial/Green | JS bundle |
| Attacks – towers | **Leveller** | **Tower queue:** X,Y list, levelled in order.<br>**Attack config:** kingdom, castle, Waves or Autofill, horse, target level (default 70). The page shows the victories needed, using a formula clamped to kingdom base and max levels (Green 1–81, Sands 35–61, Ice 20–51, Fire 45–71).<br>**Skips:** 1m–24h, default 5h. Smallest selected is used first. The module stops when all selected skips are used up.<br>**Commanders:** "use different numbers from Towers to run both".<br>**Status:** current tower level and VC versus target, skip counts, commanders. | Trial/Green | JS bundle |
| Attacks – alliance boss | **Rift Raid** (multi-account) | **Command bar:** "Retreat all (N)", reads the boss, walls and marches.<br>**Tabs:** Accounts / Raid / Group settings.<br>**Accounts:** 3-step flow (select → put in a group → Start), filters (All, No group/Custom, Running, Needs boss points, Offline), search.<br>**Raid:** per-alliance "wall breaker rules".<br>**Groups:** accounts follow the group's settings. Editing one account makes it Custom, and "Back to group" undoes that. Commanders stay per account. | Trial/Green | UI |
| Commanders & presets | **Virtual Presets** | Per account, a list of named presets ("N wave(s) configured") with create, edit and delete.<br>The editor is the wave panel in custom mode: per wave, Server Preset or Custom flanks (Left 2 tools + 2 units, Middle 3 + 6, Right 2 + 2), plus AST ×3 and RW ×8.<br>Attack modules pick them under "Virtual Preset" in their Waves dialog. | Included with any plan | JS bundle |
| Troops / tools / heal | **Recruit, Tools & Heal** | **Per castle** (all except Berimond):<br>- Recruit: Rotation (ordered rows keep a mix such as 3×A:2×B) or Smart plan (absolute goal per type counting stationed, travelling and in-production troops; ∞ goals level against each other).<br>- Tools: the same two modes per tool family.<br>- Heal: troop select, or "Auto — coin-heal all".<br>**Failures:** isolated per type; a type is excluded for the session after about 25 server refusals.<br>**Status:** per-castle have/target with reasons (needs workshop, not researched, no currency, needs barracks). | Trial/Green | UI (help text) + JS bundle |
| Tools purchase | **Armourer** | **Tool targets:** rows per kingdom × tool. Checked hourly from already-polled inventory. Buys the deficit + 4,000.<br>**Coin Overflow Burn:** buys tools so coins above the 2,147.48M cap are not lost.<br>**Safety limits:** coin floor, spend cap per run. "Top Up Now". | Trial/Green | UI |
| Shops / events | **Blacksmith & Event Shops** | **Six tabs:** Nomad/Khan shop (121 packages), Samurai (157), Blacksmith silver (111), and 3 villages (8 each).<br>**Launch rule:** spend at event start; start buying N min before the end; buy when a currency reaches X; or manual.<br>**Limits:** currency floors and a spend cap per event. "Only when ending" packages fire in the last 30 min.<br>**Buy list:** ordered, with max items per package.<br>**Villages:** pay with coal, oil or glass; keep at least N; buy every N min. | Trial/Green | UI |
| Shops | **Offer Buyer** | **Watcher:** notifies on the dashboard and Discord.<br>**Buy rules:** plain-words rules ("offers that contain Affluence tickets and Sasaki's Offering") plus Auto-buy, which buys the cheapest matching option.<br>**Limits:** ruby reserve and daily spend limit. Never buys a one-time deal twice. Buys not-yet-unlocked offers when they open.<br>**Purchase history.** | Trial/Green | UI (help text) |
| Events | **Live Wheel Spin** | Auto-spins the Wheel of Unimaginable Affluence, one spin per server confirm. History with a jackpots filter. | Trial/Green | UI + JS bundle |
| Boosters | **Overseers** | **Global:** ruby floor (default 50,000), max buys per pass (10).<br>**Per booster** (Marauder, Food, Mead, Honey, Beef, Drill instructor, Wood, Stone):<br>- Mode: Off, Keep active, or Buy on sale only.<br>- "Extend below N days": default 2, max 90.<br>- "Sale ≥ %": default 50.<br>- "Stock to N days": default 45, hard cap 365.<br>**Sale banner:** discount and rotation countdown.<br>**Purchase record:** booster, rubies, discount, clock after. | Trial/Green | JS bundle |
| Resources | **Food Manager** | **Rescue below:** N hours of food (default 6).<br>**Donor limits:** donors keep 100k; minimum transfer 5k.<br>**Skip travel:** on, using 10m/30m/1h skips.<br>**Protected kingdoms:** Green, Sands, Ice, Fire.<br>**Donor order:** "all-positive castles first, then the least-negative". Emergency mode feeds the fastest-dying main from the slowest-dying donor.<br>**Limits:** outposts donate but never receive; Storms excluded.<br>**Views:** castles table (food, capacity, rate/h, time left) and a transfer record. | Trial/Green | JS bundle |
| Buildings | **Castle Manager** | **Global:**<br>- Ruby-cost upgrades with a daily cap.<br>- Auto-expand (wood and stone only).<br>- Move buildings; store decos.<br>- Repair first, via alliance help (notes the ~3h throttle) or resources.<br>- Time skips 1m–24h.<br>**Per castle:**<br>- Enable.<br>- **Isometric layout map:** zoom, pan, click a building to set a target count and "Upgrade to".<br>- Ordered building goals.<br>- Ring targets: Wall, Gate, Towers L1–9; Moat L1–4.<br>- Repair priority order.<br>- **Decorations:** store selected or all, place from storage.<br>- **Castle items:** assign temporary items per building, Keep alive or Replace only, "boost under N min" (60).<br>**Material moving:** rules from a castle to a kingdom main. Resources W/S/Coal/Oil/Glass/Iron. Mode: send above N, send exactly, or fill the destination.<br>**Live config:** changes apply without a restart.<br>**Activity feed.** | Trial/Green | UI (global, goals, ring, repair) + JS bundle (layout, decos, items) |
| Buildings – BTH | **BTH Castle Builder** | **Global:** skip builds with 5-min skips (on); spend rubies when required (off).<br>**Per castle:** ring targets (Wall/Towers/Gate ≤5, Moat ≤2); ordered building goals with count and "Upgrade to"; isometric layout map. | BTH | JS bundle |
| Crafting | **Refinery & Toolsmith** | **Resource transfers:** auto-transfer between kingdoms, optional skips, minimum threshold (10k).<br>**Per queue tab:** "Keep at least" input reserves.<br>**Per kingdom:** enable, auto-unlock slots with coins, a production queue of up to 6 recipes (repeats in order), Short or Long duration per recipe.<br>"Never uses rubies or time skips". | Trial/Green | JS bundle |
| Feasts | **Auto-Feast** | **Food threshold:** minimum 100k; a feast costs 150k.<br>**Castles:** enable per castle (Berimond excluded).<br>Save only; no Start button. | Trial/Green | JS bundle |
| Equipment | **Equip Sell & Forge** | **Per rarity:** Keep / Sell / Forge. Forge fuses 6 items into the next rarity; Legendary rerolls 3 with a protection chip.<br>**Hero gear:** sell checkboxes.<br>**Keep gear with these bonuses:** 7 options, plus double-bonus and triple-bonus gear.<br>**Gems:** auto-forge up to level N; sell gems ≤ level N.<br>**Relic selling:** gear, heroes and gems; by commander or castellan; old 3-/5-stat rolls; combat-bonus count; scope (PvP, Samurai, FC/BC, Berimond, Nomad, PvE).<br>**Relic protections:** about 30 bonus checkboxes.<br>**Safety:** skip enchanted and gemmed gear; cycle every 1800 s. | Trial/Green | JS bundle |
| Equipment – BTH | **Equipment Manager** | **Build commanders:** speed or coin-cost loadouts; with both, lower IDs get speed. Strict upgrades only.<br>**Sell junk:** gear and hero tiers.<br>**Protect:** enchanted and gemmed gear.<br>**Check interval:** 300 s. | BTH | JS bundle |
| BTH / Outers farming | **Coin Farmer** | **Tabs:** BTH and Outers.<br>**Settings:** tower X,Y; commanders; horse; skips; auto-buy Marauder (990 rubies) and Return maps up to a % goal; ruby floor.<br>**Outers only:** kingdom select, autofill army, buy troops at the armourer, auto-buy "Relentless robber hunting".<br>**Status:** pauses at the event hit cap. | BTH | JS bundle |
| BTH | **BTH Blacksmith** | Minimum-stock thresholds for skips, feathers, wood, stone, 4 relic troop types, breaching towers, shield wall and boulders. Optional Outers mode. | BTH | JS bundle |
| BTH | **Influence Farming** | **Shared army:** autofill or waves, relic-only commanders.<br>**Player farming:** max might, min influence, player and alliance blacklists, VIP commanders per day, VIP blackout window.<br>**City-state snipes:** auto or fixed reservation timing.<br>**Alliance capitals:** three strategies (farm all day; 200-ruby slowdown hits landing at the reset; scheduled burst after the reset), filters by risk and MP, a capital list with exclude and pick. | BTH | JS bundle |
| BTH | **Event Recruiter** | One coin-troop pick per event castle. | BTH | JS bundle |
| Outers | **OR Storms** | **Forts:** checklist of 8 fort levels.<br>**Army:** autofill or waves.<br>**Aquamarine auto-buy** and decoration.<br>**Food transfer:** to the Storms castle with skips. | Outers | JS bundle |
| Outers | **MP Builder** | **Kingdoms:** checklist.<br>**Dwellings:** build and upgrade to L1–12.<br>**Relics:** targets for Farmhouse, Greenhouse, Woodcutter and Quarry (max L20), with an LT/LM token and ruby cost estimate.<br>**Outposts:** optional, for relic upgrades. | Outers | JS bundle |
| PvP / defense | **Alert + Autostation** | **Tabs:** Troop stationing, Discord alerts, Seasonal attacks. Start from Overview → Quick Start; settings can be edited offline.<br>**Global rules:**<br>- Minimum attacking army and "leave at N remaining".<br>- Allow stationing to end protection.<br>- Open gates (6h or 12h): on all castles, above an army size, or as an emergency if stationing fails.<br>**Maintenance protection:** station troops on a maintenance warning without dropping protection; recall afterwards; keep chosen troops home.<br>**Per castle:**<br>- Send away when attacked, and/or repeat 12-hour stationing.<br>- Destination: automatic (prefers 24h, then 12/9/2h protected alliance castles) or chosen, plus a backup.<br>- Troops that stay home: by category or exact counts.<br>- Travel boost, VIP or normal commanders, bring troops home after the last attack (wait 60 s).<br>**Discord:** own and alliance webhooks; ping @here, @everyone, members, roles, or per-account rules; minimum army to alert and to ping; optional spy on alliance attacks; DMs.<br>**Seasonal events:** alert and/or station per event (7 events).<br>**Live stations list:** with Recall. | Trial/Green | JS bundle |
| PvP | **Asset Capture Monitor** | **Coordinates:** a list of X,Y + kingdom + label.<br>**Check every:** 1–12 h.<br>**Spy:** optional, on the occupying army.<br>**Discord alerts:** own webhook, DM, mentions.<br>**Auto-break:** autofill or waves; don't break while protected; normal or VIP commanders; horse. Break attacks respect the attack-cost cap. | Trial/Green | JS bundle |
| Alliance / social | **Messages** | **Report cleanup:** delete "no battle" reports (on) and NPC battle reports (off). Player reports, spy reports and mail are never touched. Cleanup record.<br>**Alliance chat:** log polled every 3 s; send up to 1,300 characters. Needs the watcher running. | Trial/Green | JS bundle |
| Multi-account | **Multi-account dashboard** | **Add Game Account:** game username, game password, server field (default "India").<br>**Overview:** Active, Hits Today, Coins, Rubies; Main and Outers/BTH views; Quick Start per account.<br>**Licences:** slots, plus saved accounts.<br>**Sharing:** per-capability sharing of accounts with other users.<br>**Rift groups.** | Included with any plan | UI + JS bundle (sharing) |
| Dashboards / live data | **Live View** | Per castle: In castle, Travelling and Wounded panels, each split into troops and tools icon grids. Main or Outers/BTH realm. Polls every 4 s while the tab is visible. | Included with any plan | UI (picker) + JS bundle |
| Logs | **Logs** | Level filter (All, Debug, Info, Warning, Error), account filter, "Following" live tail, times in the user's zone. | Included | UI |
| Notifications | **Discord notifications** | **Per account delivery route:** Off, Webhook, DM, or Webhook + DM.<br>**Events:** game maintenance, reconnect failed, module error-stops, daily hit limit reached, hit-limit auto-resume, leveller complete, offer buyer, daily towers report.<br>**Live stats card:** opt-in; updates every 1–6 h; edit in place or repost; 3–30 day history.<br>**Test button.**<br>PvP and Asset Monitor use their own webhooks. | Included with any plan | JS bundle |
| Settings | **Account Settings** | **User time zone:** UI.<br>**Per game account:**<br>- Apply construction-item bonuses to attack capacity (on).<br>- Auto-buy the global speed bonus (2,500 rubies).<br>- **Reconnect:** main server 1 attempt with 180 s waits; event server 4 attempts, escalating from 8 s.<br>- **Attack limit:** daily hit count or coin cost per attack, per realm, with a "trigger preview" calculator.<br>- Discord settings (above).<br>Fields save on blur. | Included | UI (time zone) + JS bundle |
| Safety | **Refusal stop** | Leveller and others stop after N cooldown refusals in 24 h. The dialog offers "Keep stopped — contact admin" or "Bypass and restart" (15 more refusals allowed). | Included | JS bundle |
| UI/UX | Themes, module icons, long help text | 4 themes. Every option has a specific inline explanation. Many configs can be edited offline. Translate-guard script. | Included | UI |
| Anti-ban / humanization | Not offered | No delay, jitter, proxy or schedule-window setting in the UI or in any chunk read. The only timing controls are the reconnect settings and the attack limits. Influence Farming's config has an unexposed `timed_jitter_ms` field. | — | UI + JS bundle (absence) |
| Scheduling | Event-relative timing only | Shop launch rules, village "buy every N min", score shutoff, Commander Reserve, pause at N taunts, Influence Farming reset timing, VIP blackout window. No general time-window scheduler. | — | UI + JS bundle |
| Quests / daily rewards / gifts | Not offered | No quest, daily-login, gift or chest-opening module. Healing is only "Auto — coin-heal all" in Recruit, Tools & Heal. | — | absence |
| Account / billing | Credits plus manual admin top-up | 2-day trial; Green 12 creds; BTH +4 creds. Extended through Discord admins. | Paid – advertised, not verified | UI + landing |

## Gated or unreachable areas

- **The real account could not be used.** The login form wants a username; the stored entry has an email and password, and neither the email, its local part nor the game username worked. I stopped after three attempts. So it is still unknown whether game account "poison ivy" (India 1) is linked there. To capture rendered `main-*` shots, the Squire username is needed, or the password needs checking.
- **Per-account forms never rendered.** These modules still show only an account picker in the trial: Berimond, Towers, Leveller, Overseers, Food Manager, Messages, Virtual Presets, Live View, Auto-Feast, Equip Sell & Forge, Crafting, Recruit/Tools/Heal rows, Alert + Autostation, Asset Monitor, per-account Account Settings, and the Castle Manager layout. Their options above come from the JS bundle, not from a rendered page. Option lists that the server supplies at runtime (full unit and tool lists from `/api/modules/game-options`, crafting recipes, catalog-driven tab names) are not covered.
- **Plan-locked in the trial:** Coin Farmer, BTH Blacksmith, Influence Farming, Equipment Manager, OR Storms and MP Builder. Their options also come from the JS bundle.
- **Wave editor:** now captured with all 4 waves expanded, the Server Preset list (Empty, Preset 1–30), the AST tool list and the courtyard unit list (`.audit/squirebot/shots/trial-28-fortress-b*`). Custom per-flank slots (Left 2 tools + 2 units, Middle 3 + 6, Right 2 + 2) appear only in the Virtual Presets editor and are known only from the JS.
- **Pricing:** the credit price and the payment method are not public.

## Notable for a competitor

- **Account sharing with capability rights** (read, settings, commanders, Discord, start/stop) and a "hands off while the owner plays" lock. This is a real multi-user feature, not just multi-account.
- **Breadth of event and economy coverage:**
  - Shop automation with 4 launch rules and per-event caps.
  - Coin-overflow burn.
  - Khan rage optimiser with ordered rage and tablet pick lists.
  - Berimond Advisor Mode, which uses the game's own repeat attacks.
  - Lane goals and a camp builder.
  - Food Manager rescue logistics.
  - Overseer keep-active versus sale-only buying.
  - Equipment selling and forging with relic-bonus protections.
  - A castle manager with an isometric layout, castle items and deco storage.
- **Defensive PvP is deep:** automatic stationing to protected alliance castles, repeat 12-hour stationing, open-gate fallbacks, maintenance-time stationing, seasonal-raid handling, and Discord pings per account.
- **Safety by limits, not humanization:**
  - Ruby floors and daily caps everywhere.
  - Attack limits by hit count or by coin cost, with a preview calculator.
  - Loss limits in Berimond.
  - A refusal counter that stops modules and asks the user to contact the admin.
  - No delay, jitter, proxy or schedule settings.
- **Polish:**
  - Long, specific help text on every control.
  - Offline config editing.
  - Live status cards on every module.
  - Purchase and transfer records.
  - A Discord live stats card.
  - Logs in the user's time zone with a live tail.
- **Gaps:**
  - No humanization, proxy or time-window scheduler.
  - No quests, daily rewards or gifts.
  - Notifications go only to Discord; there is no Telegram or email.
  - Credits are billed manually through Discord.
  - The Outers tier has not launched.
  - The trial excludes BTH.
