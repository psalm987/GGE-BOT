# Dethrone

Dethroning replaces the lord of a Foreign Lords or Bloodcrow camp. Exile puts a new lord with a different defence in the camp; the dialog rates the change at -10% to 0% of the defence. Fortify keeps the lord and adds extra defenders, rated +20% to +40%. Each costs more than the last.

## Request

`rae` (`C2SReplaceAlienCampVO`, G@12764097). The client sends the fields in this order:

| Field | Value |
|---|---|
| `XPOS`, `YPOS` | The camp's coordinates |
| `RCK` | The currency key. Exile sends the key the player picked from the event's `RCKS` list. Fortify sends `"C2"`, rubies. |

The Exile keys seen so far:

| `RCK` | Currency | Balance (`sce` push name) |
|---|---|---|
| `C1` | Coins | `gcu` `C1` |
| `GTO` | Gold token (currency 35) | `goldToken` |
| `STO` | Silver token (36) | `silverToken` |
| `ST` | Samurai token (7) | `samuraiToken` |

An event lists the keys it offers in `RCKS`. The Bloodcrow event in the live trace listed `["GTO","STO","ST"]` and no `C1`, so coins were not offered there.

The dethrone dialog builds the request in `onSendReroll` (G@12756378).

## Reply

The reply is an error code only (`RAECommand`, G@14287429). On `0` the client opens a success dialog. Afterwards the camp's `AI[9]` (already dethroned) is 1. See [invasions.md](invasions.md) for the camp layout.

## When the client allows it

The ring menu shows **Dethrone** (`ButtonAlienRerollComponent`, G@12751836) only when all of these hold:

- The event's `sei` entry has `CRE: 1` and a non-empty `RCKS`.
- For Exile, the key the player picked is in `RCKS`. Fortify needs no key.
- Your level is 70 or higher.
- None of your movements is heading to the camp.
- No movement from the camp is heading to you.

Dethroning a camp that was already dethroned shows a warning first.

## Cost

The cost depends on how many times you have dethroned, not on the camp level or your castle. The table is the `rerollCosts` items section, rows with `type: "alien"`, 20 rows in all. The full table is `cost-tables.json` in the fixtures.

| Count so far (`RCSC` for Exile, `RCHC` for Fortify) | Exile (coins) | Fortify (rubies) | Exile (gold tokens) | Exile (silver tokens) | Exile (samurai tokens) |
|---|---|---|---|---|---|
| 0 | 24,000 | 1,200 | 80 | 300 | 100 |
| 1 | 48,000 | 1,210 | 160 | 600 | 200 |
| 2 | 72,000 | 1,240 | 240 | 900 | 300 |
| 19 | 262,704,000 | 3,968,120 | 875,680 | 3,283,800 | 1,094,600 |

The token columns are the `costGoldToken`, `costSilverToken` and `costSamuraiToken` fields of the same rows. The rows also carry `costKhanTablet` and `costKhanMedal`, which no known event offers as an Exile key.

`CastleAlienRerollData` (G@14765338) reads the row at index `min(RCSC, 19)` for Exile and `min(RCHC, 20)` for Fortify. The Fortify index can reach 20, one past the last row, so the Fortify cost after 20 Fortifies is unknown. Exile with an event currency in place of coins reads that currency's column of the row. Ruby costs can be lower after discounts (`getFinalCostsC2`).

## Dethrone counts

`RCSC` is your Exile count and `RCHC` your Fortify count. Both arrive in the event's `sei` entry and in an `rce` push (`RCECommand`, G@14292009). Both feed `parse_RCE` (G@14766072).

The live trace showed the count change by push alone. After one Exile (`rae` with `RCK: "GTO"`, reply `0`) the server pushed `sce [["GTO",108842]]`, `hac {"CP":[[618,489]]}` and `rce {"RCSC":1,"RCHC":0}`. About 14 minutes later it pushed `rce {"RCSC":0,"RCHC":0}`, so the count falls back on its own. The bot takes the counts from `rce` and lets the push win over its own increment.

## Evidence and confidence

| Fact | Confidence | Confirm with |
|---|---|---|
| `rae` fields and order | high | |
| Exile sends an `RCKS` key, Fortify sends `"C2"` | high | |
| The reply is an error code only | high | |
| Level 70 and the movement rules | high on the client, medium on the server | |
| Cost table and its index | high | |
| Fortify cost after 20 Fortifies | low | Not worth confirming. |
| The counts reset each event | medium | Log `sei` `RCSC` and `RCHC` at the start of two events. |
| The count drops back about 14 minutes after an Exile, announced by `rce` | medium | One live trace, one drop. Log the time between an Exile and the next `rce` over a few Exiles. |
| An Exile with `GTO` costs the token column and updates the balance by `sce` | high | One live Exile at count 0: the dialog showed 108,922 gold tokens and a price of 80, and `sce` then sent 108,842. |
| An event's `RCKS` gates its Exile keys | high on the client, medium on the server | With `RCKS` `["GTO","STO","ST"]` the dialog showed exactly those three balances and offered no coin price. The server's answer to an unlisted key is untested. |
| The silver and samurai columns match `STO` and `ST` | low | Not exiled live. |
| The `rae` reply and the new counts | medium | One Exile, 24,000 coins for the first. |
