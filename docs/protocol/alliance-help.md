# Alliance help: `ahr`, `ahl`, `ahh`, `ahd` and `aha`

Alliance members can speed up each other's recruiting, healing and building. `packages/bot-core/allianceHelp.js` keeps the alliance's open requests and asks for help. The Help requests plugin presses "Help all" for other members' requests. Recruit and tools and Heal troops ask for help when their `askAllianceHelp` option is on. The facts come from Lazy Lord's source (`be/allianceHelpRequests.js` and the help parts of `be/plugins/recruit.js` and `be/plugins/healTroops.js`, MIT) unless the table at the end says otherwise. Our fixtures hold no alliance help frame.

## The list of open requests

| Command | Direction | Body |
|---|---|---|
| `ahl` | Push | The whole list: `{"AHL": [request, …], "TSL": …}` |
| `ahh` | Push | One request added or changed |
| `ahd` | Push | One request gone: `{"LID": …}` |

A request:

| Field | Meaning |
|---|---|
| `LID` | The request's id in the list |
| `PID` | The player who asked |
| `PN` | That player's name |
| `TID` | The request type (`items/alliancehelprequests.json`): 2 healing, 6 recruiting |
| `P` | How many members have helped so far |
| `AC` | Whether this player has helped |
| `OP.AID` | The castle the request is for |
| `RT` | Seconds until the request runs out |

A type takes `maxHelpersCount` helpers (`items/alliancehelprequests.json`). The game keeps a request listed after it has all its helpers, until it runs out.

## Ask for help

```json
{"ID": 0, "T": 6}
```

| Field | Recruiting | Healing |
|---|---|---|
| `T` | 6 | 2 |
| `ID` | 0, the barracks list | The healing batch's id, field 5 of its `PIDL` slot ([heal.md](heal.md#the-hospital-list-pidl)) |

`ahr` names no castle, so the bot sends it from inside the castle (`setCastle`).

An accepted request gets no `ahr` reply. The game only pushes the new request as `ahh`, with this player's `PID`, the asked type as `TID` and `P` 0. Only a refusal comes back as `ahr`. The bot therefore waits up to 10 seconds for either itself. It does not use `waitForResult`, whose silences count towards restarting the bot.

| Answer | Meaning | What the bot does |
|---|---|---|
| `ahh` push | Asked | Counts the request as open for that castle |
| Silence for 10 s | Probably asked | The same |
| `ahr` 273 `NO_MULTIPLE_ALLIANCEHELP` | A request of that type is open already for the castle | The same, without a log line |
| `ahr` 2 `INVALID_PARAMETER_VALUE` | The batch is done | Nothing. The next batch can be asked for |
| `ahr` 53 `NOT_IN_OWNED_CASTLE` | The game forgot the castle | Joins again and asks once more |
| Any other `ahr` code | Refused | Logs it, and that castle waits an hour before asking again |

The game takes one open request of a type for each castle. The bot counts a request as open from the moment it asks until the game's list shows it, an hour at most, and after that for as long as the list shows it.

### When the bot asks

Recruiting follows the game's button. One request helps every batch in the barracks. The bot asks when a batch has a `PID`, no help yet (`RAH` false) and at least 5 soldiers (`TUA`). The batch in production (`PS`, or `PS.P`) must also have more than 60 seconds left (`RCT`). A waiting batch is in `QS[].P`. The bot reads the barracks from the castle's join (`spl0`) or from its last order, whichever is newer, and asks once for each such look.

Healing asks for one batch at a time: a healing slot with no help taken (field 4 is 0), a batch id (field 5) and more than 60 seconds left (field 2). The bot never asks twice for one batch.

Before each ask the bot waits 1.5 to 4 seconds, as a player does before pressing the button.

## Help others

`aha {"KID": 15}` presses "Help all", with the client's value for `KID`. One request alone is `ahc {"LID": …, "KID": 1}`, which the bot does not send. The Help requests plugin presses "Help all" once other members have requests this player has not helped, short of helpers and not run out.

## Facts and confidence

| Fact | Confidence | Source |
|---|---|---|
| `ahl`, `ahh`, `ahd` and the request fields | medium | Lazy Lord's source. `ahl`, `ahh` and `ahd` with `LID`, `PID`, `TID`, `P`, `AC` and `RT` are what Help requests already reads |
| `OP.AID` names the request's castle | medium | Lazy Lord's source. Confirm with one live `ahh` after an ask |
| `ahr {ID, T}`: recruiting `T 6, ID 0`, healing `T 2, ID` the batch | medium | Lazy Lord's source, after the client's `Game.bundle.js` |
| An accepted `ahr` gets no reply, only the `ahh` push | medium | Lazy Lord saw it live on 2026-11-13. Confirm with one live ask |
| 273 for a second open request, even with all its helpers | medium | Lazy Lord saw it live on 2026-11-25 |
| 2 for a healing batch that is done or about to end | medium | Lazy Lord saw it live on 2026-11-25 |
| 53 for an ask made 3 s after a join | medium | Lazy Lord saw it live on 2026-11-26 |
| The recruiting button takes a batch of at least 5 with no help (`RAH`) | medium | Lazy Lord's source, after the client |
| `aha {KID: 15}` | medium | Lazy Lord's source. Help requests sends it already |
