# Nomad camps, the Khan camp and the Khan's taunts

This page is reference for the Nomad Invasion: the Nomad camps, the Khan camp, rage and taunts, and the castle defence a taunt meets. It comes from two recorder traces of 2026-11-22, sessions `20261122-000542-92f4e2` (Nomads) and `20261122-001737-052ef3` (Khan), read with the client build `Game.bundle.b13ef28e9bb95fa622bd.js` and `items_v790.03.json`. The masked captures are `packages/bot-core/test/fixtures/protocol/nomad-20261122.json` and `khan-20261122.json`.

## One event, two camp types

| | Nomad camp | Khan camp |
|---|---|---|
| Event id (`EID`) | 72 | 72 |
| Area type | 27, `AreaType.nomadCamp` | 35, `AreaType.khanCamp` |
| Camp owner id | -601 | -801 |
| Movement type of an attack (`M.T`) | 0 | 21 |

Both camp types belong to event 72. The event has one difficulty and one score:

- `sede {EID: 72, EDID, C2U: 0}` sets the difficulty for both camp types. The trace set `EDID` 310, tier 10 (`difficultyTypeID` 10), and the server answered 0 with `C2U` 0.
- `pep {EID: 72}` returns one `OP[0]` for the player, whichever camp type earned the points.

The Nomad, Samurai and Khan plugins share one `sede` per event start through `settleDifficulty` in `packages/bot-core/eventDifficulty.js`. The first plugin to see the event start sends it, and the others take its answer. Each plugin's score shutoff reads the same `OP[0]`.

## Nomad camps

### Camp area info

| `AI` index | `extraData` index | Field |
|---|---|---|
| 0 | | Area type, 27 |
| 1, 2 | | X, Y |
| 3 | 0 | Seconds since the player's last spy, -1 when never spied |
| 4 | 1 | Victories against this camp |
| 5 | 2 | Seconds until the camp can be attacked. 0 or less means now. A camp never attacked shows minus the current Unix time. |
| 6 | 3 | Always 0 in the trace |
| 7 | 4 | Owner, -601 |
| 8 | 5 | `eventAutoScalingCampID` |
| 9, 10, 11 | 6, 7, 8 | Wall, gate and moat bonus (200, 160 and 40 at difficulty 310) |

Samurai camps (area type 29) have the same layout.

### A camp climbs one row per victory

Each victory moves a camp to the next `eventAutoScalingCamps` row. At difficulty 310 the rows are 991 to 1000, camp level 101 to 110. Rows 991 to 999 have `coolDown` 0. Row 1000 is the last, with `coolDown` 5400 and `saveSettingForNumberOfAttacks` -1.

The trace sent 10 attacks at one camp before the first one landed. All 10 won. Victories 1 to 9 moved the camp from 991 to 1000 and left its wait at 0. The tenth victory, against row 1000, set the wait to 5400 seconds. From then on, every victory against the camp sets the wait to 5400 seconds again.

A camp can therefore take as many attacks in flight as there are rows with `coolDown` 0 from its current row, plus one. `hitsBeforeCooldown` in `packages/bot-core/eventCamps.js` computes this number, and the Nomad and Samurai plugins send up to that many attacks at a camp at once.

### Points depend on the chests in the later waves

| Later waves | Points for one victory |
|---|---|
| 40 HugeKhanTabletChests (unit 405) in wave 2 only | 714 to 921 |
| 405 chests in waves 2 to 5, 40 on each flank and 50 at the front | 5,571 to 6,189 |

The first wave carried 5 ladders (740), 4 rams (738) and 11 or 12 rolling shields (739), with 125, 125 and 254 Shield Maidens (215).

### Skips

`msd {X, Y, MID: -1, NID: -1, MST, KID: "0"}` skips a camp's wait. `KID` is a string. The reply is the camp's new `AI` array. From the trace, `MS3` takes off 10 minutes, `MS4` 30 minutes and `MS5` 60 minutes. A wait of 5400 seconds took one `MS5` and one `MS4`.

### Spying

`ssi {TX, TY, KID}` asks how many spies the player can send. The reply carries the target's `gaa` and `AS`, the spies available.

`csm {SID, TX, TY, SC, ST, SE, HBW, KID, PTT, SD}` sends the spies. The trace sent `SC` 29, `ST` 0, `SE` 100, `HBW` -1 and `PTT` 1. The movement in the reply has `T` 3 and `HBW` 1009.

## The Khan camp

### Camp area info

The Khan camp has its own layout.

| `AI` index | `extraData` index | Field |
|---|---|---|
| 0 | | Area type, 35 |
| 1, 2 | | X, Y |
| 3 | 0 | Seconds since the player's last spy, -1 when never spied |
| 4 | 1 | Always -1 in the trace |
| 5 | 2 | Seconds until the camp can be attacked |
| 6 | 3 | The full wait the last attack started |
| 7 | 4 | Rubies to skip the wait |
| 8 | 5 | Attack counter. It starts at 1 and goes up by one with each victory. |
| 9 | 6 | `eventAutoScalingCampID` |
| 10, 11, 12 | 7, 8, 9 | Wall, gate and moat bonus |

The wait after each victory is the row's `coolDown` plus `cooldownIncrease` for each earlier victory. For row 1153 the trace showed 780, 1200, 1620 and 2040 seconds. The skip cost grows the same way, by `skipCostIncrease`: 3915, 4760 and 5605 rubies.

After each victory the server also pushes `aic {AC: [{X, Y, AR, ACID, EID: 72, ACVC}]}`. `AR` is the alliance's rage on the camp, `ACID` the camp's row and `ACVC` the attack counter.

### Rage

`rpr {EID: 72, PCRP, PTRP}` reports the player's rage. `PCRP` is the current rage, and it stops at the camp row's `playerRageCap`, 2460 for row 1153. `PTRP` is the total rage the player has earned.

A victory adds `generatedRagePerAttack` and the rage of the tools in the waves. The trace sent 40, 40 and 50 RageBoost tools (unit 106) in waves 2 to 5 and gained 1,426 to 2,254 rage a hit. A defended taunt adds `generatedRagePerDefense`, 1,610 for row 1153.

### Taunts

`lta {AV: 0, EID: 72}` spends the full rage bar on a taunt. The server has no direct reply. It pushes `rpr` with `PCRP` 0, then a `gam` with one movement:

| Field | Value |
|---|---|
| `M.T` | 20 |
| `M.OID`, `M.SID` | -801 |
| `M.TT` | 400, the seconds until it lands |
| `M.TA` | The player's main castle |
| `M.SA` | The Khan camp |
| `FA` | The attacking army per flank, `{L, M, R, RW}` |

The taunt lands at the time `M.TT` gives. No movement-removal push names it. Its landing shows as `rpr`, `aic`, `pep` and a report message (`sne`, type 6) all at once.

### A defended taunt is where the points are

| Action | `pep OP[0]` before | After | Gain |
|---|---|---|---|
| A victory against the camp | 26,648 | 27,150 | about 500 |
| The first taunt defended | 28,324 | 227,537 | 199,213 |
| The second taunt defended | 227,738 | 443,674 | 215,936 |

A defended taunt also fills the rage bar again: after the second defence `PCRP` was back at 2460. A plugin that taunts at a full bar keeps the chain going while the defence holds.

## Castle defence

The client reads the whole defence with one command and writes it in three parts.

### Read the defence

`dfc {CX, CY, AID, KID: -1}`. `CX` and `CY` are the castle's position and `AID` its id. The reply holds:

| Field | Content |
|---|---|
| `A` | The castle's area info |
| `dfw` | The walls, as written by `dfw` below, plus `U`, `US` and `D` (defence value) |
| `dfm` | The moat, as written by `dfm` below, plus `D` |
| `dfk` | The courtyard, as written by `dfk` below, plus `U`, `UYL` and `AUYL` |
| `gui` | The castle's storage, `{I: [[wodID, count]]}` |

### Write the walls

`dfw {CX, CY, AID, L, M, R}`. Each side is `{S: [[wodID, amount]], UP, UC}`:

- `S` is the side's tool slots. An empty slot is `[-1, 0]`. The trace had 4 slots on each flank and 6 at the front.
- `UP` is the side's share of the defending troops in percent. The trace had 30, 40 and 30.
- `UC` was 0 throughout.

The reply repeats the three sides with `U`, `US` and `D`. The client sent one more empty slot on each flank than the reply holds, and the server accepted it.

### Write the moat

`dfm {CX, CY, AID, LS, MS, RS}`. Each part is a list of one slot, `[[wodID, amount]]`. The reply repeats it with `D`.

### Write the courtyard

`dfk {CX, CY, AID, MAUCT, UC, S, STS}`. The trace had `MAUCT` 200, `UC` 51, and three empty slots in each of `S` and `STS`. The client sends `dfk` twice after every `dfw`, unchanged. The trace has no courtyard change, so what `S` and `STS` hold is not confirmed.

### A slot takes its tools out of storage

A write moves tools between storage and the slots. The trace raised every wall slot of tool 110 to 999. The 110 slots went from 8,284 tools to 11,988, and storage went from 50,497 to 46,793, the same 3,704 tools. The moat writes moved 926 moat tools (unit 112) the same way.

A defence uses up the tools in the slots. To keep the defence at strength, read `dfc` after a taunt lands and write each part back up to the wanted amounts, while storage lasts. The Khan plugin's `keepDefence` option does this in `packages/bot-core/khanDefence.js`. It refills to the layout it read when the plugin started, and a slot the player raises or changes in the game becomes the new target.

The trace's tools were elite Nomad defence tools: unit 110 on the walls (ranged defence +70), 622 at the gate (gate +75) and 112 in the moat (moat +110).

## Evidence and confidence

| Fact | Confidence | Confirm with |
|---|---|---|
| Both camp types are event 72 with one difficulty and one score | high | |
| Nomad and Khan `AI` layouts | high | |
| Rows with `coolDown` 0 take attacks in flight, the last row waits 5400 seconds | high | |
| `msd` fields and the skip lengths | high | |
| `lta`, the taunt movement and its landing time | high | |
| About 200,000 points for a defended taunt at row 1153 | high, for this row | A capture at another difficulty |
| `dfc`, `dfw` and `dfm` fields | high | |
| A write moves tools out of storage | high | |
| A defence uses up slot tools | medium | Read `dfc` after a taunt lands |
| What `dfk` `S` and `STS` hold | low | Change the courtyard in the game while recording |
| An empty slot after a defence reads `[-1, 0]` | low | Read `dfc` after a defence that empties a slot |
