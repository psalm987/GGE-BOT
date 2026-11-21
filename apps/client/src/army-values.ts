import {
    ARMY_SIDES, MAX_WAVES, MIN_WAVES, TROOP_SUPPLIES, UNIT_ORDERS, WAVE_SIDES, emptyCustomWave, emptyWave, waveIsEmpty,
    type ArmySlot, type Autofill, type AutofillSource, type ManualPlan, type PluginOptionDef, type PluginSettings, type Wave, type WaveSide,
} from "@gge/contracts"
import type { OptionValues } from "./plugin-values.ts"

/**
 * A plugin's autofill, worked out from the option values on screen. `tools` holds the bot-catalog keys of the tool
 * options that are on: a ticked Checkbox's own key, or a Select's chosen text.
 */
export function autofillOf(source: AutofillSource, defs: PluginOptionDef[], values: OptionValues): Autofill {
    const picked = ARMY_SIDES.filter(side => {
        const from = source.sides[side]
        return from === true || (from !== undefined && values[from] === true)
    })
    const flanks = picked.filter(side => side !== "courtyard")
    const waves = typeof source.waves === "string" ? Number.parseInt(String(values[source.waves] ?? ""), 10) : source.waves
    const index = (key: string | undefined) => key === undefined ? -1 : Number(values[key] ?? 0)
    return {
        sides: flanks.length ? picked : source.whenNoSides ?? picked,
        waves: typeof waves === "number" && Number.isFinite(waves) && waves > 0 ? waves : "all",
        tools: source.tools.flatMap(key => {
            const def = defs.find(d => d.key === key)
            if (def?.type === "Checkbox") return values[key] === true ? [key] : []
            if (def?.type === "Select") return def.selection[Number(values[key] ?? 0)] ?? []
            return []
        }),
        unitOrder: UNIT_ORDERS[index(source.unitOrder)] ?? "castle",
        supply: TROOP_SUPPLIES[index(source.supply)] ?? "all",
        minTroops: Number(source.minTroops === undefined ? 0 : values[source.minTroops]) || 0,
    }
}

/** What a plan holds, for its one-line summary. */
export function planCounts(plan: ManualPlan) {
    return {
        waves: plan.waves.filter(wave => !waveIsEmpty(wave)).length,
        total: plan.waves.length,
        supportTools: plan.ast.filter(item => item !== null).length,
        courtyard: plan.rw.filter(slot => slot !== null).length,
    }
}

export const filledSlots = (wave: Wave) =>
    wave.kind === "custom" ? WAVE_SIDES.flatMap(side => [...wave[side].tools, ...wave[side].units]).filter(slot => slot !== null).length : 0

const replaced = <T>(list: T[], index: number, value: T) => list.map((item, i) => i === index ? value : item)

export const withWave = (plan: ManualPlan, index: number, wave: Wave): ManualPlan => ({ ...plan, waves: replaced(plan.waves, index, wave) })
/** A new empty wave at the end; a plan already at the limit comes back as it is. */
export const withAddedWave = (plan: ManualPlan): ManualPlan => plan.waves.length >= MAX_WAVES ? plan : { ...plan, waves: [...plan.waves, emptyWave()] }
/** The plan without one wave; the waves after it move up, and a plan always keeps one. */
export const withoutWave = (plan: ManualPlan, index: number): ManualPlan =>
    plan.waves.length <= MIN_WAVES ? plan : { ...plan, waves: plan.waves.filter((_, i) => i !== index) }
/** Every wave after `index` set to a copy of that wave. */
export const withWaveCopiedToRest = (plan: ManualPlan, index: number): ManualPlan =>
    ({ ...plan, waves: plan.waves.map((wave, i) => i > index ? structuredClone(plan.waves[index]!) : wave) })
export const withSupportTool = (plan: ManualPlan, index: number, item: number | null): ManualPlan => ({ ...plan, ast: replaced(plan.ast, index, item) })
export const withCourtyard = (plan: ManualPlan, index: number, slot: ArmySlot): ManualPlan => ({ ...plan, rw: replaced(plan.rw, index, slot) })

/** A custom wave with one slot changed. A preset wave becomes custom first. */
export function withSlot(wave: Wave, side: WaveSide, row: "tools" | "units", index: number, slot: ArmySlot): Wave {
    const custom = wave.kind === "custom" ? wave : emptyCustomWave()
    return { ...custom, [side]: { ...custom[side], [row]: replaced(custom[side][row], index, slot) } }
}

/** The plugins of an account whose stored settings send this virtual preset, whatever army mode they are on. */
export const pluginsSending = (plugins: PluginSettings, presetId: string) =>
    Object.entries(plugins).flatMap(([key, setting]) => Object.values(setting.options).some(value =>
        typeof value === "object" && value !== null && "kind" in value && value.kind === "virtual" && value.presetId === presetId) ? [key] : [])
