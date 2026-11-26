# Commander bonuses

A commander's bonuses decide how many troops fit on each flank, how fast it marches and what it loots. `protocols.js` computes them in `Lord`, the way the client's `LordVO.getUniqueBoni` collects them.

## Where the bonuses come from

| Source | Lord data | Game data |
|---|---|---|
| Gear | `EQ[i][5]`, `[[equipmentEffectID, value]]` | `equipment_effects`: `effectID`, and `ignoreCap` 1 for gear the cap does not limit |
| Relics | `EQ[i][5]` and the relic gem's `EQ[i][12][3][4]`, `[[relicEffectID, power, value]]`, when `EQ[i][11]` is 3 | `relicEffects` |
| Gems | `EQ[i][10]`, the gem id | `gems`: `effects` is a list of effect ids. A gem with `triggerChance` under 100 does not count. |
| Gear sets | `EQ[i][7]`, and a gem's `setID`, counted once per gem | `equipment_sets`: each `neededItems` threshold reached adds `effects`, a list of gear effect ids |
| The commander's own effects | `E` and `AE`, `[[effectID, [value], source]]` | |
| The assigned general | `GID`, matched to the generals list (`gie`), and its `SIDS` | `generalSkills`: `effects`, a list of effect ids |

The generals list is read each time the bonuses are computed, so a `gie` that comes after the commanders still counts. The old code compared the general's `GID` against `e.generalID`, a field the raw commander data does not have, so general skills never counted.

## Totals

`getEffects(areaType)` returns the totals by effect type name, such as `attackUnitAmountFlank`. For a target of `areaType`:

1. A bonus with an `areaTypeID` counts only against those area types.
2. A PvP-only bonus (`isPvPFight`) does not count against a target the game controls (barons, fortresses, watchtowers, Storm Islands, event camps, Khan and Daimyo). A PvE-only bonus (`isPvEFight`) does not count against a player.
3. The bonuses of one effect type that share a `capID` are capped together at `effectCaps.maxTotalBonus`. Gear that ignores the cap is added after.

`getEffects()` with no area type counts only the bonuses that apply everywhere, PvE and PvP alike. Callers that know the target should pass its `areaInfo.type`, or bonuses for that kind of target are left out.

## Facts and confidence

| Fact | Confidence | Source |
|---|---|---|
| The sources in the table above, `E` and `AE` included | high | Client: `LordVO.getUniqueBoni`, `LordVO.parseLord` (`_rawLordEffects = parseRawEffects(e.E)`, `areaEffects = parseRawEffects(e.AE)`) |
| Gem effects are effect ids, and set effects are gear effect ids | high | Game data: every gem effect id is in `effects`. Every set effect id is in `equipment_effects`, 18 only there. |
| A gem with `triggerChance` under 100 is set aside | high | Client: `LordVO.mergeBoni` |
| Capping per cap group, then adding gear that ignores the cap | medium | Lazy Lord's source, after the client's `mergeBoni`. Confirm against the attack screen's numbers (`gli`). |
| Which area types count as PvE | medium | Lazy Lord's source |
