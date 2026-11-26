# Castle layout: the `gca` block

The Build plugin and the Blade Coast plugin both place buildings on a ground plan. The plan arrives in the `gca` block of a castle message, such as the `jaa` reply when the bot enters a castle or the Blade Coast camp. `packages/bot-core/castleLayout.js` parses the block and works out free spots, expansion spots and build times. `packages/bot-core/unitCatalog.js` sorts the troops and tools that a plugin may send.

The facts on this page come from the source of Lazy Lord, an MIT-licensed fork of the same upstream bot. That source names the game client classes that it copied. Nothing on this page has been captured from a live session yet. The tests in `packages/bot-core/test/castle-layout.test.mjs` use hand-made rows, so they check the code against this page, not against the game.

## The block

| Key | Holds | Row shape |
|---|---|---|
| `BD` | Buildings | Building row |
| `BG` | Ground pieces. wodID 200 is the castle ground and 201 is one expansion | `[wodID, objectID, x, y, rotation]` |
| `FP` | Fixed-position objects, such as the wishing well | `[wodID, objectID, x, y, rotation]` |
| `D` | Wall and moat | Building row |
| `G` | Gate | Building row |
| `T` | Towers | Building row |

## Building row

| Index | Field | Meaning |
|---|---|---|
| 0 | `wodID` | The row in `buildings.json` |
| 1 | `objectID` | The building's own id, which an upgrade names |
| 2, 3 | `x`, `y` | Top-left tile |
| 4 | `rotation` | An odd rotation swaps width and height |
| 5 | `secondsDone` | Seconds of construction already done, **not** seconds left |
| 6 | `state` | See [Building states](#building-states) |
| 7 | `hitPoints` | |
| 8 | `boost` | The construction boost the work started with, times 100. 100 means no boost |
| 9 | `efficiency` | |
| 10 | `damageType` | Above 0 when the building is damaged |
| 14 | `districtID` | Above 0 when the building sits inside a district building and takes no tiles on the grid |
| 15 | `upgradeTargetWodID` | The wodID an upgrade turns the building into (the client's `SERVERINDEX_UPGRADE_TARGET_WOD_ID`) |

Our `protocols.js` names index 5 `buildTime`. The name suggests time left, but the value is the time done.

## Building states

The client's `IsoBuildingStateEnum` sorts states as follows.

| States | Meaning |
|---|---|
| 0, 4, 15 | Built and idle |
| 2 | New building under way |
| 13 | Upgrade under way |
| 6, 10 | Also under way. Their exact meaning is not known |

## Time left

`ABasicBuildingVO.getTimeLeftForBuilding` gives the seconds left as `floor(buildDuration / boost) - secondsDone`, never below 0. For a new building, `buildDuration` is the building's own row. For an upgrade (state 13), it is the row at index 15, or the row's `upgradeWodID` when index 15 is missing.

## Free spots

`IsoDataGrid.isDimensionFreeForBuild` accepts a spot when every tile is on a ground piece and no building or fixed-position object covers it. District buildings cover nothing. The bot takes the first spot, scanning rows from the top and tiles from the left. It tries the turned shape only when the row's `rotateType` is above 0.

## Expansions

`IsoDataObjectGroupExpansion` places an expansion next to the existing ground: the arrows that the client draws. The search starts two expansion widths out from the castle ground. Each spot's `r` is the rotation the expansion piece takes. The client computes the last row of the search from the castle ground's `x`, not its `y`, and the code keeps that quirk.

The number of expansions a player may own grows with level, as `ConstructionConst` gives it:

| Player level | Expansions |
|---|---|
| 1 | 1 |
| 2 | 2 |
| 3 to 5 | level − 1 |
| 6 to 12 | ceil(2 + level / 3) |
| 13 to 21 | ceil(level / 2 − 0.5) |
| 22 to 45 | ceil((level − 1) / 4 + 4) |
| 46 and up | 19 |

The cost of the next expansion is the `expansions.json` row whose `expansionLevel` is one more than the expansions owned and whose `spaceIDs` list holds the kingdom id. The Blade Coast maps 22, 27 and 28 have rows of their own.

## Game data

The bot downloads `items_v<version>.json` at boot and writes every top-level key whose name matches `^[A-Za-z_]+$` to `data/items/<key>.json`. The runner does this in `apps/runner/src/game-data.ts` and the legacy panel in `main.js`. A copy of the items file from 2026-11-26 has all the keys that Build and Blade Coast read, so no download change is needed.

| File | Rows | Used for |
|---|---|---|
| `buildings.json` | 4127 | Sizes, rotation, build times, upgrade chains |
| `expansions.json` | 137 | Expansion costs per kingdom or coast map |
| `tmaps.json` | 19 | Blade Coast maps 22, 27 and 28 and their island lists |
| `tmapnodes.json` | 499 | Islands |
| `prebuiltcastles.json` | 38 | The Blade Coast camp, row 29 |
| `partpayprices.json` | 142 | Part-payment prices |
| `craftingRecipes.json` | 521 | Crafting |

## Unit filters

| Field | Reading |
|---|---|
| `allowedToTravel`, `allowedToAttack` | `space+area` pairs joined by `#`. `-1` matches any. No list means anywhere |
| `canBeUsedToAttackNPC` | `0` means the tool works only against players |
| `slotTypes` | `1` is the front, `2` a flank |
| `wallBonus`, `gateBonus`, `defRangeBonus` | The tool's role: wall, gate or ranged |

A unit fits the Blade Coast when it may travel to `22+8` (the camp) and attack at `22+7` (the islands).

## Confidence

| Fact | Level | Confirm with |
|---|---|---|
| `gca` keys and the building row up to index 10 | medium, from Lazy Lord's source, not yet captured | Log one `jaa` reply for a castle |
| Index 5 is seconds done, not seconds left | medium, from Lazy Lord's source, not yet captured | Log `jaa` twice a minute apart while a building is under way |
| Index 8 is the boost times 100 | medium, from Lazy Lord's source, not yet captured | Log `jaa` during a boosted build |
| Index 14 is the district | medium, from Lazy Lord's source, not yet captured | Log `jaa` for a castle with a district building |
| Index 15 is the upgrade target | medium, from Lazy Lord's source, not yet captured | Log `jaa` while an upgrade is under way |
| State meanings | medium, from Lazy Lord's source, not yet captured | Log `jaa` for an idle, a building and an upgrading castle |
| Spot search and expansion spots | medium, from Lazy Lord's source, not yet captured | Compare `expansionSpots` with the arrows in the client for one castle |
| Expansion limit by level | medium, from Lazy Lord's source, not yet captured | Compare with the client's expansion count at two levels |
| The game data keys exist | high, read from the items file | None |
| Blade Coast travel and attack pairs | high, read from the items file | None |
