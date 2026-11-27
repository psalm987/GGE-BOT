# Attacks: the attack screen, limits, refusals and targets

This page is reference for how the attack plugins talk to the game around a `cra`: the attack screen the client opens first, the daily count, what each refusal means, and how barons, fortresses, camps, glory castles and the Khan are judged ready. Most of it comes from Lazy Lord's backend (MIT, a fork of the same upstream), read on 2026-11-26. Their code is evidence, not proof. Each fact's confidence says whether anything of ours backs it.

Sources: Lazy Lord's `be/plugins/attack/attack.js`, `sharedFortressAttackLogic.js`, `sharedBarronAttackLogic.js`, `sharedRealmInvasionLogic.js`, `attackKhan.js`, `be/plugins/commander.js`, `be/protocols.js`, `be/eventDifficulty.js`, `be/attackTemplates.js` and `be/reportCleaner.js`. The bot code that follows them names the file.

## The attack screen

The client opens the attack screen before every attack. The bot now does the same (`openAttackScreen` in `plugins/attack/attack.js`).

| Target area type | Request |
|---|---|
| 11 (fortress) | `abi` |
| 17 | `aci` |
| 24 (storm resource island) | none: its screen names no source castle |
| any other | `adi` |

The request is `{SX, SY, TX, TY, KID}`: the source castle, the target and the kingdom. The reply carries:

| Field | Meaning | Use |
|---|---|---|
| `SCID` | The source castle's id | The troop count below is taken only when it names this castle. |
| `gui.I` | The castle's troops and tools, `[[wodID, count]]`, as the screen shows them | Replaces the castle's unit count. The bot's own count lags after an attack leaves, and an army built on it is refused with `MISSING_UNITS`. |
| `gaa.AI` | The target as the game sees it now: `[type, x, y, ...extraData]` | Replaces the target's `extraData`, so a camp still cooling down is seen before the `cra`. |
| `gli.C` | Each commander as the server sees it for this castle and target | The plugin's commander for this attack, built with `ClassTypes.Lord`. |
| `AE` | Effects of this castle for this attack, such as construction items | Become the commander's area effects. |

A refused screen means the target is not ready. The bot sends no `cra`, and the plugin holds that target for a while. The refusal is logged at debug level for `COOLING_DOWN`, which is another player's hit landing first, and as a warning otherwise.

With `humanize.attack_dialog` the client's other steps follow the screen: `gas`, then `gdi`, then the `cra`.

## The daily count

The game sends `gai {AC, ACTH}` at login. `AC` is the attacks counted today. The bot adds 1 for each `cra` the game accepts, takes `AC` whenever `gai` comes again, and starts again from 0 on a new UTC day. Before, the count moved only at login, so the limit was overshot or never released. Where the game's own day ends is not known. Lazy Lord uses 19:30 UTC for Indian servers, which we do not copy.

## Refusals and the attack queue

| Refusal | What the bot does |
|---|---|
| The same error again from one plugin | That plugin waits 30, 60, 120 and then 300 seconds before its next attack. A success clears it. The other plugins go on. |
| `CANT_START_NEW_ARMIES` | Every plugin waits 30 minutes, then the castle list is read again. Lazy Lord saw it after attacks 1.5 seconds apart. |
| `NO_MORE_TROOPS`, `NOT_ENOUGH_TOOLS`, `CASTLE_LOCKED` | No wait: nothing was sent. |
| `NOT_ENOUGH_CURRENCY1` | The plugin waits 10 minutes, then tries again. |
| `WONT_REACH_IN_TIME` | The target is held 5 minutes. |
| `COOLING_DOWN`, a refused screen | The target is held 5 minutes (glory castles: see below). |
| `NO_SPY_REPORT` (the bot's own, see [Spy-filled wave 1](#spy-filled-wave-1)) | The plugin waits 10 minutes, then tries again. |
| `NOT_ENOUGH_TOOLS` from a spy-filled wave 1 | The plugin stops, with a status saying why. |

Before, any 3 refusals from any plugin paused every plugin for 5 to 60 minutes.

A plugin out of troops waits for a march of its castle to come home, or 5 minutes at most (`waitForTroops`). Before, with no army out, it waited for ever.

## Targets

### Robber barons

The bot keeps its own record of when each tower is ready: the wait its own march home saw, or a 5-minute hold after a refusal. The map entry is shared, and any packet about the tower rewrites it. A tower whose map data is over 2 minutes old is looked at again (`ssi`, in the look queue) before its attack.

### Fortresses

After the player's own hit, a fortress stays closed to them for `bossdungeons.playerCooldownDelay` seconds (about 5 days). The map shows everyone only the global cooldown (1 day), so a hit sent on the map's word was refused again and again. A fortress's level is `extraData[1]`. The plugin's own level (20, 44, 51) is the fallback. Lazy Lord's fallbacks are 21, 45 and 55. Fortresses are looked for within 50 tiles of the castle, not over the whole map.

### Event camps and Berimond Invasion

A camp whose skip is refused is held 5 minutes, and no `cra` goes to a camp still cooling down. With no skip left the plugin attacks only camps that are ready on their own for 5 minutes, then tries skips again. Before, it stopped.

### Foreign Lords and Bloodcrow castles

The map around the castle is read again before each attack (one request, 50 tiles each way), and the nearest open castle the player is not already attacking goes next. `extraData[2]` is the seconds until a beaten castle is back for the player, 0 when it is there. Before, only 1 counted as closed. `NO_PLAYER_SPAWNED_YET` (291), a refused screen and `COOLING_DOWN` leave the castle out for 5, 15, 30 and then 60 minutes, and the run goes on. Before, 291 stopped the run.

The castle's level is read from `extraData[0]`. Lazy Lord uses a fixed 70 instead. This is unconfirmed.

### The Khan

The camp is found again (`fnm`) before each attack. A taunt (`lta`) gets no reply when it works. The game empties the rage bar instead: our capture `khan-20261122.json` shows `lta` at 182.9 s and `rpr` with `PCRP` 0 at 183.0 s. The bot sends one taunt at a time and counts it as sent only when `rpr` drops below the cap within 15 seconds.

With the defender gate on (`tauntMinDefenders`):

- a wall side is defended when its troop share `dfw[side].UP` is above 0;
- every slot of a defended side needs 10 tools for each Khan army already on its way, plus 10 for the new one;
- the defenders are counted from the `dfc` reply's storage `gui.I`, or from the castle's own count when the reply has none.

## Commanders

A commander counts as free again once the bot sees its army come home. Every 15 seconds, a busy commander with no army of the player's out and no plugin holding it is freed:

- 3 minutes after the game refused it as busy (`LORD_IS_USED`);
- 60 seconds after its army should have been home: the march's end, plus its travel time again for an attack;
- 10 minutes after it was marked busy otherwise.

Lazy Lord also frees a commander a plugin has held for 10 minutes. We do not: our queue can hold one longer (the 30-minute pause, the hourly limit), and freeing it would lend it to a second plugin.

On `LORD_IS_USED` the plugin reports its commander with `commanderRefused` instead of freeing it. Freed, it went to the next waiting plugin, which was refused too. The refusal also asks for the movement list (`gam`) 10 seconds later, at most every 30 seconds. `syncMovements` in `protocols.js` ends the player's own marches the reply does not list.

## Event difficulty

A tier counts as unlocked when it is not locked (`isLocked`), or when the achievement that unlocks it (`achievements.unlocksDifficulty`) is in the player's finished achievements (`vli` `FA`). A tier above 10 with a ruby price can only be rented and never counts. "Highest unlocked difficulty" is the default for event camps.

## Wave plans

| Item field | Rule |
|---|---|
| `amountPerWave` | No more of the tool than this in one wave. |
| `canBeUsedToAttackNPC` "0" | Not sent against area types 2, 11, 17, 24, 25, 27, 29, 30, 35 or 37. Foreign Lords (21) and Bloodcrow (34) castles count as player targets. |
| A support tool with an effect of type 156 (`additionalWaves`) | Adds that many waves, on top of the commander's own. |

## Spy reports

`sne` entries are `[id, type, header, sender, playerID, age in seconds, read, archived, forwarded]`. Types 3 and 4 are spy reports, on a player's target and on an NPC's. Their header reads `spyKind+result[+areaType]#kingdomID+ownerID[+name]`. Our Bloodcrow capture's `1+0+34#0+-1002+` fits it. With "Delete reports" on, the report of the bot's own spies (an accepted `csm`) is deleted when they got through (result 0), and kept when they were caught (2). A spy report is deleted 2 to 3 minutes after it arrives, not 1 to 3 seconds like a battle report, so spy-filled wave 1 can still read it on the reopened attack screen. An archived or forwarded report is never deleted, battle or spy.

## Spy-filled wave 1

Foreign Lords (21), Bloodcrow (34), Khan camp (35) and Daimyo (37) plugins have the option "Fill wave 1 from a spy report". The bot spies the target before each attack and fills wave 1 from the report, as the game's own "Fill waves" does. Everything in this section is from Lazy Lord's source (`be/waveOneAutofill.js` and `be/plugins/attack/attack.js`, MIT) unless it names our own evidence. The bot code is `spyTarget` and `spyWave` in `plugins/attack/attack.js` and the planner in `spyFill.js`.

### Spying

1. `ssi {TX, TY, KID}`. The reply's `AS` is the spies in the castle. With none, nothing is sent.
2. `csm {SID: castle id, TX, TY, SC: AS, ST: 0, SE: 100, HBW, KID, PTT, SD: 0}` sends every spy at 100 % accuracy. Lazy Lord rides a feather whenever the account has one. The bot rides one only when the plugin's own horse setting is the feather and one is left. Otherwise it takes the coin horse with the best `spyBoost` when the plugin rides any horse, and `HBW` -1 when it rides none. A horse paid in rubies is never taken.
3. The reply's movement is at `A.M`, `AAM.M` or `M`. The spies land after `TT - PT` seconds. The bot waits that long plus 5 to 10 seconds, 15 minutes at most. `NOT_ENOUGH_SPIES` (105) means no spies are left.
4. The bot opens the attack screen again. Its reply carries the report in `S` and the target's bonuses in `B.AIE`.

The other attacks in the queue go on while the spies travel. The attack steps out of the queue for the wait (`turn.outsideQueue` in `waitToAttack`) and carries on ahead of the queued attacks once the spies land. While the screen shows no report the bot spies again. After 10 trips without one it gives up with `NO_SPY_REPORT`.

### What the screen shows

| Field | Meaning |
|---|---|
| `S[0]`, `S[1]`, `S[2]`, `S[3]` | The left flank, front, right flank and courtyard, each `[[wodID, count]]`. A side counts as reported when one of the first three has an entry. |
| `B.AIE` | The target's bonuses, `[[effectID, [value]]]`: 10000 wall, 10001 gate, 10002 moat, 10004 ranged defence, 10007 defence. |
| `gaa.AI` 6 to 8 | A castle's own wall, gate and moat. Khan camps have them at 10 to 12 and Daimyo castles at 9 to 11. Our Daimyo capture (`daimyo-20261120.json`) holds 110, 110 and 0 there. |

### Filling wave 1

1. One troop fills every side: the ranged troop with the most `rangeAttack` times the commander's ranged bonus, among those the castle has enough of for both flanks and the front, else the strongest. A side takes as many as it has room for.
2. Each side, left, front, right, cancels in order its wall, then its gate (front only), then the defenders' ranged defence. The moat is left alone.
   - Wall or gate: the target's own value, plus its bonus, plus the spied tools' `wallBonus` or `gateBonus`, minus the commander's `wallReduction` or `gateReduction`.
   - Ranged defence: 100, plus 10004 and 10007, plus the spied tools' `defRangeBonus`, the same on every side.
3. For each, the tool kind with the highest bonus that cancels it alone goes first, event and elite tools ahead at the same bonus. When none can, the one kind that cancels the most fills the room. A tool that lowers two defences counts for both.
4. A side never takes more tool kinds than it has tool slots (2 on a flank, 3 on the front at level 37 and up), more tools than its room, or more of a tool than its `amountPerWave` across the wave. A tool `allowedToAttack` or `canBeUsedToAttackNPC` bars from the target is left out.
5. A wall or gate left standing is `NOT_ENOUGH_TOOLS`. Ranged defence left over is allowed.

Wave 1 takes its troops and tools before the plugin builds its other waves, so they go to wave 1 first. The plugin's own wave 1 goes back to the castle, and the plan takes its place. With Waves, the plan's first wave is not filled at all.

Lazy Lord also counts the account's legendary skills in the wall and gate reduction at Foreign Lords and Bloodcrow castles. The bot does not read legendary skills yet, so it may send a few more tools than needed there.

A dry run sends no spies and opens no screen. It writes the `csm` it would send to the log, and plans wave 1 against the target's map entry alone.

## Evidence and confidence

| Fact | Confidence | Confirm with |
|---|---|---|
| `lta` gets no reply on success, and `rpr` drops below the cap within a second | high | Our capture `khan-20261122.json` |
| The `dfw` sides carry `UP` | high | Our capture: 30, 40, 30 |
| The attack screen commands by area type (`adi`, `abi`, `aci`, none for 24) | medium | One `adi` on a baron and one `abi` on a fortress on the test account |
| The screen reply's `SCID`, `gui.I`, `gaa.AI`, `gli.C` and `AE` | medium | The same captures: compare `gui.I` with the castle list |
| Refused screens mean "not ready" | medium | A screen on a camp still cooling down |
| `AC` rises only with accepted attacks; the game's day boundary | low | `gai` before and after a few attacks, and across midnight UTC |
| `CANT_START_NEW_ARMIES` holds the account about 30 minutes | medium | Lazy Lord's logs only |
| `bossdungeons.playerCooldownDelay` closes a fortress to its attacker | medium | Hit one fortress and look at it the next day |
| A fortress's level is `extraData[1]` | medium | One fortress look |
| Glory `extraData[2]` is the seconds until a castle is back | medium | Look at a castle just beaten |
| The glory castle level is `extraData[0]` | low | One Foreign Lords look, compared with its attack screen |
| Defenders in the `dfc` reply's `gui.I` | low | Our capture's `gui.I` held tools only. Read `dfc` on an account with defensive troops in storage. |
| 10 tools per slot for each Khan army on its way | low | Lazy Lord's reasoning, not measured |
| `gam` lists every movement of the player | medium | One `gam` with a march out |
| Achievement-unlocked tiers (`vli` `FA`, `unlocksDifficulty`) | medium | `sede` on a tier unlocked by achievement |
| `amountPerWave`, `canBeUsedToAttackNPC`, effect type 156 | medium | Lazy Lord's reading of the client |
| Spy report types 3 and 4 and their header | medium | One spy report in a trace |
| `sne` entry fields 7 and 8 are archived and forwarded | low | Archive one report while recording |
| The attack screen's `S` and `B.AIE` after a spy, and their sections | medium | Lazy Lord's source; one spy and attack screen on a Khan camp on the test account |
| Wall, gate and moat at `gaa.AI` 6 to 8, 10 to 12 (Khan) and 9 to 11 (Daimyo) | medium | Lazy Lord's source; our Daimyo capture fits. One Khan camp `adi` |
| The ranged defence base of 100 and the bonuses 10004 and 10007 | low | Lazy Lord's source, checked by them against the game with two commanders |
| The `csm` movement's `TT - PT` is the spies' trip | medium | Our Berimond capture's `TT` 1 s; one home-kingdom spy on the test account |
