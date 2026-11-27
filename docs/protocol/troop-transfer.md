# Troop transfer between kingdoms

The Troop transfer plugin (`packages/bot-core/plugins/troopTransfer.js`) keeps troops and tools stocked in a kingdom by sending them from another kingdom's castle. This page lists the commands it sends and how sure each fact is.

The request shapes were captured live for Berimond (see [berimond-kingdom.md](berimond-kingdom.md#moving-troops-in-kut-and-msk)). Transfers between the Great Empire and the other kingdoms come from Lazy Lord's source (`be/plugins/troopTransfer.js`) and are not yet captured.

## Send troops: `kut`

```json
{"SCID": 1000001, "SKID": 0, "TKID": 1, "CID": -1, "A": [[1, 900], [614, 300]]}
```

| Field | Meaning |
|---|---|
| `SCID` | The sending castle's id |
| `SKID` | The sending castle's kingdom |
| `TKID` | The kingdom that takes the troops |
| `CID` | Always -1 |
| `A` | `[wodID, amount]` for each troop or tool. One transfer can carry several |

`protocols.js` sends it through `ClientCommands.kingdomTroopTransfer`, in the `troopTransferTurn` line, because the reply names no request.

The reply carries `kpi`. Its `UT` lists one entry for each transfer on its way: `{KID, RS, I}`, with the kingdom it goes to, the seconds left and the units. `protocols.js` puts each entry on that kingdom's castle as `troopTransfer`.

## Skip a transfer: `msk`

```json
{"MST": "MS4", "KID": "1", "TT": "1"}
```

`KID` is the kingdom the transfer goes to. `TT` `"1"` is a troop transfer (`KingdomSkipType.sendTroops`), `"2"` a goods transfer. Both are strings. `protocols.js` sends it through `ClientCommands.skipResourceTransfer`, in the `kingdomSkipTurn` line.

## What the plugin relies on

- **The timer does not count down.** `RS` is the seconds left when the game sent it. Nothing updates it until the next `kpi`. The plugin stamps each timer when a `kpi`, `fjf`, `kgt`, `msk` or `kut` reply brings it, and works out the time left from that stamp.
- **One transfer into a kingdom at a time.** A kingdom with a transfer on its way gets no new one until it lands, or until the plugin skips it when time skips are on. A kingdom can send to several kingdoms at once. So each kingdom has one sender: the first rule for a kingdom names it.
- **Only kingdom castles.** The main castle (area type 1) in the Great Empire and the kingdom castle (area type 12) elsewhere send and take transfers. Berimond (kingdom 10) is left to its own event.
- **Army starts are spaced.** A transfer starts an army on the server like an attack. Two army starts close together can get the connection closed. The plugin waits 5 to 10 seconds after the last `cra`, `cat`, `cds` or `kut` reply that succeeded.

## Facts and confidence

| Fact | Confidence | Source |
|---|---|---|
| `kut {SCID, SKID, TKID, CID: -1, A}` into Berimond | high | Live capture ([berimond-kingdom.md](berimond-kingdom.md#moving-troops-in-kut-and-msk)) |
| The same shape between the Great Empire and another kingdom | medium | Lazy Lord's source. Confirm with one small transfer on the test account. |
| `msk {MST, KID, TT: "1"}` skips a troop transfer | high | Live capture, Berimond |
| `kpi.UT[].RS` never counts down between pushes | medium | Lazy Lord's source |
| One transfer into a kingdom at a time | medium | Lazy Lord's source. A second `kut` into a busy kingdom was never captured, so its refusal code is unknown. |
| Two army starts close together can close the connection | medium | Lazy Lord's source. Not captured. |
