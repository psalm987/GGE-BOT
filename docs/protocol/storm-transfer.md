# Goods transfers into the Storm Islands

Mead replace (`packages/bot-core/plugins/meadReplaceStorm.js`), Send food (`packages/bot-core/plugins/foodSendStorm.js`) and Build Supply (`packages/bot-core/plugins/buildSupply.js`) send goods to the Storm Islands castle by kingdom transfer. The game takes one goods transfer into Storm at a time, so all three go through one arbiter, `packages/bot-core/stormTransfer.js`. This page lists the commands, the facts the arbiter relies on, and its API.

The request shapes come from the mead sender, which has run live, and from Lazy Lord's source (`be/plugins/foodSendStorm.js`, `be/plugins/buildSupply.js`).

## Refresh the figures: `dcl`

```json
{"CD": 1}
```

The castles' mead and food do not drop locally as troops eat. Each look sends `dcl` first and works from the figures in its reply. If no reply comes, the arbiter logs `stormLevelsNotRefreshed` and uses the figures it holds.

## Send goods: `kgt`

```json
{"SCID": 1000001, "SKID": 0, "TKID": 4, "G": [["F", 11000]]}
```

| Field | Meaning |
|---|---|
| `SCID` | The sending castle's id |
| `SKID` | The sending castle's kingdom |
| `TKID` | The kingdom that takes the goods. 4 is the Storm Islands |
| `G` | `[code, amount]` for each goods: `MEAD`, `F` (food), `W` (wood), `S` (stone) |

`protocols.js` sends it through `ClientCommands.kingdomUnitTransfer`, in the `goodsTransferTurn` line. The reply carries `kpi`. Its `RT` lists one entry for each goods transfer on its way: `{KID, RS, G}`, with the kingdom it goes to, the seconds left and the goods. `protocols.js` puts each entry on that kingdom's castle as `resourceTransfer`.

## Skip a transfer: `msk`

```json
{"MST": "MS5", "KID": "4", "TT": "2"}
```

`TT` `"2"` is a goods transfer (`KingdomSkipType.sendResource`). `protocols.js` sends it through `ClientCommands.skipResourceTransfer`, in the `kingdomSkipTurn` line. The skip comes from the skip items the player holds and allows in the Skips settings (`plugins/skips.js`). The arbiter never spends rubies. After each skip that goes through, it waits 1 to 3 seconds before the next.

## What the arbiter relies on

- **One goods transfer into Storm at a time.** While one is on its way, a new `kgt` into Storm is refused. Mead, food and Build Supply's wood and stone therefore share one slot.
- **The timer does not count down.** `RS` is the seconds left when the game sent it. The arbiter stamps each timer when a `kpi`, `fjf`, `kgt`, `msk` or `kut` reply brings it, and works out the time left from that stamp.
- **A skip without fresh timer.** An `msk` reply without `kpi` leaves the old timer. The arbiter takes the skip's minutes off that timer, or the next look would skip the same time again.
- **About a tenth is lost on the way.** Lazy Lord saw about 10% of a wood and stone transfer to Storm lost on 2026-11-16. Food is filled to the free space ÷ 0.9. Mead was never measured and is filled to the free space, as before.
- **Goods that landed through skips** count in the Storm castle only from the game's next update. The arbiter adds them itself, less the share lost on the way.

## Who gets the slot

At each look, every sender reports a Want: the hours its goods lasts in Storm (stock ÷ what is eaten each hour) and, when it is due, an order to send. The arbiter decides in `decide(secondsLeft, wants)`, a pure function:

1. If a transfer is on its way and it lands after a goods that may skip has run out, skip it. A dry run never skips. One look skips once.
2. If a transfer is still on its way, send nothing. A sender that wants to send looks again in 5 minutes. The others keep their own wait.
3. Otherwise a dry run's order is written to the log and never holds the slot, so food on Log only never holds up the mead. Among the real orders, the one whose goods runs out soonest goes. A goods nothing eats has Infinity hours and goes after one that is eaten. Among equal hours, goods troops eat go before goods they don't.
4. After a send, the sender looks again in about 15 minutes. A refused send is tried again in 5 minutes.
5. If the order that went through has `landNow`, the arbiter skips that transfer until it lands and counts its goods in the Storm castle before it tells the sender.

## Arbiter API

```js
const stormTransfer = require("../stormTransfer.js")

stormTransfer.register({
    name: "buildSupply",
    feedsTroops: false,
    look: storm => want,         // called with fresh figures at each look; return a Want
    busy: minutes => {},         // it wanted to send, but a transfer lands in `minutes`
    sent: order => {},           // its order went through
    refused: code => {},         // the game refused its order
})
stormTransfer.wake()             // bring the next look forward to now
stormTransfer.fillAmount(storm, "wood")   // what fills the storehouse, counting the loss
stormTransfer.firstSource(rows, "wood")   // first castle-and-keep row with goods above its keep: { castle, spare }
stormTransfer.slotSecondsLeft()  // seconds until the transfer on its way lands, 0 for none
```

A Want is `{ hoursLeft, maySkip, dryRun, landNow, order: { from: castle, goods: { wood: 5000, stone: 5000 } } }` when it wants the slot, or `{ hoursLeft, maySkip, waitMs, note }` when it does not: `waitMs` is when to look again and `note` is the log line, as `[key, ...args]`. Register at load. The arbiter starts its looks when the bot has loaded, if the Storm Islands are unlocked.

## Build Supply

Build Supply sends wood and stone for Build's plan in the Storm castle. It is ported from Lazy Lord's `be/plugins/buildSupply.js`.

- **Trigger.** Build emits `buildLooked` after each look that leaves a castle unfinished (see [build.md](build.md#the-hook-for-build-supply)). Build Supply acts only on a castle in kingdom 4, and only when `nothingPayable` is true and `need` has wood or stone. It then calls `wake()`.
- **Want.** `hoursLeft` is Infinity, because no troops eat wood or stone, and `feedsTroops` is false. Mead and food that have an order therefore go first. A Build Supply order never makes the arbiter skip another transfer.
- **Amount.** For each of wood and stone: `fillAmount` (the free space ÷ 0.9), but no more than what the plan lacks (`need` less the stock) ÷ 0.9. A goods the plan does not lack is not sent.
- **Source.** The first row of `buildSupplySources` whose castle has wood or stone above its keep, through `firstSource`. That castle sends what it can spare of both in one `kgt`. Storm and Berimond rows never send.
- **Skips.** With `buildSupplyUseSkips` on (the default), the order has `landNow`.
- **Build's next look.** Build Supply passes `lookAgainIn` a promise. It resolves when the arbiter has answered, or after 90 seconds at most:

| Arbiter's answer | Build looks again |
|---|---|
| Sent and landed through skips | In 5 to 10 seconds |
| Sent, on its way | When it lands, plus 30 to 60 seconds |
| The slot is taken | When that transfer lands, plus 30 to 60 seconds |
| Refused | In 5 minutes plus 30 to 60 seconds, after the arbiter's retry |
| Nothing to send, or Log only | At Build's own time |

When Build looks while a transfer is already on its way, Build Supply sends nothing and asks for a look once it lands. One report from Build sends at most once. The arbiter keeps the report through a busy slot or a refusal, so it can send once the slot is free.

What Lazy Lord did differently:

- Lazy Lord sent the full storehouse fill whatever the plan lacked. About a tenth of each transfer is lost, so Build Supply sends no more than the plan lacks.
- Lazy Lord also skipped another sender's transfer on its way to free the slot. Build Supply waits for it, because the arbiter skips only for goods that run out.
- Lazy Lord stopped skipping when a skip reply brought no fresh timer. The arbiter counts the skip down on the old timer instead, as for mead and food.

## Facts and confidence

| Fact | Confidence | Source |
|---|---|---|
| `kgt {SCID, SKID, TKID, G}` into Storm with `MEAD` | high | The mead sender, live |
| The same shape with `F` | medium | Lazy Lord's source. Confirm with one small transfer on the test account. |
| The same shape with `W` and `S` in one `G` | medium | Lazy Lord's source. Confirm with one small transfer on the test account. |
| `msk {MST, KID: "4", TT: "2"}` skips a goods transfer | high | The mead sender, live |
| One goods transfer into Storm at a time | medium | Lazy Lord's source. The refusal code of a second `kgt` was never captured. |
| About 10% lost on the way | medium | Lazy Lord saw it live for wood and stone. Not measured for food or mead. |
| Food eaten per hour is `DFC × FCR/100 − DF` | medium | The formula feast.js uses. A Storm castle captured on 2026-11-21 had `DFC` 0: its troops ate only mead. |
