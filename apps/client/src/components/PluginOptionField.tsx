import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons"
import { useQuery } from "@tanstack/react-query"
import { Button, Checkbox, Col, Form, Input, InputNumber, Select, Typography } from "antd"
import { useRef, useState, type KeyboardEvent } from "react"
import { useTranslation } from "react-i18next"
import type { AccountCastle, CastleRef, GameItem, GameItemKind, ItemCatalog, PluginOptionDef, RowColumn, RowValue } from "@gge/contracts"
import { palette } from "@gge/ui"
import { orpc } from "../api.ts"

const KIND: Record<ItemCatalog, GameItemKind> = { banners: "banner", tools: "tool", troops: "troop", supportTools: "supportTool" }
const COLUMN_KIND = { tool: "tool", troop: "troop" } as const

function useGameItems(kind: GameItemKind) {
    const { t } = useTranslation("game")
    const items = useQuery({ ...orpc.catalog.gameItems.queryOptions({ input: { kind } }), staleTime: Infinity }).data ?? []
    const nameOf = (item: GameItem) => t(item.nameKey, { defaultValue: item.name })
    return { items, nameOf, byId: new Map(items.map(item => [item.id, item])) }
}

export function useKingdomName() {
    const { t } = useTranslation("client")
    return (kingdom: number) => t(`plugins.kingdom.${kingdom}`, { defaultValue: t("plugins.kingdom.other", { id: kingdom }) })
}

const castleKey = (ref: CastleRef) => `${ref.kingdom}:${ref.id}`
const toCastle = (key: string): CastleRef => {
    const [kingdom, id] = key.split(":").map(Number)
    return { kingdom: kingdom!, id: id! }
}

function useCastleOptions(castles: AccountCastle[]) {
    const { t } = useTranslation("client")
    const kingdomName = useKingdomName()
    return castles.map(c => ({ value: castleKey(c), label: t("plugins.castle.option", { name: c.name, kingdom: kingdomName(c.kingdom), x: c.x, y: c.y }) }))
}

/** One castle of the account, by kingdom and id. */
function CastleSelect({ castles, value, onChange, ...aria }: { castles: AccountCastle[]; value?: CastleRef | null; onChange?: (v: CastleRef | null) => void; "aria-label"?: string; id?: string }) {
    const options = useCastleOptions(castles)
    return <Select {...aria} allowClear disabled={!castles.length} options={options} value={value ? castleKey(value) : undefined}
        onChange={(key?: string) => onChange?.(key ? toCastle(key) : null)} />
}

/**
 * Items in the order the plugin tries them. Each row moves with its arrow buttons or Alt+Up/Down while focused,
 * and a polite live region says where it went.
 */
function OrderedList({ catalog, value = [], onChange, id }: { catalog: ItemCatalog; value?: number[]; onChange?: (v: number[]) => void; id?: string }) {
    const { t } = useTranslation("client")
    const { items, nameOf, byId } = useGameItems(KIND[catalog])
    const [said, say] = useState("")
    const rows = useRef(new Map<number, HTMLLIElement>())
    const name = (itemId: number) => { const item = byId.get(itemId); return item ? nameOf(item) : t("plugins.list.unknownItem", { id: itemId }) }

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
                            <span style={{ flex: 1 }}>{name(itemId)}</span>
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
            <Select showSearch={{ optionFilterProp: "label" }} value={null} aria-label={t("plugins.list.add")} placeholder={t("plugins.list.add")}
                suffixIcon={<PlusOutlined />} style={{ width: "100%" }} disabled={!addable.length}
                options={addable.map(item => ({ value: item.id, label: nameOf(item) }))}
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

function ItemSelect({ kind, value, onChange, label }: { kind: GameItemKind; value?: number; onChange: (v: number | undefined) => void; label: string }) {
    const { items, nameOf } = useGameItems(kind)
    return <Select showSearch={{ optionFilterProp: "label" }} aria-label={label} value={value} onChange={onChange} style={{ width: "100%" }}
        options={items.map(item => ({ value: item.id, label: nameOf(item) }))} />
}

/** A table the player adds rows to: per castle, per tool or per troop, with a number. */
function Rows({ columns, castles, value = [], onChange, id }: { columns: RowColumn[]; castles: AccountCastle[]; value?: RowValue[]; onChange?: (v: RowValue[]) => void; id?: string }) {
    const { t } = useTranslation("client")
    const { t: tb } = useTranslation("bot")
    const header = (c: RowColumn) => tb(c.key, { defaultValue: c.key })
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
                                            : c.type === "number" ? <InputNumber aria-label={label} min={c.min} max={c.max} value={row[c.key] as number | undefined} style={{ width: "100%" }}
                                                onChange={v => set(index, c.key, v ?? undefined)} />
                                            : <ItemSelect kind={COLUMN_KIND[c.type]} label={label} value={row[c.key] as number | undefined} onChange={v => set(index, c.key, v)} />}
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

/** One option of a plugin in its settings dialog, bound to the dialog form's `options.<key>`. */
export function PluginOptionField({ def, castles, hidden }: { def: PluginOptionDef; castles: AccountCastle[]; hidden: boolean }) {
    const { t } = useTranslation("bot")
    const { t: tc } = useTranslation("client")
    if (def.type === "")
        return hidden ? null : <Col xs={0} sm={12} />
    const label = t(def.key, { defaultValue: def.key })
    // antd gives every column a display, which beats the `hidden` attribute.
    const style = hidden ? { display: "none" } : undefined
    const half = { xs: 24, sm: 12, style }
    const full = { span: 24, style }
    if (def.type === "Label")
        return <Col {...full}><Typography.Text strong className="gge-display" style={{ color: palette.gold, fontSize: 13 }}>{label}</Typography.Text></Col>
    const name = ["options", def.key]
    switch (def.type) {
        case "Checkbox":
            return <Col {...half}><Form.Item name={name} valuePropName="checked" style={{ marginBottom: 4 }}><Checkbox>{label}</Checkbox></Form.Item></Col>
        case "Select":
            return <Col {...half}><Form.Item name={name} label={label}><Select options={def.selection.map((option, value) => ({ label: option, value }))} /></Form.Item></Col>
        case "Number":
            return (
                <Col {...half}>
                    <Form.Item name={name} label={label} extra={tc("plugins.between", { min: def.min, max: def.max })}>
                        <InputNumber min={def.min} max={def.max} step={def.step} style={{ width: "100%" }}
                            suffix={def.unit ? tc(`plugins.unit.${def.unit}`) : undefined} />
                    </Form.Item>
                </Col>
            )
        case "CastlePicker":
            return <Col {...half}><Form.Item name={name} label={label} extra={castles.length ? undefined : tc("plugins.castle.none")}><CastleSelect castles={castles} /></Form.Item></Col>
        case "OrderedList":
            return <Col {...full}><Form.Item name={name} label={label}><OrderedList catalog={def.catalog} /></Form.Item></Col>
        case "Rows":
            return (
                <Col {...full}>
                    <Form.Item name={name} label={label} rules={[{ validator: (_, rows?: RowValue[]) => rowsComplete(def.columns, rows) ? Promise.resolve() : Promise.reject(new Error(tc("plugins.rows.incomplete"))) }]}>
                        <Rows columns={def.columns} castles={castles} />
                    </Form.Item>
                </Col>
            )
        case "Text":
        case "Channel": {
            const bounds = def.type === "Text" && (def.min !== undefined || def.max !== undefined)
            const extra = def.type === "Channel" ? tc("plugins.channelId")
                : bounds ? tc("plugins.between", { min: def.min ?? tc("plugins.any"), max: def.max ?? tc("plugins.any") }) : undefined
            return (
                <Col {...half}>
                    <Form.Item name={name} label={label} extra={extra}>
                        <Input inputMode={bounds ? "decimal" : undefined} placeholder={def.default ? tc("plugins.default", { value: def.default }) : undefined} />
                    </Form.Item>
                </Col>
            )
        }
    }
}
