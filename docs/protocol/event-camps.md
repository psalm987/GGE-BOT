# Event camps, Daimyo castles and Luna's trade boat

This page is reference for three settings pages of the player app: Nomads, Samurai and Daimyo; Green Berimond; and Storms. It says how the game marks a Berimond invasion camp's side, what a Daimyo attack needs that the bot doesn't send, and which packages the Storm Islands shop sells for aquamarine.

The study read the public HTML5 client as text on 2026-11-19: `Game.bundle.efded7cc2ea1e1d30527.js`, `dll/ggs.dll.b68ed9c3af90ea1e396d.js` and `items/items_v790.02.json`. It executed no client code, opened no socket and used no account. `G@n` is a byte offset into that bundle.

## Berimond invasion camps have a side

A Berimond invasion camp is area type 30, `AREA_TYPE_FACTION_INVASION_CAMP`. `FactionInvasionCampMapObjectVO.parseAreaInfo` (G@9056319) reads its `AI` array as follows. The `extraData` column is the index in the bot's `GAAAreaInfo.extraData`, which drops the first three entries.

| `AI` index | `extraData` index | Field |
|---|---|---|
| 3 | 0 | Seconds since the last espionage |
| 4 | 1 | Victory count, which is also the camp's level in `factioninvasioncamps` |
| 5 | 2 | Seconds until the camp can be attacked again |
| 7 | 4 | `dungeonType`: the id of the camp's owner |

The owner id is the side. `DungeonConst.BLUE_FACTION_KING` is -410 and `DungeonConst.RED_FACTION_KING` is -411. The client names a camp "blue camp" when its owner is -410 and "red camp" otherwise. The event dialog's two "show me" buttons send `fnm` with `T` 30 and `NID` -411 for a red camp and -410 for a blue one.

The bot's Camp side option compares `extraData[4]` with these two ids. This is read from the client and not yet confirmed on a live account.

## Daimyo castles need commands the bot doesn't send

Daimyo castles are area type 37 (`AREA_TYPE_DAIMYO_CASTLE`) and Daimyo townships are type 38. Their owners are -811 and -815. `items` holds `daimyoCastles` and `daimyoTownships`, 30 rows each, with `id`, `rank`, `level` (81 to 120) and `coolDown`.

`DaimyoCastleMapObjectVO.parseAreaInfo` (G@2423588) reads `AI[4]` as the castle's id in `daimyoCastles`, `AI[5]` as the seconds until the next attack, `AI[7]` as the skip cost and `AI[8]` as the `eventAutoScalingCampID`.

The client reaches them through commands of their own. The bot sends none of these today, so a Daimyo plugin waits for a capture of each one.

| Command | Client class | Purpose |
|---|---|---|
| `gda` | `C2SGetDaimyoAreasEventVO` | Lists the player's Daimyo castles and townships. `DAIMYO_CASTLES_PER_PLAYER` and `DAIMYO_TOWNSHIPS_PER_PLAYER` are both 4 |
| `gdc` | `C2SGetDaimyoAllianceContractsEventVO` | The alliance's Daimyo contracts |
| `gdw` | `C2SGetDaimyoWarEffortsEventVO` | The alliance's war efforts |
| `ldt` | `C2SLaunchDaimyoTauntAttackVO` | Calls a Daimyo attack on the player's own castle |
| `cdd` | `C2SCreateDaimyoDefenseMovementVO` | Sends defenders to a township |

Unknown until captured: the request and reply fields of `gda`, whether a Daimyo castle is attacked with `cra` like a camp, and what a township needs.

## Luna's trade boat sells these for aquamarine

The bot buys from the Storm Islands shop with `sbp` and `BT` 3, one package for each request. These rows of `packages` have a `packagePriceAquamarine`.

| Package | `packageID` | Aquamarine | Gives | Stock |
|---|---|---|---|---|
| Coins | 2798 | 75,000 | 2,000,000 coins | No limit |
| Experience | 3114 | 10,000 | 5,000 XP, legend levels 1 to 949 | No limit |
| 5-hour skips | 3122 | 40,000 | 50 skips | 10 |
| 24-hour skips | 3123 | 40,000 | 10 skips | 30 |
| Mock peasants | 248 | 1,570 | 5 tools (unit 735) | No limit |
| Crab Rock | 3116 | 75,000 | A decoration, 3,500 public order | No limit |
| Tide Garden | 3118 | 75,000 | A decoration, 3,500 public order | No limit |
| Whale Lagoon | 3117 | 100,000 | A decoration, 3,750 public order | No limit |

`stock` is how many the shop sells. The data doesn't say over what period, so the bot stops buying a package for the session once the game refuses it.
