# gge-tracker.com timetables

gge-tracker.com is an unofficial community site, not run by Goodgame, that tracks fortresses and Storm forts on most game servers. Its public API gives the time each one can be attacked next. The Fortress plugins (`packages/bot-core/plugins/attack/sharedFortressAttackLogic.js`) and the Storm forts plugin (`packages/bot-core/plugins/attack/attackStormForts.js`) can take their targets and times from it instead of scanning the map. This page lists the requests, the fields the bot reads and how sure each fact is.

This is not the game's protocol. It is a third-party site, so the bot reads it only for an account whose player opted in.

The shapes come from two sources:

- **Lazy Lord's source**, `be/fortressTracker.js` and `be/stormTracker.js` (MIT), which read the same three endpoints.
- **Our own reads**, one per endpoint, on 2026-11-27, with no player name. The recorded answers, cut to a few entries, are the fixtures in `apps/runner/test/fixtures/gge-tracker/`.

## Consent and what is sent

The consent is an account setting, the `ggeTracker` plugin on the account's **Account settings** tab, with two checkboxes. Both are off by default.

| Option | What it allows |
|---|---|
| `useTimetables` | The runner reads the timetables for the account's game server. The only thing sent is the server's name, for example `IN1`, in the `gge-server` header. |
| `includePlayerName` | The fortress list request also carries the account's name as `filterByPlayerName`. Shown only under a ticked first box. |

One account setting, rather than an option on each plugin, is one consent for the account: the player decides once what this account may share, and the Fortress and Storm plugins both follow it.

Nothing of ours is ever sent: no stats, no attacks, no account details. Every request is a GET with a 10 s timeout and the User-Agent `Mozilla/5.0 (compatible)`.

## Where it runs

Only the runner reads the site (`apps/runner/src/gge-tracker.ts`), behind one cache per game server that every account on that server shares. A worker asks with the `GgeTracker` worker message (action 29) and never fetches:

```json
{"id": 1, "kind": "fortresses", "kingdom": 1}
{"id": 2, "kind": "stormForts"}
```

The runner answers with the same `id`:

```json
{"id": 1, "ok": true, "kind": "fortresses", "server": "IN1", "fetchedAt": 1795777200000, "withName": false, "fortresses": [{"x": 750, "y": 594, "availableAt": 1795796371234}]}
{"id": 2, "ok": false, "error": "off"}
```

| Error | Meaning |
|---|---|
| `off` | The account's first box is not ticked. Nothing was fetched |
| `noServer` | The site has no such data for the account's game server |
| `unavailable` | The site could not be read, now or at the last try |
| `badRequest` | The request was malformed, or named a kingdom without fortresses |

The runner reads the consent from the account's own settings, not from the worker, and adds the player's name itself. The worker's own check (`packages/bot-core/plugins/ggeTracker.js`) sends no message at all while the box is off. A worker that gets no answer within 30 s counts it as no timetable.

## The server catalog: `servers/catalog`

```
GET https://api.gge-tracker.com/api/v1/servers/catalog
```

The answer is XML, one `<server>` block per server:

```xml
<server>
	<enabled>true</enabled>
	<storm>true</storm>
	<fortress>true</fortress>
	<advanced-castle>true</advanced-castle>
	<gge-server-name>India</gge-server-name>
	<name>IN1</name>
</server>
```

A server counts for fortresses when `enabled` and `fortress` are `true`, and for Storm forts when `enabled` and `storm` are `true`. Our read listed 83 servers, the Empire servers and the `E4K_` and `PARTNER_` ones. Confidence: high (read).

The site's name for a game server comes from the game's `1.xml`: the country code of `instanceLocaId` plus `instanceName`. `generic_country_IN` and `1` make `IN1`. `generic_country_international` becomes `INT`, so `INT3`. When that name is not in the catalog the code alone is tried, so `generic_country_ASIA` and `1` make `ASIA`. Confidence: high for the servers in our read, from Lazy Lord's mapping and the catalog's names.

The catalog is fetched once per runner, and again 30 minutes after a failed read.

## Fortresses: `dungeons`

```
GET https://api.gge-tracker.com/api/v1/dungeons?page=1&size=100&filterByKid=%5B%221%22%5D[&filterByPlayerName=<name>]
gge-server: IN1
```

`filterByKid` is a JSON array of kingdom ids as strings: 1 Burning Sands, 2 Everwinter Glacier, 3 Fire Peaks. The answer:

```json
{
  "dungeons": [{
    "kid": 1, "position_x": 750, "position_y": 594,
    "player_id": "65622085", "player_name": "bdm", "player_might": "49681456", "player_level": 70, "player_legendary_level": 950,
    "total_attack_count": "202", "available_duration_seconds": 523,
    "global_available_at": "2026-11-27T16:19:31.234Z", "effective_cooldown_until": "2026-11-27T16:19:31.234Z",
    "last_attack": "2026-11-26T16:21:14.840Z", "distance": null
  }],
  "pagination": {"current_page": 1, "total_pages": 1, "current_items_count": 77, "total_items_count": 77}
}
```

| Field | Use |
|---|---|
| `kid`, `position_x`, `position_y` | The fortress. A row of another kingdom is dropped |
| `effective_cooldown_until` | When this player can attack it next. With a player name it includes the player's own cooldown after their last hit |
| `global_available_at` | When anyone can attack it. Used when `effective_cooldown_until` is missing |
| `pagination.total_pages` | More pages are read, 100 rows each, half a second apart, up to 40 |

The `player_*` fields name the last attacker. The bot does not keep them. Our read of IN1 kingdom 1 gave 77 fortresses on one page, and without a name `effective_cooldown_until` equalled `global_available_at`. Confidence: high for the fields (read). Medium that a name adds the player's own cooldown, which is Lazy Lord's reading, since we sent no name.

When the site does not know a name, such as a new account's, it answers an empty list. The runner then fetches the list again without the name and answers `withName: false`. Confidence: medium (Lazy Lord).

A list is kept for a day: it holds only the fortresses that come free within 24 hours of the fetch, and is fetched again a day later, per server, kingdom and name. A failed fetch is tried again 30 minutes later.

## Storm forts: `storms/forts`

```
GET https://api.gge-tracker.com/api/v1/storms/forts?page=1&size=500
gge-server: IN1
```

```json
{
  "forts": [{
    "kid": 4, "position_x": 629, "position_y": 620, "isle_id": 10, "victory_count": 9, "attacks_left": 1,
    "is_visible": true, "available_at": "2026-11-27T11:28:02.856Z", "available_since_observed": true,
    "last_available_seconds": 16624, "updated_at": "2026-11-27T15:32:49.448Z", "distance": null
  }],
  "pagination": {"current_page": 1, "total_pages": 1, "current_items_count": 240, "total_items_count": 240}
}
```

| Field | Use |
|---|---|
| `position_x`, `position_y` | The fort |
| `isle_id` | The fort's type, the game's `extraData[2]`: 7 to 9 are the easy levels 60 to 80, 10 to 14 the hard levels 40 to 80 |
| `victory_count` | Victories so far, the game's `extraData[4]` |
| `is_visible` | False for a fort the map does not show yet |
| `available_at` | When it can be attacked |
| `updated_at` | When the site last looked at it |

Our read of IN1 gave 240 forts on one page. Confidence: high for the fields (read). The type codes follow the plugin's existing level table.

The list is fetched again when its last fort comes free within 30 minutes, and never sooner than 15 minutes after the last fetch, which is also the wait after a failure.

## How the plugins use it

The timetable is a hint, not the truth. Both plugins still look at each target in the game (`ssi`) and open the attack screen before they attack, and a refusal holds the target as before. The Fortress plugins still hold a fortress for the player's own cooldown after their hit (`bossdungeons.playerCooldownDelay`).

- **Fortresses.** The kingdom's whole list, nearest first, each attacked once both the game and the timetable say it is free. The plugin asks the runner again every 30 minutes.
- **Storm forts.** Every fort of a ticked level, also the hidden ones. A fort the game does not show yet is held for 5 minutes after its look. The plugin asks again once no fort comes free more than 30 minutes ahead, at most every 15 minutes.

With the box off, or when the runner answers with an error, both plugins scan the map as before. A plugin that was on the timetable goes back to the map when the timetable stops answering.
