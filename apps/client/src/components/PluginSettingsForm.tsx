import { DownOutlined, RightOutlined } from "@ant-design/icons"
import { Button, Checkbox, Col, Form, Input, Row, Select, Switch, Tag, Typography } from "antd"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { PluginCatalogEntry, PluginSettings } from "@gge/contracts"
import { orpc } from "../api.ts"

type OptionValues = Record<string, string | number | boolean | undefined>
export type PluginFormValues = Record<string, { enabled: boolean; options: OptionValues }>

/** Form values for every visible plugin: saved settings over catalog defaults. */
export function pluginFormValues(catalog: PluginCatalogEntry[], saved: PluginSettings = {}): PluginFormValues {
    return Object.fromEntries(catalog.filter(e => !e.hidden).map(entry => {
        const options: OptionValues = {}
        for (const def of entry.options) {
            if (def.type === "" || def.type === "Label")
                continue
            const value = saved[entry.key]?.options[def.key] ?? def.default
            options[def.key] = def.type === "Select" && value !== undefined ? Number(value) : value
        }
        return [entry.key, { enabled: entry.force || Boolean(saved[entry.key]?.enabled), options }]
    }))
}

/** What the API stores: only options that differ from their default, nothing empty. */
export function toPluginSettings(catalog: PluginCatalogEntry[], values: PluginFormValues): PluginSettings {
    const out: PluginSettings = {}
    for (const entry of catalog.filter(e => !e.hidden)) {
        const value = values[entry.key]
        if (!value)
            continue
        const options: Record<string, string | number | boolean> = {}
        for (const def of entry.options) {
            if (def.type === "" || def.type === "Label")
                continue
            const v = value.options?.[def.key]
            const fallback = def.type === "Select" && def.default !== undefined ? Number(def.default) : def.default
            if (v === undefined || v === "" || v === fallback)
                continue
            options[def.key] = v
        }
        out[entry.key] = { enabled: entry.force || value.enabled, options }
    }
    return out
}

function OptionField({ pluginKey, def }: { pluginKey: string; def: PluginCatalogEntry["options"][number] }) {
    const { t } = useTranslation("bot")
    const { t: tc } = useTranslation("client")
    if (def.type === "")
        return null
    if (def.type === "Label")
        return <Col span={24}><Typography.Text strong className="gge-display" style={{ color: "#E0A526", fontSize: 13 }}>{t(def.key, { defaultValue: def.key })}</Typography.Text></Col>
    const name = ["plugins", pluginKey, "options", def.key]
    if (def.type === "Checkbox")
        return <Col xs={24} sm={12}><Form.Item name={name} valuePropName="checked" style={{ marginBottom: 4 }}><Checkbox>{t(def.key, { defaultValue: def.key })}</Checkbox></Form.Item></Col>
    if (def.type === "Select")
        return <Col xs={24} sm={12}><Form.Item name={name} label={t(def.key, { defaultValue: def.key })}><Select options={def.selection.map((label, value) => ({ label, value }))} /></Form.Item></Col>
    const bounds = def.type === "Text" && (def.min !== undefined || def.max !== undefined)
    const extra = def.type === "Channel" ? tc("plugins.channelId")
        : bounds ? tc("plugins.between", { min: def.min ?? tc("plugins.any"), max: def.max ?? tc("plugins.any") }) : undefined
    return (
        <Col xs={24} sm={12}>
            <Form.Item name={name} label={t(def.key, { defaultValue: def.key })} extra={extra}>
                <Input inputMode={bounds ? "decimal" : undefined} placeholder={def.default ? tc("plugins.default", { value: def.default }) : undefined} />
            </Form.Item>
        </Col>
    )
}

function PluginRow({ entry, atAttackLimit }: { entry: PluginCatalogEntry; atAttackLimit: boolean }) {
    const { t } = useTranslation("bot")
    const { t: tc } = useTranslation("client")
    const [open, setOpen] = useState(false)
    const panelId = `plugin-${entry.key}-settings`
    const label = t(entry.key, { defaultValue: entry.key })
    return (
        <div style={{ borderBottom: "1px solid #3A2E1F" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 48 }}>
                {entry.force
                    ? <Tag color="gold" style={{ marginInlineEnd: 0 }}>{tc("plugins.alwaysOn")}</Tag>
                    : <Form.Item name={["plugins", entry.key, "enabled"]} valuePropName="checked" noStyle>
                        <AttackAwareSwitch label={label} blockTurningOn={entry.category === "attack" && atAttackLimit} />
                    </Form.Item>}
                <span style={{ flex: 1, fontWeight: 600 }}>{label}</span>
                {entry.options.length > 0 &&
                    <Button type="text" size="small" aria-expanded={open} aria-controls={panelId}
                        icon={open ? <DownOutlined /> : <RightOutlined />} iconPlacement="end" onClick={() => setOpen(o => !o)}>
                        {tc("plugins.settings")}
                    </Button>}
            </div>
            {/* Kept mounted so hidden options still submit their values. */}
            <div id={panelId} hidden={!open} style={{ padding: "4px 0 12px" }}>
                <Row gutter={16}>{entry.options.map((def, i) => <OptionField key={def.key ?? `gap-${i}`} pluginKey={entry.key} def={def} />)}</Row>
            </div>
        </div>
    )
}

/** An enable switch that can't be turned on while the account is at its attack plugin limit; it can always be turned off. */
function AttackAwareSwitch({ label, blockTurningOn, checked, onChange }: { label: string; blockTurningOn: boolean; checked?: boolean; onChange?: (v: boolean) => void }) {
    const { t } = useTranslation("client")
    return <Switch size="small" aria-label={t("plugins.enable", { label })} checked={checked} onChange={onChange}
        disabled={blockTurningOn && !checked} title={blockTurningOn && !checked ? t("plugins.attackLimitReached") : undefined} />
}

/** One row per plugin, built from the catalog: an enable switch and its settings. Lives inside a Form whose `plugins` field holds PluginFormValues. */
export function PluginSettingsForm({ catalog }: { catalog: PluginCatalogEntry[] }) {
    const { t } = useTranslation("client")
    const limit = useQuery(orpc.plugins.attackLimit.queryOptions()).data
    const values = Form.useWatch("plugins") as PluginFormValues | undefined
    const attackPlugins = catalog.filter(e => e.category === "attack" && !e.force && !e.hidden)
    const enabled = attackPlugins.filter(e => values?.[e.key]?.enabled).length
    const atLimit = limit !== undefined && limit !== null && enabled >= limit
    return (
        <div>
            {attackPlugins.length > 0 && (
                <Typography.Paragraph type={limit !== null && limit !== undefined && enabled > limit ? "danger" : "secondary"} style={{ marginBottom: 8 }}>
                    {limit !== null && limit !== undefined ? t("plugins.attackCountLimited", { count: enabled, limit }) : t("plugins.attackCount", { count: enabled })}
                </Typography.Paragraph>
            )}
            {catalog.filter(e => !e.hidden).map(entry => <PluginRow key={entry.key} entry={entry} atAttackLimit={atLimit} />)}
        </div>
    )
}
