# Glory banners and attack slots

A glory banner is a tool whose `fameBonus` raises the glory an attack earns. This page lists those tools and the three places a `cra` can carry tools: the wave tool slots, the support tools (`AST`) and the courtyard wave (`RW`).

## Bonus field

The items field is `fameBonus`, in whole percent. The client stores it times 0.01 (`ToolUnitVO`, G@875670). `data/fame-tools.tsv` lists all 53 tools that carry it. These are the ones a player is most likely to own:

| `wodID` | Name | Bonus | Cost |
|---|---|---|---|
| 660 | Flag | +1% | 125 coins, siege workshop level 2 |
| 661 | Banner | +2% | 21 rubies, siege workshop level 2 |
| 77 | Elite banner | +3% | 34 rubies |
| 24 | Champion banner | +4% | 46 rubies |
| 152, 153 | Royal and king's banners | +6%, +8% | 67, 84 rubies |
| 239, 240 | Viscount and emperor's banners | +9%, +10% | 105, 131 rubies |
| 474, 475, 476 | High queen's, high king's and supreme monarch's banners | +11% to +13% | 150 to 187 rubies |
| 774 | Invasion banner (`AlienInvasionAntiBanner`) | +4% | Event tool, camps 21 and 34 only |
| 564, 566 | Invasion ram and shields | +9% | Event tools, camps 21 and 34 only, used up in battle |

Several elite rams, ladders, bundles and shields also carry a `fameBonus` of 2% to 8%.

## Which banners an invader camp accepts

`AttackHelper` (G@1105049) lets a tool attack a target when `canBeUsedToAttackNPC` is 1, or the target belongs to a player, or the target is an invader camp (`AAlienInvasionMapobjectVO`). Banners marked `canBeUsedToAttackNPC: 0` therefore work on Foreign Lords and Bloodcrow camps. A tool's `allowedToAttack` limits it further: `0+21#0+34` means kingdom 0, area type 21 or 34.

## Wave tool slots

Banners go in a wave's tool lists, the same lists that hold ladders and rams. `getWaveInfoObject` (G@11538739) builds each wave as:

| Field | Holds |
|---|---|
| `L.T`, `M.T`, `R.T` | Tool slots for the left flank, the front and the right flank, each `[wodID, amount]` |
| `L.U`, `M.U`, `R.U` | Unit slots, each `[wodID, amount]` |

A tool's `slotTypes` says where it fits. Type 1 is a front tool slot and type 2 a flank tool slot (`SLOT_TYPE_MIDDLE_TOOL`, `SLOT_TYPE_FLANK_TOOL`, D@2488897). Banners have `1,2,9`, so they fit any tool slot. Rams have `1,9`, so they fit the front only.

`getAttackInfo` in `plugins/attack/attack.js` opens a slot only when the target level reaches the slot's unlock level:

| Side | Tool slots, by target level | Unit slots, by target level |
|---|---|---|
| Left and right flank | 1, and a second at 37 | 1, and a second at 13 |
| Front | 1, a second at 11 and a third at 37 | 2, then 4 at 13 and 6 at 26 |

Every tool in a wave shares that side's tool cap, `getTotalAmountToolsFlank` or `getTotalAmountToolsFront`.

## Support tools (`AST`)

`AST` is a list of 3 offence support tool `wodID`s, with -1 for an empty slot (`ATTACK_SUPPORT_TOOL_SLOTS=3`, D@2488806). The client fills it from `toolsSupportWodIds` (G@3649298). Each id counts as one tool (`parseSupportTools`, G@7818789). An offence support tool has slot type 10 (`SLOTTYPE_TOOL_SUPPORT_OFFENSE`, G@891241). Banners do not go here.

## Courtyard wave (`RW`)

`RW` is the courtyard wave: 8 unit slots, each `[wodID, amount]`, with `[-1, 0]` for an empty slot (`REINFORCEMENT_WAVE_UNIT_SLOTS=8` and `REINFORCEMENT_WAVE_TOOL_SLOTS=0`, D@2488806). The client fills it from `yardWaveContainer.getSlotList(true)` (G@2478779). The courtyard wave holds no tools.

## What the bot sends today

`getAttackInfo` sends `AST: [-1, -1, -1]` and eight `[-1, 0]` slots in `RW`. Each attack plugin then fills the `RW` slots with `assignUnit`. No plugin sends a support tool. `fixtures/protocol/cra-banner-wave.json` shows a `cra` with banners (661) in both flank tool slots.

## Evidence and confidence

| Fact | Confidence | Confirm with |
|---|---|---|
| `fameBonus` is the field, in whole percent | high | |
| Banners with `canBeUsedToAttackNPC: 0` are accepted on invader camps | high on the client, medium on the server | One Foreign Lords attack with 1 Flag (660). |
| Banners go in the wave tool slots, not `AST` | high | |
| `AST` is 3 `wodID`s, `RW` is 8 `[wodID, amount]` slots | high | |
| How banner bonuses stack across slots and waves | low | One Foreign Lords attack with 1 Flag (660), then one without, comparing the `pep` deltas. |
| Meaning of slot type 9 | low | Not needed by any planned plugin. |
