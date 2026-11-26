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

## `dms` is not a movement command

`dms` is `C2S_DELETE_MESSAGE` and `S2C_DELETE_MESSAGE`, the reply to deleting a report or a message. The bot sends it itself (`reportCleanup.js`, `plugins/misc.js`), and its `MID` is a message id. `protocols.js` used to read `dms` as "movements removed". It called `MID.forEach`, which threw on the numeric message id. A message id equal to a march id freed that march's commander early. The handler is gone.

## Facts and confidence

| Fact | Confidence | Source |
|---|---|---|
| `mrm` is `S2C_REMOVE_MOVEMENT`, and its `MID` is one movement id | high | Client: `ClientConstSF`, `MRMCommand`, `CastleArmyData.parse_MRM` |
| `dms` is `DELETE_MESSAGE` | high | Client: `ClientConstSF.C2S_DELETE_MESSAGE` |
