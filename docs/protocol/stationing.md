# Stationing, gates and protection

Stationing sends your troops to defend an alliance member's castle and keeps them there for a set number of hours. Auto Station needs it to move troops out of a castle before an attack lands. This page also covers recalling troops, opening the gates and the protection fields that decide where troops can safely go.

## Station troops

`cds` (`C2SCreateDefenceSupportMovementVO`, G@14793558). The client builds it in `CastleAttackData.sendSupport` and sends the fields in this order:

| Field | Value | Compared with `cra` |
|---|---|---|
| `SID` | The source castle's object id | `cra` sends `SX`, `SY` |
| `TX`, `TY` | The target castle | The same |
| `LID` | The commander | The same |
| `WT` | Hours to stay, 1 to 99 | `cra` sends 0 |
| `HBW` | The horse `wodID`, or -1 with a feather | The same |
| `BPC` | Premium commander | The same |
| `PTT` | 1 to use a feather (pegasus ticket) | The same |
| `SD` | Slow-down | The same |
| `A` | A flat list of `[wodID, amount]`, with no waves | `cra` sends waves |

### Cost

Stationing is free for up to 12 hours. The free time is 24 hours when the target is occupied and 72 hours for a capital or metropolis. Each hour past that costs 275 rubies (`getSupportDurationCostC2`, D@2682411, constants at D@2685769 to D@2685962).

### Reply

`{gcu, O, A}`, where `A` is the new movement (`CDSCommand`, G@14217710).

### Who you can support

A castle that is not yours and whose owner is in your alliance (`CastleMapobjectVO.canBeSupported`, G@2317177). An outpost has its own rule (G@2305223). It must belong to a player and be held by you or an alliance member.

The client can send `sdi {TX, TY, SX, SY}` (`C2SSupportDefenceInfoVO`, G@8369567) before `cds`. The reply has the source castle id (`SCID`), the target (`gaa`), your inventory (`gui`) and the unit limits for the yard and wall (`UYL`, `AUYL`, `UWL`).

### Supporting drops your own protection

Sending support from a castle while you have beginner or peace protection removes your protection. The client warns first: "If you start supporting another player, you will lose your attack protection." (`dialog_supportWithNoobProtection`, `ButtonSupportDefenceComponent.onClick`, G@5374329). In Berimond the same warning applies to beginner and faction protection.

## List stationed troops

A stationed army is a `gam` movement with `M.T == 1` (`MOVEMENTTYPE_DEFENCE`, G@146569), `M.OID` equal to your player id, and `M.PT >= M.TT`. `UM.TWD` is the total station time and `UM.PWD` the time passed, both in seconds (G@2362591). `protocols.js` turns every `gam` movement into a `Movement`, so a stationed army is a `Movement` with `type == 1`.

## Recall troops

`mcm {MID}` (`C2SCancelMovementVO`, G@3921158), where `MID` is the movement's `M.MID`. The reply `{A}` is the same movement turned into a return march (`MCMCommand`, G@14224130).

`sti` and `cat` move troops only between your own castles.

## Open the gates

`mos` (`C2SOpenGateStartVO`, G@5537195):

| Field | Value |
|---|---|
| `CID` | The castle id |
| `KID` | The kingdom |
| `CD` | 0 for 6 hours, 1 for 12 hours, -1 to cancel |

The reply is `{gcu, CID, KID, RPT}`, where `RPT` is the open-gate time left in seconds (`MOSCommand`, G@14164218). Error 2 (`INVALID_PARAMETER_VALUE`) means a protection mode is active.

### Cost

`getOpenGateCosts` (D@2643873) gives the ruby cost before discounts:

`10 * round(base[CD] * n^(1.1 + n/10) / 10)`, with `base = [450, 700]` and `n = min(9, OGC + 1)`.

| `OGC` | 6 hours | 12 hours |
|---|---|---|
| 0 | 450 | 700 |
| 1 | 1,110 | 1,720 |
| 2 | 2,090 | 3,260 |
| 4 | 5,910 | 9,190 |
| 8 or more | 36,450 | 56,700 |

`cost-tables.json` in the fixtures has every row. `getFinalCostsC2` applies discounts on top.

### Counters

Each castle in the castle list (`dcl`, `gcl`) carries `OGC`, the open-gate count, and `OGT`, the open-gate time left (G@1683898). The client adds 1 to `OGC` whenever a `mos` reply has `RPT > 0` (`parse_MOS`, G@1267535). When `OGC` returns to 0 is unknown.

## Protection fields

`WorldMapOwnerInfoVO.fillFromParamObject` (G@1354360) reads protection from every owner info. `OwnerInfo` in `protocols.js` already parses all three.

| Field | Meaning | `OwnerInfo` property |
|---|---|---|
| `RPT` | Peace time left | `remainingPeaceTime` |
| `RNP` | Beginner protection left | `remainingNoobTime` |
| `FN.PMS`, `FN.PMT` | Berimond faction protection status and end time | `factionID.protectionStatus`, `factionID.protectionTime` |

`uap {KID}` returns your own beginner time in that kingdom as `NS` (`C2SUserAttackProtectionVO`, G@7643639).

Peace is bought with `mps {CD}` (`C2SPeaceModeStartVO`, G@5537647). `CD` 0 to 3 buys 7, 14, 21 or 60 days for 5,000, 7,500, 10,000 or 20,000 rubies (`PEACE_MODE_C2`, D@2640011). `CD: -1` cancels.

## Alliance castles

`ain {AID}` returns the alliance as `A`, with its members in `A.M` (`AllianceInfoVO.parseMemberList`, G@3115173). Each member is an owner info with `OID`, `N`, `L`, `RPT`, `RNP` and `AP`. `AP` is the member's castle list, each entry `[KID, objectId, X, Y, areaType]`. `OwnerInfo` exposes it as `castlePositionList`.

At the alliance level, `A.AP` is the alliance's aqua points, not castle positions.

A castle attackers cannot hit is an `AP` entry in your kingdom whose member has `RPT > 0`. An attack on it fails with error 131, `TARGET_HAS_PEACE`.

## Evidence and confidence

| Fact | Confidence | Confirm with |
|---|---|---|
| `cds` fields, order and reply | high | |
| The server accepts `cds` without a prior `sdi` | medium | Station 1 cheap unit with `WT: 1` without `sdi`, then recall it. |
| Free hours and the ruby rate | high | |
| Who can be supported | high on the client | |
| Supporting drops your own protection | high on the client | |
| Stationed troops are `gam` movements with `M.T == 1` | high | The same station-and-recall check. |
| `mcm` recalls a stationed army | high on the client, medium on the server | The same station-and-recall check. |
| `mos` fields, reply and cost formula | high | Skip: at least 450 rubies. |
| When `OGC` resets | low | Log `OGC` from `dcl` on two different days. |
| Protection fields | high | |
| `ain` member entries include `AP` | medium | Log one `ain` reply. |
