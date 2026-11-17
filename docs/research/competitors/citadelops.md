# CitadelOps (citadelops.app): competitive research

Researched 2026-11-16. I read the public marketing site, pricing, how-it-works and terms. I also read the signed-in **Setup guide** (`/guide`, about 2,000 lines of per-setting reference) and the Account Center pages, using a disposable CitadelOps account. I attached no game account, so the real Command Center was never reachable. All Command Center detail below comes from the official guide text and the guide's illustrative screenshots (fictional data). No settings were changed and nothing was started.

On 2026-11-17 I repeated the pass read-only and kept screenshots, page text, the guide's 42 images and API samples in `.audit/citadelops/` (see its README for the route table). In this doc, `shots/NN` means `.audit/citadelops/shots/NN-*.jpg` and `img:` means a file in `.audit/citadelops/guide-images/`. That pass also used no game account, so the Command Center is still unverified.

## Summary

- **Product.** A hosted cloud bot for Goodgame Empire and Empire: Four Kingdoms (E4K). The account-add dialog has a Game selector with both games. You give CitadelOps your game username and password. Its servers keep the account logged in 24/7 and run "routines" while your browser is closed. Nothing to install. The dashboard ("Command Center") works on phone, tablet and desktop.
- **Tagline.** "The easiest castle automation app." The site is at Portal v3.2.1, and the "What's new" anchor is `#new-in-236`. Neither had changed on 2026-11-17. The terms and privacy pages say "Updated August 31, 2026".
- **Sign-up.** Passkey with a username, Google, or Discord. No email or password, and no captcha seen. The passkey sign-up worked with a virtual authenticator.
- **Game login.** Username and password on a listed world. Steam and other sign-ins, unlisted worlds and the mobile edition are not supported. The password is "encrypted before it is stored" ("sealed"; only the automation playing the account receives it).
- **Worlds.** The Game world list depends on the Game selector (shots/27, shots/28).
  - GGE (39): ARAB1, ASIA1, AU1, BR1, BG1, CN1, CZ1, EG1, FR1, DE1, GR1, HIS1, HU1, HU2, IN1, INT1, INT2, INT3, IT1, JP1, LT1, NL1, PL1, PT1, RO1, RU1, SA1, SKN1, SK1, KR1, ES1, ES2, HANT1, TR1, AE1, GB1, US1, WORLD1, WORLD2.
  - E4K (35): ARAB1, AR2, ASIA1, AU1, BR1, CN1, FR1, DE1, DE2, GR1, HIS1, IN1, ID1, INT2, INT3, INT4, IT1, JP1, KR1, MX1, NL1, PH1, PL1, PT1, RU1, RU2, SKN1, ES1, HANT1, TR1, GB1, US1, US2, WORLD1, WORLD2. `/api/game-servers?game=e4k` lists these as `tcp://…:443` hosts, so E4K is played over the raw TCP socket, while GGE uses `wss://`.
- **Pricing.** Credit packs, not a subscription. 1 credit = 30 calendar days for one game account (one player on one world).
  - 1 credit: $20
  - 5 credits: $75 ($15 each)
  - 10 credits: $100 ($10 each; the billing page says "10+ credits $100+")
  - Credits are bought by contacting staff on Discord. There is no in-site checkout.
  - Credits have no expiry, can be shared with another username or linked email (no fee, irreversible), and support per-account auto-renew.
  - **Referral:** a personal sharing code. You earn 1 bonus credit each time friends' combined purchases with your code reach 20 credits.
- **Free trial.** 7 days (168 h) with all features, once per game account, ever. It starts at the first successful game login and never pauses. Routines stop at the end and nothing is charged. While on trial, the game account can't be added to another CitadelOps account. Adding a game account with "Start now" off uses no credit.
- **No feature tiers.** Every credit unlocks every feature ("Every pack. Full access."). So "Paid" below means "needs an active trial or credit". I could not verify any of it without attaching a game account.
- **Scale.** Discord "Citadel Ops" has about 100 members (24 online on 2026-11-16, 17 on 2026-11-17). The landing page shows live aggregate stats over a rolling 24 h. The API (`/api/public/automation-activity`) needs at least 3 reporting accounts and returns "lower / typical / higher" values; the page says the range is the middle 60% of accounts.

  | Stat | 2026-11-16 | 2026-11-17 00:44 (shots/03) |
  |---|---|---|
  | Rubies looted | ≈122,556 | ≈202,058 |
  | Completed attacks | ≈17,907 | ≈30,073 |
  | Rubies per account, typical (range) | 3,497 (724–17,001) | 16,603 (2,660–23,482) |
  | Might per account, typical (range) | +41,951 | +122,475 (−89,619 to +202,999) |

  The totals rose about 65% in a day, so either usage is growing fast or the window is noisy. Treat them as marketing numbers.
- **Languages.** EN, DE, FR, PL, CS. Light and dark theme, plus compact or comfortable spacing.
- **Ban stance.** The FAQ says plainly: "Yes. Third-party automation carries a ban risk… no ban-free guarantee."
- **Architecture** (from network traffic and the JS bundles, not from a running bot):
  - One React SPA on `citadelops.app` with a JSON API under `/api`. The API covers passkey auth, `/api/user` and a hosted control plane under `/api/hosted/*`.
  - The control plane handles: accounts, credentials, actions, per-account shared access (`/access`, GET/PUT/DELETE, with a role that can't start or stop the runtime), a stable or beta worker channel per account (`/channel`), config revisions, an offline `checkpoint` ("Bot offline. Showing the last saved state"), metrics, and a `dashboard-session`.
  - The Command Center then talks to `/runtime/accounts/{runtimeId}`, with direct runtime hosts under `citadelops.net`.
  - Deleting an account during its trial needs `confirmTrialLoss`.

## Core concepts (UX model)

- **Routine cards** sit on an Automation page grouped into Offense, Production & Building, and Resources & Upkeep. Each card shows:
  - an on/off switch and a "…" menu
  - a status line, for example "Waiting · no available assigned commander supports the required maiden relic", "Needs changes · fix Attack preset 1" or "Off · needs a Gallantry booster"
  - a counter such as "84 attacks today"
  - buttons: Set up / Edit / Fix / Check booster / Guide me through this
- **Two sets of names.** The Command Center uses "Auto X" names. The public site uses generic names. In the same Automation screenshot shown twice (img: `ui-panel-round8__current-automation.webp` in the guide, `marketing__public-automation.webp` on the landing page), the cards pair up as follows:
  - Event planning = Auto Advisor
  - Seasonal routines = Auto Fortress
  - Event routines = Auto Invasion
  - Camp management = Auto Nomad / Samurai
  - Tower attacks = Auto Towers
  - Attack and defense = Auto Khan
  - Player camp attacks = Auto Beri PvP
  - Event attacks = Auto Beri World
  - Island management = Auto Storm
  - Troop shelter = Auto Bird
  - Incoming defense = Auto Station
  - Recruitment, Tool production, Resource production, Food balance, Building upgrades and Construction items = Auto Recruit, Auto Tool, Auto Sceat Resources, Auto Food Balance, Auto Builder and Auto Construction Items

  The landing page's text list (shots/06) gives some of these names different descriptions, and it adds "Fortress attacks", so the marketing copy is not consistent. The same screenshot has a **"Choose a goal"** button at the top right of the Automation page, which the guide text doesn't describe.
- **Simple vs Advanced mode** per routine. Simple asks only for the troops and tools it may use plus a goal (score or stock target), and has a "Use recommended setup" button. Advanced exposes presets, difficulty, travel, budgets, scan timing and so on. Simple is the default for new setups.
- **"Before you start" / "Setup checks" side panel** in every settings dialog. It is a live readiness checklist with green and amber items. Examples:
  - "Source castle is in the Great Empire"
  - "Every event has an unlocked difficulty"
  - "Stops at 1,000,000 event points"
  - "2,487 of 4,500 daily attacks used"
  - "Travel uses the horse or ship tier paid with coins"
  - "40 assigned commanders qualify"
  - "Each target is spied and its attack planned at launch"
  - It also shows a "Plan" summary, such as "Never buys Ruby-priced packages; keeps 0 Rubies in reserve", and jump links to each settings group.
- **Spending transparency.** Each routine states what currency it may spend before you enable it. Ruby spending always needs an explicit toggle and a reserve. "Save changes" stays disabled with the reason shown beside it until required fields are valid.
- **Run controls on every routine:**
  - "Run for a set time": 1 minute to 7 days, then auto-stop.
  - "Calendar": a weekly schedule with day and time slots. Auto Bird can use a different preset per calendar period.
  - "Stop" prevents new actions; attacks and transports already sent still finish.
- **Waiting-reason taxonomy:**
  - Attacks: free commander, troops, tools, available target
  - Production: queue space, resources, unmet target
  - Daily limit: wait for reset
  - Goal reached: work complete
- **Header bar:** castle selector, connection pill ("Connected"), daily attack counter (e.g. 2,487), and live status pills for Auto Bird and Auto Station with gear buttons. An "Account Center" button and a multi-account switcher sit top right.
- **Commanders → Functions.** Per-automation commander permissions and requirements, saved automatically. Assigning a general applies in-game at once. "Live Movements" is a read-only view. Routines wait for busy commanders to return.
- **Storm castle role card.** It applies to whichever Storm castle you currently own, so setups survive each new Storm season.

## Feature inventory

The "Free/Paid" column reads "Paid*" throughout. That means it needs a trial or credit, all features come with any credit, and it is advertised but not verified.

| Category | Feature / plugin | Configurable options seen (range / default / recommended) | Free/Paid | Evidence |
|---|---|---|---|---|
| Attacks: barons/towers | **Auto Towers** ("Tower attacks") | **Simple:**<br>• "Use recommended setup" (one full wave per attack, stocked troop, no advisor spending)<br>• Per-castle "Attack from here" switch, Troop, Radius in tiles (1–1,820, rec 35)<br>• "Towers in range" preview<br>• "Copy to other castles…"<br>• Commanders (rec 20 assigned)<br>**Advanced:**<br>• Per-castle Attack mode: Full waves of one troop / saved Preset / Custom<br>• Waves 1–30<br>• "Maiden-supported only" (needs a commander with the maiden relic)<br>• Authoritative map scan every 1,800–3,600 s (rec 1,800)<br>• Daily normal-attack limit (account-wide; 0 = none; rec 3,500)<br>• Horse travel boost: Travel feather / Horse-ship (coins) / Warhorse-fast ship (rubies) / Courser-fastest ship (rubies)<br>• "Use Advisor with Time Skips" (repeats hits on one tower using ≥3 h skips; the user must activate the Baron Advisor in-game)<br>• Max daily Time Skips (0 pauses advisor)<br>• Per-size skip allow and keep amounts<br>• Storm castle card | Paid* | Guide; shots/49; img: `ui-panel-round4__auto-towers.webp`, `guide-auto-towers-general.png`, `guide-auto-towers-castle.png` |
| Attacks: robber-baron/kingdom towers | Same routine, scoped to "robber-baron and kingdom towers"; "Scan up to 1,820 tiles and preview the tower count" | as above | Paid* | Marketing; shots/04, shots/06 |
| Attacks: fortresses | **Auto Fortress** ("Seasonal routines" on the demo card) | • Per kingdom: Everwinter Glacier / Burning Sands / Fire Peaks (outer-kingdom main castles only)<br>• Direwolves per session: bought in the Nomad shop in batches of 100, up to 100,000 per session; 0 = no buying; rec 5,000<br>• Keep Khan tablets reserve (rec 25,000)<br>• Use time skips for Direwolf transfers, with reserves<br>• Picks the fastest eligible assigned commander per fortress (gear, gem, set and general speed after caps)<br>• Travel option<br>• Daily normal-attack limit<br>• Calendar<br>• Each attack waits for a full Direwolf flank wave<br>• Direwolves are bought in the Great Empire and distributed to the kingdoms | Paid* | Guide; shots/53; img: `guide-current-auto-fortress.png` |
| Attacks: fortress boost | **Auto Booster** / Fortress boost in Auto Buyer | Buys the daily fortress speed boost for exactly 2,500 rubies, keeping the ruby reserve | Paid* | Guide; shots/51; img: `ui-panel-round2__auto-buyer.webp` |
| Events: Nomad/Samurai | **Auto Nomad / Samurai** ("Camp management" on the demo card; "Four-camp levelling and locked-target attack chains") | **Attack type:** Regular attacks or Advisor attacks (the event advisor sends coin-paid runs).<br>**Activate advisor:**<br>• Manual button, confirmed<br>• "Activate advisor automatically" uses an event token, else a universal token (rec off)<br>**Simple:**<br>• Nomad attack preset / Samurai attack preset = "Auto Battle Waves" or a saved preset<br>• Attack from castle<br>• Troops it may send<br>• Tools it may use (only event-allowed tools)<br>• Booster chests per attack (0 = fill free tool room)<br>• Stop at score / Score target (0 = none)<br>• Auto Battle Waves picks waves, difficulty (up to Expert+ or the highest unlocked) and travel<br>**Advanced:**<br>• Per-event difficulty or Classic mode<br>• Attack camp: Auto select or one of 4 camps<br>• Attacks per run (advisor)<br>• Daily attack limit<br>• Coins per attack + coins to keep<br>• Rubies per attack + to keep<br>• Skip cooldowns with allowed time skips and keep amounts<br>• Travel (feather / coin / ruby)<br>**Behaviour:** levels the 4 camps, picks the cheapest camp, spies each camp and plans each attack at launch | Paid* | Guide; shots/50; img: `guide-current-auto-nomad.png` |
| Events: Nomad/Samurai advisor | **Auto Advisor** ("Event planning" on the demo card) | Its own card in the current Automation screenshot: "Runs the Nomad or Samurai advisor during the event." The guide text has no section for it. It documents advisor runs as the "Advisor attacks" type inside Auto Nomad / Samurai | Paid* | img: `ui-panel-round8__current-automation.webp`, `marketing__public-automation.webp` |
| Events: Nomad/Samurai camps | **Camp management** (marketing name) | On the demo card this is Auto Nomad / Samurai ("Attacks Nomad or Samurai camps until your score target"; "fix Attack preset 1"). The landing list instead describes it as "Supplies, builds and runs your faction event camp", which matches no routine in the guide. | Paid* | shots/06; img: `marketing__public-automation.webp` |
| Events: Khan | **Auto Khan** ("Attack and defense") | • Attack from (GE main castle or outpost); Defend at (GE main, read-only)<br>• Camp attack preset; Main defense preset (reapplied before retaliations)<br>• Simple: allowed troops and tools, defense tools, "Pick the castellan's general", "Swap the castellan's gear"<br>• Horse travel boost<br>• Lock automatic Khan attacks<br>• Trigger Khan retaliation at full rage<br>• Max rage chain (0 = no cap)<br>• Require Rage points booster<br>• Stop at Khan points: recalls attacks and opens main gates at the ruby price; 0 disables<br>• Replenish defense tools (non-ruby offers)<br>• Daily normal-attack limit (Simple default 4,500)<br>• Stop before event end (rec 5 min)<br>• Skip every Khan camp cooldown (required on)<br>• Keep 1m/5m/10m/30m/1h/5h/24h skips<br>• Protect offense on main-castle wall: 6 h gates at the ruby cost when own offensive troops on the wall ≥ threshold (rec 1,000)<br>• Player attacks yield to Auto Station; Khan taunts excluded | Paid* | Guide; shots/50; img: `guide-current-auto-khan.png` |
| Events: Foreign Lords / Bloodcrow (invasion) | **Auto Invasion** ("Event routines") | • Source castle (GE)<br>• Simple: troops it may send, optional tools<br>• Banners per attack (0 = fill free tool room)<br>• Stop at event score (must be > 0)<br>• "Reconfigure commanders" (equips assigned commanders from a shared gear pool; gems stay attached)<br>• Advanced: Attack preset; Horse travel boost; Foreign Lords difficulty; Bloodcrow difficulty<br>• Stop before event ends (rec 30 min)<br>• Daily normal-attack limit (default 4,500)<br>• Fortify each target, with a fortification currency (event currency or explicitly chosen rubies)<br>• Automatic difficulty up to Expert+<br>• Fills spare slots with flags and banners | Paid* | Guide; shots/50; img: `guide-current-auto-invasion.png` |
| Events: Storm Islands | **Auto Storm** ("Island management") | • Automatically open Storm castle + choice of starter castle (price shown)<br>• Construction target capture modes: Functional / Layout / Exact clone; Pause target<br>• Decoration preset after construction<br>• Transport missing resources from donors<br>• Use time skips for construction and transport<br>• Allow premium costs; Allow demolition<br>• Protected donor reserves (wood, stone, Aquamarine)<br>• Time-skip reserves per size<br>• Upgrade Harbor, target level 1–3 (2–3 premium)<br>• Horse travel boost<br>• Storm forts: levels 40–80, per-level enable<br>• Fort attack preset: saved / configure here<br>• Minimum attacks remaining<br>• Attack target priority (level order; nearest first)<br>• Import missing troops from ordered donor castles<br>• Minimum troops kept after launch (rec 1,000)<br>• Storm committed-troop cap (blank = auto)<br>• Map coverage view<br>• Luna Aquamarine shop: Keep Aquamarine, search reward, Use reward, Target total, Unlimited, Priority<br>• Daily attack limit<br>• Policy check interval (default 30 s)<br>• Map refresh (read-only, 2 h)<br>• Auto Food Balance is forced on while Storm runs | Paid* | Guide; shots/50; img: `guide-current-auto-storm.png` |
| Events: Berimond | **Auto Beri World** ("Event attacks" in demo; "Plays the Battle for Berimond: moves troops, attacks towers and builds your camp") | • Tower attack preset: saved / configure here<br>• Source castle (GE or outpost)<br>• Travel; attack check interval (30 s)<br>• Daily attack limit<br>• Proportional troop transfers to keep the preset's troop mix (Food-fed troops only; partial donor stock OK; waits for the pending transfer)<br>• Minimum free capacity (rec 1)<br>• Troop transport time skips with keep amounts<br>• "Only run with a Gallantry booster" gate<br>• Camp tool minimums: scaling ladders / battering rams / mantlets, bought with coins<br>• Builder lane (uses returned loot only), Faction Stable target level 1–5<br>• Custom camp target capture (Functional / Layout / Exact clone)<br>• Construction time skips; Allow premium costs; Allow demolition<br>• Wood and Stone reserves<br>• Per-size construction skip reserves<br>• Calendar | Paid* | Guide; shots/50; img: `guide-current-auto-beri-world.png` |
| Events: Berimond PvP | **Auto Beri PvP** ("Player camp attacks", **Beta**) | • Target mode: Nearest camps (N camps) or Chosen players<br>• Attack preset or configure<br>• "Current plan" preview<br>• Travel option<br>• Skips protected or destroyed camps | Paid* | Guide; shots/50; img: `ui-panel-round8__current-beri-pvp.webp` |
| Events: upcoming | **Auto Daimyo** ("Coming soon: tracks the Legion and plans your Daimyo attacks") | none | n/a | Seen in a screenshot on 2026-11-16. Not in the 2026-11-17 guide text, guide images or landing page |
| Events: Rift | **Rift Raid** | • Replay: capture an attack template in-game, pick a source castle, use the captured commander or any; Replay or Schedule<br>• Maiden Comms wave probes: 11 troops per flank, probe goal, Send probe, Cancel run | Paid* | Guide; shots/54; img: `ui-panel-round2__rift-tools.webp` |
| Attack scheduling | **Attack Scheduler** (Settings → Attacks) | • Random Attack Timer Range: min/max delay in seconds between sent attacks; minimum 4.0 s "to avoid rate limiting" (screenshot shows 4–4.1)<br>• **Automated Attack Priority:** drag-to-reorder modules (e.g. 1 Rift Replays, 2 Rift Maiden Waves…); waiting time ages older work upward; manual and scheduled attacks keep protected priority | Paid* | img: `ui-panel-round2__settings-updates-support.webp` |
| Manual attacks | **Alliance Targets** | • Choose an alliance; search and filter target castles<br>• Spy (sends all available spies; shows report age)<br>• Attack: source castle + preset, formation review, then launch<br>• "View spy formations and attackable targets, with commanders and generals chosen for you" | Paid* | Guide; shots/54; img: `ui-panel-round2__alliance-targets.webp` |
| Commanders & presets | **Attack Presets / Defense Presets** | New preset: troops, tools, quantities, name. Chosen per routine; quantities adapt to commander and target capacity | Paid* | Guide; shots/54; img: `ui-panel-round2__attack-defense-presets.webp` |
| Commanders & presets | **Equipment & Commanders** | Equipment list with filters; Commanders → Functions (per-automation allow lists and requirements, general assignment); Live Movements (read-only) | Paid* | Guide; shots/54; img: `ui-panel-round2__equipment-commanders.webp` |
| Commanders & presets | **Hall of Legends** | Legend-skill presets: allocate points, Save preset (doesn't apply), Apply with reset-cost confirmation. "Apply a skill preset in one click" | Paid* | Guide; shots/54; img: `ui-panel-round8__current-hall.webp` |
| Analysis | **PvP Coach** | Lists your scored battles; shows score, losses and a suggested setup. "Compare recorded battles with the best plan found in combat simulations." Analysis only | Paid* | Guide; shots/04, shots/54; img: `ui-panel-round8__current-pvp-coach.webp` |
| Analysis | **PvP Leaderboard** | Global leaderboard built from opt-in shared PvP battle reports; Find me and search unlock once you share. Opt-in toggle is in Settings | Paid* | Guide; shots/54; img: `ui-panel-round2__stats-and-results.webp`, `ui-panel-round2__settings-updates-support.webp` |
| Troops/recruitment | **Auto Recruit** | Simple: Add troop → target stock, priorities (units can share a priority), "All tiers" counts the family and recruits the highest tier, castle selection. Stock counted account-wide (home + queued + away; wounded excluded). No ruby recruitment | Paid* | Guide; shots/49; img: `ui-panel-round2__auto-recruit.webp` |
| Tools | **Auto Tool** | Add tool → target stock, priority, "All levels", castle selection; account-wide stock (home + queued + travelling); no ruby production | Paid* | Guide; shots/49; img: `ui-panel-round2__auto-tool.webp` |
| Resources/crafting | **Auto Sceat Resources** ("Resource production") | **Simple:**<br>• Automatic component balance (crafts the lowest total first)<br>• Long recipes<br>• Auto-rents all extra active and queue slots for coins; 10,000,000 coin reserve<br>• No rubies; skips up to 5 h<br>• Dragon materials crafting with a max (0 = unlimited)<br>**Advanced:**<br>• Minimum coin reserve; minimum ruby reserve<br>• Resource logistics toggle; Use Storm as overflow buffer<br>• Allow ruby recipes<br>• Ruby-skip blocked overflow (finishes 1 craft per cycle at the ruby price when storage > threshold)<br>• Per-building (Encampment 1/2…) on/off; Rent second active slot (5m coins / 7 d); Rent extra queue slots (0.5m–10m coins / 7 d)<br>• Repeating recipe cycle<br>• Check timing (every 5 min; shipments from 50,000; overflow at 90% storage)<br>• Transport time skips; Additional storage nodes; Paid travel | Paid* | Guide; shots/51; img: `ui-panel-round2__auto-sceat-resources.webp` |
| Resources/trading | **Market barrows** (Settings) | Minimum shipment (≥1, default 1,000); rounds smaller when donors can spare | Paid* | img: `ui-panel-round2__settings-updates-support.webp` |
| Food | **Auto Food Balance** | Donor castles; food and coin reserves kept at donors; check interval; amount to send; transport and travel cost allowance. Balances Food, Honey, Mead and Beef | Paid* | Guide; shots/49; img: `ui-panel-round2__auto-food-balance.webp` |
| Troop transfers | **Auto Troops Manager** | **Simple:** "Use recommended setup" (event holds with an 18 h lead; no redistribution)<br>Options:<br>• Bring event troops home N h before events (uses the game's event forecast)<br>• Troop destinations (redistribution before Auto Bird)<br>• Smallest move<br>• Per-castle reserves<br>• Kingdom-transfer time skips | Paid* | Guide; shots/52; img: `ui-panel-round8__current-troops-manager.webp` |
| Buildings | **Auto Builder** | Castles and kingdoms to build in; use Legendary Tokens toggle; resource reserves; Calendar; permanent kingdoms only; "Keep" ignored by default; no rubies or event tokens; waits for repair of damaged buildings | Paid* | Guide; shots/51; img: `ui-panel-round2__auto-builder.webp` |
| Construction items | **Auto Construction Items (TCI)** | Per castle: item, min/max item level, optional saved preset; equips and renews | Paid* | Guide; shots/51; img: `ui-panel-round2__auto-tci.webp` |
| Construction/decor | **Decorations** (Live Ops) | Save the current decoration layout per castle (name ≤40 chars); apply saved layouts | Paid* | img: `ui-panel-round8__current-live-ops.webp` |
| Equipment | **Auto Equipment Cleanup** | Rarities to sell (non-relic); automatic gem cleanup runs even with no rarity selected | Paid* | Guide; shots/51; img: `ui-panel-round2__auto-equipment-cleanup.webp` |
| Healing | **Auto Hospital** | Check interval; Calendar. No priority controls. Troops that need rubies to heal are **discarded** | Paid* | Guide; shots/49; img: `ui-panel-round2__auto-hospital.webp` |
| Feasts / specialists / shop | **Auto Buyer** ("Stock and supplies") | • Account-wide: Great Empire main castle; Keep at least rubies; Allow ruby-priced shop packages (no daily cap)<br>• Tabs: Ruby offers / Shops / Specialists / Feast<br>• Buy limited-time ruby offers when they contain a watched item ≤ its ruby limit<br>• Watched items list + "Ruby offers open now"<br>• Shop item goals with quantities and reserves<br>• Renew selected specialists and feasts<br>• Fortress boost<br>• Check timing | Paid* | Guide; shots/51; img: `ui-panel-round2__auto-buyer.webp` |
| Daily rewards / tax | **Auto Freebies** ("Free rewards") | • Daily login reward (daily, Alliance and VIP rewards; no rubies)<br>• Repair help: asks the alliance to repair damaged buildings; skips after repeated failures; tied to the main switch<br>• Auto tax: duration; never starts ruby-cost tax unless permitted | Paid* | Guide; shots/51; img: `ui-panel-round2__auto-freebies.webp` |
| One-off actions | **Live Ops** "Do something once, right now, without an automation" | Tabs: **Run once** (Decorations, Shops, Wheels, Gacha, Troop cleanup) and **Alliance** (e.g. alliance boosts). Confirmation before spending | Paid* | Guide; shots/54; img: `ui-panel-round8__current-live-ops.webp` |
| Boosts | "Daily boosts" | "Applies selected boosts only within the spending limits you approve" | Paid* | Marketing; shots/06 |
| Player battles | "Player battles" | "Runs only the player battles you set up, within the limits you set" (= Beri PvP / Rift replay) | Paid* | Marketing; shots/06 |
| Defense / anti-attack | **Auto Station** ("Incoming defense") | • Evacuate before landing (minutes; rec 1; at least 5 s after detection)<br>• Minimum protection left (RPT days, rec 3)<br>• Recall when clear (rec on)<br>• Open gates as fallback (6 h gates, possibly rubies; not in Berimond)<br>• Purchased Protection Mode paid-gate permission (off by default)<br>• Per-castle troops left to defend, with Storm castle card<br>• Destination = alliance castle with protection | Paid* | Guide; shots/52; img: `guide-current-auto-station.png`, `guide-auto-station-settings.jpg` |
| Troop sheltering | **Auto Bird** ("Troop shelter") | • Random stationing delay Min/Max hours (rec 6 / 12)<br>• Minimum to send (rec 1,000 eligible)<br>• Minimum RPT (rec 3 days)<br>• Preferred targets<br>• Per-castle troops kept home<br>• Automatic Direwolf reserve when Auto Fortress locks them<br>• Storm castle reserve<br>• Named presets: Load / Apply / Save as new / Delete<br>• Calendar with a preset per period | Paid* | Guide; shots/52; img: `guide-current-auto-bird.png`, `guide-auto-bird-general.png`, `guide-auto-bird-castle.png` |
| Alliance | **Alliance Discord bot** | Setup wizard: Add bot, Connect Discord, Link account, Connect server, Pick channels.<br>Commands:<br>• /help, /link (chat code), /unlink, /status<br>• /aboost and /boost (buy an alliance boost)<br>• /citadel-setup, /alerts (test)<br>Alerts:<br>• Incoming attacks on members' castles: one card per castle, updated live, showing attacker, army once visible and castle defense<br>• Pings the attacked member or a backup role<br>• Castles captured or lost<br>• Optional auto-spy of attacked castles (opt-in per member)<br>• Needs at least one member's CitadelOps connection online | Paid* | Guide; shots/54; img: `ui-panel-round8__current-discord.webp` |
| Intel | **World Intel** | Players, alliances and public event leaderboards and results by world; profiles with retained history; observation dates; refresh | Paid* | Guide; shots/54; img: `ui-panel-round2__world-intelligence.webp` |
| Stats/dashboards | **Feature Stats** | Per event or feature totals; "Previous event scores" | Paid* | Guide; shots/54; img: `ui-panel-round2__stats-and-results.webp` |
| Stats/dashboards | **My Stats** | Date range + metric; saved account and troop history (might etc.) | Paid* | Guide; shots/54; img: `ui-panel-round2__stats-and-results.webp` |
| Stats/dashboards | **Castle overview** | Troops / Resources / Queues for the focused castle (read-only) | Paid* | Guide; shots/54; img: `ui-panel-round2__castle-overview.webp` |
| Logs | **Logs** | Search logs, Source filter (automation / background / your actions / system checks), Result filter, expandable entries with reason | Paid* | Guide; shots/54; img: `ui-panel-round8__current-logs.webp` |
| Anti-ban / humanization | Connection + safety (Settings → Game account) | • Relog delay 1–1,440 min (default 5) before reconnecting<br>• **Safety locks** toggle: unrecognized game rejections pause the affected automation; Lock length 5–1,440 min (default 30)<br>• Random attack delay min/max (≥4.0 s)<br>• Daily normal-attack limits per routine (account-wide count; defaults 3,500–4,500)<br>• No proxy settings were visible | Paid* | img: `ui-panel-round2__settings-updates-support.webp`; guide |
| Multi-account | Account Center | Multiple game accounts per CitadelOps login (1 credit each); account switcher; nickname (≤32); per-account settings and schedules; "New accounts start on the regular version": each account runs on a stable or beta worker channel and can be switched from its account card (bundle strings, `/api/hosted/accounts/:id/channel`)<br>• Shared access: an account can be shared with other CitadelOps users, including a role that can't start or stop the runtime (`/access`; not seen in the UI)<br>• Add account dialog: nickname, Game, Game world (filterable), username, password, **Start now** switch off by default | Free (account center) / Paid* (hosting) | Observed; shots/20, shots/22, shots/25–28 |
| Notifications | Discord only (alliance bot) | No Telegram or email notifications seen | Paid* | Guide; shots/54 |
| Settings/UX | Settings → Preferences | Display language (5), compact/comfortable spacing, Export settings (excludes credentials, logs, live state), Import settings (replaces config; takes effect immediately for enabled routines), What's new / Patch Notes, Support → Discord | Paid* | Guide; shots/18; img: `ui-panel-round2__settings-updates-support.webp` |
| Account/billing | Billing & credits | • Next renewal (credits needed/available), auto-renew per owned account<br>• Buy 1/5/10+ on Discord<br>• Share credits (exact number to a username or email)<br>• Sharing bonus code; friend's code<br>• Credit movement log | Free (observed) | Observed; shots/21, shots/30, shots/33 |
| Account/billing | Profile & security | Display name, username, account ID; passkeys (add/remove), connect Google or Discord; active sessions; sessions last up to 7 days; "Sign out everywhere"; sign-in help via Discord. The Discord row's button is labelled "Connect Google" (UI bug, shots/31) | Free (observed) | Observed; shots/23, shots/31 |

## Gated or unreachable areas

- **Command Center** (Automation, Live Ops, Settings, every routine dialog). It needs a connected GGE account. I did not add one, per the rules. All detail here comes from the signed-in guide and its fictional-data screenshots, so exact defaults outside the guide's "Recommended" values are unverified. Its route is `/dashboard`. With no hosted account, it falls back to the Game accounts page (shots/24).
- **Purchase flow.** Credits are bought only through Discord DMs. Not explored.
- **Discord server.** I did not join it, so there is no changelog or announcements. Invite metadata only: "Citadel Ops", about 100 members (17 online on 2026-11-17).
- **Settings → Attacks / Preferences tabs.** Seen only partly, in img: `ui-panel-round2__settings-updates-support.webp`.
- **Shared account access and the beta worker channel.** These are known only from API paths and UI strings in the JS bundle. Both need an attached game account.
- **Legacy public paths** `/updates`, `/compatibility`, `/reliability`, `/security`, `/support` and `/desktop` now redirect to landing-page anchors. There is no separate changelog page.
- **Patch notes / What's new.** These live inside the Command Center. The public site only shows the "What's new" headline list:
  - simpler daily routines with stock targets and crafting goals
  - Alliance Targets
  - tower scans up to 1,820 tiles
  - skill presets and battle advice
  - 5 languages

## Notable for a competitor

1. **Simple/Advanced split with "Use recommended setup".** Simple asks only for allowed troops, allowed tools and a goal. "Auto Battle Waves" plans each attack after spying at launch. That lowers the setup barrier a lot.
2. **Live readiness checklist beside every settings dialog** ("Before you start / Setup checks"), plus precise waiting reasons on each card. Save stays disabled until fields are valid, with the reason inline. This is very polished.
3. **Explicit spending model.** Every ruby path is opt-in, with a reserve. Each routine states plainly what it may spend. Per-size time-skip "keep" reserves (1m–24h) appear everywhere.
4. **Account-wide stock targets** for recruitment and tools, counting home + queued + away, with priority groups and "All tiers".
5. **Cross-routine coordination:**
   - Auto Fortress locks Direwolves out of Auto Bird.
   - Storm forces Food Balance on.
   - Khan yields player attacks to Auto Station.
   - Auto Troops Manager pulls troops home 18 h before events using the game's event forecast.
   - A global attack-priority queue with aging and a random inter-attack delay.
6. **Blueprint capture** for Storm and Berimond camps: Functional / Layout / Exact clone, plus a decoration preset.
7. **Social and data features beyond the bot:**
   - Alliance Discord bot with live incoming-attack cards and slash commands, including buying alliance boosts
   - World Intel (cross-world leaderboards and history)
   - opt-in PvP report-sharing leaderboard
   - PvP Coach with combat-simulation suggestions
   - Hall of Legends skill presets
   - Rift replay templates
8. **Hosting operations** (from the API surface, unverified in the UI):
   - a stable or beta worker channel per game account, switchable from the account card
   - an offline view showing the last saved state when the bot is down
   - shared access to one game account for other CitadelOps users, with a limited role
   - E4K supported over its raw TCP socket next to GGE over WebSocket
9. **Growth mechanics:**
   - live aggregate results on the landing page (rubies looted, might growth)
   - a referral code (1 credit per 20 referred)
   - transferable, non-expiring credits
   - a 7-day trial per game account
   - Google Ads conversion tracking on Discord joins and first payments
10. **Weak spots:**
   - Payment is manual via Discord.
   - No Telegram or email notifications.
   - No visible proxy or anti-detection controls beyond delays, relog delay and safety locks.
   - Auto Hospital discards ruby-heal troops with no priority controls.
   - Only username/password worlds are supported.
   - The community is small (about 100 Discord members).
   - The marketing names don't map cleanly to the routines (see Core concepts). There is also a small UI bug: the Discord sign-in row's button reads "Connect Google".
   - The daily attack caps (3,500–4,500) hint at the game's daily attack limit.
