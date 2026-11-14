---
name: commander-pool
description: Formal check (TLA+ model plus a conformance run of the real code) that GGE-BOT's attack plugins never lend one commander to two attacks and never send a commander that is out on a march. Use before and after any change to plugins/commander.js, to waitToAttack in plugins/attack/attack.js, to how an attack plugin borrows or frees a commander (waitForCommanderAvailable, freeCommander, useCommander), or to the movement "outgoing"/"return" events in protocols.js. Also use when debugging LORD_IS_USED errors or a bot that pauses with "tooManyImportantErrors".
---

# Commander pool verification

The code and the harness live in `packages/bot-core/`. Paths below are relative to that folder unless they start with `packages/`.

## What it checks

Every attack plugin borrows commanders from one pool in `plugins/commander.js`. The check proves four rules for every order in which the plugins' steps can interleave, within the bounds below:

| Rule | Plain sentence | Harm when broken |
|---|---|---|
| `NoDoubleBooking` | Two attack loops never hold the same commander at once. | Both send it. The second gets `LORD_IS_USED`. |
| `NoBusyLordSent` | The bot never sends an attack with a commander that is out on a march. | `LORD_IS_USED`. `ggeBot.js:89-104` counts it, and at 8 it pauses the websocket, so the bot stops. |
| `NoStrandedWaiter` | No loop waits while a commander sits free. | An attack plugin stalls forever. |
| `NoLeakedLord` | Every commander marked in use is out on a march or held by a loop. | That commander is never freed. The pool shrinks until plugins stall. |

## Run it

```sh
pnpm test:formal   # from the repo root; runs packages/bot-core/verification/commander-pool/check.sh
```

The check needs Java 11+ and Node. The first run downloads `tla2tools.jar` 1.7.4 to `~/.cache/gge-bot-tla/` and checks its SHA-256. The script reads `TLA2TOOLS_JAR` if the jar is somewhere else. A full run takes about 40 s.

The script runs two layers and compares each result with the `EXPECTED` table inside it:

1. **`conformance.js`** loads the real `plugins/commander.js` with the game connection stubbed out. It checks seven facts the model relies on, such as "freeCommander wakes only the first waiter". If you edit `commander.js`, this layer notices on its own.
2. **TLC** checks each rule on three groups of runs:
   - `code-as-is` models the code as it is: one Khan-shaped loop and two sendHit-shaped loops.
   - `sendHit-loops-only` has no Khan-shaped loop.
   - Four `broken:` variants each must fail their rule. They prove the rules can fail.

   Each group also has a `Deadlock` row: TLC checks that the model always has a next step. A deadlock means every loop is stuck, which usually comes with a `NoStrandedWaiter` or `NoLeakedLord` break.

Exit 0 means every result matches `EXPECTED`. Exit 1 prints a `DIFF` line for each result that changed and saves TLC's output under `verification/commander-pool/out/`, which git ignores.

Read every TLC result, passing or failing, with the pstack `/statechart` skill. On a violation it gives the shortest path to the broken rule in plain words. On a pass it draws how the pool moves between states. Give `/statechart` `verification/commander-pool/CommanderPool.tla` and `CommanderPool.cfg` (that config is the `code-as-is` run with all four rules).

## Findings

**Fixed: Khan-shaped loops double-booked commanders (`NoDoubleBooking`, `NoBusyLordSent`).** `attackKhan`, `attackNomads`, `attackSamurai` and `attackBerimondInvasion` free a commander and then `continue` back to `waitForCommanderAvailable` in the same synchronous run. `freeCommander` handed that commander to a waiting loop through `resolve()`, but the waiter only marked it used one microtask later, so the same-run re-acquire took it too. The second send got `LORD_IS_USED`, and its handler passed the busy commander on to the next waiter. The listener now calls `useCommander` before `resolve()` (`commander.js:93`). `conformance.js` reports `sameRunReacquireGetsWokenCommander: false`, and TLC finds all four rules hold for `code-as-is`. The `broken:wake-skips-useCommander` run models the old code and must keep failing both rules.

These are findings, not modeling errors. Don't weaken a rule or the model to make them pass.

## Does my change touch the verified code?

These files and functions were last confirmed to match the model at sync commit **`1bf623d63252576f05233bac46d74a1ddb35ed38`**.

| Code | Model |
|---|---|
| `plugins/commander.js`: `freeCommander`, `useCommander`, `waitForCommanderAvailable`, the `movementEvents` "outgoing"/"return" handlers | `FreeState`, `Acquired`, `Resume`, `MarchReturns`, the "outgoing" mark in `Respond` |
| `plugins/attack/attack.js`: `waitToAttack` (one callback at a time; sleep only after a truthy result) | `Run`, `queueSleeping`, `QueueWakes` |
| `attackKhan.js:205-458`, `attackNomads.js:171-415`, `attackSamurai.js:161-403`, `attackBerimondInvasion.js:113-355` (loop shape) | `LoopPlugins`, the loop branch of `React` |
| `sharedBarronAttackLogic.js:85-310`, `sharedFortressAttackLogic.js:25-152`, `attackStormForts.js:161-310` (sendHit shape) | the other branches of `React`, `Reacquire` |
| `protocols.js:1176-1215` (`newMovement`, "outgoing"/"return" emits), `protocols.js:1291-1295` (`cra` handler) | `Respond`, `MarchReturns` |
| `ggeBot.js:89-104` (`checkForIssues`) | the harm behind `NoBusyLordSent` |

To see what changed since the sync commit:

```sh
git diff -M 1bf623d63252576f05233bac46d74a1ddb35ed38 -- plugins/commander.js plugins/attack/ protocols.js ggeBot.js \
  packages/bot-core/plugins/commander.js packages/bot-core/plugins/attack/ packages/bot-core/protocols.js packages/bot-core/ggeBot.js
```

A new attack plugin that borrows commanders is covered code too. Add it to the table under the shape it uses.

## When a result changes

1. **`conformance.js` DIFF.** `commander.js` no longer behaves the way the model assumes. Read the check in `conformance.js`. Each one names the model step it backs. Then update that step in `CommanderPool.tla` to match the new code. A fix for finding 1 flips `sameRunReacquireGetsWokenCommander` to false. Then make `Resume` part of `FreeState` (or whatever the fix does), and set `code-as-is / NoDoubleBooking` to `holds` in `EXPECTED`.
2. **TLC DIFF on `code-as-is` or `sendHit-loops-only`.** Read the path with `/statechart`. Walk each step against the code it cites. If a step does something the code can't do, the model is wrong: fix the model and say so. If every step matches the code, it is a real bug: report it as a numbered path in the code's words, and leave `EXPECTED` as it is until the user decides.
3. **A `broken:` variant now holds.** The model no longer has a way to break that rule, so the rule has stopped checking anything. Fix the model until the variant fails again.
4. **`tlc-error` or `type-error`.** The spec or a config is malformed. Read the saved TLC output.

When you change covered code on purpose, mirror the change in `CommanderPool.tla` before running. The model doesn't read the JavaScript. Keep every comment's file:line pointer accurate. One TLA+ step must stay one synchronous run of JavaScript: a step ends wherever the code awaits.

## Scope

Verified: two commanders, three attack loops (one Khan-shaped, two sendHit-shaped, plus a run with all three sendHit-shaped), every interleaving of their steps, 16,508 distinct states, all explored.

The model assumes, and does not check:
- **No commander whitelists.** Every loop accepts every commander (`commanderWhiteList` empty, the default). With whitelists, `freeCommander` skips waiters that reject the commander. That isn't modeled.
- **A woken waiter resumes before any other already-queued job.** In Node it resumes one microtask later, so a job queued before the wake-up could run first. The model doesn't explore that order, so it can miss a double booking that depends on it.
- **No one else moves commanders.** The player playing by hand or a second bot on the account would cause `LORD_IS_USED` that the model never sees.
- **The server answers every `cra`.** A reply that comes after `waitForResult`'s timeout (`TIMED_OUT`, then a late success) isn't modeled.
- **Commanders are loaded** (`gli` has arrived), and the commander list doesn't change while plugins run.

Not covered: the troop math in `getAttackInfo`/`assignUnit`, the attack-limit check in `waitToAttack`, target selection, and the `dms` handler in `protocols.js` (a deleted movement emits `return`, which frees its commander; the model's `MarchReturns` covers the effect).

## Keeping in step

Move the sync commit forward only after you have confirmed that the model and the coverage table describe the code at the new commit. Running the check green isn't enough. Edit the commit in two places in this file, in "Does my change touch the verified code?" and in the `git diff` command. If covered code changed without anyone rechecking it, use `/maintain-formal-verification-skill`.
