# Movements

This page covers how a march ends: when the game removes one early, when the bot counts one as over, and what `protocols.js` tells plugins. It also covers commands that were misread as movement commands.

## The game removes a movement: `mrm`

`mrm {MID}` (`S2C_REMOVE_MOVEMENT`) is a push. The client handles it in `MRMCommand.executeCommand`, which calls `CastleArmyData.parse_MRM(MID)`. That method calls `removeArmyMovementById(MID)` and dispatches `MOVEMENTS_REMOVED`. `MID` is one movement id, a number, not a list.

`protocols.js` ends the named movement when `mrm` arrives. It takes the movement off `movements` and emits two events on `movementEvents`:

| Event | When |
|---|---|
| `ended` | Any movement is over: it ran its course or the game removed it. |
| `return` | The movement was a march home (its target owner is its owner). The commander is free and the troops are home. |

A movement ends only once. When `mrm` comes first, the movement's own timer finds nothing to end.

`plugins/incoming.js` clears an incoming attack on `ended`. An attack removed before its landing time is reported as cancelled.

## When the bot counts a march as over

A movement's own timer ends it 10 s after the time the game gives (`MOVEMENT_DONE_AFTER_MS`). The game removes a movement a few seconds late and refuses its commander with `LORD_IS_USED` until then. The bot used to free the commander 1 s after the march time.

An army that stays at its target, such as troops stationed at an ally, is over only when its stay is over. `Movement.endsAt` is its arrival plus `UM.TWD - UM.PWD` seconds ([stationing.md](stationing.md#list-stationed-troops)). `PT` keeps counting during the stay, so for an army already standing there the rest of the stay counts from now. Before this, a stationed army counted as over at its arrival.

When a march home ends, `protocols.js` adds its troops and goods to the castle. It skips that when the castle list (`dcl`) was read after the march landed, because that list already counts them.

## `dms` is not a movement command

`dms` is `C2S_DELETE_MESSAGE` and `S2C_DELETE_MESSAGE`, the reply to deleting a report or a message. The bot sends it itself (`reportCleanup.js`, `plugins/misc.js`), and its `MID` is a message id. `protocols.js` used to read `dms` as "movements removed". It called `MID.forEach`, which threw on the numeric message id. A message id equal to a march id freed that march's commander early. The handler is gone.

## Facts and confidence

| Fact | Confidence | Source |
|---|---|---|
| `mrm` is `S2C_REMOVE_MOVEMENT`, and its `MID` is one movement id | high | Client: `ClientConstSF`, `MRMCommand`, `CastleArmyData.parse_MRM` |
| `dms` is `DELETE_MESSAGE` | high | Client: `ClientConstSF.C2S_DELETE_MESSAGE` |
| The game removes a movement about 6 s after its time, so 10 s is a safe grace | medium | Lazy Lord's source, from one capture (`MOVEMENT_DONE_AFTER_MS`). Confirm by logging `mrm` arrival against the march time. |
