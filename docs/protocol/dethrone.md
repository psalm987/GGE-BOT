# Dethrone

Dethroning replaces the lord of a Foreign Lords or Bloodcrow camp. Exile puts a new lord with a different defence in the camp. Fortify keeps the lord and adds extra defenders. Each costs more than the last.

## Request

`rae` (`C2SReplaceAlienCampVO`, G@12764097). The client sends the fields in this order:

| Field | Value |
|---|---|
| `XPOS`, `YPOS` | The camp's coordinates |
| `RCK` | The currency key. Exile sends the key the player picked from the event's `RCKS` list, such as `"C1"` for coins. Fortify sends `"C2"`, rubies. |

The dethrone dialog builds the request in `onSendReroll` (G@12756378).

## Reply

The reply is an error code only (`RAECommand`, G@14287429). On `0` the client opens a success dialog. Afterwards the camp's `AI[9]` (already dethroned) is 1. See [invasions.md](invasions.md) for the camp layout.

## When the client allows it

The ring menu shows **Dethrone** (`ButtonAlienRerollComponent`, G@12751836) only when all of these hold:

- The event's `sei` entry has `CRE: 1` and a non-empty `RCKS`.
- Your level is 70 or higher.
- None of your movements is heading to the camp.
- No movement from the camp is heading to you.

Dethroning a camp that was already dethroned shows a warning first.

## Cost

The cost depends on how many times you have dethroned, not on the camp level or your castle. The table is the `rerollCosts` items section, rows with `type: "alien"`, 20 rows in all. The full table is `cost-tables.json` in the fixtures.

| Count so far (`RCSC` for Exile, `RCHC` for Fortify) | Exile (coins) | Fortify (rubies) |
|---|---|---|
| 0 | 24,000 | 1,200 |
| 1 | 48,000 | 1,210 |
| 4 | 192,000 | 1,340 |
| 9 | 2,136,000 | 4,100 |
| 14 | 23,688,000 | 124,000 |
| 19 | 262,704,000 | 3,968,120 |

`CastleAlienRerollData` (G@14765338) reads the row at index `min(RCSC, 19)` for Exile and `min(RCHC, 20)` for Fortify. The Fortify index can reach 20, one past the last row, so the Fortify cost after 20 Fortifies is unknown. Exile with an event currency in place of coins reads that row's `softCosts`. Ruby costs can be lower after discounts (`getFinalCostsC2`).

## Dethrone counts

`RCSC` is your Exile count and `RCHC` your Fortify count. Both arrive in the event's `sei` entry and in an `rce` push (`RCECommand`, G@14292009). Both feed `parse_RCE` (G@14766072).

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
| The `rae` reply and the new counts | medium | One Exile, 24,000 coins for the first. |
