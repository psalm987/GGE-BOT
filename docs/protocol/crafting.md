# Crafting: Refinery and Toolsmith

The Refinery and Toolsmith components plugin (`packages/bot-core/plugins/refineryToolsmith.js`) crafts construction components in the Refinery and the Toolsmith and rents their extra slots for coins. It is a different job from `plugins/toolsmith.js`, which builds siege and defence tools in the workshops ([tools.md](tools.md)).

The request and reply shapes come from Lazy Lord's source (`be/plugins/refineryToolsmith.js`, MIT), which cites the web client `Game.bundle.js`. They are not yet captured by this project. The recipes, slots and prices come from the game's `items/craftingRecipes.json`, `items/craftingQueues.json`, `items/buildings.json`, `items/researches.json` and `items/rewards.json` as of 2026-11.

## The buildings and products

crin names a building's kind by `CQID`, the `queueTypeId` of its recipes and queue row. 1 is the Refinery and 2 is the Toolsmith (from Lazy Lord's source). `queueTypeId` 3 and 4 belong to other buildings (`DragonHoard`, `DragonBreathForge`) and are not used.

Each product is a recipe group (`recipeGroupID`). The plugin's product numbers are fixed in `PRODUCTS`, so a saved row keeps its meaning:

| Product number | Recipe group | Building | Reward key in `rewards.json` |
|---|---|---|---|
| 1 | 1 | Refinery | `addRefinedLumber` |
| 2 | 2 | Refinery | `addRefinedStone` |
| 3 | 13 | Refinery level 5 | `addSteel` |
| 4 | 14 | Refinery level 5 | `addDragonGlass` |
| 5 to 12 | 3 to 10 | Toolsmith | `addComponent1` to `addComponent8` |

The game's names for `component1` to `component8` are screws, black powder, saw, drill, crowbar, leather strips, chains and metal plates (`lang/en.json` `currency_name_component1` to `8`). `protocols.js` maps the same currencies to `screws`, `blackPowder`, `saws`, `drills`, `crowbars`, `leatherStrips`, `chains` and `metalPlates`.

## Recipes: `craftingRecipes.json`

| Field | Meaning |
|---|---|
| `craftingRecipeId` | The id sent as crst's `CRID` |
| `recipeGroupID` | The product |
| `queueTypeId` | 1 Refinery, 2 Toolsmith |
| `type` | `Short` (3600 s), `Long` (18000 s) or `Ruby` (1800 s) |
| `level` | 1 to 11 for groups 1 to 10, 1 to 10 for groups 13 and 14 |
| `craftingDuration` | Seconds |
| `cost<Resource>` | The price: `costWood`, `costStone`, `costCoal`, `costOil`, `costGlass`, `costIron`, `costRefinedLumber`, `costRefinedStone`. `Ruby` recipes add `costC2` (rubies) |
| `requiredCraftingBuildings` | Building wodIDs the recipe needs: `2998,3175` (Refinery level 5) for steel and dragon glass |
| `rewardIDs` | The `rewards.json` row of what it makes |

The plugin picks only `Short` or `Long` recipes with no `costC2`. No `Short` or `Long` row of queues 1 and 2 has a coin or ruby price as of 2026-11.

## Unlocked recipes: effect 616

Effect 616 (enableCraftingRecipes) lists recipe ids as `616&id#id#…`. A recipe is unlocked when one of these lists it (from Lazy Lord's source):

- The building's own `areaSpecificEffects` in `buildings.json`. Every Refinery level has `616&1#12#23#34#45#56`: level 1 of refined wood and refined stone, in each of the three types. Level 5 adds `368#378#388#398#408#418` (steel and dragon glass).
- A bought research's `effects` in `researches.json`, for example research 2001 `616&2` (refined wood short, level 2).
- crin's `CE` pairs `[616, value]` of the building's area.

The building's wodID comes from the castle layout (`gca.BD`, whose second field is the building's object id, crin's `OID`). Before the bot has read the layout, the plugin uses the kingdom's level 1 row of that building, which unlocks no steel or dragon glass.

## Read the buildings: `crin`

```json
{}
```

The client sends it when the player opens the crafting window. It reads only.

```json
{"CAI": [{"CE": [[616, "1#12"]], "CBI": [{"KID": 0, "AID": 1000001, "OID": 501, "S": 3, "CQID": 2,
  "PS": {"CRID": [67, -1], "RCT": [1800, 0], "RUT": [0]},
  "QS": {"CRID": [67, -1, -1, -1], "RCT": [5400, 0, 0, 0], "RUT": [86400, 0, 0]}}]}]}
```

| Field | Meaning |
|---|---|
| `CAI` | One entry for each area |
| `CE` | The area's effects as `[effectID, value]` pairs |
| `CBI` | One entry for each crafting building: the building's entry |
| `KID`, `AID` | Kingdom and castle id |
| `OID` | The building's object id |
| `S` | The building's state. The plugin sends nothing while it is 0, 1, 2, 5 or 6 |
| `CQID` | 1 Refinery, 2 Toolsmith |
| `PS`, `QS` | The crafting slots and the queue slots |
| `CRID` | The recipe in each slot, in slot order. -1 (or 0) is free |
| `RCT` | Seconds left on each slot's craft |
| `RUT` | Seconds left on each rentable slot's rental. 0 is locked |

The state set {0, 1, 2, 5, 6} comes from Lazy Lord's source ("being built, built stopped, being dismantled"). It is not the same list as the castle layout's building states in [castle-layout.md](castle-layout.md), where 0 is "built and idle". crin's `S` may use another enum. The test account must confirm what `S` a working building reports.

## Slots: `craftingQueues.json`

```json
{"queueTypeId": "2", "permanentProductionSlots": "1", "productionSlotUnlockCostC1": "5000000", "productionSlotUnlockDuration": "604800",
 "permanentQueueSlots": "1", "queueSlotUnlockCostC1": "500000,3000000,6500000", "queueSlotUnlockDuration": "604800"}
```

A building's slots of one kind are the permanent ones first, then one rentable slot for each price in the `…UnlockCostC1` list. A rental lasts `…UnlockDuration` seconds (a week). The slot index counts from 0 across both, so the Toolsmith's queue slots are 0 (permanent) and 1, 2 and 3 (rentable).

## Craft: `crst`

```json
{"KID": 0, "AID": 1000001, "OID": 501, "PWR": 0, "CRID": 67}
```

The game puts the craft in a free crafting slot, else in a free queue slot. The reply is the building's entry, as in `CBI` (from Lazy Lord's source). When a reply carries no entry, the plugin marks the first free slot busy itself, and the next crin corrects it.

## Rent a slot: `crun`

```json
{"KID": 0, "AID": 1000001, "OID": 501, "S": [1], "ST": "queue"}
```

| Field | Value |
|---|---|
| `S` | The slot index, as above |
| `ST` | `"production"` or `"queue"` |

The game rents slots in order, so the plugin always rents the first locked slot of the ones the player picked. It pays coins only. The reply is the building's entry. The game's rent window has no ruby price, so the plugin never sends one (from Lazy Lord's source).

The plugin adds two limits that Lazy Lord's code does not have: the `rentCoinCap` option caps what one round spends on rentals, and `coinFloor` keeps that many coins.

## Research: `rei`

```json
{}
```

The reply's `BR` lists the bought research ids. The client sends it when the player opens the research tower. The plugin asks once an hour.

## Other replies that carry a building's entry

`crca`, `crqm` and `crsk` also answer with the building's entry (from Lazy Lord's source). The plugin never sends them. It reads their replies, like those of `crst` and `crun`, to keep its view of the slots current.

## Refusals

| Code | Name | What the plugin does |
|---|---|---|
| 63 | `NO_FREE_CONSTRUCTION_SLOT` | Every slot is full. This is normal. The plugin waits for the next round |
| 10, 11, 55 and any other `NOT_ENOUGH_*` | | Short of resources after all. The plugin waits for the next round and does not hold the building back |
| Any other, and no reply | | Logged. The building is held back for 15 minutes, then 30, up to an hour (`refusals.js` `refusalMemory`) |

Lazy Lord's code counts its backoff in rounds (1, 2, 4… up to an hour) and backs off on `NOT_ENOUGH_*` too.

## Facts and confidence

| Fact | Confidence | Source |
|---|---|---|
| `crin {}` and its reply fields | medium | Lazy Lord's source |
| `crst {KID, AID, OID, PWR: 0, CRID}` uses a free crafting slot, else a free queue slot | medium | Lazy Lord's source |
| `crun {KID, AID, OID, S, ST}` rents for coins, in order | medium | Lazy Lord's source |
| The replies of `crst`, `crun`, `crca`, `crqm` and `crsk` carry the building's entry | medium | Lazy Lord's source |
| `rei {}` returns `BR` | medium | Lazy Lord's source |
| 63 means every slot is full | medium | Lazy Lord's source, and `err.json` |
| States 0, 1, 2, 5 and 6 mean the building can't craft | low | Lazy Lord's source. It conflicts with the layout's state list. Confirm on the test account |
| `CQID` 1 is the Refinery and 2 the Toolsmith | high | `craftingRecipes.json` `queueTypeId` with the buildings' `377` and `616` effects |
| Recipes, slots, prices and effect 616 lists | high | `craftingRecipes.json`, `craftingQueues.json`, `buildings.json`, `researches.json`, 2026-11 |
