# Healing troops: `hfl` and `hru`

The Heal troops plugin (`packages/bot-core/plugins/healTroops.js`) heals each castle's wounded troops with coins. This page holds the commands it sends, the hospital state it reads and what each refusal means. Most facts come from Lazy Lord's source (`be/plugins/healTroops.js`, MIT). Only the `hfl` request and its reply are captured in our fixtures. The table at the end gives each fact its source.

## The hospital in the castle data

| Field | Where | Meaning |
|---|---|---|
| `H` | A castle of `dcl` | The castle has a military hospital. `protocols.js` keeps it as `castle.hasHospital`, and an update without `H` keeps the old value |
| `HI` | A castle of `dcl` | The wounded, as `[[wodID, amount], …]`. `protocols.js` keeps it as `castle.hospitalInventory` |
| `spl2` | `jaa` | The hospital list (LID 2) as a player sees it on opening it. `castleQueue(kingdomID, castleID, 2)` returns it |

The plugin reads the wounded from `dcl` at the start of each check and never enters a castle with none.

## The hospital list (`PIDL`)

The hospital list is an `spl` with `LID` 2. Its `PIDL` holds one array for each slot:

| Slot | Meaning |
|---|---|
| `[-1, …]` | Free |
| `[-2, …]` | Locked |
| `[unit, amount, secondsLeft, speed, helpSecondsTaken, batchID, …]` | Healing. Lazy Lord names it after the client's `UnitHealPackageSlotVO` |

A hospital with no free slot stays full until its shortest batch ends. The plugin waits for the smallest `secondsLeft` of a healing slot, plus 10 seconds for the difference between the clocks.

## Open the hospital

```json
{"KID": 0, "AID": 1000001, "HRF": -1}
```

The client sends `hfl` when the player opens a castle's hospital. The game echoes the request with `HRF` set to 1. The capture is `hfl_1` in `packages/bot-core/test/fixtures/protocol/daily-20261121.json`. Lazy Lord saw the same echo for a castle without a hospital, so the reply says nothing about the hospital.

## Heal

```json
{"U": 1, "A": 100}
```

| Field | Value |
|---|---|
| `U` | The unit's `wodID` |
| `A` | How many to heal |

`hru` names no castle. It heals in the castle the player is in, so the plugin sends it inside `setCastle`. An accepted heal answers with `spl` (the hospital list after the heal) and `gcu` (the account's coins). `protocols.js` also reads a `gui` in the reply, if there is one, as the castle's new stock.

A unit costs `healingCostC1` coins a head (`items/units.json`). The plugin heals only units with `healingCostC1` above 0 and no `healingCostC2` (rubies).

## Refusals

| Code | Name | What the plugin does |
|---|---|---|
| 10 | `NOT_ENOUGH_CURRENCY1` | Sends nothing to that castle until the coins cover the refused heal, `healingCostC1 × A` |
| 88 | `TOO_MUCH_UNITS` | Halves the amount at the next check |
| 63 | `NO_FREE_CONSTRUCTION_SLOT` | Backs off without a log line: the hospital has no free slot |
| 53 | `NOT_IN_OWNED_CASTLE` | Joins the castle again and heals once more, once only |
| Any other, or no answer | | Backs off 1, 2, then 4 checks, an hour at most |

## Alliance help

A healing batch can get alliance help: `ahr {"ID": batchID, "T": 2}`, where `batchID` is the slot's field 5. [alliance-help.md](alliance-help.md) covers the request. The plugin asks only for a batch with no help taken yet (field 4 is 0) and more than a minute left (field 2). Lazy Lord saw `INVALID_PARAMETER_VALUE` for a batch that was about to end.

## Facts and confidence

| Fact | Confidence | Source |
|---|---|---|
| `hfl {KID, AID, HRF: -1}`, echoed with `HRF: 1` | high | Captured: `hfl_1` in `daily-20261121.json` |
| `hfl` is echoed for a castle without a hospital as well | medium | Lazy Lord's source. Confirm by opening a castle without a hospital |
| `hru {U, A}` heals in the castle the player is in, and is refused with 53 elsewhere | medium | Lazy Lord's source. Confirm with one live heal |
| The `hru` reply carries `spl` with `LID` 2 and `PIDL`, and `gcu` | medium | Lazy Lord's source. Confirm with one live heal |
| `PIDL` slot shape: `[-1]` free, `[-2]` locked, `[unit, amount, secondsLeft, speed, helpSecondsTaken, batchID]` | medium | Lazy Lord's source, after the client's `UnitHealPackageSlotVO` |
| `jaa` carries the hospital as `spl2` | medium | Lazy Lord's source and the client's `parse_SPL` ([castle-state.md](castle-state.md)) |
| `H` and `HI` in `dcl` | medium | Lazy Lord's source and `protocols.js`. Confirm with one live `dcl` of a castle with wounded |
| Coin-only units: `healingCostC1 > 0` and no `healingCostC2` | medium | Lazy Lord's source and `items/units.json` field names |
| Codes 10, 88, 63 and 53 for `hru`, and their meaning | medium | Lazy Lord's source and `err.json` names |
