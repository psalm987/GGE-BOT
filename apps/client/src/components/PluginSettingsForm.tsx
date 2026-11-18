import { SettingOutlined } from "@ant-design/icons"
import { Button, Form, Tag, Typography } from "antd"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { MODULES, type PluginCatalogEntry, type PublicAccount } from "@gge/contracts"
import { Icon } from "@gge/ui"
import { orpc } from "../api.ts"
import type { PluginFormValues } from "../plugin-values.ts"
import { AttackAwareSwitch, BreaksPeaceTag, PluginStatusPill, usePluginPill } from "./PluginPanels.tsx"

export { pluginFormValues, toPluginSettings, type PluginFormValues } from "../plugin-values.ts"

function PluginRow({ entry, atAttackLimit, account, values }: { entry: PluginCatalogEntry; atAttackLimit: boolean; account: PublicAccount | undefined; values: PluginFormValues | undefined }) {
    const { t } = useTranslation("bot")
    const { t: tc } = useTranslation("client")
    const label = t(entry.key, { defaultValue: entry.key })
    const enabled = entry.force || Boolean(values?.[entry.key]?.enabled)
    const botRunning = account?.status?.actualState === "running"
    const pill = usePluginPill(enabled, botRunning, botRunning ? account?.status?.pluginStates?.[entry.key] : undefined)
    return (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 12px", minHeight: 44, padding: "2px 0" }}>
            {entry.force
                ? <Tag color="gold" style={{ marginInlineEnd: 0 }}>{tc("plugins.alwaysOn")}</Tag>
                : <Form.Item name={["plugins", entry.key, "enabled"]} valuePropName="checked" noStyle>
                    <AttackAwareSwitch label={label} blockTurningOn={entry.category === "attack" && atAttackLimit} />
                </Form.Item>}
            <span style={{ flex: 1, minWidth: 140, fontWeight: 600 }}>{label}</span>
            {entry.breaksPeace && <BreaksPeaceTag />}
            {enabled && botRunning && pill && <PluginStatusPill state={pill.state} />}
            {/* Registers the options as one field, so the drawer's own save sends them back unchanged. */}
            <Form.Item name={["plugins", entry.key, "options"]} hidden noStyle />
        </div>
    )
}

/**
 * The account's plugins as switches under their module. Each module's options are on its own page, which "Open settings"
 * leads to for an account that exists. Lives inside a Form whose `plugins` field holds PluginFormValues.
 */
export function PluginSettingsForm({ catalog, account, onOpenModule }: { catalog: PluginCatalogEntry[]; account?: PublicAccount; onOpenModule?: (moduleId: string) => void }) {
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
            {MODULES.filter(module => module.status === "live").map(module => {
                const entries = module.plugins.flatMap(key => catalog.find(e => e.key === key && !e.hidden) ?? [])
                if (!entries.length) return null
                const name = t(`modules.${module.id}.name`)
                return (
                    <section key={module.id} aria-label={name} style={{ borderBottom: "1px solid var(--gge-rule)", padding: "8px 0" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <Icon icon={module.icon} size={24} />
                            <strong className="gge-display" style={{ flex: 1 }}>{name}</strong>
                            {account && onOpenModule && entries.some(e => e.options.length > 0) && (
                                <Button type="text" icon={<SettingOutlined />} onClick={() => onOpenModule(module.id)} aria-label={t("drawer.openModuleSettings", { module: name })} style={{ minHeight: 44 }}>
                                    {t("drawer.openSettings")}
                                </Button>
                            )}
                        </div>
                        {entries.map(entry => <PluginRow key={entry.key} entry={entry} atAttackLimit={atLimit} account={account} values={values} />)}
                    </section>
                )
            })}
        </div>
    )
}
