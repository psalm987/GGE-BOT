# Building and upgrading in a castle

The Build plugin (`packages/bot-core/plugins/build.js`) brings each castle of a player's plan to the buildings, levels and counts the plan names. `packages/bot-core/buildPlan.js` holds every decision as a pure function. `packages/bot-core/castleBuilder.js` holds the building requests, which the Blade Coast plugin also sends.

Every command, field and rule on this page is **from Lazy Lord's source, not yet captured by us**, unless a row says otherwise. Lazy Lord is an MIT-licensed fork of the same upstream bot. Its `be/plugins/build.js` names the game client classes it copied. None of our fixtures holds a building frame. The tests in `packages/bot-core/test/build.test.mjs` play against a hand-made game built from this page, so they check the code against this page, not against the game.

The ground plan that the requests act on is in [castle-layout.md](castle-layout.md).

## Commands

| Command | Request | Reply | Notes |
|---|---|---|---|
| `jca` | `{ CID, KID }` | `jaa { grc, gca, gpa }` | Enters a castle. The plugin sends it before each look, unless it read the castle within the last 5 seconds. See [castle-state.md](castle-state.md). |
| `ebu` | `{ WID, X, Y, R, PWR: 0, PO: -1, DOID: -1 }` | `ebu`, result only | A new building of wodID `WID` at tile `X`, `Y` with rotation `R`. `PO -1` is no private offer and `DOID -1` no district. |
| `eup` | `{ OID, PWR: 0, PO: -1 }` | `eup`, result only | The building with object id `OID` a level up. Also the keep, the gate, the moat and a tower. |
| `eud` | `{ OID, PWR: 0, PO: -1 }` | `eud`, result only | The castle wall a level up. The wall has a request of its own. |
| `ebe` | `{ X, Y, R, CT: 1 }` | `ebe`, result only | An expansion at an expansion spot. `CT 1` pays with wood and stone. |
| `etc` | `{ OID }` | `etc`, result only | Collects the treasure chest an expansion leaves. |
| `msb` | `{ OID, MST }` | `msb`, result only | A time skip on a building under way. `MST` is `MS1` to `MS7`: 1, 5, 10 and 30 minutes, 1, 5 and 24 hours. |

## Requests never sent

Rubies are the game's `C2`.

- `PWR 1` on `ebu`, `eup` or `eud` pays the building with rubies.
- `CT 0` on `ebe` pays the expansion with rubies.
- A building row with a `costC2` above 0 has a ruby price.

`castleBuilder.ALLOWED` gives each request the rule its payload must pass: `PWR` exactly 0, `CT` exactly 1, `MST` one of the seven skip types. `buildPlan.mayLeave` adds `jca` and nothing else. The plugin sends every request through it, and a request it refuses never leaves. A test plays a long plan and checks every request the plugin sent against `mayLeave`.

## The join reply

| Field | Holds | Read into |
|---|---|---|
| `grc.W`, `grc.S`, `grc.C`, `grc.O`, `grc.G`, `grc.I`, `grc.A` | The castle's wood, stone, coal, oil, glass, iron and aquamarine | `castle.wood` and so on |
| `gpa.MRW`, `gpa.MRS` and so on | What the castle can store of each | `castle.getProductionData.maxAmountWood` and so on |
| `gca` | The ground plan | `castle.layout`, and `castle.buildings` for the plugins that read wodIDs |
| `gca.scl.OIDL` | The build queue: an object id for a slot in use, `-1` for a free slot | `castle.buildingSlots` |

Our `protocols.js` looks for `scl` in `gca` first and then beside it. The upstream bot reads it from `gca`. Neither place has been seen in a capture.

## What a plan may name

`buildPlan.js` builds the list from `buildings.json`. A building is offered when its level-1 row passes every rule below.

| Rule | Field |
|---|---|
| A building, not ground, wall or tower | `group` is `Building` |
| The first level | `level` is 1 and the row has no `downgradeWodID` |
| Sold in the shop as civil or military | `shopCategory` is `CIVIL` or `MILITARY` |
| Not a district | no `isDistrict` |
| Not an event building | no `eventIDs` |
| Not another look of a building | no `skinID` |
| Has a price, and only in coins, castle resources or tracked currencies | every `cost*` field above 0 is one of the lists below |
| No requirement the bot can't check | no `effectLocked`, `sceatSkillLocked`, `slumLevelNeeded` or `skillUnlockID` |

A building's levels follow `upgradeWodID` from the first level. The list stops before the first level that fails the last two rules, so a plan can't name a level with a ruby price.

**Castle resources:** `costWood`, `costStone`, `costCoal`, `costOil`, `costGlass`, `costIron`, `costAquamarine`.

**Tracked currencies:** `costLegendaryToken`, `costLegendaryMaterial`, `costFloraToken`, `costSceatToken`, `costGoldToken`, `costPlaster`, `costDragonScaleTile`, `costCommonTimber`, `costCommonStraw`, `costRareNails`, `costRareGlue`, `costSamuraiToken`, `costKhanTablet`, `costKhanMedal`, `costImperialDucat`. Coins are `costC1`.

The Berimond camp (kingdom 10) is the one exception to the event rule. Its buildings carry `eventIDs` 3 and `kIDs` 10. Its decorations (`FactionDeco`, `shopCategory` `DECO`) are offered by their `type`, because they share one name. Lazy Lord leaves out `FactionGuardpost`, `FactionHospital`, `FactionStable` and `FactionMarket`, and so do we.

### Upgrade-only kinds

A castle is given these. The bot upgrades them and never builds one.

| Plan name | First wodID | Where the layout keeps it | Request |
|---|---|---|---|
| `Keep` | the `Keep` row with no `downgradeWodID` | `gca.BD` | `eup` |
| `Castlewall` | 501 | `gca.D` | `eud` |
| `Moat` | 455 | `gca.D` | `eup` |
| `Gate` | 450 | `gca.G` | `eup` |
| `Towers` | 402 | `gca.T` | `eup` |
| `FactionBarracks` | the Berimond level-1 row | `gca.BD` | `eup` |
| `FactionUnitCamp` | the Berimond level-1 row | `gca.BD` | `eup` |

`Towers` stands for every tower the castle has built. An empty tower spot is the game's level 0 (wodID 401) and is left alone. The first five are for every kingdom but Berimond. The last two are for Berimond only.

## What the game would refuse

The plugin checks each step before it sends it.

| Check | Field | Blocks the row with |
|---|---|---|
| The player's level | `requiredLevel` against `gxp.LVL` | `needsLevel` |
| The player's legend level | `requiredLegendLevel` against `gxp.LL` | `needsLegendLevel` |
| The kingdom | `kIDs` holds the castle's kingdom | `notInKingdom` |
| The Berimond camp takes only its own | the row's `kIDs` holds 10 | `notInKingdom` |
| The castle type | `onlyInAreaTypes` holds the castle's area type | `notInCastleType` |
| The game's limit | fewer than `maximumCount` built | `atLimit` |
| A free spot | `findSpot` finds one | `noSpace` |
| The price fits the storage | each resource price, plus the resource floor, is at most the castle's storage | `overStorage` |

A step also waits when the building is under way, in the build queue or damaged, and when the castle or the player can't pay yet. The coin floor is kept on a price in coins, and the resource floor on every castle resource.

## Order of work in a castle

1. Collect a treasure chest. A chest the game refuses is never asked for again.
2. Finish a build under way with time skips, where the player ticked that. Only `gca.BD` buildings in state 2 or 13 are skipped.
3. Buy an expansion, where the player ticked that. It takes no queue slot.
4. With no free slot in the queue, wait until the first build ends.
5. Go through the plan's rows in order. The first row that can act sends one request.

For a row, the `count` best buildings are raised first, one level at a time. New ones are then built at level 1 on the first free spot.

The plugin reads the castle again before the next step.

## Expansions

The next expansion is the `expansions.json` row whose `expansionLevel` is one more than the expansions bought and whose `spaceIDs` holds the kingdom. The plugin buys it when the player's level allows another ([castle-layout.md](castle-layout.md#expansions)) and the castle holds its `costWood` and `costStone` above the resource floor. It stops at a row with `sceatSkillLocked`, `effectLocked`, `costLegendaryToken` or `costLegendaryMaterial`. The row's `costC2` is the ruby price for `CT 0` and is ignored.

## Refusals

| Result | On | The plugin |
|---|---|---|
| any | `ebu`, `eup`, `eud` | Leaves that row alone for an hour and looks again in 30 to 60 seconds for the other rows |
| any | `ebe` | Buys no expansion in that castle for an hour |
| any | `etc` | Never asks for that chest again |
| 335 `NO_TIME_SKIP_LEFT` | `msb` | Counts that skip type as empty and picks another |
| 311 `NOT_COOLING_DOWN` | `msb` | Gives the skip back to its count |
| 5 `INVALID_OBJECT_ID` | `msb`, after a skip of ours | Takes the build as done |

## Timing

| Wait | Length |
|---|---|
| After a build, an upgrade or an expansion | 5 to 10 seconds |
| After a chest or a skip | 3 to 6 seconds |
| Between two skips on one building | 1.5 to 3 seconds |
| After a refusal | 30 to 60 seconds |
| A full queue, or a row waiting for a building under way | Until that build ends, plus 10 to 12 seconds |
| Waiting for resources, blocked, or a dry run | 1 hour |
| A castle the bot couldn't read | 10 minutes |

A castle whose plan is done is not looked at again until the player saves a changed plan. The saved plan is never rewritten.

## The hook for Build Supply

After each look that leaves a castle's plan unfinished, the plugin emits `buildLooked` on the bot's `events`:

| Field | Meaning |
|---|---|
| `castle` | The castle as `protocols.js` holds it |
| `need` | `{ wood, stone }`: what the rest of the plan costs. It counts every level still to go, new buildings from level 1 and the expansions the player's level allows. It leaves out levels the castle can't build and levels that cost aquamarine. |
| `nothingPayable` | True when the plan has next steps that wood and stone pay for and the castle can pay none of them |
| `waiting` | True when a step waits for resources |
| `lookAgainIn(ms)` | Brings the castle's next look forward. It also takes a promise of a number. |

Build Supply (`packages/bot-core/plugins/buildSupply.js`) listens to it for the Storm castle, and passes `lookAgainIn` a promise that resolves when the wood and stone it sent arrive. See [storm-transfer.md](storm-transfer.md#build-supply). The plugin works the two numbers out only when something listens.

## Confidence

| Fact | Source | Level | What would confirm it |
|---|---|---|---|
| `ebu`, `eup`, `ebe`, `etc`, `msb` payloads | Lazy Lord's source. Blade Coast sends the same five | medium | One accepted request of each on the test account |
| `eud` upgrades the wall | Lazy Lord's source | medium | One wall upgrade on the test account |
| `PWR 0` pays with resources and `PWR 1` with rubies | Lazy Lord's source, and the same field on `bfs` and `csc` in ours | medium | An `ebu` with `PWR 0` that takes wood and no rubies |
| `CT 1` pays an expansion with wood and stone | Lazy Lord's `EXPANSION_WITH_RESOURCES` | medium | One expansion that takes wood and stone and no rubies |
| `gca.scl.OIDL` is the build queue, `-1` free | Upstream bot's parse | low | A captured `jaa` with a build under way |
| The catalog rules | Lazy Lord's source, run against `buildings.json` of 2026-11-14: 58 kinds | medium | A refusal-free pass through the shop's civil and military tabs |
| `requiredLevel` is the player's level without legend levels | Lazy Lord's source | medium | A build at exactly the required level |
| The wait and hold lengths | Lazy Lord's choices, not game limits | high that they are choices | Not applicable |
| `msb` 5 means the build is already done | Lazy Lord's source | low | A skip sent just after a build ends |
