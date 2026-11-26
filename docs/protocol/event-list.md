# The event list

The game sends the list of running events in `sei {E}` and inside the login reply `fjf` as `fjf.sei`. Each entry has the event id `EID` and `RS`, the seconds until it ends. The game sends several lists at login and a new one when the events change.

## Start, stop and the end backstop

`protocols.js` takes in one list at a time, in the order the lists came, after login (`load`). For each list it does three things in order:

1. It keeps the list, which `activeEvent(eventID)` reads.
2. It emits `eventStart` for each event the last list did not have.
3. It emits `eventStop` for each event the new list leaves out.

An event can end while the bot is connected without a new list. So each event also counts as stopped 30 s after its end time, `RS` plus 30 s, with `byEndTime: true` on the `eventStop` info. A later list that still has the event starts it again. A new list resets every end time. An end more than about 24 days away is left to the next list, because a timer cannot hold it.

## The event gate

`eventGate.js` is for plugins that work only during one event. It runs in the worker thread only.

| Export | What it does |
|---|---|
| `isActive(eventID)` | Whether the event is running. |
| `whenActive(eventID)` | A promise that resolves with the event's info once it runs, at once while it runs. |
| `onStart(eventID, fn)` | Calls `fn(eventInfo)` each time the event starts. Returns a function that stops it. |
| `onStop(eventID, fn)` | Calls `fn(eventInfo)` each time the event stops. Returns a function that stops it. |

## Facts and confidence

| Fact | Confidence | Source |
|---|---|---|
| `RS` is the seconds until the event ends | high | Already relied on by `stormClosing.js`, `wheelSpin.js` and the glory plugins. Lazy Lord cites the client's `ASpecialEventVO`. |
| An event can end without a new list | medium | Lazy Lord's source adds the backstop for it. |
| An older list handled after a newer one stopped events wrongly | medium | Lazy Lord saw it at login when their list handling waited on a difficulty choice. Our handling had no such wait, so the queue is a guard. |
