# Market carts

The Send resources by cart plugin (`packages/bot-core/plugins/sendResources.js`) sends wood, stone or food from one castle to a castle at a map position, by market cart, until a total has gone. This page lists the commands it sends, the pushes it reads and how sure each fact is.

The shapes come from two sources, and neither is our own capture yet:

- **Lazy Lord's source** (`be/plugins/sendResources.js`, MIT), a bot that sends these commands.
- **The public HTML5 client**, `Game.bundle.7fe30f1649d36a928f2b.js`, read as text on 2026-11-27 as the [README](README.md#how-the-findings-were-obtained) describes. `G@n` offsets on this page are into that build, not the one the README names.

## Read the markets: `cmi`

```json
{"S": 1, "KID": -1}
```

`S: 1` with `KID: -1` asks for every castle in every kingdom (`C2SMarketInfoVO.SCOPE_ALL_KINGDOMS`, G@3267728). The reply's `C` holds one entry for each castle:

| Field | Meaning |
|---|---|
| `CID` | The castle's id |
| `KID` | The castle's kingdom |
| `TC` | Every cart the castle has. 0 means it has no marketplace |
| `AC` | The carts free now |
| `W`, `S`, `F`, `C`, `O`, `G`, `I`, `MEAD`, `BEEF`, `HONEY` | The castle's goods |
| `AE` | Effects as `[[effectID, [value]], ...]`. Effect 90 is the cart capacity boost in % |

The client reads these fields in `CastleTradeVO.fillFromParamObject` (G@15726436). The plugin asks once a round, through `chores.ask`, so a silent game never counts toward `TOO_MANY_TIMEOUTS`.

## Send carts: `crm`

```json
{"KID": 0, "SID": 1000001, "TX": 300, "TY": 300, "HBW": -1, "PTT": 0, "SD": 0, "G": [["W", 1000]]}
```

| Field | Meaning |
|---|---|
| `KID` | The kingdom of the sending castle. The target is in the same kingdom |
| `SID` | The sending castle's id |
| `TX`, `TY` | The target's map position |
| `HBW` | The horse's `wodID`, or -1 for none or with a feather |
| `PTT` | 1 with a fast horse feather, else 0 |
| `SD` | The slow-down offset in seconds. 0 sends at once |
| `G` | The goods as `[[code, amount]]`, with the codes `cmi` uses |

The fields and their order are those of `C2SCreateMarketMovementVO` (G@8041544). The client sends it from the castle's send-goods dialog (`CastlePostSendGoodsDialog.sendGoods`, G@4016550), so `ClientCommands.sendCarts` joins the castle first through `setCastle`. Sends go one at a time, in the `cartTurn` line, because a refusal names no castle.

The plugin picks the horse as Lazy Lord does: among the castle's unlocked horses (`gpc` `UH`), the one with the highest `marketBoost` in `horses.json` that costs coins (`costFactorC1`) and no rubies (`costFactorC2`).

### The reply

The reply is `{gcu, grc, O, A}`. The client's `CRMCommand` reads `A` as one more map movement (`parseMapMovementArray([A])`, G@14487914), the same way it reads a `gam` entry:

| Field | Meaning |
|---|---|
| `A.M.T` | 4, a market movement (`MOVEMENTTYPE_MARKET`) |
| `A.M.D` | The direction. 1 is the way back |
| `A.M.SA`, `A.M.TA` | Where the carts leave from and go to, as map areas: `[type, x, y, castle id, ...]` |
| `A.M.TT`, `A.M.PT` | The trip's seconds in all, and the seconds already gone |
| `A.MM.C` | The carts the load took |
| `A.MM.G` | The goods on the carts |

`protocols.js` turns `A` into a `Movement`, as it does for `cat` and `cds`. The bot's own reply is the one with `D` not 1 and `SA[3]` equal to the sending castle, because the way back of earlier carts also comes as `crm`.

### The way back

When the carts reach the target, the game pushes `crm` again: `D` is 1, `SA` is the target and `TA` is the castle they return to. They are home `TT - PT` seconds later. The client replaces a movement whose id it already holds, so `protocols.js` ends the trip out when a push brings the same id. The plugin reads the push from `movementEvents` "outgoing" and sends the next load 10 seconds after the carts are home. When it misses the push, as after a reconnect, it sends again after twice the way there and 60 seconds more.

## Check the target: `gaa`

```json
{"KID": 0, "AX1": 297, "AY1": 297, "AX2": 303, "AY2": 303}
```

Before each send, the plugin reads a 7 by 7 square around the target, since the game may not answer for a single empty tile. It sends only when the tile at the target holds area type 1 (main castle), 3 (capital), 4 (outpost) or 12 (kingdom castle). A map that doesn't answer waits 10 minutes.

## Cart capacity

The client works out a cart's load in `CastlePremiumBoostData.getResourcesTransportablePerCarriage` (G@1910946):

```
1 + round(round1(100 × (100 + boost) / 100 × (1 + overloader / 100) + bonus))
```

- `boost` is effect type 96, `marketCarriageCapacityBoost`. Effect 90 in `cmi`'s `AE` is one of its effects.
- `overloader` is the premium caravan boost's level, which `cmi` does not carry.
- `bonus` is effect type 151, from the castle's baron and its area effects.

`cmi` alone can't give the load, so the plugin learns it, as Lazy Lord does:

1. It starts from `floor(100 × (1 + boost / 100))`, with `boost` the value of effect 90.
2. After each send, the load per cart is at least the amount divided by `A.MM.C`, rounded up.
3. When a load takes every free cart, a cart may take more. The next load tries one more per cart. The first refusal of such a try settles the load, and the plugin sends a full load again at once.

The learned load lives only in the run. A restart learns it again in a send or two.

## What the plugin relies on

- **Waits.** 10 seconds after the carts are home. 1 minute when no cart is free. 10 minutes when the castle is short, the game refuses, or the market or the map doesn't answer. An hour for a castle with no marketplace, a target that can't take resources, or a castle the account lacks.
- **Army starts are spaced.** Carts start a movement on the server like an attack. The plugin waits 5 to 10 seconds after the last army start (`armyGap.js`, shared with Troop transfer).
- **What was sent survives a restart.** The plugin keeps each row's running count in its plugin memory, under `sent`, by castle, target and resource. It never changes the saved rows.
- **Sending costs coins.** The client works out a coin cost from the distance and the carts (`getMarketTravelCostC1`). A send the account can't pay for is refused, and the plugin tries again 10 minutes later.

## Facts and confidence

| Fact | Confidence | Source |
|---|---|---|
| `cmi {S: 1, KID: -1}` lists every castle's carts, goods and effects | medium | Client (`C2SMarketInfoVO`, `CastleTradeVO`) and Lazy Lord's source |
| `crm {KID, SID, TX, TY, HBW, PTT, SD, G}`, with `G` as `[[code, amount]]` | medium | Client (`C2SCreateMarketMovementVO`) and Lazy Lord's source. Confirm with one cart of food. |
| The market sends wood, stone and food. The client's dialog lists ten goods | medium | Client (`CastleTradeVO.getResourcesAsCollectableList`). Lazy Lord sends only wood and stone. |
| The `crm` reply's `A` is a map movement of type 4, with `MM.C` the carts | high | Client (`CRMCommand`, `MarketMapmovementVO.parse_MM`) |
| `M.D` is the direction, and the way back is pushed as `crm` with `D` 1 | medium | Client (`_direction`) and Lazy Lord's source. Not captured. |
| A cart carries 100 plus effect 90 in %, and more from bonuses `cmi` doesn't list | medium | Client formula and Lazy Lord's source |
| A load larger than the free carts take is refused | low | Lazy Lord's source. The refusal code is unknown. |
| Area types 1, 3, 4 and 12 take resources | medium | Lazy Lord's source |
