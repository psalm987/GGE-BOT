import { SettingOutlined } from "@ant-design/icons"
import { App, Button, Form, Tag, Typography } from "antd"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { PluginCatalogEntry, PublicAccount } from "@gge/contracts"
import { palette } from "@gge/ui"
import { orpc } from "../api.ts"
import type { OptionValues, PluginFormValues } from "../plugin-values.ts"
import { PluginSettingsDialog } from "./PluginSettingsDialog.tsx"
import { AttackAwareSwitch, BreaksPeaceTag, PluginStatusPill, usePluginPill } from "./PluginPanels.tsx"

export { pluginFormValues, toPluginSettings, type PluginFormValues } from "../plugin-values.ts"

/** Persists one plugin's options for an account that exists. Without it, a new account keeps them in its form until it is added. */
export type SavePluginOptions = (entry: PluginCatalogEntry, options: OptionValues) => Promise<void>

function PluginRow({ entry, atAttackLimit, account, values, onSave, autoOpen }: {
    entry: PluginCatalogEntry; atAttackLimit: boolean; account: PublicAccount | undefined; values: PluginFormValues | undefined; onSave?: SavePluginOptions; autoOpen: boolean
}) {
    const { t } = useTranslation("bot")
    const { t: tc } = useTranslation("client")
    const { message } = App.useApp()
    const form = Form.useFormInstance()
    const openable = entry.options.length > 0
    const [open, setOpen] = useState(autoOpen && openable)
    // Asked for while this row is already on screen, such as from the command palette with the drawer open.
    useEffect(() => { if (autoOpen && openable) setOpen(true) }, [autoOpen, openable])
    const label = t(entry.key, { defaultValue: entry.key })
    const enabled = entry.force || Boolean(values?.[entry.key]?.enabled)
    const botRunning = account?.status?.actualState === "running"
    const pluginStates = botRunning ? account?.status?.pluginStates ?? {} : {}
    const pill = usePluginPill(enabled, botRunning, pluginStates[entry.key])

    async function save(options: OptionValues) {
        await onSave?.(entry, options)
        // Saved already, so it mustn't count as an unsaved change in the drawer.
        form.setFields([{ name: ["plugins", entry.key, "options"], value: options, touched: Boolean(!onSave) }])
        message.success(tc(onSave ? "plugins.dialog.saved" : "plugins.dialog.staged", { plugin: label }))
    }

    return (
        <div style={{ borderBottom: `1px solid ${palette.rule}` }}>
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 12px", minHeight: 48, padding: "4px 0" }}>
                {entry.force
                    ? <Tag color="gold" style={{ marginInlineEnd: 0 }}>{tc("plugins.alwaysOn")}</Tag>
                    : <Form.Item name={["plugins", entry.key, "enabled"]} valuePropName="checked" noStyle>
                        <AttackAwareSwitch label={label} blockTurningOn={entry.category === "attack" && atAttackLimit} />
                    </Form.Item>}
                <span style={{ flex: 1, minWidth: 140, fontWeight: 600 }}>{label}</span>
                {entry.breaksPeace && <BreaksPeaceTag />}
                {enabled && botRunning && pill && <PluginStatusPill state={pill.state} />}
                {entry.options.length > 0 &&
                    <Button type="text" icon={<SettingOutlined />} onClick={() => setOpen(true)} aria-haspopup="dialog"
                        aria-label={tc("plugins.settingsFor", { plugin: label })} style={{ minHeight: 44 }}>
                        {tc("plugins.settings")}
                    </Button>}
            </div>
            {/* Registers the options as one field, so the drawer's own save sends them. */}
            <Form.Item name={["plugins", entry.key, "options"]} hidden noStyle />
            {open && (
                <PluginSettingsDialog entry={entry} label={label} pill={pill} allValues={values}
                    initial={values?.[entry.key]?.options ?? {}} pluginStates={pluginStates} castles={account?.status?.castles ?? []}
                    onSave={save} onClose={() => setOpen(false)} />
            )}
        </div>
    )
}

/**
 * One row per plugin, built from the catalog: an enable switch, its status while the bot runs, and a button that opens
 * its settings dialog. Lives inside a Form whose `plugins` field holds PluginFormValues.
 */
export function PluginSettingsForm({ catalog, account, onSavePlugin, openPlugin }: { catalog: PluginCatalogEntry[]; account?: PublicAccount; onSavePlugin?: SavePluginOptions; openPlugin?: string }) {
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
            {catalog.filter(e => !e.hidden).map(entry =>
                <PluginRow key={entry.key} entry={entry} atAttackLimit={atLimit} account={account} values={values} onSave={onSavePlugin} autoOpen={openPlugin === entry.key} />)}
        </div>
    )
}
