# Alliance donation

The Alliance donation plugin (`packages/bot-core/plugins/allianceDonation.js`) gives the alliance's funds what each listed castle holds above a kept share of its storage, and, when ticked, the account's alliance and rift coins.

Everything on this page comes from Lazy Lord's source (`be/plugins/allianceDonation.js`, which cites the client's `CastleAllianceDonateDialog`, `C2SAllianceDonateVO` and `C2SGetDonationResourcesVO`). None of it is captured yet.

## Read a castle's resources: `gdr`

```json
{"AID": 1000001, "KID": 0}
```

`AID` is the castle's id and `KID` its kingdom. The client sends it when the player picks a castle in the donate window. The reply's `grc` holds that castle's resources at that moment, with the same keys as `ado` below. The plugin reads them from `grc` and falls back to the castle list's figure for a key `grc` leaves out.

## Give: `ado`

```json
{"AID": 1000001, "KID": 0, "RV": {"W": 1000, "S": 1000, "I": 1000, "O": 1000, "G": 1000, "C": 1000}}
```

One request for each castle. `RV` holds an amount for each resource given:

| Key | Resource |
|---|---|
| `W` | Wood |
| `S` | Stone |
| `I` | Iron |
| `O` | Olive oil |
| `G` | Glass |
| `C` | Charcoal |

Food can't be given. Coins belong to the account, so they go in one request from the main castle, kingdom 0:

```json
{"AID": 1000001, "KID": 0, "RV": {"AC": 350, "RC": 30, "LRC": 5}}
```

`AC` is alliance coins, `RC` rift coins and `LRC` legendary rift coins (their `JSONKey` in `items/currencies.json`). Rubies and gold coins are never given.

## Refusals

| Code | Name | What the plugin does |
|---|---|---|
| 270 | `PLAYER_HAS_NO_ALLIANCE` | Ends the round. The same answer would come for every castle |
| 124 | `JUST_JOINED_ALLIANCE` | Ends the round. A new member must wait |
| 398 | `ALLIANCE_FUNDS_FULL` | Ends the round |
| 55 | `NOT_ENOUGH_RESOURCES` | Said once for that castle. The next castle is still tried |
| 117 | `ALLI_NOT_ENOUGH_RES` | The same |
| 327 | `NOT_ENOUGH_SPECIAL_CURRENCY` | The same, for coins |

The plugin asks the game nothing while `playerInfo.alliance.id` (from `gal`) says the player is in no alliance.

## Facts and confidence

| Fact | Confidence | Source |
|---|---|---|
| `gdr {AID, KID}` answers with the castle's resources in `grc` | medium | Lazy Lord's source. Confirm with one live `gdr`. |
| `ado {AID, KID, RV}` with keys `W S I O G C` | medium | Lazy Lord's source, after the client's `CollectableItem*VO.SERVER_KEY` |
| Coins go as `ado {AID: main castle, KID: 0, RV: {AC, RC, LRC}}` | medium | Lazy Lord's source |
| Food can't be given | medium | Lazy Lord's source, after `items/allianceFundsDonatables.json` |
| The refusal codes above | high for the names (`err.json`), medium for when they come | Lazy Lord's source |
