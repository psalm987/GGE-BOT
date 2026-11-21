import { useMutation } from "@tanstack/react-query"
import { App, Button, Card, Typography, type FormInstance } from "antd"
import { useEffect, useReducer, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ACCOUNT_SETTINGS_PLUGINS, type PluginCatalogEntry, type PublicAccount } from "@gge/contracts"
import { messageOf } from "@gge/ui"
import { orpc, queryClient } from "../api.ts"
import { changedPlugins, moduleReducer, pluginsToSave, startModule } from "../module-values.ts"
import { AttackAwareSwitch } from "./PluginPanels.tsx"
import { PluginSection } from "./PluginSection.tsx"
import "../pages/module.css"

/** The plugin entries the Account settings tab edits, in the order they are listed. */
export const accountSettingsEntries = (catalog: PluginCatalogEntry[]) =>
    ACCOUNT_SETTINGS_PLUGINS.flatMap(key => catalog.find(entry => entry.key === key && !entry.hidden) ?? [])

/**
 * The account's own settings: the pause between attacks, the daily cap, which time skips may be spent and when to stop the bot.
 * Its edits are saved here, apart from the drawer's connection and plugin switches, and the plugins it holds are never sent by those.
 */
export function AccountSettings({ account, catalog, onDirty }: { account: PublicAccount; catalog: PluginCatalogEntry[]; onDirty: (dirty: boolean) => void }) {
    const { t } = useTranslation("client")
    const { t: tb } = useTranslation("bot")
    const { t: tc } = useTranslation("common")
    const { message } = App.useApp()
    const entries = accountSettingsEntries(catalog)
    const [state, dispatch] = useReducer(moduleReducer, undefined, () => startModule(entries, account.plugins))
    const [resetKey, setResetKey] = useState(0)
    const forms = useRef(new Map<string, FormInstance>())
    const dirty = changedPlugins(entries, state).length > 0

    useEffect(() => {
        onDirty(dirty)
        return () => onDirty(false)
    }, [dirty, onDirty])
    useEffect(() => {
        if (!dirty) return
        const warn = (e: BeforeUnloadEvent) => e.preventDefault()
        window.addEventListener("beforeunload", warn)
        return () => window.removeEventListener("beforeunload", warn)
    }, [dirty])

    const save = useMutation(orpc.accounts.update.mutationOptions({
        onSuccess: () => {
            dispatch({ type: "saved" })
            void queryClient.invalidateQueries({ queryKey: orpc.accounts.list.key() })
            message.success(t("module.saved", { name: account.name }))
        },
        onError: error => message.error(messageOf(error)),
    }))
    async function onSave() {
        const valid = await Promise.all([...forms.current.values()].map(form => form.validateFields().then(() => true, () => false)))
        if (valid.includes(false)) return void message.error(t("module.fixErrors"))
        save.mutate({ id: account.id, plugins: pluginsToSave(account.plugins, entries, state.values) })
    }
    function discard() {
        dispatch({ type: "discard" })
        setResetKey(n => n + 1)
    }

    return (
        <div className="gge-account-settings">
            <Typography.Paragraph type="secondary">{t("drawer.accountSettingsIntro")}</Typography.Paragraph>
            {entries.map(entry => {
                const label = tb(entry.key, { defaultValue: entry.key })
                return (
                    <Card key={`${entry.key}-${resetKey}`} className="gge-gilded" style={{ marginBottom: 16 }}
                        title={<span className="gge-display">{label}</span>}
                        extra={!entry.force && <AttackAwareSwitch label={label} blockTurningOn={false} checked={Boolean(state.values[entry.key]?.enabled)} disabled={save.isPending}
                            onChange={enabled => dispatch({ type: "enabled", plugin: entry.key, enabled })} />}>
                        <PluginSection entry={entry} state={state} disabled={save.isPending} castles={[]} accountId={account.id} inForm
                            register={form => form ? forms.current.set(entry.key, form) : forms.current.delete(entry.key)}
                            onOptions={options => dispatch({ type: "options", plugin: entry.key, options })} />
                    </Card>
                )
            })}
            {dirty && (
                <div className="gge-savebar" role="region" aria-label={t("module.unsaved")}>
                    <span>{t("module.unsaved")}</span>
                    <div className="gge-savebar-actions">
                        <Button onClick={discard} disabled={save.isPending}>{t("module.discard")}</Button>
                        <Button type="primary" loading={save.isPending} onClick={() => void onSave()} className="gge-press">{tc("action.save")}</Button>
                    </div>
                </div>
            )}
        </div>
    )
}
