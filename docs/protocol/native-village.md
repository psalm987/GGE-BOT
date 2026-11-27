# Native village

The Native village plugin (`packages/bot-core/plugins/nativeVillage.js`) spends a kingdom castle's goods on the pack the player picks in that kingdom's native village.

The request shapes come from Lazy Lord's source (`be/plugins/nativeVillage.js`, which cites client captures of 2026-11-06, one per kingdom). They are not yet captured by this project. The packs and prices come from the game's `items/slums.json` and `items/packages.json` as of 2026-11.

## The villages

| Kingdom | Goods | Price field in `packages.json` |
|---|---|---|
| 1 Burning Sands | Olive oil | `packagePriceOil` |
| 2 Everwinter Glacier | Charcoal | `packagePriceCoal` |
| 3 Fire Peaks | Glass | `packagePriceGlass` |

`slums.json` lists each village's levels: `{slumLevel, kID, packageIDs: "a+b"}`. Each level unlocks two packs:

| Level | Burning Sands | Everwinter Glacier | Fire Peaks |
|---|---|---|---|
| 1 | 108 coins, 3174 iron production item | 100 coins, 2793 food production item | 116 coins, 3177 iron storage item |
| 2 | 110 saber warriors, 111 desert bowmen | 102 Norseman warriors, 103 Norseman bowmen | 118 cultist warriors, 119 cultist bowmen |
| 3 | 112 composite bowmen, 113 flame bearers | 104 wolfhounds, 105 barbarians | 120 demon horrors, 121 deathly horrors |
| 4 | 3175 oil production item, 3176 oil storage item | 2794 charcoal production item, 3173 charcoal storage item | 3178 glass production item, 3179 glass storage item |

The village's level is `SL` in the kingdom's `kpi.UL` entry (`UnlockInfo.slumLevel` in `protocols.js`). The plugin reads the price and the level from the game's data at run time, so a changed price needs no code change. The pack ids above are fixed in the plugin, one Select choice each.

## Open the village: `gbc`

```json
{"CID": 1000001, "KID": 1}
```

`CID` is the kingdom castle's id. The client sends it when the player opens the village, inside that castle.

## Buy: `sbp`

```json
{"PID": 110, "BT": 3, "TID": -1, "AMT": 10, "KID": 1, "AID": -1, "PC2": -1, "BA": 0, "PWR": 0, "_PO": -1}
```

| Field | Value |
|---|---|
| `PID` | The package id |
| `BT` | 3, the native village. The armourer uses 0 ([tools.md](tools.md)) |
| `TID` | -1 |
| `AMT` | How many packs. The plugin buys `min(100, floor((goods − keep) / price))` |
| `KID` | The village's kingdom |

`sbp` names no castle, so the plugin joins the kingdom castle first (`setCastle`) and runs `gbc` and `sbp` in the `shopTurn` line, because the reply names no purchase.

## Refusals

| Code | Name | What the plugin does |
|---|---|---|
| 377 | `CONSTRUCTION_ITEM_INVENTORY_MAX_AMOUNT_REACHED` | The building item storage is full. That village is closed until the bot restarts, and the status says so. The saved pick is not changed |
| Any other | | Logged. The next round, 30 minutes later, tries again |

## Facts and confidence

| Fact | Confidence | Source |
|---|---|---|
| `gbc {CID, KID}` then `sbp {…, BT: 3, TID: -1, …}` | medium | Lazy Lord's source, after their client captures. Confirm with one pack on the test account. |
| The packs, levels and prices above | high | `items/slums.json` and `items/packages.json`, 2026-11 |
| The village level is `kpi.UL[].SL` | medium | Lazy Lord's source |
| 377 means the building item storage is full | medium | Lazy Lord's source |
| The client bought 11 packs in one `sbp` | medium | Lazy Lord's source. The cap of 100 is their choice, not a known game limit |
