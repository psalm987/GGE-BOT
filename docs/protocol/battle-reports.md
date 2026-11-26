# Battle reports

When an attack on an event camp lands, the server tells the client with a `sne` push. The client can then ask for the full report with `bls`. The report carries the glory and the loot of the hit. Foreign Lords and Bloodcrow camps share the flow.

## The push

`sne` carries `MSG`, a list of messages `[id, type, header, ...]`. Type 6 is a battle report (`MESSAGE_TYPE_BATTLE_LOG`). The live trace had:

```
sne {"MSG":[[325886158,6,"34+0+0#0+-1002","",-1,0,0,0,0]]}
```

The header reads `areaType+subtypeAttack+subtypeResult[+...]#kingdomID+ownerID[+areaName]`.

| Part | Value in the trace | Meaning |
|---|---|---|
| `areaType` | 34 | The target's area type. 34 is the Bloodcrow castle. Foreign Lords camps are 21. |
| `subtypeAttack`, `subtypeResult` | 0, 0 | Not read for event camps. The Khan defence reports use 2 and 1 or 3, see [nomad-khan.md](nomad-khan.md). |
| `kingdomID` | 0 | The Great Empire |
| `ownerID` | -1002 | The Bloodcrow owner. A spy report has type 4 and a header like `1+0+34#0+-1002+`. |

`packages/bot-core/battleReports.js` splits the header in `battleReportHeader`.

## Reading the log

`bls` (`C2SBattleLogShortVO`) takes `{"MID": <message id>, "IM": 0}`. The client sent it right after the push, without marking the message read. The reply has code 0 and a payload that starts:

```
{"DW":0,"H":0,"SR":10,"PBI":[[<player>,0,33704,-744,[["W",218500],["S",218500],["F",198500],["C1",11736],["HONEY",188500],["MEAD",188500]],8681411,1053,0,-1,32,38,0,0],[-1002,1,21055,-21055,[["W",-218500],["S",-218500],["F",-198500],["C1",-11736],["HONEY",-188500],["MEAD",-188500]],7798,0,0,-1,0,0,-100,0]],"AI":{"N":"","DP":-1002,"AT":34,"K":0,"X":630,"Y":489,"DL":70,...},...}
```

`PBI` has one row per side: `[ownerID, side, ?, ?, loot pairs, glory, ...]`. Side 0 is the attacker and side 1 the defender. The defender's loot is the attacker's, negated. The fields after the glory are not understood and the bot does not read them. `AI` describes the target camp (`AT` area type, `X`, `Y`, `DL` its level).

`parseBattleLog` takes the glory from `PBI[row][5]` and the loot from `PBI[row][4]`, for the row whose owner is the player. `readBattleLog` does the request.

## What the bot does with it

While a glory run is active, each report on the plugin's area type in the Great Empire is read. The log shows the glory of the hit and the run's total. A failed read is skipped and the run goes on.

## Evidence and confidence

| Fact | Confidence | Confirm with |
|---|---|---|
| The `sne` push with type 6 and this header, right after the attack landed | high | One trace, one hit. |
| `bls {MID, IM: 0}` gets the report, reply code 0 | high | |
| `PBI[row][5]` is the glory of the hit | high | The player's own glory (`CF`) rose from 1,203,441,119 to 1,212,122,530 across the report, exactly 8,681,411. |
| `PBI[row][4]` is the loot, the defender's row is its negation | medium | One report. Compare with the castle's resource push. |
| Side 0 is the attacker, side 1 the defender | medium | One report. |
| Foreign Lords camps give area type 21 in the header | low | Read from the event data, not seen in a header. Log one Foreign Lords report. |
| Other `PBI` fields | unknown | Not named. |
