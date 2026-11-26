# Berimond kingdom watchtowers

Berimond is kingdom 10, a faction kingdom. A player joins a faction there, owns one camp (a castle of area type 15) and attacks the enemy faction's watchtowers (area type 17) for faction points. This is not the Berimond Invasion event of [event-camps.md](event-camps.md) and [invasions.md](invasions.md), which the bot already attacks from `plugins/attack/attackBerimondInvasion.js`. That event uses invasion camps of type 30 in the home kingdoms. This page is about the towers of kingdom 10 and the commands a towers plugin sends.

Each fact below is labelled. **Live** was seen in the trace. **Client** comes from the client's class names (`tools/trace/cmd-names.json`), its error names (`packages/bot-core/err.json`) or the existing protocol pages. **Inferred** is a reading of the live data that the data supports but the server never states.

The page comes from one recorder session of the player's own account, `20261126-032939-2aa831` of 2026-11-26 (zone `EmpireEx_26`, 360 s, 200 steps). The player joined the camp, attacked one tower twice, moved troops in from the Green kingdom and left the camp again. The masked capture is `packages/bot-core/test/fixtures/protocol/berimond-kingdom.json`. The client bundle was not read for this page, so no field order here comes from a `C2S*VO` constructor.

## The flow of one tower attack

| Step | Command | Live sample (seconds into the session) |
|---|---|---|
| 1. Ask for the next tower | `fnt {}` | 6.8 |
| 2. Count spies | `ssi {TX, TY, KID}` | 8.0 |
| 3. Spy | `csm {SID, TX, TY, SC, ST, SE, HBW, KID, PTT, SD}` | 10.6 |
| 4. Read the defence | `aci {TX, TY, SX, SY, KID}` | 14.7 |
| 5. Pick an army | `gas {}` (see [presets.md](presets.md)) | 15.1 |
| 6. Attack | `cra {...}` | 31.9 |
| 7. Wait for the landing, 88 s later | pushes `ufp`, `pep`, `gaa`, `gie` | 120.6 |

The client sent the steps in this order the first time. The second run was `fnt`, `ssi`, `csm`, `ssu`, `aci`, `sas`, `cra`, with no `gas`. Nothing in the trace proves that `ssi` or `csm` is required before `aci` or `cra`. The attack ran 21 s after the spies landed (live).

## Finding the tower: `fnt`

`fnt {}` has no fields (live). The client class is `C2SFindNextTowerVO` (client). The reply, both times:

| Field | Value | Meaning |
|---|---|---|
| `X`, `Y` | 1409, 110 | The tower's coordinates (live) |
| `gaa` | `{KID: 10, uap, OI: [], AI: [[...]]}` | The same area record `ssi` and the map pushes carry, with the tower as the only entry in `AI` (live) |

The server chose the tower. The client sent no coordinates and no side. The same tower came back 183 s later, after one attack on it had landed, so a hit does not remove a tower (live). The tower was blue, owner `-410`, and the player's faction id is 1 (see "Sides"). Whether `fnt` always returns a tower of the enemy side is inferred from this one sample.

## Tower `AI` layout

The tower's area record, `AI` in `fnt`, `ssi` and the `gaa` pushes, and `TA` in the `csm` and `cra` movements:

```
[17, 1409, 110, -410, 0, [], -1, 55, 4383, 85]
```

| Index | Seen | Meaning | Confidence |
|---|---|---|---|
| 0 | 17 | Area type, `AreaType.watchTower` (live, and `ssu` names it `AT`) | high |
| 1, 2 | 1409, 110 | X and Y (live) | high |
| 3 | -410 | Owner. `ssu` names it `DP`. -410 is the blue faction king in `DungeonConst.BLUE_FACTION_KING` (client, see [event-camps.md](event-camps.md)) | high |
| 4 | 0 | Always 0 in four samples, meaning unknown | low |
| 5 | `[]` | A list of `[x, y]` pairs. Empty for the tower `fnt` returned. A second tower at 1420,123 held `[[1409,110]]`. Inferred to mean "attackable only after these towers fall" | low |
| 6 | -1, 0, 4, 21, 42 | Seconds since the spies landed. It read 0 at 0.8 s after the `csm`, 4 at the next `aci` (3.3 s later), 21 at the `cra` (20.5 s after the spies landed) and 42 in the second run, matching `aci`'s `AS` each time. It read -1 again by 109 s, and in the `fnt` and `ssi` replies sent before any spy. The window is somewhere between 42 and 109 s | medium (inferred) |
| 7 | 55 | `ssu` names it `DL`. The second tower also held 55. Meaning unknown. The camp id is also 55, so it is easy to mistake for the player's camp | low |
| 8 | 4383 down to 4363 | A counter that fell by 1 about every 14 to 18 s (4383, 4382, 4380, 4375, 4371, 4370, 4363 over 313 s), also before the first hit landed. The second tower's value stayed 9316. Not seconds, not hits | low (inferred) |
| 9 | 85 | `ssu` names it `SPC`. The second tower held 86 | low |

`ssu` is a spy-report command the client sent 2 s after the second spy. Its reply names the same record: `AI: {N, DP, AT, K, X, Y, DL, KL, WL, GL, TL, ML, RT, MID, NID, EID, SPC}` with `K` 10, `DL` 55, `SPC` 85 and `KL`, `WL`, `GL`, `TL`, `ML` all 0 (live). `KL` to `ML` read as keep, wall, gate, tower and moat levels at 0, an inference from the letters. `ssu` also repeats the defence `B` and `S` that `aci` returns. It is in the fixture as `ssu_1`.

Type 16 records appeared in the `gaa` pushes at each landing: `[16, 1407, 108, -410, [[1409,110]], -1, 30, 0, 1]` and two more around the tower (1411,112 and 1405,113), each linking back to the tower (live). They have a different layout from type 17, with the link list at index 4. What they are is unknown. Type 16 is not in `AreaType`.

## Spying: `ssi` and `csm`

The bot's `ssi` helper (`packages/bot-core/protocols.js`) sends exactly the live request, `{TX, TY, KID}`. The reply carried `TX`, `TY`, `gaa`, `AS` 38, `APM` 0, `TPM` 0 and `GC` 50 (live). `AS` is the spies available, as in [nomad-khan.md](nomad-khan.md). `GC` is a cost, 50 in both runs. `APM` and `TPM` were 0 and their meaning is unknown.

`csm` sent `{SID: 55, TX, TY, SC: 38, ST: 0, SE: 100, HBW: -1, KID: 10, PTT: 1, SD: 0}` (live). `SID` is the player's camp id, 55, not a castle id of the home kingdom. `SC` was every spy available. The reply is `{A: {M, S}, O}` (live). `M` is the movement with `T` 3, `TT` 1 s and `TA` the tower record. `S` is `{SC: 38, ST: 0, SA: 100, SR: 4}`, and `SR` 4 is unexplained. `O` holds the player's own info block and is left out of the fixture. The movement carried `HBW` 1023. [nomad-khan.md](nomad-khan.md) recorded 1009 for a home-kingdom spy, so `HBW` is not fixed.

## Reading the defence: `aci`

`aci {TX, TY, SX, SY, KID}` is `C2SGetAttackCastleInfosVO` (client). `SX`, `SY` are the coordinates of the castle attacking from, here the Berimond camp at 1296,111. The reply keys (live):

| Key | Seen | Meaning |
|---|---|---|
| `KID`, `TX`, `TY` | 10, 1409, 110 | Echo |
| `SCID` | 55 | The attacking camp's id |
| `gaa` | The tower, with `AI[6]` set | `AI[6]` was 4 and then 2 here (live) |
| `AS` | 4, then 2 | Equal to `AI[6]` both times, so it is not a spy count here (live) |
| `HAWL` | 4 both times | Unknown. The second attack used four waves, so it may be an attack wave limit |
| `B` | `{DLID: -106, GID: 114, GEM: [], E, AE: [], GASAIDS: [], SIDS: []}` | The defending commander. `GID` 114 is its general id and `E` its equipment (left out of the fixture) |
| `S` | Seven lists of `[unitId, count]` | The defence by slot, here `[[710,88],[711,21],[647,1],[647,1]]`, three more filled lists and three empty ones. What each list is (wave, flank or yard) was not confirmed |
| `gui` | `{I, SHI, HI, TU}` | The attacking camp's inventory. `I` is `[id, count]` for units and tools |
| `gli` | Commanders and their equipment, 33 KB | Left out of the fixture |
| `MB`, `AE` | 1.2592592, a list of `[id, [value], kind]` | Bonuses. Left out, meaning unknown |

The defence was identical in both reads, so one attack at 100 spies did not change it (live). That is one tower and one defence, so how the defence scales with the tower's level is unknown.

## Attacking: `cra`

The bot's attack engine already builds `cra` ([presets.md](presets.md) explains how a preset becomes the waves). The two live requests had the same shape as other kingdoms:

```
{SX: 1296, SY: 111, TX: 1409, TY: 110, KID: 10, LID: 3, WT: 0, HBW: -1, BPC: 0, ATT: 0, AV: 1,
 LP: 0, FC: 0, PTT: 1, SD: 0, ICA: 0, CD: 99, A: [<wave>, ...], BKS: [], AST: [-1,-1,-1],
 RW: [[-1,0] x 8], ASCT: 0}
```

`SX`, `SY` are the Berimond camp and `KID` is 10 (live). `LID` 3 is the commander (live), and the reply's `UM.L.ID` is 3 too. A wave is `{L: {T, U}, R: {T, U}, M: {T, U}}`, each part a tools list `T` and a units list `U` (live). Reading `L`, `R` and `M` as the left flank, right flank and middle is inferred. The first attack sent one wave. The second sent four. Waves two to four each held one unit of 507 with tool 17, and `sas` had saved those into preset 7 about 9 s earlier (live), so the extra waves came from a preset.

The reply is `{AAM: {M, UM, FA, AST, ATT, ASCT, FC}, O}` (live). `M` is the movement, `T` 18 with `TT` 88 s and `TID` -410. `M.TA` is the tower record as it was sent, and `AI[6]` there was 21 and then 42. `FA` repeats the army as sent (inferred from its contents). `UM.L` is the commander. `O` is the player's info block, left out.

The camp's inventory (`gui.I`) shows what an attack costs. Unit 546 went from 546 in the first `aci` to 623 in the second. That is 81 moved in by `kut` minus 4, and `HI` listed `[546, 4]` (live). The 4 are inferred to be losses of the first attack. Tools 614 fell by 7 and 651 by 32, the totals of the waves' `T` lists (live). So tools and losses come out of the camp, not out of any home castle.

The landing is a push 88 s later (live, 88.6 s and 87.4 s). It brings `gie`, `gmu`, `uar`, `gpc`, `cat`, `gaa`, `ufp` and `pep`. No battle report or win flag arrived. Whether the hit won can only be read from the faction points.

## Faction points and sides

| Source | Fields | Live values |
|---|---|---|
| `gfp {}` (`C2SGetFactionPointsVO`, client) | `BFP`, `RFP` | 1250 and 1450. Twelve calls, 109 s to 134 s, all the same, across the first landing |
| push `ufp` (`S2C_USER_FACTION_POINTS`) | `CFP`, `HFP`, `NHT` | `CFP` 6,412,633 then 6,417,598. `HFP` 9,497,875 both times. `NHT` -1 |
| push `pep` for `EID` 3 | `OP: [n]`, `OR: [17]` | 2,446,751 then 2,451,716 |
| push `fgb` (`S2C_GET_FACTION_BALANCE`) | `RP`, `BP` | 106 and 92, sent when the camp was joined |
| `sei` entry `EID` 3 | `RS`, `OP`, `FN`, `LID`, `RSID`, `AC`, `KL`, `KLAP`, `ACI`, ... | `FN: {MC: 55, FID: 1, TID: -1, NS: -1, PMS: -1, PMT: 0, SPC: 0}` |

The second attack raised `CFP` by 4,965 and event 3's `OP` by the same 4,965, 87.4 s after the send (live). Event 3 is therefore the Berimond kingdom's point event (inferred from the equal deltas). The first attack's gain is unknown, since the trace holds no reading from before it. `gfp` did not change over the first landing, so `BFP` and `RFP` are not the player's own points. They read as the two factions' totals but did not move, so what they count is unknown (low). `BP` and `RP` read as blue and red, an inference from the letters.

`FN` is the player's faction record. `FID` is 1 and `MC` is 55, the main camp id. `TID` is -1 in `sei` and 125 in the `jaa` reply, and 115 for another player in `hgh`, so `TID` looks like a team or town id and is not the side. The player's tower targets are owned by -410 (blue), and the player's `FID` is 1. The player presumably attacks the enemy faction's towers, so `FID` 1 is probably red (-411) by elimination. That is an inference from one account and is not confirmed.

## The Berimond camp: `jaa`, `dcl`, `laa`

The camp's coordinates are in the player's `AP` list as `[[10, 55, 1296, 111]]`, the kingdom, the camp id and the position (live).

| Command | Request | Reply (live) |
|---|---|---|
| `jaa` (`C2SJoinAreaVO`) | `{PX: 1296, PY: 111, KID: 10}` | `{KID, T: 15, gca, grc, gpa, gui, ...}`. `gca.A` is `[15, 1296, 111, 55, <player>, ...]`, the camp as an area of type 15. `gca.BG` lists the buildings. The player's `FN` block is inside |
| `dcl` (`C2SGetDetailedCastleListVO`) | `{CD: 1}` | `{PID, C}` |
| `laa` (`C2SLeaveAreaVO`) | `{}` | An empty payload, `res` 0 |

`packages/bot-core/protocols.js` sends `joa` (`C2SJoinOpenAllianceVO`) in `clientJoinArea` and waits for the `jaa` reply. The trace shows the client sending `jaa` with the same three fields, so a towers plugin should send `jaa`. The `jaa` reply also arrived with a `fgb` push and three list pushes (`gkl`, `gml`, `gll`) the first time and the second.

Other commands the player sent in the camp, with replies not studied here. `eup {OID, PWR, PO}` upgrades a building and `msb {OID, MST}` skips its build time with `MS5`, `MS4` or `MS2`. `fco {OID, FS}` was sent once on a building. `fuc {CID: 55}` returned `{FUC: 185}`, which reads as the camp's unit capacity (client name `S2C_GET_CAMP_UNIT_CAPACITY`). `hgh` and `klh` read rankings and are not needed to attack.

## Moving troops in: `kut` and `msk`

The camp has its own garrison. The player moved troops from the Green kingdom (kingdom 0, castle id masked as 1000001):

```
kut {SCID: <castle>, SKID: 0, TKID: 10, CID: -1, A: [[546, 81], [507, 104]]}
```

`SCID` is the source castle and `SKID` its kingdom, `TKID` the target kingdom. `CID` -1 and `A`, a list of `[unitId, count]`, are as sent (live). The reply is a `kpi` record with `UT: [{KID: 10, RS: 7200, I: [[546,81],[507,104]]}]` and `fki` (live). `UT` is the transfer in flight and `RS` the seconds left, here two hours.

`msk {MST: "MS5", KID: "10", TT: "1"}` skipped it. Both `KID` and `TT` are strings (live). The first reply had `RS` 3598, which is 3600 s skipped plus the 2 s that had passed. The second reply no longer had `UT`, so the troops had arrived (live). So `MS5` skips one hour, and two skips cleared the 7200 s. The same reply shape (`kpi`) arrives as a push after each skip.

`packages/bot-core/protocols.js` already sends `msk` with this shape (`clientSkipResourceTransfer`, `KID` as a string) and reads `kut`, `msk`, `kgt` and `fjf` replies through `skipUnitTransferList`. It has no sender for `kut`. Its unit-transfer helper sends `kgt`, which is a goods transfer (`C2SKingdomGoodsTransferVO`, client). A towers plugin that tops up the camp has to add a `kut` call. `kpi`'s `UL` entry for kingdom 10 read `{KID: 10, U: 1, C: 0}` (live).

## What a towers plugin needs

1. **Find a tower.** Send `fnt {}`. Read `X`, `Y` and the `gaa.AI[0]` record. Skip the tower if `AI[3]` is the player's own side. Which sign that is, see "Sides".
2. **Spy it.** Send `csm` from camp 55 with all spies and `KID` 10. Optionally `ssi` first for `AS`. Wait about 1 s for the spies to land.
3. **Read the defence.** Send `aci` with the camp's coordinates as `SX`, `SY`. Read `S` for the defenders and `gui.I` for the camp's units and tools. `AS` equals the seconds since the spy and so doubles as a freshness check.
4. **Attack from the camp.** Send `cra` with `SX`, `SY` of the camp, `KID` 10 and a preset's waves. Expect `TT` 88 s and a landing push of `ufp`, `pep` and `gaa`.
5. **Measure the result.** On the landing, read `ufp.CFP` and the `pep` push for `EID` 3. The rise in `OP` (4,965 for one hit) is the faction points of the hit. A hit that adds nothing would show as no change. That case was not captured.
6. **Keep the camp stocked.** `aci`'s `gui.I` is the camp's own inventory. When units run low, send `kut` from the Green castle and `msk` to skip the 2 h. Tools are consumed per attack (`cra`'s `T` lists), so a tool shortage needs a transfer too.

Cases the trace did not show:

- What `fnt` returns when no tower is left. `err.json` has `205 NO_MORE_TOWERS` and `1009 TOWER_DEPLETED`, which are the likely replies (inferred from the names alone).
- Where the tower's level comes from. `AI[7]` (55) and `ssu`'s `DL` (55) are candidates, but the camp id is also 55.
- The side mapping from `FID` to -410 and -411, and what a player of the other side is shown by `fnt`.
- How the defence `S` scales with the tower, and how many towers one account can hit or how often (a cooldown). The same tower was attacked again 117 s after the first landing.
- The failure replies of `cra`, `aci` and `csm` against a tower, such as a tower under attack by someone else.
- What a lost attack looks like in `ufp` and `pep`.
- The units a general may carry here, and the `gas` presets' own limits in a faction kingdom.

## Evidence and confidence

| Fact | Confidence | Confirm with |
|---|---|---|
| `fnt` takes `{}` and returns `X`, `Y`, `gaa` | high | |
| The tower record's indices 0 to 3 | high | |
| `AI[6]` is seconds since the spies landed, and expires between 42 and 109 s | medium | Log `AI[6]` at 30 s steps after a spy |
| `AI[7]`, `AI[9]` and `ssu`'s `DL`, `SPC` pair up | medium | Compare two towers' `ssu` replies |
| `AI[8]` falls slowly with time | low | Log it at a minute step with no attack |
| `AI[5]` lists towers that must fall first | low | Spy and attack the tower at 1420,123 |
| `ssi` and `csm` fields and replies | high | |
| `aci` keys, `S` and `B` | high for presence, low for what each `S` list is | One `aci` on a tower with a known defence |
| `HAWL` is an attack wave limit | low | `cra` with more waves than 4 |
| `cra` request and reply fields | high | |
| An attack takes 88 s from the camp to this tower | high for this tower | A tower at another distance |
| Tools and losses come out of the camp's inventory | high | |
| Event 3 is the Berimond kingdom's point event, and `ufp.CFP` and `pep.OP` rise together | medium, from one hit | Log the rise of a first hit |
| `gfp` is the two factions' totals | low | Log `gfp` before and after a hit that wins |
| `FID` 1 is the red side | low | A second account, on the other side |
| `kut` request and reply, `msk` skips 3600 s per `MS5` | high | |
| `packages/bot-core/protocols.js` has no `kut` sender and sends `joa` where the client sent `jaa` | high (read from the code) | |
| `fnt` replies `NO_MORE_TOWERS` when none is left | low | Attack until no tower is free |
| The tower's level source | low | `ssu` on towers of different `AI[7]` |
