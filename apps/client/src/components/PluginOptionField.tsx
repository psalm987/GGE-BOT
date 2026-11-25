import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons"
import { useQuery } from "@tanstack/react-query"
import { Button, Checkbox, Col, Form, Input, InputNumber, Select, Slider, Typography } from "antd"
import { createContext, useContext, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { KINGDOM_IDS, MAIN_CASTLE, MAIN_CASTLE_AREA_TYPES, SKIP_MINUTES, type AccountCastle, type CastleRef, type GameItem, type GameItemKind, type ItemCatalog, type PluginCatalogEntry, type PluginOptionDef, type RowColumn, type RowValue, type SkipTypes } from "@gge/contracts"
import { palette } from "@gge/ui"
import { orpc } from "../api.ts"
import { castleKey, castleOptions, toCastle } from "../castle-options.ts"
import { itemCode, itemLabel, itemOptionFilter, itemOptionLabel } from "../item-names.ts"
import { ArmyModeField, WavesField } from "./ArmyFields.tsx"
import { CommanderMapField } from "./CommanderMapField.tsx"

const KIND: Record<ItemCatalog, GameItemKind> = { banners: "banner", tools: "tool", troops: "troop", supportTools: "supportTool" }
const COLUMN_KIND = { tool: "tool", troop: "troop" } as const

/** `label` is the option's accessible name and search text, name and code; `text` and `code` are what the open list shows apart. */
export type ItemOption = { value: number; label: string; text?: string; code?: number }

/** An item select's search, over each option's label: name, level, "#403" and "403". */
export const itemSearch = { showSearch: { filterOption: itemOptionFilter } }

/** An option of an item select: the name, then the code muted at the right edge. */
export const renderItemOption = (option: { data: ItemOption }) => option.data.code === undefined
    ? option.data.label
    : (
        <span style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>{option.data.text}</span>
            <span aria-hidden style={{ color: palette.muted, fontVariantNumeric: "tabular-nums" }}>{itemCode(option.data.code)}</span>
        </span>
    )

export function useGameItems(kind: GameItemKind) {
    const { t } = useTranslation("game")
    const { t: tc } = useTranslation("client")
    const items = useQuery({ ...orpc.catalog.gameItems.queryOptions({ input: { kind } }), staleTime: Infinity }).data ?? []
    // Levels of one item share its name in the game's strings, so the level tells them apart, and the variant tells apart what still shares both.
    const nameOf = (item: GameItem) => itemLabel(t(item.nameKey, { defaultValue: item.name }), item, tc)
    const optionOf = (item: GameItem): ItemOption => ({ value: item.id, label: itemOptionLabel(nameOf(item), item.id), text: nameOf(item), code: item.id })
    return { items, nameOf, optionOf, byId: new Map(items.map(item => [item.id, item])) }
}

export function useKingdomName() {
    const { t } = useTranslation("client")
    return (kingdom: number) => t(`plugins.kingdom.${kingdom}`, { defaultValue: t("plugins.kingdom.other", { id: kingdom }) })
}

/** One castle of the account, by kingdom and id. A picked castle the account no longer lists shows as nothing picked. */
function CastleSelect({ castles, value, onChange, placeholder, ...aria }: {
    castles: AccountCastle[]; value?: CastleRef | null; onChange?: (v: CastleRef | null) => void; placeholder?: string; "aria-label"?: string; id?: string
}) {
    const { t } = useTranslation("client")
    const options = castleOptions(castles, t, useKingdomName())
    const chosen = new Map(options.flatMap(o => "options" in o ? o.options : [o]).map(o => [o.value, o.chosen]))
    const found = value && (value.id === MAIN_CASTLE
        ? castles.find(c => c.kingdom === value.kingdom && MAIN_CASTLE_AREA_TYPES.includes(c.type))
        : castles.find(c => c.kingdom === value.kingdom && c.id === value.id))
    return <Select {...aria} allowClear showSearch={{ optionFilterProp: "search" }} disabled={!castles.length} options={options} value={found ? castleKey(found) : undefined}
        labelRender={({ value: key }) => chosen.get(String(key))} placeholder={placeholder}
        status={value && castles.length && !found ? "warning" : undefined} onChange={(key?: string) => onChange?.(key ? toCastle(key) : null)} />
}

/** A number as a slider with its exact value in a field beside it. */
function SliderNumber({ value, onChange, min, max, step, suffix, label, id, disabled }: {
    value?: number | null; onChange?: (v: number | null) => void; min: number; max: number; step?: number; suffix?: string; label: string; id?: string; disabled?: boolean
}) {
    return (
        <div className="gge-slider-number">
            <Slider min={min} max={max} step={step ?? 1} value={value ?? min} onChange={onChange} disabled={disabled} tooltip={{ open: false }} ariaLabelForHandle={label} />
            <InputNumber id={id} min={min} max={max} step={step} value={value} onChange={onChange} suffix={suffix} disabled={disabled} />
        </div>
    )
}

/**
 * On a page with a plugin for each kingdom or each event: copies one option's value to the page's other plugins. A
 * Select marked `copyToAll` offers it. `each` is what a plugin of the page stands for, which the button names.
 */
export const CopyToAll = createContext<{ copy: (key: string, value: unknown) => void; each: "kingdoms" | "events" } | undefined>(undefined)

function CopyToAllButton({ optionKey, label }: { optionKey: string; label: string }) {
    const { t } = useTranslation("client")
    const all = useContext(CopyToAll)
    const form = Form.useFormInstance()
    if (!all) return null
    return <Button size="small" style={{ marginTop: 6 }} onClick={() => all.copy(optionKey, form.getFieldValue(["options", optionKey]))}>{t(all.each === "events" ? "plugins.copyToAllEvents" : "plugins.copyToAll", { label })}</Button>
}

/**
 * Items in the order the plugin tries them. Each row moves with its arrow buttons or Alt+Up/Down while focused,
 * and a polite live region says where it went.
 */
function OrderedList({ catalog, value = [], onChange, id }: { catalog: ItemCatalog; value?: number[]; onChange?: (v: number[]) => void; id?: string }) {
    const { t } = useTranslation("client")
    const { items, nameOf, optionOf, byId } = useGameItems(KIND[catalog])
    const [said, say] = useState("")
    const rows = useRef(new Map<number, HTMLLIElement>())
    const name = (itemId: number) => { const item = byId.get(itemId); return item ? itemOptionLabel(nameOf(item), itemId) : t("plugins.list.unknownItem", { id: itemId }) }

    function move(from: number, to: number, focus: "up" | "down" | "row") {
        if (to < 0 || to >= value.length)
            return
        const next = [...value]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved!)
        onChange?.(next)
        say(t("plugins.list.moved", { name: name(moved!), position: to + 1, count: next.length }))
        requestAnimationFrame(() => {
            const row = rows.current.get(moved!)
            const button = focus === "row" ? null : row?.querySelector<HTMLButtonElement>(`[data-move="${focus}"]:not([disabled])`)
            ;(button ?? row)?.focus()
        })
    }
    const onKey = (index: number) => (event: KeyboardEvent) => {
        if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown"))
            return
        event.preventDefault()
        move(index, event.key === "ArrowUp" ? index - 1 : index + 1, "row")
    }
    const remove = (index: number) => {
        say(t("plugins.list.removed", { name: name(value[index]!) }))
        onChange?.(value.filter((_, i) => i !== index))
    }
    const bonus = (itemId: number) => byId.get(itemId)?.fameBonus
    const addable = items.filter(item => !value.includes(item.id))

    return (
        <div id={id} className="gge-ordered-list">
            {value.length === 0
                ? <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>{t("plugins.list.empty")}</Typography.Paragraph>
                : <ol style={{ listStyle: "none", padding: 0, margin: "0 0 8px" }}>
                    {value.map((itemId, index) => (
                        <li key={itemId} ref={el => { if (el) rows.current.set(itemId, el); else rows.current.delete(itemId) }}
                            tabIndex={0} onKeyDown={onKey(index)} aria-label={`${index + 1}. ${name(itemId)}`}
                            style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 4px 0 10px", borderBottom: `1px solid ${palette.rule}` }}>
                            <span aria-hidden style={{ width: 22, color: palette.muted, fontVariantNumeric: "tabular-nums" }}>{index + 1}</span>
                            <span style={{ flex: 1 }}>{byId.has(itemId) ? nameOf(byId.get(itemId)!) : name(itemId)}</span>
                            {byId.has(itemId) ? <span aria-hidden style={{ color: palette.muted, fontVariantNumeric: "tabular-nums" }}>{itemCode(itemId)}</span> : null}
                            {bonus(itemId) ? <span style={{ color: palette.muted, fontVariantNumeric: "tabular-nums" }}>{t("plugins.list.bonus", { value: bonus(itemId) })}</span> : null}
                            <Button type="text" data-move="up" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => move(index, index - 1, "up")}
                                aria-label={t("plugins.list.moveUp", { name: name(itemId) })} style={{ minWidth: 44, height: 44 }} />
                            <Button type="text" data-move="down" icon={<ArrowDownOutlined />} disabled={index === value.length - 1} onClick={() => move(index, index + 1, "down")}
                                aria-label={t("plugins.list.moveDown", { name: name(itemId) })} style={{ minWidth: 44, height: 44 }} />
                            <Button type="text" icon={<DeleteOutlined />} onClick={() => remove(index)}
                                aria-label={t("plugins.list.remove", { name: name(itemId) })} style={{ minWidth: 44, height: 44 }} />
                        </li>
                    ))}
                </ol>}
            <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 8 }}>{t("plugins.list.hint")}</Typography.Paragraph>
            <Select {...itemSearch} value={null} aria-label={t("plugins.list.add")} placeholder={t("plugins.list.add")}
                suffixIcon={<PlusOutlined />} style={{ width: "100%" }} disabled={!addable.length}
                options={addable.map(optionOf)} optionRender={renderItemOption}
                onChange={(itemId: number) => {
                    onChange?.([...value, itemId])
                    say(t("plugins.list.added", { name: name(itemId), position: value.length + 1 }))
                }} />
            <span role="status" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{said}</span>
        </div>
    )
}

const emptyRow = (columns: RowColumn[]) => Object.fromEntries(columns.flatMap(c => c.type === "number" && c.default !== undefined ? [[c.key, c.default]] : []))

export const rowsComplete = (columns: RowColumn[], rows: RowValue[] = []) => rows.every(row => columns.every(c => row[c.key] !== undefined && row[c.key] !== null))

/** `orderable` lists only what a plugin may order with coins or resources. */
function ItemSelect({ kind, orderable, value, onChange, label }: { kind: GameItemKind; orderable?: boolean; value?: number; onChange: (v: number | undefined) => void; label: string }) {
    const { items, optionOf } = useGameItems(kind)
    return <Select {...itemSearch} aria-label={label} value={value} onChange={onChange} style={{ width: "100%" }} optionRender={renderItemOption}
        options={items.filter(item => !orderable || item.orderList !== null).map(optionOf)} />
}

function KingdomSelect({ value, onChange, label }: { value?: number; onChange: (v: number | undefined) => void; label: string }) {
    const kingdomName = useKingdomName()
    return <Select aria-label={label} value={value} onChange={onChange} style={{ width: "100%" }}
        options={KINGDOM_IDS.map(kingdom => ({ value: kingdom, label: kingdomName(kingdom) }))} />
}

/** A table the player adds rows to: per castle, kingdom, tool or troop, with a number. */
function Rows({ columns, castles, scope, value = [], onChange, id }: { columns: RowColumn[]; castles: AccountCastle[]; scope: string; value?: RowValue[]; onChange?: (v: RowValue[]) => void; id?: string }) {
    const { t } = useTranslation("client")
    const { t: tb } = useTranslation("bot")
    /** A plugin may name a column in its own words with `<plugin>.<option>.<column>.column`. */
    const header = (c: RowColumn) => tb(`${scope}.${c.key}.column`, { defaultValue: tb(c.key, { defaultValue: c.key }) })
    const set = (index: number, key: string, cell: RowValue[string] | null | undefined) =>
        onChange?.(value.map((row, i) => {
            if (i !== index)
                return row
            const next = { ...row }
            if (cell === undefined || cell === null) delete next[key]
            else next[key] = cell
            return next
        }))
    const template = `${columns.map(c => c.type === "number" ? "minmax(96px, 0.6fr)" : "minmax(120px, 1fr)").join(" ")} 44px`
    return (
        <div id={id}>
            {value.length === 0
                ? <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>{t("plugins.rows.empty")}</Typography.Paragraph>
                : <div style={{ display: "grid", gap: 8, marginBottom: 8, overflowX: "auto" }}>
                    <div aria-hidden style={{ display: "grid", gridTemplateColumns: template, gap: 8, color: palette.muted, fontSize: 13 }}>
                        {columns.map(c => <span key={c.key}>{header(c)}</span>)}
                        <span />
                    </div>
                    {value.map((row, index) => (
                        <div key={index} style={{ display: "grid", gridTemplateColumns: template, gap: 8, alignItems: "center" }}>
                            {columns.map(c => {
                                const label = t("plugins.rows.cell", { column: header(c), row: index + 1 })
                                return (
                                    <div key={c.key}>
                                        {c.type === "castle" ? <CastleSelect castles={castles} aria-label={label} value={row[c.key] as CastleRef | undefined} onChange={v => set(index, c.key, v)} />
                                            : c.type === "kingdom" ? <KingdomSelect label={label} value={row[c.key] as number | undefined} onChange={v => set(index, c.key, v)} />
                                            : c.type === "number" ? <InputNumber aria-label={label} min={c.min} max={c.max} value={row[c.key] as number | undefined} style={{ width: "100%" }}
                                                onChange={v => set(index, c.key, v ?? undefined)} />
                                            : <ItemSelect kind={COLUMN_KIND[c.type]} orderable={c.orderable} label={label} value={row[c.key] as number | undefined} onChange={v => set(index, c.key, v)} />}
                                    </div>
                                )
                            })}
                            <Button type="text" icon={<DeleteOutlined />} aria-label={t("plugins.rows.remove", { row: index + 1 })}
                                style={{ minWidth: 44, height: 44 }} onClick={() => onChange?.(value.filter((_, i) => i !== index))} />
                        </div>
                    ))}
                </div>}
            <Button icon={<PlusOutlined />} onClick={() => onChange?.([...value, emptyRow(columns)])}>{t("plugins.rows.add")}</Button>
        </div>
    )
}

/** The time skips one plugin may spend: the ones the account's Skips settings allow, or its own pick. */
function SkipTypesField({ value = null, onChange, id, label }: { value?: SkipTypes; onChange?: (v: SkipTypes) => void; id?: string; label: string }) {
    const { t } = useTranslation("client")
    return (
        <div id={id} style={{ display: "grid", gap: 8 }}>
            <Checkbox checked={value === null} onChange={event => onChange?.(event.target.checked ? null : [...SKIP_MINUTES])}>{t("plugins.skips.follow")}</Checkbox>
            {value !== null && (
                <Checkbox.Group aria-label={label} value={value} onChange={picked => onChange?.(SKIP_MINUTES.filter(minutes => picked.includes(minutes)))}
                    options={SKIP_MINUTES.map(minutes => ({ value: minutes, label: t(`plugins.skips.minutes.${minutes}`) }))} />
            )}
        </div>
    )
}

/** The lines under a field: what the field itself says (a range, a hint) and the plugin's own help for it. */
const extraOf = (...lines: (ReactNode | undefined)[]) => {
    const shown = lines.filter(Boolean)
    return shown.length ? <>{shown.map((line, i) => <div key={i}>{line}</div>)}</> : undefined
}

/** One option of a plugin in its settings dialog, bound to the dialog form's `options.<key>`. The commander list and VIP cap are left to the module's commander picker. */
export function PluginOptionField({ entry, def, castles, hidden, accountId }: {
    entry: PluginCatalogEntry; def: PluginOptionDef; castles: AccountCastle[]; hidden: boolean; accountId?: string
}) {
    const plugin = entry.key
    const { t, i18n } = useTranslation("bot")
    const { t: tc } = useTranslation("client")
    if (def.type === "")
        return hidden ? null : <Col xs={0} sm={12} />
    if ((entry.checks ?? []).some(check => check.option === def.key || check.vip === def.key))
        return null
    const label = t(def.key, { defaultValue: def.key })
    const helpKey = `${plugin}.${def.key}.help`
    const help = def.type !== "Label" && i18n.exists(helpKey, { ns: "bot" }) ? t(helpKey) : undefined
    // antd gives every column a display, which beats the `hidden` attribute.
    const style = hidden ? { display: "none" } : undefined
    const half = { xs: 24, sm: 12, style }
    const full = { span: 24, style }
    if (def.type === "Label")
        return <Col {...full}><Typography.Text strong className="gge-display" style={{ color: palette.heading, fontSize: 13 }}>{label}</Typography.Text></Col>
    const name = ["options", def.key]
    switch (def.type) {
        case "Checkbox":
            return <Col {...half}><Form.Item name={name} valuePropName="checked" extra={extraOf(help)} style={{ marginBottom: 4 }}><Checkbox>{label}</Checkbox></Form.Item></Col>
        case "Select":
            return (
                <Col {...half}>
                    <Form.Item name={name} label={label} extra={extraOf(help, def.copyToAll && <CopyToAllButton optionKey={def.key} label={label} />)}>
                        <Select options={def.selection.map((option, value) => ({ label: t(option, { defaultValue: option }), value }))} />
                    </Form.Item>
                </Col>
            )
        case "Number":
            return (
                <Col {...half}>
                    <Form.Item name={name} label={label} extra={extraOf(tc("plugins.between", { min: def.min, max: def.max }), help)}>
                        {def.display === "slider"
                            ? <SliderNumber min={def.min} max={def.max} step={def.step} label={label} suffix={def.unit ? tc(`plugins.unit.${def.unit}`) : undefined} />
                            : <InputNumber min={def.min} max={def.max} step={def.step} style={{ width: "100%" }}
                                suffix={def.unit ? tc(`plugins.unit.${def.unit}`) : undefined} />}
                    </Form.Item>
                </Col>
            )
        case "CastlePicker": {
            const listed = def.kingdom === undefined ? castles : castles.filter(c => c.kingdom === def.kingdom)
            return (
                <Col {...half}>
                    <Form.Item name={name} label={label} extra={extraOf(castles.length ? undefined : tc("plugins.castle.none"), help)}>
                        <CastleSelect castles={listed} placeholder={def.kingdom === undefined ? undefined : tc("plugins.castle.main")} />
                    </Form.Item>
                </Col>
            )
        }
        case "OrderedList":
            return <Col {...full}><Form.Item name={name} label={label} extra={extraOf(help)}><OrderedList catalog={def.catalog} /></Form.Item></Col>
        case "Rows":
            return (
                <Col {...full}>
                    <Form.Item name={name} label={label} extra={extraOf(help)} rules={[{ validator: (_, rows?: RowValue[]) => rowsComplete(def.columns, rows) ? Promise.resolve() : Promise.reject(new Error(tc("plugins.rows.incomplete"))) }]}>
                        <Rows columns={def.columns} castles={castles} scope={`${plugin}.${def.key}`} />
                    </Form.Item>
                </Col>
            )
        case "SkipTypes":
            return <Col {...full}><Form.Item name={name} label={label} extra={extraOf(help)}><SkipTypesField label={label} /></Form.Item></Col>
        case "ArmyMode":
            return (
                <Col {...full}>
                    <Form.Item name={name} label={label} extra={extraOf(help)}>
                        <ArmyModeField label={label} source={def.autofill} defs={entry.options} wavesKey={entry.options.find(other => other.type === "Waves")?.key} accountId={accountId} />
                    </Form.Item>
                </Col>
            )
        case "CommanderMap":
            return <Col {...full}><Form.Item name={name} label={label} extra={extraOf(help)}><CommanderMapField buckets={def.buckets} keepsOwnList={def.keepsOwnList ?? []} accountId={accountId} /></Form.Item></Col>
        case "Waves":
            return <Col {...full}><Form.Item name={name} label={label} extra={extraOf(help)}><WavesField collapsed={hidden} accountId={accountId} targets={entry.targets} /></Form.Item></Col>
        case "Text":
        case "Channel": {
            const bounds = def.type === "Text" && (def.min !== undefined || def.max !== undefined)
            const hint = def.type === "Channel" ? tc("plugins.channelId")
                : bounds ? tc("plugins.between", { min: def.min ?? tc("plugins.any"), max: def.max ?? tc("plugins.any") }) : undefined
            return (
                <Col {...half}>
                    <Form.Item name={name} label={label} extra={extraOf(hint, help)}>
                        <Input inputMode={bounds ? "decimal" : undefined} placeholder={def.default ? tc("plugins.default", { value: def.default }) : undefined} />
                    </Form.Item>
                </Col>
            )
        }
    }
}
