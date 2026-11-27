# Blade Coast (event 4)

The Blade Coast plugin (`packages/bot-core/plugins/bladeCoast.js`) plays the event for a player. It joins a camp with resources, builds the camp, fills it with troops and tools from one castle, upgrades the warship and attacks the islands one at a time, on three maps in turn. `packages/bot-core/bladeCoastPlan.js` holds every decision as a pure function.

Every command, field and reply on this page is **from Lazy Lord's source (captured from a player 2026-11-14/15), not yet captured by us**. Lazy Lord is an MIT-licensed fork of the same upstream bot. Its `be/plugins/bladeCoast.js` says the flow was captured from a player on 2026-11-14 and `tfm` on 2026-11-15. None of our fixtures holds a Blade Coast frame. The tests in `packages/bot-core/test/blade-coast.test.mjs` play against a hand-made game (`test/harness/blade-coast-game.cjs`) built from this page, so they check the code against this page, not against the game.

## Maps

| Map ID | Level | Camp space | Fewest soldiers to attack | Morale aimed for |
|---|---|---|---|---|
| 22 | Normal | 350 | 300 | 350 |
| 27 | Hard | 400 | 350 | 400 |
| 28 | Hard plus | 450 | 400 | 450 |

The maps are played in that order. A finished map is closed with `tfm` before the next is joined. The game opens the player's next level itself: Lazy Lord asked for 28 after 22, and the game opened 27.

The plugin reads the maps from the game data our bot already downloads: `tmaps.json` (`mapID`, `tmapnodeIDs` joined by `+`, `endNodeID` for the Kraken), `tmapnodes.json` (`tmapnodeID`, `type`, `dungeonType`, `dungeonlevel`, `pos`, `orUnlockIDs`, `andUnlockIDs`, `partPayPriceID`), `prebuiltcastles.json` (row 29, the camp) and `partpayprices.json` (a port's `wood` and `stone`). Every `type` that contains `DUNGEON` is an island. `PORT` is a warship level. An island opens when any of its `orUnlockIDs` is won and all of its `andUnlockIDs` are won.

## Commands

| Command | Request | Reply | Notes |
|---|---|---|---|
| `tmp` | `{ MID }` | `tmp { TM: [map] }` | The map state. See [The map state](#the-map-state). A map the player hasn't joined has no `S`. |
| `csc` | `{ ID: 29, PWR: 0, OC2: 0, SID: <map> }` | `csc`, result only | Chooses the camp, paid with resources. `PWR 1` or `OC2 1` pays with rubies and is never sent. |
| `sje` | `{ MID }` | `sje`, result only | Travels to the map. The game sends no `jaa`, so the bot forgets which castle it was in. |
| `jea` | `{ MID }` | `jaa { gca, grc: { W, S }, gpa: { MRW, MRS } }` | Enters the camp. `gca` is a castle layout ([castle-layout.md](castle-layout.md)). `grc` holds the camp's wood and stone for building. |
| `ebu` | `{ WID, X, Y, R, PWR: 0, PO: -1, DOID: -1 }` | `ebu`, result only | A new building. `PWR 1` is never sent. |
| `eup` | `{ OID, PWR: 0, PO: -1 }` | `eup`, result only | A building a level up. |
| `ebe` | `{ X, Y, R, CT: 1 }` | `ebe`, result only | An expansion. `CT 1` pays with resources (Lazy Lord's `EXPANSION_WITH_RESOURCES`). |
| `msb` | `{ OID, MST }` | `msb`, result only | A time skip on a building under way. `MST` is `MS1` to `MS7`. |
| `etc` | `{ OID }` | `etc`, result only | Collects an expansion's treasure chest. |
| `tut` | `{ MID, SCID, KID, I: [[wodID, amount]] }` | `tut`, result only | Troops and tools from castle `SCID` in kingdom `KID`. Tools travel only with a soldier: a load of tools alone is refused with `MOVEMENT_HAS_NO_UNITS`. The coin fee is half the kingdom travel fee per soldier and 50 per tool. |
| `tgt` | `{ MID, SCID, KID, G: [["W" \| "S" \| "F", amount]] }` | `tgt`, result only | Goods. A quarter is lost on the way. |
| `msm` | `{ MID, TT, MST }` | `msm`, result only | A time skip on a trip at sea. `TT 1` is troops, `TT 2` goods. |
| `ule` | `{ SCID: -1, SKID: 0, W, S, F: 0, C1: 0, IID, SC: 0 }` | A new `tmp` when paid, `ule` when refused | Pays a port (`IID` is its `partPayPriceID`). `SC 1` pays with rubies and is never sent. |
| `tai` | `{ MID, NID }` | `tai { CD, gui: { I } }` | Opens an island's attack screen. `CD` above 0 is the island's cooldown in seconds. `gui.I` is the camp's units. |
| `gas` | `{}` | `gas` | Sent after `tai`, as the client does. It also lists presets ([presets.md](presets.md)). |
| `thm` | `{ LID: -12, BT: 2, BPC: 0, MID, NID, PTT: 0, A }` | `thm { TM: { M: { MID, TT, PT } } }` | The attack. `LID -12` is the camp's built-in commander. `A` is the waves (see below). `BT 1` boosts the travel with rubies and is never sent. |
| `tfm` | `{ MID }` | `tfm`, result only | Closes a map once its Kraken is beaten. |

The plugin never sends `tkt` or `sdc`, which buy time with rubies, and never skips an island's cooldown. `bladeCoastPlan.mayLeave` lists every command above with the payload it allows. A request it refuses never leaves.

## The map state

A `tmp` map entry:

| Field | Meaning |
|---|---|
| `MID` | Map ID |
| `M` | Morale |
| `S.MU` | Camp space |
| `S.U` | Soldiers the camp counts, including those out on an attack |
| `S.W`, `S.S`, `S.F` | Wood, stone and food in the camp |
| `S.MRW`, `S.MRS`, `S.MRF` | Storage for each. Wood storage is 3,000 plus 7,500 per storehouse |
| `I` | Units in the camp, `[[wodID, amount]]`. Soldiers out on an attack are not in it |
| `UT` | Troops at sea: `RS` seconds left, `I` the units |
| `RT` | Goods at sea: `RS` seconds left, `G` the goods |
| `N` | Nodes: `NID`, `A` 1 when won or paid, `CD` cooldown seconds, `G` what a port has been paid so far |

`S.U` above the soldiers in `I` means an attack is out. After a restart the plugin waits for it.

## Waves

`A` is a list of waves, one per player-level band (1 below level 13, 2 from 13, 3 from 26, 4 from 51). Each wave has `L` and `R` (flanks) and `M` (front), each with `T` tools and `U` soldiers as `[wodID, amount]`, `[-1, 0]` for an empty slot. A flank has 2 tool and 2 soldier slots. The front has 3 tool and 6 soldier slots.

A slot opens at an island level. Filling a locked slot is refused with `ATTACK_TOO_MANY_UNITS` (Lazy Lord saw this on a level 15 island).

| Slots | Open from level |
|---|---|
| Flank tools | 0, 37 |
| Front tools | 0, 11, 37 |
| Flank soldiers | 0, 13 |
| Front soldiers | 0, 0, 13, 13, 26, 26 |

The soldier and tool caps per side are the game's `CombatConst`, as `attack.js` has them. Tools go in the first wave only. A flank takes the wall tool, then the ranged tool. The front takes the gate tool, then the wall tool.

## Movements

An island attack's march has no target position on the map (`M.TA` is missing). `protocols.js` keeps such a march in `bladeMovements.js` instead of its movement list, so the commander pool, the attack plugins and the Live view's march list never see it.

## Refusals

| Code | Name | What the plugin does |
|---|---|---|
| 391 | `EVENT_ALREADY_ENDED` | On `csc` or `tfm`: the plugin is done and switches itself off |
| 315 | `WONT_REACH_IN_TIME` | On `thm`: no more attacks this event |
| 335 | `NO_TIME_SKIP_LEFT` | On `msb` or `msm`: that skip type counts 0, and another is tried |
| 311 | `NOT_COOLING_DOWN` | On a skip: the skip counts again |
| 100 | `MOVEMENT_HAS_NO_UNITS` | Avoided: a tool load always takes one soldier |
| 313 | `ATTACK_TOO_MANY_UNITS` | Avoided: only open slots are filled |

## Facts and confidence

| Fact | Confidence | Source | Live check that confirms it |
|---|---|---|---|
| Every request and reply shape above | medium | Lazy Lord's capture, 2026-11-14/15 | One run of each on the second test account |
| `ule` answers a paid port with `tmp`, not `ule` | medium | Lazy Lord | Pay one port and watch the reply |
| An island march has no `M.TA` | medium | Lazy Lord's `protocols.js` | One `gam` while an island attack is out |
| Storehouses from wood storage (3,000 + 7,500 each) | medium | Lazy Lord | Read `S.MRW` before and after one storehouse |
| `CT 1` on `ebe` pays with resources | medium | Lazy Lord's `build.js` | Buy one camp expansion |
| The game opens the next level itself on `csc` | medium | Lazy Lord | The `csc` after closing map 22 |
| The coin fee for `tut` | low | Lazy Lord, from the client's dialog | Compare coins before and after one `tut` |
