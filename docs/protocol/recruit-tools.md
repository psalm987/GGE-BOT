# Recruit and tools: ordering with `bup`

The Recruit and tools plugin keeps each castle's troops and tools at a target by ordering them from the barracks and the workshops. This page holds what a live session showed on 2026-11-21 (client build 1173012, recorder session `20261121-203724-f52bfe`) and what is still unknown. The captured calls are in `packages/bot-core/test/fixtures/protocol/daily-20261121.json` as `bup_1` and `bup_2`, with the castle id replaced by 1000001.

## Production lists

| List | `LID` | Orders |
|---|---|---|
| Units | 0 | Troops from the barracks |
| Tools | 1 | Attack and defence tools from both workshops |

`docs/protocol/tools.md` covers list 1 in depth.

## Read a list

`spl {"LID": 0}` or `spl {"LID": 1}` (`C2SShowPackageListVO`). The client sends it for the castle it is in, so switch with `jca` first. A reply with nothing in production:

```json
{"PS": {}, "QS": [{"SI": {"RUT": -1, "VIP": 0}}, {"SI": {"RUT": -1, "VIP": 0}}, {"SI": {"RUT": 0, "VIP": 0}}, {"SI": {"RUT": 0, "VIP": 0}}, {"SI": {"RUT": 0, "VIP": 0}}], "RM": 0, "TCT": 0, "LID": 0}
```

| Field | Meaning |
|---|---|
| `PS` | The order in production, or `{}` when there is none |
| `PS.WID` | The item's `wodID` |
| `PS.TUA` | How many the order makes |
| `PS.RCT` | Seconds left |
| `PS.ICT` | Seconds the whole order takes |
| `PS.CBS`, `PS.RAH`, `PS.PID`, `PS.SPID` | Seen as `0`, `false` and two ids. Not used |
| `QS` | One entry for each queue slot, five in all |
| `QS[].SI.RUT` | `-1` on the two slots the UI showed as free, `0` on the three it showed locked behind rubies |
| `QS[].SI.VIP` | Seen as `0` |
| `RM` | Seen as `0` |
| `TCT` | Seconds left on the order in production, `0` when none |
| `LID` | The list id |

The game also pushes an `spl` when an order finishes, for example `{"PS": {}, "QS": [], "RM": 0, "TCT": 0, "LID": 1}`. Its `QS` is an empty array. A client that takes the first `spl` after its own request can read that push as the answer, so the plugin checks `LID` against the list it asked for.

## Queue an order

```json
{"LID": 0, "WID": 308, "AMT": 1, "PO": -1, "PWR": 0, "SK": 73, "SID": 0, "AID": 1000001}
```

| Field | Value |
|---|---|
| `LID` | 0 to recruit, 1 for a tool |
| `WID` | The item's `wodID`. The capture used 308 (Elitehalberd) and 614 (ladder) |
| `AMT` | How many |
| `PO` | -1 |
| `PWR` | 0 |
| `SK` | 73, the client's default |
| `SID` | The kingdom id |
| `AID` | The castle's object id |

The fields go in this order, as `C2SBuyUnitPackageVO` assigns them (`LID, WID, AMT, SID, AID, PO = -1, PWR = false, SK = 73`).

The reply carries `res` 0 and three objects.

| Reply field | Meaning |
|---|---|
| `spl` | The list after the order. The order is in `PS` when nothing was in production before |
| `grc` | The castle's resources: `W`, `S`, `F`, `C`, `O`, `G`, `A`, `I`, `HONEY`, `MEAD`, `BEEF`, `AID`, `KID` |
| `gcu` | The account's coins `C1` and rubies `C2` |

Both captured orders went into `PS`, and the free slots stayed at two. The items file prices an Elitehalberd at 180 coins (`costC1`) and a ladder at 28 wood and 12 stone.

When an order finishes the game pushes `rue {"AID", "SID", "WID", "NUA", "RUA"}`, where `NUA` is the castle's new count of that item and `RUA` how many the order added, then `gui` and `gpa`.

## Castle stock

`gui {}` (`C2SGetUnitInventoryVO`) answers `{"I": [[wodID, count], ...]}` for the castle the client is in, troops and tools together. The plugin reads every castle's stock from `dcl` instead, which carries `AC` for each castle, and counts what is in production and queued on top.

## What the plugin does with it

1. It orders only when there is room: `PS` is `{}`, or a slot of `QS` is shown free. A free slot is one that holds nothing but `SI`, with `RUT` other than 0.
2. It trusts an order only when the reply shows it: the item in `PS` when nothing was, otherwise one free slot fewer. A reply that shows neither ends the plugin's orders for that list.
3. It never orders an item that costs rubies, a Sceat component, a token or an event good. Only `costC1` and the castle resources `costWood`, `costStone` and the like count as a price the plugin may pay.
4. It keeps the account's coins above the coin floor and each castle resource above the resource floor.
5. It never sends `ups`, which unlocks a slot for rubies.

## Not known

| Fact | Status | Confirm with |
|---|---|---|
| The shape of a filled queue slot in `QS` | Not captured. Both captures had every slot free. The plugin treats any slot with more than `SI` as occupied, reads its order from `P` or from `WID` and `TUA` when it can, and otherwise reads the list as unknown and orders nothing | Queue 3 orders into list 0 and read `spl` |
| The most `AMT` one order may hold for a troop | Not captured. A tool order holds at most 80 (`TOOLS_LIMIT`). The plugin's per-order amount for troops is the player's setting | Order a large amount of a cheap troop |
| Which troops the barracks list accepts | Only 308 was captured. The plugin lists every `Barracks` troop paid with coins, including relic and research levels, and reads a refusal as "refused" | Order one of each kind |
| Kingdom limits on an item | The items file's `kIDs` is `1,2,3` for the ram and the ladder, yet a ladder was ordered in the Great Empire (`SID` 0). `kIDs` is therefore not used | Order a ram in kingdom 4 and 10 |
| Healing. `hru {"U", "A"}` | Not captured, so the plugin does not heal | Heal 1 troop and record the call |
| A refusal's result code | No refusal was captured. The plugin logs the code and treats 10 and 11 as short of money | Order more than the castle can pay |
