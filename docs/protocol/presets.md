# In-game army presets

A player saves army presets in the game and picks one while setting up an attack. This page describes how the game lists and saves presets, and how a preset reaches an attack. The facts come from the 2026-11-22 traces, which the fixture `packages/bot-core/test/fixtures/protocol/presets-20261122.json` keeps without the player's identity.

## List the presets: `gas`

The client sends `gas` each time the army screen opens. The bot sends it before each attack too (`openAttackDialog` in `packages/bot-core/plugins/attack/attack.js`).

Request: `{}`.

Reply, with result 0:

```json
{"S":[
  {"S":0,"A":"[[26,5,25,4,27,13],[26,5,27,11],[26,5,27,11],[216,254],[216,125],[216,125]]","SN":"shield"},
  {"S":1,"A":"[[166,50],[166,40],[166,40],[],[],[]]","SN":"wall+moat"}
]}
```

| Field | Meaning |
|---|---|
| `S` (outer) | The list of presets |
| `S` | The preset's slot, from 0 |
| `A` | A JSON string that holds six lists |
| `SN` | The name the player gave the preset |

The six lists of `A` are, in this order: front tools, left tools, right tools, front troops, left troops, right troops. Each list is a flat run of item and amount pairs, such as `[740,5,739,11]` for 5 of item 740 and 11 of item 739. An empty list leaves that row empty. A preset holds no courtyard and no support tools.

Not yet captured: whether the game lists a slot the player never saved, and how many slots a player can have.

## Save a preset: `sas`

```json
{"S":2,"A":"[[740,5,738,4,739,10],[740,5,739,11],[740,5,739,9],[215,254],[215,125],[215,125]]"}
```

The request overwrites one slot. It sends no name, and the game keeps the slot's name. The game answered result 0 with no payload, also for a partial preset with only some rows filled. The bot never sends `sas`.

## Use a preset in an attack

The game has no command that names a preset in an attack. The client unpacks the preset into the attack's own slots and sends an ordinary `cra`. Slots the preset leaves empty are sent as `[-1,0]`.

Both traces confirm this. In the Khan trace the player saved slot 2 (above) and then attacked. The first wave of that `cra` is the preset, slot for slot:

```json
{"L":{"T":[[740,5],[739,11]],"U":[[215,125],[-1,0]]},
 "M":{"T":[[740,5],[738,4],[739,10]],"U":[[215,254],[-1,0],[-1,0],[-1,0],[-1,0],[-1,0]]},
 "R":{"T":[[740,5],[739,9]],"U":[[215,125],[-1,0]]}}
```

## How the bot uses this

A wave plan names an in-game preset by its slot plus one (`{ kind: "preset", preset: 3 }` is slot 2), because 0 is the empty preset.

- `packages/bot-core/army.js` parses the reply (`presetsOf`) and keeps the last list. `fillFromPlan` unpacks a named preset into the wave, within the room the target and the commander allow, as it does for custom slots.
- `packages/bot-core/gamePresets.js` keeps that list current from every `gas` reply. It reads the list once, 2 to 6 minutes after login, if no attack has read it by then. It also reports the list's numbers and names in the bot's status, which the wave editor offers.
- Before an attack plugin starts, `presetsListed` checks that the game lists every preset its plan names. If one is missing, the plugin stops with the reason `statusArmyServerPreset`.

Not yet confirmed against the game: which number the game's own preset screen shows for slot 0. The wave editor shows each preset's name, so a player picks presets by name.
