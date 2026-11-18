import { Alert, Collapse, InputNumber, Segmented, Select, Tag } from "antd"
import { useTranslation } from "react-i18next"
import {
    MAX_SLOT_AMOUNT, WAVE_SIDES, WAVE_SLOTS, emptyCustomWave, emptyWave, serverPresetsIn, waveIsEmpty,
    type ArmySlot, type GameItem, type ManualPlan, type Wave,
} from "@gge/contracts"
import { filledSlots, withCourtyard, withSlot, withSupportTool, withWave } from "../army-values.ts"
import { useGameItems } from "./PluginOptionField.tsx"
import "./army.css"

type ItemOption = { value: number; label: string }
const TOOL_AMOUNT = 10
const TROOP_AMOUNT = 100

type Catalog = ReturnType<typeof useGameItems>
/** The choices of an item select: the catalogs' items by name, plus the slot's own item when they lack it. */
function itemOptions(unknown: (id: number) => string, ...catalogs: Catalog[]) {
    const options: ItemOption[] = catalogs.flatMap(({ items, nameOf }) => items.map((item: GameItem) => ({ value: item.id, label: nameOf(item) })))
    const known = new Set(options.map(option => option.value))
    return (current: number | null | undefined) =>
        current === null || current === undefined || known.has(current) ? options : [...options, { value: current, label: unknown(current) }]
}

function ItemPicker({ options, value, onChange, label, disabled }: { options: ItemOption[]; value: number | null; onChange: (item: number | null) => void; label: string; disabled?: boolean }) {
    const { t } = useTranslation("client")
    return <Select allowClear showSearch={{ optionFilterProp: "label" }} aria-label={label} placeholder={t("waves.slot.empty")} disabled={disabled}
        value={value ?? undefined} options={options} onChange={(item?: number) => onChange(item ?? null)} style={{ width: "100%", minWidth: 0 }} />
}

/** One slot: a game item and how many of it. */
function SlotField({ optionsFor, value, onChange, label, startAmount, disabled }: {
    optionsFor: (current: number | null | undefined) => ItemOption[]; value: ArmySlot; onChange: (slot: ArmySlot) => void; label: string; startAmount: number; disabled?: boolean
}) {
    const { t } = useTranslation("client")
    return (
        <div className="gge-army-slot">
            <ItemPicker options={optionsFor(value?.item)} value={value?.item ?? null} label={label} disabled={disabled}
                onChange={item => onChange(item === null ? null : { item, amount: value?.amount ?? startAmount })} />
            <InputNumber aria-label={t("waves.slot.amount", { slot: label })} min={1} max={MAX_SLOT_AMOUNT} precision={0} disabled={disabled || !value}
                value={value?.amount ?? null} onChange={amount => value && amount && onChange({ ...value, amount })} style={{ width: "100%" }} />
        </div>
    )
}

function WaveTag({ wave }: { wave: Wave }) {
    const { t } = useTranslation("client")
    if (waveIsEmpty(wave)) return <Tag>{t("waves.tag.empty")}</Tag>
    return <Tag color="gold">{wave.kind === "preset" ? t("waves.tag.preset", { n: wave.preset }) : t("waves.tag.custom", { n: filledSlots(wave) })}</Tag>
}

/**
 * The wave plan editor: waves 1 to 4, each an in-game preset or custom slots, then the support tools and the courtyard.
 * The same editor writes a module's own plan and a virtual preset.
 */
export function WavePlanEditor({ value, onChange, disabled }: { value: ManualPlan; onChange: (plan: ManualPlan) => void; disabled?: boolean }) {
    const { t } = useTranslation("client")
    const unknown = (id: number) => t("plugins.list.unknownItem", { id })
    const tools = itemOptions(unknown, useGameItems("tool"), useGameItems("banner"))
    const troops = itemOptions(unknown, useGameItems("troop"))
    const supportTools = itemOptions(unknown, useGameItems("supportTool"))
    const presetOptions = (current: number) => [{ value: 0, label: t("waves.preset.empty") }, ...(current > 0 ? [{ value: current, label: t("waves.preset.option", { n: current }) }] : [])]

    const panel = (wave: Wave, index: number) => {
        const n = index + 1
        const set = (next: Wave) => onChange(withWave(value, index, next))
        return (
            <div className="gge-army">
                <Segmented<Wave["kind"]> aria-label={t("waves.kind.label", { n })} value={wave.kind} disabled={disabled}
                    onChange={kind => set(kind === "preset" ? emptyWave() : emptyCustomWave())}
                    options={[{ value: "preset", label: t("waves.kind.preset") }, { value: "custom", label: t("waves.kind.custom") }]} />
                {wave.kind === "preset"
                    ? <>
                        <Select aria-label={t("waves.preset.label", { n })} value={wave.preset} options={presetOptions(wave.preset)} disabled={disabled}
                            onChange={(preset: number) => set({ kind: "preset", preset })} style={{ width: "100%", maxWidth: 360 }} />
                        <p className="gge-army-note">{t("waves.preset.note")}</p>
                    </>
                    : <div className="gge-army-sides">
                        {WAVE_SIDES.map(side => (
                            <fieldset key={side} className="gge-army-side">
                                <legend>{t(`army.side.${side}`)}</legend>
                                {(["tools", "units"] as const).map(row => (
                                    <div key={row} className="gge-army-slots">
                                        <span className="gge-army-note">{t(`waves.row.${row}`)}</span>
                                        {Array.from({ length: WAVE_SLOTS[side][row] }, (_, i) => (
                                            <SlotField key={i} optionsFor={row === "tools" ? tools : troops} value={wave[side][row][i] ?? null} disabled={disabled}
                                                startAmount={row === "tools" ? TOOL_AMOUNT : TROOP_AMOUNT}
                                                label={t(`waves.slot.${row}`, { wave: n, side: t(`army.side.${side}`), n: i + 1 })}
                                                onChange={slot => set(withSlot(wave, side, row, i, slot))} />
                                        ))}
                                    </div>
                                ))}
                            </fieldset>
                        ))}
                    </div>}
            </div>
        )
    }

    return (
        <div className="gge-army">
            <p className="gge-army-note">{t("waves.intro")}</p>
            {serverPresetsIn(value).length > 0 && <Alert type="warning" showIcon title={t("waves.preset.warning")} />}
            <Collapse defaultActiveKey={value.waves.flatMap((wave, i) => waveIsEmpty(wave) ? [] : [i])}
                items={value.waves.map((wave, i) => ({
                    key: i, children: panel(wave, i),
                    label: <span className="gge-army-wave-head"><span>{t("waves.wave", { n: i + 1 })}</span><WaveTag wave={wave} /></span>,
                }))} />
            <section aria-label={t("waves.support.title")}>
                <h3 className="gge-army-heading gge-display">{t("waves.support.title")}</h3>
                <div className="gge-army-support">
                    {value.ast.map((item, i) => <ItemPicker key={i} options={supportTools(item)} value={item} disabled={disabled}
                        label={t("waves.support.slot", { n: i + 1 })} onChange={next => onChange(withSupportTool(value, i, next))} />)}
                </div>
            </section>
            <section aria-label={t("waves.courtyard.title")}>
                <h3 className="gge-army-heading gge-display">{t("waves.courtyard.title")}</h3>
                <div className="gge-army-courtyard">
                    {value.rw.map((slot, i) => <SlotField key={i} optionsFor={troops} value={slot} startAmount={TROOP_AMOUNT} disabled={disabled}
                        label={t("waves.courtyard.slot", { n: i + 1 })} onChange={next => onChange(withCourtyard(value, i, next))} />)}
                </div>
            </section>
            <p className="gge-army-note">{t("waves.amountHint")}</p>
        </div>
    )
}
