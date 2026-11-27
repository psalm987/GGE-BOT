# Colossus donation

The Colossus donation plugin (`packages/bot-core/plugins/colossusEventDonate.js`) gives wood and stone to the Colossus during its event, from the castles the player lists.

Everything on this page comes from Lazy Lord's source (`be/plugins/colossusEventDonate.js`). None of it is captured yet. The event runs only some weeks, so a capture waits for it.

## Give: `cde`

```json
{"DW": 4500, "DS": 4000, "SCID": 1000001, "SKID": 0}
```

| Field | Meaning |
|---|---|
| `DW` | Wood to give |
| `DS` | Stone to give |
| `SCID` | The giving castle's id |
| `SKID` | Its kingdom: 0, 1, 2 or 3 |

The plugin sends one `cde` at a time and waits for its reply, because no other plugin sends it.

## How much

Lazy Lord gave a resource down to 0 once it reached a share of storage. This plugin keeps a share instead. Each castle row has two shares of storage:

- **Give from.** A resource is given only once it reaches this share. Default 90 %.
- **Keep.** The castle gives down to this share. Default 50 %.

So a castle with 10,000 wood storage and 9,500 wood gives 4,500 and keeps 5,000. Wood and stone are judged apart.

## When the event is not running

The game refuses `cde` with 209, `SPECIALEVENT_NOT_RUNNING`. The plugin then stops the round and asks again 6 hours later. Lazy Lord saw the Colossus as event 44 or 57 in the `sei` list, but not every time it ran. So the refusal is the sign the plugin trusts. Event 44 or 57 starting ends the wait at once, one time. An id that turns out not to be the Colossus can't make the plugin ask every round.

The plugin never switches itself off and never changes the saved settings. Lazy Lord switched the plugin off and the player had to switch it on for the next event.

## Facts and confidence

| Fact | Confidence | Source |
|---|---|---|
| `cde {DW, DS, SCID, SKID}` | medium | Lazy Lord's source. Confirm with one small donation during the event. |
| 209 means no Colossus event is running | medium | Lazy Lord's source |
| The Colossus is event 44 or 57 | low | Lazy Lord saw it in the event list only sometimes |
| Only kingdoms 0 to 3 give | medium | Lazy Lord's source |
