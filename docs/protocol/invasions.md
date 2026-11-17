# Foreign Lords and Bloodcrow invasions

Foreign Lords and Bloodcrows are alliance invasion events. Each places invader camps on the Great Empire map, and attacking a camp earns event points and glory. The two events use the same commands with different ids.

## Events and camps

| | Foreign Lords | Bloodcrow |
|---|---|---|
| Event id (`EID`) | 71, `EVENTTYPE_ALIEN_INVASION_ALLIANCE` (D@2596222) | 103, `EVENTTYPE_RED_ALIEN_INVASION_ALLIANCE` (D@2598806) |
| Camp area type | 21, `AREA_TYPE_ALIEN_CAMP` (D@2785241) | 34, `AREA_TYPE_RED_ALIEN_CAMP` |
| Camp owner id | -1000, `BASIC_ALIEN_ID` (D@2577953) | -1002, `BASIC_RED_ALIEN_ID` (D@2578043) |
| Difficulty ids (`EDID`) | 1 to 11 | 101 to 111 |

`protocols.js` already names both area types: `AreaType.alienCastle` is 21 and `AreaType.bloodcrowCastle` is 34.

## Find a camp

The event dialog finds the next camp with `fnm` (Foreign Lords at G@13126457, Bloodcrow at G@13521596).

| Field | Value |
|---|---|
| `T` | 21 or 34 |
| `KID` | 0 |
| `LMIN` | -1 |
| `LMAX` | -1 |
| `NID` | -701, `BASIC_INVASION_CAMP_PLAYER_ID` (D@2577953) |

The reply carries the camp in `gaa`, the shape that `ClientCommands.getNextMapObject` in `protocols.js` already parses. That helper sends `NID: -801`, the id for alliance nomad camps (`BASIC_ALLIANCE_NOMAD_CAMP_PLAYER_ID`, D@2578043), so it cannot find these camps as written.

## Camp area info

The camp's `AI` array (`AAlienInvasionMapobjectVO.parseAreaInfo`, G@4875459) has these entries. The `extraData` column is the index in `GAAAreaInfo.extraData`, which drops the first three entries.

| `AI` index | `extraData` index | Field |
|---|---|---|
| 0 | | Area type, 21 or 34 |
| 1, 2 | | X, Y |
| 3 | 0 | Camp level (`dungeonLevel`) |
| 4 | 1 | Seconds since the last espionage |
| 5 | 2 | Peace mode, 1 when on |
| 6, 7, 8 | 3, 4, 5 | Base wall, gate and moat bonus |
| 9 | 6 | Already dethroned, 1 when true |
| 10 | 7 | `eventAutoScalingCampID`, when above 0 |

An `AI` array of 4 entries or fewer means the camp is not visible to you.

## Attack a camp

The client attacks a camp as a dungeon attack (`attackDungeon`, G@1834691). It sends `adi {SX, SY, TX, TY, KID}`, then `cra`. The `cra` has no fields specific to these events. `sendAttack` in `plugins/attack/attack.js` already sends the same pair when `humanize.attack_dialog` is on.

## Pick a difficulty

`sede` (`C2SSelectEventDifficultyVO`, G@6428604) picks the difficulty for an event.

| Field | Value |
|---|---|
| `EID` | 71 or 103 |
| `EDID` | The difficulty id |
| `C2U` | 1 to rent a locked tier with rubies, else 0 |

The tiers come from the `eventAutoScalingDifficulties` items section. The full table is `cost-tables.json` in the fixtures.

| Tier | Foreign Lords `EDID` | Bloodcrow `EDID` | Rent |
|---|---|---|---|
| 1 to 4 | 1 to 4 | 101 to 104 | Free |
| 5 | 5 | 105 | 10,000 rubies |
| 6 to 11 | 6 to 11 | 106 to 111 | 7,500 rubies more per tier, up to 55,000 |

## Event state

`AAlienInvasionEventVO` (G@6841692) reads these fields from the event's entry in `sei`:

| Field | Meaning |
|---|---|
| `CRE` | 1 when dethroning is enabled |
| `RCKS` | Event currency keys a dethrone can spend in place of coins |
| `RCSC`, `RCHC` | Your soft (coin) and hard (ruby) dethrone counts. See [dethrone.md](dethrone.md). |
| `TZID`, `SZID` | Target and source zone ids |

## Event points

`pep {EID}` returns `{EID, OR, OP, PT}` (`PEPCommand`, G@14360894). `OR` is `[playerRank, allianceRank]` and `OP` is `[playerPoints, alliancePoints]`. `OP[0]` is your event glory. `attackKhan.js` and `attackNomads.js` already read `OP[0]` for their score shutoff.

## Glory

The client counts every invader camp as a glory source: `canEarnFame` returns true for any `AAlienInvasionMapobjectVO` (G@3354348). Its estimate, `getEstimatedFameBonus`, uses the camp level in place of an opponent's level. The estimate is 0 when your level minus the camp level exceeds `getMaxLevelDif2` for your level. The server computes the real award, which shows as the change in `pep` `OP[0]`.

## Evidence and confidence

| Fact | Confidence | Confirm with |
|---|---|---|
| Event ids, area types and owner ids | high | |
| `fnm` with `NID: -701` returns a camp | high | |
| Camp `AI` layout | high | |
| `adi` then `cra`, with no event-specific `cra` fields | high | |
| `sede` fields and the tier table | high | |
| `sei` carries `CRE`, `RCKS`, `RCSC` and `RCHC` for events 71 and 103 | medium | Log the login `sei` frame. |
| `pep` `OP[0]` is the player's event glory | high | |
| The glory a camp awards | medium | One attack, reading `pep` before and after. |
