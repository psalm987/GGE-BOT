import { useQuery } from "@tanstack/react-query"
import { Form, Segmented, Select } from "antd"
import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { emptyPlan, type ArmyMode, type AutofillSource, type GamePreset, type ManualPlan, type PluginOptionDef, type VirtualPreset, type WavePlan } from "@gge/contracts"
import { orpc } from "../api.ts"
import { autofillOf, planCounts } from "../army-values.ts"
import type { OptionValues } from "../plugin-values.ts"
import { WavePlanEditor } from "./WavePlanEditor.tsx"
import "./army.css"

/** The autofill of a plugin in one line, such as "L·F·R+CY · 4w · Wall tools". */
function useAutofillSummary() {
    const { t } = useTranslation("client")
    const { t: tb } = useTranslation("bot")
    return (source: AutofillSource, defs: PluginOptionDef[], values: OptionValues) => {
        const autofill = autofillOf(source, defs, values)
        const flanks = autofill.sides.filter(side => side !== "courtyard").map(side => t(`army.short.${side}`)).join("·")
        const sides = [flanks, autofill.sides.includes("courtyard") ? t("army.short.courtyard") : ""].filter(Boolean).join("+")
        return [
            sides || t("army.summary.noSides"),
            autofill.waves === "all" ? t("army.summary.allWaves") : t("army.summary.waves", { n: autofill.waves }),
            autofill.tools.length ? autofill.tools.map(key => tb(key, { defaultValue: key })).join(", ") : source.whenNoTools ? tb(source.whenNoTools) : t("army.summary.noTools"),
        ].join(" · ")
    }
}

/** The account's virtual presets; none while no account is picked. */
export function useVirtualPresets(accountId: string | undefined): VirtualPreset[] {
    return useQuery({ ...orpc.virtualPresets.list.queryOptions({ input: { accountId: accountId ?? "" } }), enabled: accountId !== undefined }).data ?? []
}

/** The in-game presets the bot last saw the game list for the account; none until it has read them. */
export function useGamePresets(accountId: string | undefined): GamePreset[] {
    const accounts = useQuery({ ...orpc.accounts.list.queryOptions(), enabled: accountId !== undefined })
    return accounts.data?.find(account => account.id === accountId)?.status?.gamePresets ?? []
}

/** A wave plan in one line. */
function usePlanSummary(presets: VirtualPreset[]) {
    const { t } = useTranslation("client")
    return (plan: WavePlan | undefined | null) => {
        if (!plan) return t("army.summary.noPlan")
        if (plan.kind === "manual") return t("army.summary.plan", planCounts(plan))
        const preset = presets.find(p => p.id === plan.presetId)
        return preset ? t("army.summary.virtual", { name: preset.name }) : t("army.summary.virtualMissing")
    }
}

/**
 * The Autofill or Waves switch of a plugin, with a line that sums up the side that is on. It reads the plugin's other
 * options from the form around it. `wavesKey` is the plugin's Waves option.
 */
export function ArmyModeField({ value = "autofill", onChange, label, source, defs, wavesKey, accountId }: {
    value?: ArmyMode; onChange?: (mode: ArmyMode) => void; label: string; source: AutofillSource; defs: PluginOptionDef[]; wavesKey: string | undefined; accountId: string | undefined
}) {
    const { t } = useTranslation("client")
    const form = Form.useFormInstance<{ options: OptionValues }>()
    const options = Form.useWatch("options", form) ?? {}
    const autofillSummary = useAutofillSummary()
    const planSummary = usePlanSummary(useVirtualPresets(accountId))
    const plan = wavesKey === undefined ? undefined : options[wavesKey] as WavePlan | undefined
    return (
        <div className="gge-army-mode">
            <Segmented<ArmyMode> aria-label={label} value={value} onChange={onChange}
                options={[{ value: "autofill", label: t("army.mode.autofill") }, { value: "waves", label: t("army.mode.waves") }]} />
            <p className="gge-army-summary" data-army-summary>{value === "autofill" ? autofillSummary(source, defs, options) : planSummary(plan)}</p>
        </div>
    )
}

/**
 * A plugin's wave plan: written here, or one of the account's virtual presets. An unset option shows an empty plan,
 * which is saved once the player changes it. While the plugin is on Autofill the field is `collapsed` and draws
 * nothing, so a page of several plugins stays light.
 */
export function WavesField({ value, onChange, id, collapsed, accountId }: {
    value?: WavePlan | null; onChange?: (plan: WavePlan) => void; id?: string; collapsed: boolean; accountId: string | undefined
}) {
    const { t } = useTranslation("client")
    const presets = useVirtualPresets(accountId)
    const gamePresets = useGamePresets(accountId)
    // The plan written here survives a look at the virtual presets and back.
    const written = useRef<ManualPlan | null>(null)
    if (value?.kind === "manual") written.current = value
    if (collapsed) return null
    const source = value?.kind === "virtual" ? "virtual" : "manual"
    const known = value?.kind === "virtual" && presets.some(preset => preset.id === value.presetId)
    function pickSource(next: "manual" | "virtual") {
        if (next === source) return
        if (next === "manual") return onChange?.(written.current ?? emptyPlan())
        if (presets[0]) onChange?.({ kind: "virtual", presetId: presets[0].id })
    }
    return (
        <div id={id} className="gge-army">
            <div className="gge-army-row">
                <Segmented<"manual" | "virtual"> aria-label={t("waves.source.label")} value={source} onChange={pickSource}
                    options={[{ value: "manual", label: t("waves.source.manual") }, { value: "virtual", label: t("waves.source.virtual"), disabled: presets.length === 0 }]} />
                <Link to={accountId ? `/m/virtual-presets?account=${accountId}` : "/m/virtual-presets"}>{t("waves.source.manage")}</Link>
            </div>
            {presets.length === 0 && <p className="gge-army-note">{t("waves.source.none")}</p>}
            {value?.kind === "virtual"
                ? <>
                    <Select aria-label={t("waves.source.pick")} value={known ? value.presetId : undefined} placeholder={t("army.summary.virtualMissing")} status={known ? undefined : "error"}
                        options={presets.map(preset => ({ value: preset.id, label: preset.name }))} onChange={(presetId: string) => onChange?.({ kind: "virtual", presetId })}
                        style={{ width: "100%", maxWidth: 360 }} />
                    <p className="gge-army-note">{t("waves.source.virtualNote")}</p>
                </>
                : <WavePlanEditor value={value?.kind === "manual" ? value : emptyPlan()} onChange={next => onChange?.(next)} gamePresets={gamePresets} />}
        </div>
    )
}
