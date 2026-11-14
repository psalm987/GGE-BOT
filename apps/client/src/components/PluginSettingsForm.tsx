import { DownOutlined, RightOutlined } from "@ant-design/icons"
import { Button, Checkbox, Col, Form, Input, Row, Select, Switch, Tag, Typography } from "antd"
import { useState } from "react"
import type { PluginCatalogEntry, PluginSettings } from "@gge/contracts"
import { t, useLanguage } from "../i18n.ts"

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
    if (def.type === "")
        return null
    if (def.type === "Label")
        return <Col span={24}><Typography.Text strong className="gge-display" style={{ color: "#E0A526", fontSize: 13 }}>{t(def.key)}</Typography.Text></Col>
    const name = ["plugins", pluginKey, "options", def.key]
    if (def.type === "Checkbox")
        return <Col xs={24} sm={12}><Form.Item name={name} valuePropName="checked" style={{ marginBottom: 4 }}><Checkbox>{t(def.key)}</Checkbox></Form.Item></Col>
    if (def.type === "Select")
        return <Col xs={24} sm={12}><Form.Item name={name} label={t(def.key)}><Select options={def.selection.map((label, value) => ({ label, value }))} /></Form.Item></Col>
    return (
        <Col xs={24} sm={12}>
            <Form.Item name={name} label={t(def.key)} extra={def.type === "Channel" ? "Discord channel ID" : undefined}>
                <Input placeholder={def.default ? `Default: ${def.default}` : undefined} />
            </Form.Item>
        </Col>
    )
}

function PluginRow({ entry }: { entry: PluginCatalogEntry }) {
    const [open, setOpen] = useState(false)
    const panelId = `plugin-${entry.key}-settings`
    const label = t(entry.key)
    return (
        <div style={{ borderBottom: "1px solid #3A2E1F" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 48 }}>
                {entry.force
                    ? <Tag color="gold" style={{ marginInlineEnd: 0 }}>Always on</Tag>
                    : <Form.Item name={["plugins", entry.key, "enabled"]} valuePropName="checked" noStyle>
                        <Switch size="small" aria-label={`Enable ${label}`} />
                    </Form.Item>}
                <span style={{ flex: 1, fontWeight: 600 }}>{label}</span>
                {entry.options.length > 0 &&
                    <Button type="text" size="small" aria-expanded={open} aria-controls={panelId}
                        icon={open ? <DownOutlined /> : <RightOutlined />} iconPlacement="end" onClick={() => setOpen(o => !o)}>
                        Settings
                    </Button>}
            </div>
            {/* Kept mounted so hidden options still submit their values. */}
            <div id={panelId} hidden={!open} style={{ padding: "4px 0 12px" }}>
                <Row gutter={16}>{entry.options.map((def, i) => <OptionField key={def.key ?? `gap-${i}`} pluginKey={entry.key} def={def} />)}</Row>
            </div>
        </div>
    )
}

/** One row per plugin, built from the catalog: an enable switch and its settings. Lives inside a Form whose `plugins` field holds PluginFormValues. */
export function PluginSettingsForm({ catalog }: { catalog: PluginCatalogEntry[] }) {
    useLanguage()
    return <div>{catalog.filter(e => !e.hidden).map(entry => <PluginRow key={entry.key} entry={entry} />)}</div>
}
