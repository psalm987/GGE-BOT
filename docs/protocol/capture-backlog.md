# Capture backlog

This page lists the non-seasonal features that still need a live capture before a plugin can be written, and what each capture must contain. It comes from the recorder trace of 2026-11-21 (session `20261121-203724-f52bfe`) and from the client build `Game.bundle.b13ef28e9bb95fa622bd.js` fetched the same day.

The fields below are the order in which each `C2S*VO` constructor assigns them, read from the client as text. A field the client fills from game state is marked "from state". Nothing on this page was sent to the server unless the Captured column says so. To read a class, run `tools/protocol/ctx.py` with its class name.

## Already captured

| Feature | Commands | Where |
|---|---|---|
| Login bonus | `alb {}`, `clb {ID:-1, I:<reward key>, SP:null}` | `packages/bot-core/test/fixtures/protocol/daily-20261121.json` |
| Recruiting and tool production | `bup {LID, WID, AMT, PO, PWR, SK, SID, AID}`, `spl {LID}`, `gui {}` | The same fixture, and [recruit-tools.md](recruit-tools.md) |
| Event wheel spin | `pep {EID}`, `lws {LWET:1}` | The same fixture, and [wheel.md](wheel.md) |
| VIP state | the `vip` push and `gbd.vip`: `VP` points, `VRL` highest level reached, `VRS` seconds of VIP left, `UPG` premium commanders used today | [vip-commanders.md](vip-commanders.md) |
| Daily tasks | the `dql` push: `RDQ` open tasks with progress `P`, `FDQ` finished task ids, `RS` milestone rewards | This page, under Daily tasks |

## Needs a capture

Each entry names the cheapest safe action that would capture it. Actions marked "costs rubies" need the owner's approval first.

### Premium (VIP) commanders in an attack

- **Command**: `cra` with `BPC: 1`. The client sends `BPC` from its premium flag (`C2SCreateArmyAttackMovementVO`). The bot always sends 0.
- **Unknown**: the `LID` the client sends for the premium commander, and the `UPG` change in the next `vip` push.
- **Capture**: one attack with a premium commander on an account whose VIP mode is on (level 5 or higher). Without VIP the game asks for rubies instead, so the capture needs a VIP account.

### Login bonus: troops and the special rewards

- **Known from the client**: a troop reward is claimed with the unit's `wodID` as `ID` (`clb {ID:655, I:"U", SP:null}`); every other kind sends `ID: -1`. The two special rewards are claimed with `SP: "ALLI"` or `SP: "VIP"` and come back in entries `[2].ALLI` and `[3].VIP` of that day. The plugin claims troops this way but never the special rewards.
- **Capture**: one day where troops are picked, and, on an account in an alliance or with VIP on, one special reward.

### The classic Wheel of Fortune

- **Known from the client**: `lws {LWET:0}`, event 15, tickets `LWT`, 30 a spin (300 in Pro mode). The plugin leaves it off by default.
- **Capture**: one classic spin, and the classic wheel's `sei` entry, to see whether it carries `PMA` as the event wheel does.

### A filled production queue slot

- **Unknown**: what a queue slot of `spl` holds once an order waits in it, the largest `AMT` one `bup` accepts for troops, and the refusal codes. The plugin only orders when nothing is in production or a slot shows bare (`SI` alone), so an unknown shape costs at most one order.
- **Capture**: queue two small orders of the same list back to back, and read `spl` after each.

### Healing

- **Commands**: `hru {U, A}` (`C2SReviveUnitPackageVO`: `U` the unit `wodID`, `A` the amount). `hfl {KID, AID, HRF}` was captured: `HRF: -1` was answered with `HRF: 1`, and its meaning is unknown.
- **Unknown**: the coin cost in the reply, and whether healing queues like recruiting.
- **Capture**: heal a few units that heal for coins. Some units heal only for rubies (a veteran composite bowman cost 162 rubies each); a plugin must leave those alone.
- **Edge case**: the test account's hospital was full (171 of 171), so new casualties were being lost.

### Repairs

- **Commands**: `ira {}` repairs every building (`C2SIsoRepairAllVO`). `rbu {OID, PO, PWR}` repairs one building (`C2SIsoRepairBuildingVO`: `OID` the building object id, `PO` defaults to -1, `PWR` 1 to pay rubies).
- **Unknown**: which reply marks a building as burning, and the repair cost.
- **Capture**: repair one burning building for resources, with `PWR` 0.

### Resource transfers between castles

- **Commands**: `crm {KID, SID, TX, TY, HBW, G, PTT, SD}` (`C2SCreateMarketMovementVO`: `SID` the source castle, `TX`/`TY` the target, `HBW` the horse or -1 with a feather, `G` the goods, `PTT` 1 with a feather, `SD` slow-down). `cmi {S:1, KID:-1}` reads the market in every kingdom. `gctb {}` lists the transport buildings.
- **Unknown**: the shape of `G` and the barrow capacity per transfer.
- **Capture**: send a small amount of food from one castle to another in the same kingdom. This feeds Food manager and Castle manager's material transfers.

### Overseers (boosters)

- **Commands**: `ovs {T, PO}` starts an overseer (`C2SOverseerStartVO`). `boi {}` reads the boosters (`C2SBoosterInfoVO`).
- **Prices seen in the King's Market**: production overseers +25% for 7 days at 625 rubies each, marauder 990, drill instructor 347 (on sale at -65%), tax collector bribe 750, maps 50, transport +7 barrows 80.
- **Capture**: `boi` alone is free and shows what runs. A purchase costs rubies and needs the owner's approval and a ruby budget.

### Offers

- **Commands**: `oop {OID, ODI, C}` (`C2SOfferOfferPayVO`), `bso {OID, AMT, POID}` (`C2SBuyBestsellerOfferVO`), `odc` (offer duration check). Opening the sale popup sent `core_osd {OID: 1002000}` with no reply. The offer list arrives in `core_pol`, about 430 KB at login; each offer's `additionalComponents` holds its cost, such as `{"name":"cost","params":{"AMT":13599,"CID":"C2"}}`.
- **Edge case**: ruby offers sit beside real-money popups. One "Go to shop" button opened the payment page. A plugin must only consider offers whose cost currency is `C2` (rubies), within a budget, and never open the payment shop.

### Wheelbarrows

- **Command**: `rcc {RT}` (`C2SIsoResourceCartCollectVO`). `RT` is the index of the cart in the client's `CastleResourceCartsData` enum.
- **Capture**: collect the wheelbarrows in front of the castle. It is free and one of the daily tasks (collect 5 times).

### Mercenary post

- **Commands**: `mpe {MID}` (`C2SMercenaryPackageVO`), `rmm {MID}` refreshes a mission (`C2SRefreshMercenaryMissionVO`, may cost rubies).
- **Capture**: open the mercenary post and start one free mission. It is one of the daily tasks.

### Spying

- **Command**: `csm {SID, TX, TY, SC, ST, SE, HBW, KID, PTT, SD}` (`C2SCreateSpyMovementVO`: `SC` spy count, `ST` spy type, `SE` effort).
- **Capture**: spy on one robber baron castle. The daily task asks for 5.

### Crafting

- **Commands**: `ceq {I, EX}` (`C2SCraftEquipmentVO`), `cge {MID, UG, C2}` (`C2SCraftGemVO`; `C2` 1 pays rubies and must stay 0).
- **Capture**: craft one item or gem in the smithy without rubies. It is one of the daily tasks.

### Equipment auto-sell

- **Commands**: `aes {ECS}` (`C2SSetAutoSellEquipmentConditionsEventVO`: `ECS` a list of `[slot, rareness]`), `ags` for gems. The game sells by these rules itself, which is safer than selling item by item.
- **Capture**: open the auto-sell settings and save them once.

### Event advisors

- The Nomad advisor (Temujin Mergen) lets you attack Nomad camps back to back during the Nomad Invasion and costs one advisor token. The client also has Samurai, Berimond and Baron advisors (`description_advisorInformation_*` strings).
- **Unknown**: the buy and use commands.
- **Capture**: during a Nomad Invasion, buy and use one token on an account that holds one.

### Building upgrades

- **Commands**: `eup {OID, PO, PWR}` (`C2SIsoUpgradeObjectVO`), `msb {MST, OID}` skips building time, `sub` lists buildings that can be upgraded. Opening the build menu sent `sin ""` and got the storage inventory.
- **Capture**: upgrade one cheap building for resources.

## Daily tasks

The `dql` push lists the day's tasks. On 2026-11-21 there were 12, and the milestone chests at 3, 6, 9 and 12 finished tasks were granted by the server on its own: no claim command was sent, and a "Reward received" popup followed the third task. A bot therefore earns them just by doing the tasks.

| Task (UI text) | Command | Plugin |
|---|---|---|
| Log in once a day | login | always |
| Collect at least N coins from taxes | `txc` | Tax collector |
| Defeat a robber baron castle level 25 or higher | `cra` | Towers |
| Defeat a barbarian tower in Everwinter Glacier | `cra` | Towers |
| Recruit units | `bup` with `LID` 0 | Recruit and tools |
| Produce tools | `bup` with `LID` 1 | Recruit and tools |
| Collect the wheelbarrows 5 times | `rcc` | needs a capture |
| Complete one mission at the mercenary post | `mpe` | needs a capture |
| Spy on 5 targets | `csm` | needs a capture |
| Make an equipment item or a gem | `ceq` or `cge` | needs a capture |
| Perform a successful sabotage | spy movement | not planned: it attacks other players |
| Spend rubies | any | never |

## Checklist for the next trace

Record on the second test account with the recorder, add a marker before each step, and stop after the last one. Every step is free unless marked.

1. Collect the wheelbarrows in front of the main castle.
2. Open the mercenary post and start one free mission.
3. Spy on one robber baron castle.
4. Craft one piece of equipment or one gem without rubies.
5. Heal two units that heal for coins.
6. Repair one burning building for resources.
7. Send 100 food to another castle in the same kingdom.
8. Open the equipment auto-sell settings and save them unchanged.
9. Upgrade one cheap building.
10. Open the overseers tab of the King's Market (no purchase), so `boi` and the booster state are recorded.
11. On a VIP account only: one attack with a premium commander.
12. During a Nomad Invasion only: buy or use one advisor token.
13. Queue two small troop orders back to back, so `spl` shows a filled slot.
14. Pick troops on a login bonus day that offers them.
15. Spin the classic Wheel of Fortune once while it runs, outside Pro mode.
