# Game protocol notes

These pages describe the game commands that four planned plugins need: Foreign Lords glory attacks, Bloodcrow glory attacks, Auto Station and tooling. Each page is reference: request and reply fields, costs, limits and how sure each fact is.

| Page | Covers |
|---|---|
| [invasions.md](invasions.md) | Foreign Lords and Bloodcrow events, camps, targets, difficulty, points and glory |
| [banners.md](banners.md) | Glory banners, the wave tool slots, support tools (`AST`) and the courtyard wave (`RW`) |
| [dethrone.md](dethrone.md) | Replacing an invader camp with `rae`, and what it costs |
| [stationing.md](stationing.md) | Sending troops to an ally castle with `cds`, recalling them, opening gates and the protection fields |
| [tools.md](tools.md) | Workshop production, Sceat tool levels, the armourer and the coin cap |
| [recruit-tools.md](recruit-tools.md) | Ordering troops and tools with `bup`, the production lists as captured, and what is still unknown |
| [event-camps.md](event-camps.md) | The side of a Berimond invasion camp, how Daimyo castles are attacked and read, and the aquamarine packages of the Storm Islands shop |
| [vip-commanders.md](vip-commanders.md) | Premium ("VIP") commanders, the free daily allowance per VIP level, the `vip` push and what a capture must still confirm |
| [wheel.md](wheel.md) | The Wheel of Fortune and the Wheel of Unimaginable Affluence: the spin, the tickets, the event list and what is never sent |
| [nomad-khan.md](nomad-khan.md) | Nomad and Khan camps of event 72, rage and taunts, the points a defended taunt earns, and the castle defence commands `dfc`, `dfw`, `dfm` and `dfk` |
| [presets.md](presets.md) | The player's in-game army presets: listing them with `gas`, saving with `sas`, and how a preset becomes the slots of a `cra` |
| [capture-backlog.md](capture-backlog.md) | What the 2026-11-21 trace captured, the features that still need a capture, and a checklist for the next trace |

## How the findings were obtained

The study read the public HTML5 client and its static data as text on 2026-11-17. It executed no client code, opened no socket and used no account.

| File | Source |
|---|---|
| `Game.bundle.58d319efe36aacf6c6ab.js` | Game code, 15.9 MB, with class names intact |
| `dll/ggs.dll.1510ece3613739fd91ea.js` | Shared constants and enums |
| `items/items_v789.02.json` | Game data: units, tools, packages, events and costs |
| `lang/en.json` (version 4403) | English strings |

All four come from `https://empire-html5.goodgamestudios.com/default/index.html` and the files it names.

The client sends a request with `sendCommandVO`, which writes `JSON.stringify(vo)` (D@455752). A request is therefore exactly the fields of its `C2S*VO` class, in the order the constructor assigns them.

### Offsets

`G@n` is a byte offset into `Game.bundle.58d319efe36aacf6c6ab.js`. `D@n` is a byte offset into `ggs.dll.1510ece3613739fd91ea.js`. The offsets are valid for those two builds only. To read the code at an offset, run `tools/protocol/ctx.py` with a pattern from the cited line.

### Confidence

| Level | Meaning |
|---|---|
| high | Read directly from client code or game data. |
| medium | Inferred from the client. The server can differ. |
| low | The client does not show it. |

Each page ends with a table that gives every fact its level and the single live read or action that would confirm it.

## Fixtures and data

`packages/bot-core/test/fixtures/protocol/` holds one JSON file per area. Each file is derived from the client, not captured from a session, and its `_label` field says so. Replace a fixture with sanitised captured frames after a live check confirms it.

`docs/protocol/data/` holds the tables the pages draw on:

| File | Rows |
|---|---|
| `fame-tools.tsv` | The 53 tools with a `fameBonus` |
| `armorer-packages.tsv` | Every armourer package, with prices, stock and level limits |
| `tool-unlocks.tsv` | Each Sceat skill and research that enables or disables a workshop tool |
| `error-codes.tsv` | The 433 server error codes. `packages/bot-core/err-classes.json` sorts them into severe and "not now" for the logs |

To regenerate the tables and fixtures from a newer client, follow [`tools/protocol/README.md`](../../tools/protocol/README.md).

## Live checks

Each open item needs one live read or action. The reads cost nothing and happen at login. The actions are for a second, expendable account.

| Check | Confirms | Cost |
|---|---|---|
| Log the login `sei` frame | `sei` fields for events 71, 103 and 27 ([invasions](invasions.md), [dethrone](dethrone.md), [tools](tools.md)) | None |
| Log one `ain` reply | `ain` member entries include `AP` ([stationing](stationing.md)) | None |
| Log the `skl` reply and compare `SIDS` with the recruit list | Sceat tool levels ([tools](tools.md)) | None |
| Log `OGC` from `gcl` or `dcl` on two different days | When the open-gate counter resets ([stationing](stationing.md)) | None |
| Log `gcu.C1` on an account with many coins | The coin cap ([tools](tools.md)) | None |
| One Foreign Lords attack with 1 Flag (660), then one without, comparing the `pep` deltas | Banner acceptance and stacking ([banners](banners.md)) | 125 coins and the attack |
| Station 1 cheap unit with `WT:1` without sending `sdi`, then recall it with `mcm` | `cds` without `sdi`, and recall ([stationing](stationing.md)) | Travel coins |
| Queue 1 ladder (614) with `bup` | `bup` on list 1 ([tools](tools.md)) | 28 wood, 12 stone |
| Buy armourer package 28 once | Armourer `sbp` ([tools](tools.md)) | 220 coins |
| One Exile dethrone | The `rae` reply and the dethrone counts ([dethrone](dethrone.md)) | 24,000 coins for the first |

Skip `mos`. Opening the gates costs at least 450 rubies, and the client already shows its request, reply and cost formula.
