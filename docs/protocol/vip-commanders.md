# VIP commanders

The game calls them premium commanders. The commander picker's VIP tile and its daily VIP cap (plugin option `vipCommanders`, 0 to 300) are saved, but the bot ignores them. This page records what the game client and one live capture on 2026-11-21 showed.

## Free allowance

While VIP mode is active, the VIP level gives free premium commanders each day. The source is the items table `viplevels`, field `freePremiumGeneralsPerDay`.

| VIP level | Free premium commanders per day |
|---|---|
| 1 to 4 | 0 |
| 5 | 25 |
| 6 | 50 |
| 7 | 100 |
| 8 | 150 |
| 9 | 200 |
| 10 | 300 |

The cap's maximum, 300, is the level-10 allowance. The VIP tile sets 25, the lowest allowance above zero, so it fits every VIP account that has one.

When none remain, the game charges rubies for a temporary commander. A bot must never exceed the free allowance, whatever the cap says.

## Using one

An attack uses a premium commander by sending `BPC: 1` in `cra` (`C2SCreateArmyAttackMovementVO`). The bot always sends `BPC: 0` (`packages/bot-core/plugins/attack/attack.js`). Sending `BPC: 1` is not confirmed on a VIP-active account, so the bot does not do it.

## The `vip` push

The push, also found in `gbd.vip`, carries these fields.

| Field | Meaning |
|---|---|
| `VP` | VIP points |
| `VRL` | Highest VIP level reached |
| `VRS` | VIP seconds remaining, 0 when VIP mode is inactive |
| `UPG` | Premium commanders used today |

Remaining today is the allowance for the level minus `UPG`. VIP points fall 5% a day while VIP mode is off, which of `VRL` or the points sets the level while it is off is not confirmed.

## Still to confirm

Capture one attack with `BPC: 1` on a VIP-active account and record:

- The `LID` (commander id) the request carries, since a premium commander may use a different id range than an owned one.
- The change in `UPG` after the reply.
- Whether `VRL` or the points decide the allowance once VIP mode has lapsed.
- The error code, if any, when the allowance is spent.
