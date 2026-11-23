import { useState } from "react"
import { Alert, Button, Collapse, InputNumber, Segmented, Select, Tag } from "antd"
import { useTranslation } from "react-i18next"
import {
    MAX_SLOT_AMOUNT, MAX_WAVES, MIN_WAVES, SERVER_PRESETS, WAVE_SIDES, WAVE_SLOTS, emptyCustomWave, emptyWave, serverPresetsIn, waveIsEmpty,
    type ArmySlot, type GameItem, type GamePreset, type ManualPlan, type Wave,
} from "@gge/contracts"
import { filledSlots, withAddedWave, withCourtyard, withSlot, withSupportTool, withWave, withWaveCopiedToRest, withoutWave } from "../army-values.ts"
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

function WaveTag({ wave, gamePresets }: { wave: Wave; gamePresets: GamePreset[] }) {
    const { t } = useTranslation("client")
    if (waveIsEmpty(wave)) return <Tag>{t("waves.tag.empty")}</Tag>
    if (wave.kind === "custom") return <Tag color="gold">{t("waves.tag.custom", { n: filledSlots(wave) })}</Tag>
    const name = gamePresets.find(preset => preset.preset === wave.preset)?.name
    return <Tag color="gold">{name ? t("waves.tag.presetNamed", { n: wave.preset, name }) : t("waves.tag.preset", { n: wave.preset })}</Tag>
}

/**
 * The wave plan editor: waves 1 to 25 (4 to begin with), each an in-game preset or custom slots, then the support tools and the courtyard.
 * The same editor writes a module's own plan and a virtual preset. `gamePresets` are the in-game presets the bot last
 * saw the game list for the account, which a wave can name.
 */
export function WavePlanEditor({ value, onChange, disabled, gamePresets = [] }: {
    value: ManualPlan; onChange: (plan: ManualPlan) => void; disabled?: boolean; gamePresets?: GamePreset[]
}) {
    const { t } = useTranslation("client")
    const unknown = (id: number) => t("plugins.list.unknownItem", { id })
    const tools = itemOptions(unknown, useGameItems("tool"), useGameItems("banner"))
    const troops = itemOptions(unknown, useGameItems("troop"))
    const supportTools = itemOptions(unknown, useGameItems("supportTool"))
    const names = new Map(gamePresets.map(({ preset, name }) => [preset, name]))
    // Every slot is offered, so a plan can be set up before the bot has read the game's list.
    const presetLabel = (n: number) => {
        const name = names.get(n)
        if (name) return t("waves.preset.named", { n, name })
        return gamePresets.length > 0 && !names.has(n) ? t("waves.preset.unlisted", { n }) : t("waves.preset.option", { n })
    }
    const presetOptions = [
        { value: 0, label: t("waves.preset.empty") },
        ...Array.from({ length: SERVER_PRESETS }, (_, i) => ({ value: i + 1, label: presetLabel(i + 1) })),
    ]
    const unlisted = gamePresets.length > 0 && serverPresetsIn(value).some(preset => !names.has(preset))

    const [open, setOpen] = useState<number[]>(() => value.waves.flatMap((wave, i) => waveIsEmpty(wave) ? [] : [i]))
    const removeWave = (index: number) => {
        onChange(withoutWave(value, index))
        setOpen(open.filter(i => i !== index).map(i => i > index ? i - 1 : i))
    }

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
                        <Select aria-label={t("waves.preset.label", { n })} value={wave.preset} options={presetOptions} disabled={disabled}
                            onChange={(preset: number) => set({ kind: "preset", preset })} style={{ width: "100%", maxWidth: 360 }} />
                        <p className="gge-army-note">{t(gamePresets.length ? "waves.preset.note" : "waves.preset.unread")}</p>
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
                <div className="gge-army-row">
                    {index < value.waves.length - 1 && <Button disabled={disabled} onClick={() => onChange(withWaveCopiedToRest(value, index))}>{t("waves.copyRest")}</Button>}
                    <Button danger disabled={disabled || value.waves.length <= MIN_WAVES} aria-label={t("waves.remove", { n })} onClick={() => removeWave(index)}>{t("waves.removeShort")}</Button>
                </div>
            </div>
        )
    }

    return (
        <div className="gge-army">
            <p className="gge-army-note">{t("waves.intro")}</p>
            {unlisted && <Alert type="warning" showIcon title={t("waves.preset.warning")} />}
            {value.waves.length > 4 && <p className="gge-army-note">{t("waves.cap")}</p>}
            <Collapse activeKey={open} onChange={keys => setOpen([keys].flat().map(Number))}
                items={value.waves.map((wave, i) => ({
                    key: i, children: panel(wave, i),
                    label: <span className="gge-army-wave-head"><span>{t("waves.wave", { n: i + 1 })}</span><WaveTag wave={wave} gamePresets={gamePresets} /></span>,
                }))} />
            <div className="gge-army-row">
                <Button disabled={disabled || value.waves.length >= MAX_WAVES} onClick={() => onChange(withAddedWave(value))}>{t("waves.add")}</Button>
                <span className="gge-army-note" data-wave-count>{t("waves.count", { n: value.waves.length, max: MAX_WAVES })}</span>
            </div>
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
