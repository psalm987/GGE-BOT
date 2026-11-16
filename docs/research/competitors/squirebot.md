# The Squire Bot (thesquirebot.com) — competitive research

Researched 2026-11-16 with a disposable dashboard account. No GGE account was added, and nothing was started, saved or toggled. Evidence comes from the rendered dashboard UI (dropdowns opened and closed with Escape, dialogs opened and closed) and the public landing page. Raw dumps are in `scratchpad/pw/squirebot/dump/`.

## Summary

- **Product:** a hosted cloud bot ("GGE Bot Dashboard", branded "The Squire Bot"). The web dashboard is Next.js with shadcn-style UI, a dark gold theme, and 4 colour themes: Warm, Creme, Royal Green, Sharp. You add game accounts (username, password, server). The bot logs in server-side and runs modules 24/7. Nothing is installed locally.
- **Sign-up:** username, email and password, or Discord OAuth. There is no captcha. A verification email is sent, and the banner says verification is "required when requesting an extension". The account worked before verification.
- **Pricing model (credits, sold manually via Discord):**
  - Every new account gets a **free 2-day trial of the full Green plan**. The countdown shows "Time left 1d 23h".
  - **Green plan: "12 creds"**. It covers all main-realm modules "on all your accounts".
  - **BTH add-on: "+4 creds"**. It covers the Beyond the Horizon modules.
  - **Outer realms will be a separate tier.** It is not available yet, and only MP Builder is open.
  - "Always included with any plan": multi-account dashboard, Live View, virtual presets and wave editor, Discord notifications.
  - Licences card: "LICENCES · RUNNING 0 / 1 — 1 free · 0 saved". This suggests a cap on concurrently running accounts (licences), with saved but idle accounts tracked separately.
  - The credit-to-money price is not public. Upsell text reads: "Not included in your plan … Contact the admin ([2 Discord handles]) to add it." There is no self-serve checkout.
- **Community:** Discord server "FarmTheEmpire", about 490 members and about 83 online (invite d8QRyuAAj2). No docs, FAQ, changelog or YouTube links are on the site.
- **Trial scope:** the trial **did not include BTH or Outers**. Coin Farmer, BTH Blacksmith, Influence Farming, Equipment Manager, OR Storms and MP Builder all showed "Not included in your plan". Event Recruiter and BTH Castle Builder still rendered their account picker.

## Navigation (full module list)

- Overview (Main / Outers-BTH tabs)
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

- **Trial/Green:** visible in the trial; in steady state it is the paid Green plan (12 creds), marked "paid – advertised, not verified".
- **BTH:** +4 creds, paid – advertised, not verified.
- **Outers:** future tier.

| Category | Feature/plugin | Configurable options seen | Free/Paid | Evidence |
|---|---|---|---|---|
| Attacks – event camps | **Nom/Sam/Daimyo** | **Mode:** Skip Mode (single target, uses skip items) or Cycle Mode (auto-scans nom/sam camps, no skips).<br>**Target camp coordinates:** X,Y, verified on start.<br>**Army:** Waves (manual) or Autofill (default "L·F·R · 4w · Combat tools (wave 1)").<br>**Commander indices:** text, e.g. "1;2;3;4;5".<br>**Skip types:** 1m / 5m / 10m / 30m / 1h / 5h (default on) / 24h. "Smart selection: prefers abundant (≥999) largest skip".<br>**Horse type:** Feather or Coin.<br>**Event difficulty:** Player's Current, Easy, Easy+, Intermediate, Intermediate+, Hard, Hard+, Expert, Expert+, Master, Master+.<br>**Score shutoff:** 0 = off. | Trial/Green | UI |
| Attacks – Khan | **Khan** | **Difficulty:** as Nomads, plus Archmaster.<br>**Army:** Autofill default "L·F·R+CY · 4w · Rage + booster waves · rage 3w / chests 0w".<br>**Commander indices.**<br>**Skip types:** smallest selected used first.<br>**Horse type.**<br>**Score shutoff.**<br>**Tablets-only mode:** farms camps but never sends rage taunts, so there are no self-invited counterattacks.<br>**Rage optimiser:** sizes banners for the rage expected at landing, including taunt resets.<br>**Pause hits at N incoming taunts:** 0 = off.<br>**Auto-Defense:** "Enable with Khan" switch (default on). Mode is Auto (Best Available, fills wall, moat and keep slots) or Manual (Pick Tools). "Load Current" copies the in-game defense.<br>**Medal Shop:** auto-buy renegade defense troops with Khan medals.<br>**Armourer auto-buy thresholds:** Flaming Arrows, Hurling Rocks, Castle Gate Reinforcement, Sharpened Stakes. Bought in batches of 1000.<br>**Bodkin Arrowheads:** paid with Khan tablets. | Trial/Green | UI |
| Attacks – Storms | **Storms** (Storm Islands forts) | **Hit:** checkboxes for Lv40H, 50H, 60H, 60E✓, 70H✓, 70E✓, 80H✓, 80E✓, prioritised by distance.<br>**Army:** Autofill "L·R · 3w · Wall tools · skip easy".<br>**Commander indices.**<br>**Horse type.**<br>**Aquamarine auto-buy:** Coins, XP (spend all, skipped at legend level 950), 5H skips, 24H skips, Dummy peasants (spend all).<br>**Decoration:** Off, Crab Rock, Tide Garden or Whale Lagoon.<br>**Tool auto-buy:** maintain ladders, rams and mantlets as stock levels, 0 = off, batches of 1000.<br>**Build L1 cargo ships & castle management.**<br>**Upgrade cargo ships.**<br>**Resource transfer to Storms:** source castle (Auto = Green main), auto-transfer food and mead with thresholds and a minimum reserve, skipping the transfer cooldown.<br>**Troop transfer to Storms** from other castles. | Trial/Green | UI |
| Attacks – Fortress | **Fortress** (kingdom fortresses) | **Kingdoms:** Burning Sands, Everwinter Glacier and Fire Peaks, each with a checkbox (default on) and a per-kingdom hit limit ("no limit").<br>**Per-kingdom preset:** wave editor.<br>**Commander indices.**<br>**Horse type.**<br>**Commander Reserve:** seconds before a fort frees. Holds commanders so other modules cannot take them; 0 = off. | Trial/Green | UI |
| Attacks – Green Berimond invasion | **Green Berimond** | **Commander indices.**<br>**Horse.**<br>**Army mode:** Autofill (event tools) or preset.<br>**Camp side:** All (red + blue), Red only or Blue only.<br>**Event tool options:** No Event Tools, Reputation Mode (prefers reputation tools over points), Low Value Chests.<br>Start/stop is done from Overview → Quick Start. | Trial/Green | UI |
| Attacks – Foreign Castles / Bloodcrows | **Invasion Events** (one config, auto-detects which event is live, attacks around the Green main) | **Commander indices.**<br>**Event difficulty:** Classic, Easy … Master+, Archmaster (default Intermediate+).<br>**Score shutoff.**<br>**Horse.**<br>**Minimum troops:** default 1000; pauses and waits for returns.<br>**Dethrone FC/BC:** Off, plus Exile/ruby options (disabled offline).<br>**Attack under protection:** a warning that it breaks the peace shield.<br>**Autofill:** tooled waves 1–4 (default 2); remaining waves use Chest tools or Troops only.<br>**Wave templates:** per wave, Moat (wall/gate/moat) or Shield (wall/gate/mantlet), with explained layouts such as "front: wall 15 / gate 15 / moat rest".<br>**Soldiers type:** All, Food only or Mead only.<br>**Include beef troops.**<br>**Low value chests.**<br>**Customise chests:** ordered pick list of glory tools.<br>**Support tools (AST):** war wagon (auto, capped Lv3), shrapnel bomb, organ cannon, hand cannon, assault flamethrower. 3 slots, auto-resolved to the highest owned level. | Trial/Green | UI |
| Attacks – Berimond | **Berimond** (marketing: auto camp builder, tower farming, advisor and player-attack modes) | Gated behind account selection. | Trial/Green | marketing + gated UI |
| Attacks – towers | **Towers** ("hits kingdom towers around the clock"; monitors and refills tools internally) | Gated. | Trial/Green | marketing + gated UI |
| Attacks – towers | **Leveller** ("force-levels up towers") | Gated. | Trial/Green | marketing + gated UI |
| Attacks – alliance boss | **Rift Raid** (multi-account) | **Command bar:** "Retreat all (N)", raid reading of boss, walls and marches.<br>**Tabs:** Accounts / Raid / Group settings.<br>**Accounts tab:** 3-step flow (select accounts → put in a group → Start), "More" menu, filters (All, No group/Custom, Running, Needs boss points, Offline), search.<br>**Raid tab:** per-alliance "wall breaker rules".<br>**Group settings:** named groups; accounts follow the group's settings. Editing one account's Settings makes it "Custom", and "Back to group" undoes that. Commanders stay per account. | Trial/Green (not in marketing list) | UI |
| Commanders & presets | **Autofill wave builder** (shared dialog) | **Fill sides:** Left, Front, Right, Courtyard.<br>**Waves:** 1–4. "Wave items add extras when 4 are configured".<br>**Tools (wave 1):** varies by module. Options seen: No tools / Combat tools (wave 1) / Event boosters + combat tools; Wall tools / Wall + Rams + Mants; Rage + booster waves.<br>**Khan booster waves:** rage-wave and booster-wave counts, Low-value boosters first, Customise rage boosters, Customise boosters (ordered tablet chests).<br>**Unit order:** Fastest first, Strongest first or Weakest first (economy).<br>**Troop supply:** Food troops only, Mead troops only or All troops.<br>**Min troops (wait below):** on top of a hard floor of one wave's capacity.<br>Explanatory text: wave 1 flanks lead with ranged and later waves with melee; caps are clamped by tower level, player level and camp/equipment bonuses. | Included with any plan | UI |
| Commanders & presets | **Manual wave editor** ("Configure Waves — <target>") | **Waves 1–4:** each as an accordion. Each wave can load an in-game **Server Preset** (Empty or Preset 1–30). The 4th wave's config repeats for extra waves.<br>**Support Tools (AST):** 3 slots, item list of Shrapnel bomb Lv1–10, Organ cannon Lv1–10, Hand cannon Lv1–10, Assault flame thrower Lv1–10 and Warwagon Lv1–4.<br>**Courtyard Soldiers (RW):** 8 slots of unit + count. The list has 100+ units, including event and renegade units. | Included with any plan | UI |
| Commanders & presets | **Virtual Presets** (dashboard-side presets independent of the 30 in-game slots, usable by modules instead of autofill) | Gated (account). | Included with any plan | UI + marketing |
| Commanders | **Commander indices per module + Commander Reserve** (Fortress) | Semicolon list per module. The reserve holds commanders to avoid cross-module conflicts. | Trial/Green | UI |
| Troops / tools / heal | **Recruit, Tools & Heal** | **Two recruiting styles:**<br>- **Rotation:** ordered rows; the FIFO queue keeps a mix such as 3×A:2×B; "Leave empty" rows trim on save.<br>- **Smart plan:** an absolute goal per troop type that counts stationed, travelling and in-production troops (wounded excluded). Batches shrink so goals are never overshot. The castle idles and re-checks about 30s after losses. ∞ goals fill after numeric goals and level against each other.<br>**Failure isolation:** per type, e.g. barracks level too low or special currency empty.<br>**Tools:** the same rotation or stock goals per tool family; all research tiers count, and the higher tier is produced when researched.<br>**Heal:** "automatic coin-heal" (marketing). | Trial/Green | UI help text + marketing |
| Tools / equipment purchase | **Armourer** | **Tool Targets:** add rows per kingdom × tool. Stock is checked hourly from inventory data that is already polled, so it adds no extra traffic. When below target it buys the deficit + 4,000 headroom. "Top Up Now".<br>**Coin Overflow Burn:** switch. When coins reach a threshold, a basket of tools is bought, because the coin cap of 2,147.48M means income above it is lost.<br>**Safety limits:** coin floor; spend cap per run (0 = off).<br>**Buttons:** Start Rules, Save Config. | Trial/Green | UI |
| Shops / events | **Blacksmith & Event Shops** | **Six tabs:** Nomad/Khan event shop (121 packages), Samurai event shop (157), Blacksmith silver shop (111), Everwinter / Burning Sands / Fire Peaks villages (8 each).<br>**Per event shop:**<br>- Enable switch.<br>- **Launch rule** (pick one): Spend once when events start (default); Start buying when event ending in N min; Buy when currency reaches X (e.g. Khan tablets ≥ / Khan medals ≥); Manual only.<br>- "Only when ending" packages always fire in the last 30 min.<br>- **Currency floors and spend cap per event,** per currency.<br>- **Buy list** in priority order, with max items per package (0 = spend all down to the floor).<br>- **Package catalog** with cost, shop limit, level gates (e.g. "up to LL600", "LL650+") and "Refresh offers"; it can be configured offline.<br>**Villages:** pay with the kingdom resource (Coal / Oil / Glass). Options: keep at least N, buy every N minutes, buy list with max items received per pass. Catalog grouped by village level. | Trial/Green | UI |
| Shops | **Offer Buyer** (personal limited-time ruby offers) | Offers are listed as they arrive. **Watcher:** watch mode notifies on the dashboard and Discord. **Plain-language buy rules**, e.g. "buy offers that contain Affluence tickets and Sasaki's Offering", plus an Auto-buy toggle that buys the cheapest matching option. Item "kind chips" (◈). **Ruby reserve and daily spend limit.** Never buys a one-time deal twice. Handles not-yet-unlocked offers. Purchase history. | Trial/Green | UI help text |
| Events | **Live Wheel Spin** | Auto-spins the "Wheel of Unimaginable Affluence" (sale-days event), one spin per server confirm, so "thousands of tickets clear in minutes". Marketing also says it "snipes event-end ranks". | Trial/Green | UI + marketing |
| Boosters | **Overseers** | Keeps boosters extended and rebuys them on sale. Gated. | Trial/Green | marketing + gated UI |
| Resources | **Food Manager** | Anti-desertion food logistics across kingdoms. Gated. | Trial/Green | marketing + gated UI |
| Buildings / construction | **Castle Manager** | **Global settings:**<br>- Upgrade ruby-cost buildings, with a daily ruby cap (0 = none).<br>- Auto-expand when out of space (wood and stone only, never rubies).<br>- Move buildings to make space.<br>- Store decorations to make space (decorations only).<br>- Repair before build/upgrade.<br>- Repair via alliance help (3 clicks; notes the game pauses requests about 3h after a burst).<br>- Repair with resources (alliance help goes first).<br>- Use time skips: 1m–24h, largest that fits, else smallest in stock.<br>Defaults shown: rubies off, skips off, move ✓, store decos ✓, repair first ✓.<br>**Per castle** (Storms and Berimond excluded):<br>- **Building goals:** ordered work list with arrows; counts clamped to game caps.<br>- **Castle ring target levels:** Castle Wall L1–9, Gate L1–9, Moat L1–4, Wall Towers L1–9.<br>- **Repair priority:** reorderable categories (Storage, Economy & Production, Military, Relic & Districts, Walls & Defense), each with its building list explained.<br>**Material moving:** castle-to-castle transfer rules, with "skip the transfer travel" (default on) using the selected skips. Marketing adds "keeps boost items alive". | Trial/Green | UI |
| Buildings – BTH | **BTH Castle Builder** | Goal-driven construction of buildings, wall ring and expansions. Gated. | BTH | marketing |
| Crafting | **Refinery & Toolsmith** ("Crafting") | Recipes are chosen online or offline. Unlocks are checked each pass. "Never uses rubies or time skips". Covers Refinery, Toolsmith, Dragon Hoard and Dragon Breath Forge loops. | Trial/Green | UI + marketing |
| Feasts | **Auto-Feast** | Keeps feasts running for permanent PO. Config gated. | Trial/Green | marketing + gated UI |
| Equipment | **Equip Sell & Forge** | Sells junk gear and forges upgrades. Gated. | Trial/Green | marketing + gated UI |
| Equipment – BTH | **Equipment Manager** | Sells junk event gear and builds speed or coin-cost commander loadouts. | BTH | marketing ("Not included in your plan" in trial) |
| BTH / Outers | **Coin Farmer, BTH Blacksmith, Influence Farming, Event Recruiter, OR Storms, MP Builder** | Coin Farmer runs coin loot round the clock. Influence Farming farms players, snipes city-states and raids alliance capitals. Event Recruiter auto-recruits chosen troops in every BTH castle. One event server runs at a time; the realm is detected on connect. "Quick Start" reuses a stored event token so the main server does not need to be online. | BTH / Outers | marketing + Overview text; mostly plan-locked |
| PvP / defense | **Alert + Autostation** | Attack alarms with instant defense stationing. "Choose who gets alerted, where troops go, and what stays home." Can be edited offline. | Trial/Green | UI + marketing |
| PvP | **Asset (Capture) Monitor** | Continuous asset tracking with alerts and "autobreak per config". Gated. | Trial/Green | marketing + gated UI |
| Alliance / social | **Messages** | Mailbox cleanup (battle reports) and alliance chat from the dashboard. | Trial/Green | UI + marketing |
| Multi-account | **Multi-account dashboard** | Add Game Account dialog: game username, game password, searchable server list (default "India"). Overview stats: Active, Hits Today, Coins, Rubies. Main and Outers/BTH views. **Quick Start** per account. Licence slots (1 free in trial). Rift groups apply settings to many accounts. | Included with any plan | UI |
| Dashboards / live data | **Live View** | Per-account castle troop and tool stock, with Main and Outers/BTH tabs. | Included with any plan | UI |
| Logs | **Logs** | Level filter (All, Debug, Info, Warning, Error), account filter, "Following" (live tail), entry count, times shown in the user's zone. | Included | UI |
| Notifications | **Discord notifications** | Per-account Discord settings live under Account Settings (gated). Used by the Offer Buyer, alerts and others. Times follow the user's time zone. Notification bell in the top bar. | Included with any plan | UI + marketing |
| Settings | **Account Settings** | User time zone (auto-detected from the browser, with "Use my browser's zone"). Per-game-account settings are gated. | Included | UI |
| UI/UX | Themes, sidebar module icons, plain-English help everywhere | 4 themes. Every option has a long inline explanation. Many configs can be edited offline. Translate-guard script so browser translation does not break React. | Included | UI |
| Anti-ban / humanization | Not seen | No delay, jitter, proxy or schedule-window settings were visible anywhere. Traffic-saving notes appear instead ("zero extra traffic"; protection-break warnings). | — | absence in UI |
| Scheduling | Event-relative timing only | Shop launch rules (event start, last N min, currency threshold), village "buy every N min", Score Shutoff, Commander Reserve, pause at N taunts. There is no generic cron or time-window scheduler. | — | UI |
| Quests / daily rewards / gifts / hospital | Not offered | No quest, daily-login, gift or chest-opening module. Healing only via "automatic coin-heal" in Recruit, Tools & Heal. | — | absence |
| Account / billing | Credits plus manual admin top-up | 2-day trial; Green costs 12 creds and BTH +4 creds. Plans are extended through Discord admins, and a verified email is required to request an extension. | Paid – advertised, not verified | UI + landing |

## Gated or unreachable areas

- **Every per-account config needs an added game account.** These pages showed only an account picker: Berimond, Towers, Leveller, Overseers, Food Manager, Messages, Virtual Presets, Live View, Auto-Feast, Equip Sell & Forge, Crafting recipes, Utility rows, Alert + Autostation, Asset Monitor, per-account Discord settings, and the castle layout in Castle Manager. Adding an account requires a real GGE login, so I stopped there.
- **Not in the trial plan:** BTH Coin Farmer, BTH Blacksmith, Influence Farming, Equipment Manager, OR Storms and MP Builder. Each shows "Not included in your plan – contact admin".
- **Inside the manual wave editor,** the per-wave left/front/right slot editing appeared only as the Server Preset picker. Troop and tool slots per flank were not exposed offline.
- **Pricing:** the price of a credit and the payment method are not public. Purchases go through Discord admins.
- **No public docs, FAQ, changelog or YouTube** were linked. The Discord server is the only community channel.

## Notable for a competitor

- **Depth of event coverage:**
  - The shop automation has 4 launch rules, per-currency floors and per-event spend caps, an offline-configurable catalog with level gates, and "only when ending" packages.
  - Village shops paying with kingdom resources.
  - Coin-overflow burn: it buys tools so coins above the 2.147B cap are not wasted.
  - A Khan rage optimiser and a tablets-only mode.
  - Commander Reserve across modules.
  - Rift Raid group orchestration with "Retreat all".
- **Plain-language Offer Buyer rules** with a ruby reserve and daily cap, and Discord pings for new personal offers.
- **Smart-plan recruiting:** absolute deficits, ∞ goals that level against each other, and per-type failure isolation.
- **Castle Manager:** ordered building goals, castle ring target levels, a repair-priority ordering with alliance-help repair (it knows the ~3h throttle), auto-expand without rubies, and moving buildings or storing decos to make space.
- **Polish:** long, specific help text on every control, defaults chosen for the user, offline config editing, colour themes, logs in the user's zone with a live "Following" tail, and one Overview Quick Start.
- **Gaps:**
  - No visible anti-ban, humanization or proxy options.
  - No time-window scheduler.
  - No quests, daily rewards or gifts.
  - No Telegram or email notifications; Discord only.
  - Manual credit billing through Discord.
  - Outers tier not launched.
  - The trial excludes BTH.
