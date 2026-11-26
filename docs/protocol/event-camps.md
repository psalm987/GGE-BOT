# Event camps, Daimyo castles and Luna's trade boat

This page is reference for three settings pages of the player app: Nomads, Samurai and Daimyo; Green Berimond; and Storms. It says how the game marks a Berimond invasion camp's side, how a Daimyo castle is attacked and what about it is still unknown, and which packages the Storm Islands shop sells for aquamarine.

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

## Daimyo castles are attacked like camps

Daimyo castles are area type 37 (`AREA_TYPE_DAIMYO_CASTLE`) and Daimyo townships are type 38. Their owners are -811 and -815. `items` holds `daimyoCastles` and `daimyoTownships`, 30 rows each, with `id`, `rank`, `level` (81 to 120) and `coolDown`. The castles belong to the Samurai event: `eventAutoScalingCamps` has 30 rows of `eventID` 80 and `areaType` 37 for each difficulty, each with a `rank` and a `camplevel`.

| Rank | `daimyoCastles` ids | Level | Wait after an attack |
|---|---|---|---|
| 1 | 1 to 10 | 81 to 90 | 30 min, rising 30 min each attack to 2 h |
| 2 | 11 to 20 | 91 to 100 | 1 h, rising to 5 h |
| 3 | 21 to 25 | 106 to 110 | 2 h, rising to 10 h |
| 4 | 26 to 30 | 116 to 120 | 5 h, rising to 25 h |

### What the recorded client sent

The recorder trace `20261120-211045-08bd1f` (2026-11-20, client build 1173012, recorder 0.1.0, marked "daimyo event") holds a player attacking Daimyo castles on the Great Empire map. Its screenshots show the castle window titled "Daimyo castle - Rank 1". Recorder 0.1.0 kept no server replies, so the trace shows only what the client sent.

- The client found the castles by scanning the map with `gaa` (68 requests). It never sent `gda`, `gdc`, `gdw`, `ldt` or `cdd`.
- Each attack is `adi` and then `cra`, as for a camp: `adi {"SX":693,"SY":526,"TX":695,"TY":528,"KID":0}`, then `cra` to the same target with `KID` 0, `LID`, `A` (four or five waves), `RW` (the courtyard) and the other fields the bot already sends.
- The client attacked four castles near its castle at 693:526: 695:528 twice, 687:528, 695:516 and 698:535.
- A wait was skipped with `msd {"X":695,"Y":528,"MID":-1,"NID":-1,"MST":"MS4","KID":"0"}`, and once with `MST` `"MS5"`. That is the frame the bot's `skipTarget` already sends for camps.
- The attacks carried ordinary tools only: units 272 and 245 (workshop tools) and 648 and 651 (elite tools). Every Samurai event tool has `allowedToAttack` `0+29`, which is the Samurai camp alone, so no event tool may attack a Daimyo castle.

### How the bot reads a castle

The client build `Game.bundle.7fe30f1649d36a928f2b.js` and `items_v790.06.json`, read as text on 2026-11-25, give this layout. `DaimyoCastleMapObjectVO.parseAreaInfo` reads the `AI` array as follows. An entry of only type, X and Y is a castle the player cannot see.

| `AI` index | `extraData` index | Field |
|---|---|---|
| 3 | 0 | Seconds since the last espionage |
| 4 | 1 | The castle's id in `daimyoCastles` |
| 5 | 2 | Seconds until the castle can be attacked again |
| 6 | 3 | The castle's full wait |
| 7 | 4 | Skip cost |
| 8 | 5 | `eventAutoScalingCampID` |
| 9, 10, 11 | 6, 7, 8 | Wall, gate and moat bonus |

`DaimyoCastleXmlData.getDaimyoCastleByID` takes the castle's `eventAutoScalingCamps` row when `AI[8]` is above 0, and its `daimyoCastles` row by `AI[4]` otherwise. The Attack Daimyo plugin (`attackDaimyo.js`, the `daimyo` profile in `eventCamps.js`) does the same. It reads the rank and level from that row and skips the castles the player cannot see. It attacks nothing if an entry has some other shape or names a castle no row holds. It then reports the problem and logs each entry.

### Still unknown

- The `gaa` reply for a Daimyo castle has not been seen on the wire. The table above comes from the client's code, and the plugin's tests use a reply built from it.
- The `cra` reply to a Daimyo attack, and whether it says anything a camp's reply does not.
- Whether other players' Daimyo castles show on the map, and in what form.
- What a township needs. The client has `cdd` (`C2SCreateDaimyoDefenseMovementVO`) to send defenders to one.
- The taunt. `ldt` (`C2SLaunchDaimyoTauntAttackVO`) calls a Daimyo attack on the player's own castle.
- The fields of `gda` (`C2SGetDaimyoAreasEventVO`), which lists the player's castles and townships. `DAIMYO_CASTLES_PER_PLAYER` and `DAIMYO_TOWNSHIPS_PER_PLAYER` are both 4. `gdc` and `gdw` list the alliance's Daimyo contracts and war efforts.

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
