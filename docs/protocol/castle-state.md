# Castle state

Many commands name no castle. The game applies them to the castle the player is in. This page covers how `protocols.js` keeps track of that castle, and what it reads from castle updates.

## The castle the player is in

`setCastle(castle, callback)` runs `callback` in `castle` and sends `jca {CID, KID}` first when needed. It joins when any of these is true:

- The bot is not in that castle.
- The last join is over 2 minutes old (`JOIN_FRESH_MS`).

`setCastle(undefined, callback)` means any castle will do. It keeps the castle the player is in.

These events change the castle the bot thinks it is in:

| Event | Effect |
|---|---|
| `jaa`, asked for or not | The bot is in that castle, or in none when the area is not one of the account's castles (`grc.KID`, `grc.AID`). The join time is now. |
| `notInOwnedCastle` from `ggeBot.js` | The game refused a command with `NOT_IN_OWNED_CASTLE` (53). The bot is in no castle. |
| `forgetCurrentCastle()` | A plugin moved the player somewhere the game sends no `jaa` for, such as the Blade Coast map. The bot is in no castle. |

## Production lists in a join

The `jaa` reply carries `spl0` to `spl3` at its top level. The client passes each one to `CastleModel.militaryData.parse_SPL`. `castleQueue(kingdomID, castleID, lid)` returns the list with that `LID` from the castle's last join, as `{ spl, at }`.

## Castle updates

| Update | What `protocols.js` keeps |
|---|---|
| `B`, `WS`, `DW`, `H` in a castle list or join | `hasBarracks`, `hasSiegeWorkshop`, `hasDefenseWorkshop`, `hasHospital`. An update without the field keeps the old value. |
| `hru {gui, gcu}` | `gui` sets the castle's `unitInventory`, `strongHoldInventory`, `hospitalInventory` and `travelingUnits`. An `hru` without `gui` changes no units. |

## Facts and confidence

| Fact | Confidence | Source |
|---|---|---|
| `jaa` carries `spl0` to `spl3`, read as production lists | high | Client: the `jaa` handler calls `parse_SPL(i.spl0)` to `parse_SPL(i.spl3)` |
| LID 0 is the barracks, 1 the siege workshop, 2 the hospital | medium | Lazy Lord's source. Confirm with one live `jaa`. |
| The game forgets the castle after a few minutes, without a message | medium | Lazy Lord found it live. Confirm by sending a castle-less command 3 minutes after a join. |
| Updates without `B`, `WS`, `DW` or `H` mean "unchanged" | medium | Lazy Lord's source: a castle join leaves them out. |
