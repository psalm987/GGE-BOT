# Tools: production, levels and the armourer

Tooling keeps tool stocks at a target by producing tools in the workshops and buying them from the armourer. This page covers the production queue, how tool levels unlock, the armourer and the coin cap.

## Workshops

The siege workshop builds attack tools and the defence workshop builds defence tools. Each building level unlocks more tools: the building's `unlockIDs` lists them, and each tool's `buildingLevel` names the level it needs.

| Building | Level 1 | Level 2 | Level 3 | Level 4 |
|---|---|---|---|---|
| Siege workshop (`Workshop`) | 165 | 166 | 167 | 256 |
| Defence workshop (`Dworkshop`) | 176 | 177 | 178 | 257 |

These are building `wodID`s, from the `buildings` items section.

## Production queue

Both workshops share one production list, list 1 (`TOOLS_LIST=1`, D@2689726). Units use list 0 and auxiliary items list 3.

### Read the queue

`spl {LID: 1}` (`C2SShowPackageListVO`, G@2721416). `parse_SPL` (G@15310567) reads the reply:

| Field | Meaning |
|---|---|
| `LID` | The list id |
| `QS` | The queued orders |
| `PS` | The order in production |
| `RM` | The recruitment mode |
| `TCT` | Seconds left on the order in production |

### Queue an order

`bup` (`C2SBuyUnitPackageVO`, G@4154303). The client sends the fields in this order:

| Field | Value |
|---|---|
| `LID` | 1 |
| `WID` | The tool's `wodID` |
| `AMT` | How many |
| `PO` | -1 |
| `PWR` | 0 |
| `SK` | 73, the client's default |
| `SID` | The kingdom id |
| `AID` | The castle's area id |

One order holds at most 80 tools bought with coins or resources (`TOOLS_LIMIT=80`, D@2689705) and at most `MAXIMUM_PREMIUM_TOOL_STACK_SIZE` tools bought with rubies (G@2822509). The queue has 5 slots (`MAX_SLOTS=5`, D@2689693). `ups {LID: 1}` unlocks a slot for 375 rubies (`UNLOCK_C2`).

A ladder (614) costs 28 wood and 12 stone, and a ram (611) 56 wood and 24 stone.

## Tool levels

Research does not unlock tool levels. The research tower only speeds production (effects 108 and 114). `rei {}` returns the bought research ids as `BR` (`parse_REI`, G@15348784).

Levelled tools are the 20 Sceat chains, `wodID`s 245 to 567, each with levels 1 to 11 and building level 4. Each tool names its neighbours with `upgradeWodID` and `downgradeWodID`.

Sceat skills unlock the levels. A skill's `effects` holds `46&<wodID>` to enable a tool and `84&<wodID>` to disable one. `data/tool-unlocks.tsv` lists 193 enables and 350 disables. `skl {}` returns your active Sceat skills as `SIDS` (`parse_SKL`, G@12954443), and login data carries them too.

The level you can build in a chain is the highest enabled `wodID` that no active skill disables.

Basic tools have one level: ram (611), ladder (614), mantlet (620), wood bundle (617) and the defence tools.

## Armourer

The armourer is a package event, event 27 (`EVENTTYPE_ARMORER`, D@2595230). The client handles it as `ArmorerEventVO` (G@13171539). It sells only the packages listed in its `sei` entry as `PIDS` (`BuyPackagesEventVO`, G@803863).

### Buy

`sbp` (`C2SBuyEventPackageVO`, G@3046598). The client sends the fields in this order:

| Field | Value |
|---|---|
| `PID` | The package id |
| `BT` | 0 |
| `TID` | 27 |
| `AMT` | How many packages |
| `KID` | The kingdom |
| `AID` | -1 for a tool. A castle's object id only for a package whose reward is a building |
| `PC2` | -1 |
| `BA` | 0 |
| `PWR` | 0 |
| `_PO` | -1 |

`attackStormForts.js` already sends `sbp`, with `BT: 3`.

The reply is `{gcu, gui, grc, cpi, sin, vip, ...}` (`SBPCommand`, G@14367138). The errors are 10 (`NOT_ENOUGH_CURRENCY1`), 154 (`STORAGE_CAPACITY_REACHED`) and 327 (`NOT_ENOUGH_SPECIAL_CURRENCY`).

### Which castle receives a package

Nothing in the client lets a player choose a castle for a tool package. This was read from `Game.bundle.b13ef28e9bb95fa622bd.js` of the public HTML5 client, without logging in.

- `C2SBuyEventPackageVO` takes `(PID, BT, TID, AMT, KID, AID = -1, PC2 = -1, BA, _PO, PWR)`.
- The shared buy dialog (`AMerchantBuyDialog.onBtnOkClick`) sets `KID` to the active kingdom and starts `AID` at -1. It fills `AID` only when `packageVO.reward.itemType == CollectableEnum.BUILDING`. Then it sends the active castle's object id, or the kingdom's main castle when the active area is not one of the player's castles.
- Armourer packages reward units, so the client sends `AID` -1 for every tool.
- The re-buy path of the equipment merchant dialog also sends `AID` -1.

So `KID` picks the kingdom and the server picks the castle. Which castle that is, the active castle, the main castle or one the server chooses, is **not known**. The bot sends what the client sends and does not set `AID` for tools.

How the Armourer module uses this. A row names a castle. The bot counts that castle's tools and compares them with the row's stock, then buys into the castle's kingdom with `AID` -1. For a kingdom's main castle this is the best-supported case. For any other castle, the bot checks that the purchase raised that castle's count, and stops buying for that row if it did not (log key `buyToolsNotArrived`).

| Fact | Confidence | Confirm with |
|---|---|---|
| The client sends `AID` -1 for tool packages | high | |
| `AID` is only a castle id for building rewards | high | |
| The server delivers a tool package to the kingdom's main castle | low | Buy one package from the second test account while another castle is active, then read both castles' tools. |

### Coin prices

Each package holds 1 tool. `data/armorer-packages.tsv` has every package.

| Package | Tool | `wodID` | Coins | Player level |
|---|---|---|---|---|
| 28 | Ladder | 614 | 220 | 4 and up |
| 32 | Ram | 611 | 430 | 4 and up |
| 36 | Mantlet | 620 | 810 | 17 and up |
| 40 | Wood bundle | 617 | 1,610 | 38 and up |
| 30 | Defence rocks | 637 | 550 | 3 and up |
| 2472 | Defence rocks | 637 | 110 | 6 to 99 |
| 34 | Gate reinforcement | 626 | 1,720 | 3 and up |
| 2474 | Gate reinforcement | 626 | 344 | 6 to 99 |
| 38 | Flaming arrows | 629 | 3,210 | 16 and up |
| 2476 | Flaming arrows | 629 | 642 | 6 to 99 |
| 42 | Sharpened stakes | 634 | 5,780 | 38 and up |
| 2478 | Sharpened stakes | 634 | 1,156 | 6 to 99 |
| 256 | Ballast stone | 56 | 8,140 | 4 and up |

Banners from the armourer (275, 393 and others) cost rubies only. A purchase is capped by the package's `maxBuyPerClick` or its `stock`.

## Coin cap

The client checks no coin cap. `parseGCU` stores `gcu.C1` as it arrives (G@15494696). The client defines `MAX_INT = 2147483647` (G@298396), and a server-side 32-bit integer would cap coins there, but nothing in the client shows that it does.

## Evidence and confidence

| Fact | Confidence | Confirm with |
|---|---|---|
| Workshop ids and unlocks | high | |
| Both workshops share list 1 | high | Queue 1 ladder (614) with `bup`. |
| `spl` and `bup` fields and order | high | The same ladder order. |
| 80 coin tools per order, 5 slots | high | |
| Sceat skills set tool levels | high on the data, medium on the level rule | Log the `skl` reply and compare `SIDS` with the recruit list. |
| Armourer is event 27 and sells `sei` `PIDS` | high on the client, medium on which offers are live | Log the login `sei` frame. |
| `sbp` fields, reply and errors | high | Buy package 28 once, 220 coins. |
| Coin cap | low | Log `gcu.C1` on an account with many coins. |
