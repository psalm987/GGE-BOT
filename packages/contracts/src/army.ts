import * as z from "zod"

/**
 * The army an attack plugin sends. A plugin either fills it by its own rules (autofill) or follows a wave plan the
 * player wrote. packages/bot-core/plugins/attack/army.js parses the same shapes in plain JavaScript, and
 * packages/bot-core/test/army-contract.test.mjs holds the two to the same answers.
 */
export const ARMY_MODES = ["autofill", "waves"] as const
export const ArmyMode = z.enum(ARMY_MODES)
export type ArmyMode = z.infer<typeof ArmyMode>

export const ARMY_SIDES = ["left", "front", "right", "courtyard"] as const
export const ArmySide = z.enum(ARMY_SIDES)
export type ArmySide = z.infer<typeof ArmySide>

/** The order autofill takes troops in. "castle" is the order the castle lists them, as the bot always did. */
export const UNIT_ORDERS = ["castle", "fastest", "strongest", "weakest"] as const
export const UnitOrder = z.enum(UNIT_ORDERS)
export type UnitOrder = z.infer<typeof UnitOrder>

/** Which troops autofill may take, by what they eat. */
export const TROOP_SUPPLIES = ["all", "food", "mead"] as const
export const TroopSupply = z.enum(TROOP_SUPPLIES)
export type TroopSupply = z.infer<typeof TroopSupply>

/** The game's time skips, in minutes. */
export const SKIP_MINUTES = [1, 5, 10, 30, 60, 300, 1440] as const
/** The skips one plugin may spend; null follows the account's Skips settings. */
export const SkipTypes = z.array(z.union(SKIP_MINUTES.map(minutes => z.literal(minutes)))).max(SKIP_MINUTES.length)
    .refine(list => new Set(list).size === list.length, "holds a skip twice").nullable()
export type SkipTypes = z.infer<typeof SkipTypes>

/**
 * How a plugin fills an army by itself. It is a view worked out from the plugin's own options (see AutofillSource),
 * never stored: `tools` are the labels of the tool options that are on.
 */
export const Autofill = z.object({
    sides: z.array(ArmySide),
    waves: z.union([z.number().int().min(1), z.literal("all")]),
    tools: z.array(z.string()),
    unitOrder: UnitOrder,
    supply: TroopSupply,
    minTroops: z.number().int().min(0),
})
export type Autofill = z.infer<typeof Autofill>

export const SERVER_PRESETS = 30
export const MAX_WAVES = 4
export const SUPPORT_TOOL_SLOTS = 3
export const COURTYARD_SLOTS = 8
export const MAX_SLOT_AMOUNT = 100_000
/** The slots a wave has on each side once the target's level opens them all. */
export const WAVE_SLOTS = { left: { tools: 2, units: 2 }, front: { tools: 3, units: 6 }, right: { tools: 2, units: 2 } } as const
export const WAVE_SIDES = ["left", "front", "right"] as const
export type WaveSide = typeof WAVE_SIDES[number]

const ItemId = z.number().int().positive()
/** A game item by its wodID and how many to send; null leaves the slot empty. The bot never sends more than the side holds. */
export const ArmySlot = z.object({ item: ItemId, amount: z.number().int().min(1).max(MAX_SLOT_AMOUNT) }).nullable()
export type ArmySlot = z.infer<typeof ArmySlot>

const flank = ({ tools, units }: { tools: number; units: number }) =>
    z.object({ tools: z.array(ArmySlot).length(tools), units: z.array(ArmySlot).length(units) })
export type Flank = z.infer<ReturnType<typeof flank>>

/** One wave: one of the player's in-game presets (0 is the empty one), or slots written out side by side. */
export const Wave = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("preset"), preset: z.number().int().min(0).max(SERVER_PRESETS) }),
    z.object({ kind: z.literal("custom"), left: flank(WAVE_SLOTS.left), front: flank(WAVE_SLOTS.front), right: flank(WAVE_SLOTS.right) }),
])
export type Wave = z.infer<typeof Wave>

/** Waves 1 to 4 (the fourth repeats for any wave after it), the support tools and the courtyard. */
export const ManualPlan = z.object({
    kind: z.literal("manual"),
    waves: z.array(Wave).length(MAX_WAVES),
    ast: z.array(ItemId.nullable()).length(SUPPORT_TOOL_SLOTS),
    rw: z.array(ArmySlot).length(COURTYARD_SLOTS),
})
export type ManualPlan = z.infer<typeof ManualPlan>

/** A plan written here, or one of the account's virtual presets, which the runner swaps for its plan before a bot starts. */
export const WavePlan = z.discriminatedUnion("kind", [
    ManualPlan,
    z.object({ kind: z.literal("virtual"), presetId: z.uuid() }),
])
export type WavePlan = z.infer<typeof WavePlan>

export const Army = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("autofill"), autofill: Autofill }),
    z.object({ mode: z.literal("waves"), waves: WavePlan }),
])
export type Army = z.infer<typeof Army>

const emptyFlank = ({ tools, units }: { tools: number; units: number }): Flank =>
    ({ tools: Array<ArmySlot>(tools).fill(null), units: Array<ArmySlot>(units).fill(null) })
export const emptyWave = (): Wave => ({ kind: "preset", preset: 0 })
export const emptyCustomWave = (): Extract<Wave, { kind: "custom" }> =>
    ({ kind: "custom", left: emptyFlank(WAVE_SLOTS.left), front: emptyFlank(WAVE_SLOTS.front), right: emptyFlank(WAVE_SLOTS.right) })
export const emptyPlan = (): ManualPlan => ({
    kind: "manual",
    waves: Array.from({ length: MAX_WAVES }, emptyWave),
    ast: Array<number | null>(SUPPORT_TOOL_SLOTS).fill(null),
    rw: Array<ArmySlot>(COURTYARD_SLOTS).fill(null),
})

const slotsOf = (wave: Wave) => wave.kind === "custom" ? WAVE_SIDES.flatMap(side => [...wave[side].tools, ...wave[side].units]) : []
/** Whether a wave sends anything: a preset other than the empty one, or a custom wave with a filled slot. */
export const waveIsEmpty = (wave: Wave) => wave.kind === "preset" ? wave.preset === 0 : slotsOf(wave).every(slot => slot === null)
/** The in-game presets a plan names. The bot can only send those it has seen the game list. */
export const serverPresetsIn = (plan: ManualPlan) => [...new Set(plan.waves.flatMap(wave => wave.kind === "preset" && wave.preset > 0 ? [wave.preset] : []))]

/** A virtual preset: a named plan the account's attack modules can pick. */
export const VirtualPresetName = z.string().trim().min(1).max(60)
export const VirtualPreset = z.object({
    id: z.uuid(),
    accountId: z.uuid(),
    name: VirtualPresetName,
    plan: ManualPlan,
    createdAt: z.date(),
    updatedAt: z.date(),
})
export type VirtualPreset = z.infer<typeof VirtualPreset>
export const CreateVirtualPreset = z.object({ accountId: z.uuid(), name: VirtualPresetName, plan: ManualPlan })
export const UpdateVirtualPreset = z.object({ id: z.uuid(), name: VirtualPresetName, plan: ManualPlan })
/** How many virtual presets one account keeps. */
export const MAX_VIRTUAL_PRESETS = 30

const key = z.string().min(1)
/**
 * Where a plugin's autofill reads from, so the settings page can sum it up in a line. A side is the Checkbox that turns it
 * on, or true when the plugin always fills it. `waves` is a number option, or a fixed count. `tools` are Checkbox and
 * Select options whose chosen label names the tools. `whenNoSides` is what the plugin fills while every side is off.
 * `whenNoTools` names, as a bot label, what the plugin sends while no tool option is on.
 */
export const AutofillSource = z.object({
    sides: z.partialRecord(ArmySide, z.union([key, z.literal(true)])),
    whenNoSides: z.array(ArmySide).optional(),
    waves: z.union([key, z.number().int().min(1), z.literal("all")]),
    tools: z.array(key),
    whenNoTools: key.optional(),
    unitOrder: key.optional(),
    supply: key.optional(),
    minTroops: key.optional(),
})
export type AutofillSource = z.infer<typeof AutofillSource>
