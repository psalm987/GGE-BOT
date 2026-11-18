import { useMutation, useQuery } from "@tanstack/react-query"
import { Alert, App, Button, Card, Form, Grid, Progress, Row, Segmented, Select, Skeleton, Tabs, Tag, Typography, type FormInstance } from "antd"
import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, Navigate, useParams, useSearchParams } from "react-router"
import { MODULES, type AccountCastle, type ModuleDef, type PluginCatalogEntry, type PluginStates, type PublicAccount } from "@gge/contracts"
import { GameArt, messageOf, ParchmentCard, SigilStatus } from "@gge/ui"
import { orpc, queryClient } from "../api.ts"
import { ComingSoon } from "./ComingSoon.tsx"
import { AppLayout } from "../components/AppLayout.tsx"
import { PluginOptionField } from "../components/PluginOptionField.tsx"
import { AttackAwareSwitch, BreaksPeaceTag, PluginStatusPill, SetupChecks, readView, usePluginPill, writeView, type View } from "../components/PluginPanels.tsx"
import { changedAdvanced } from "../plugin-values.ts"
import { attackPluginsOn, changedPlugins, moduleReducer, pluginsToSave, startModule, type ModuleState } from "../module-values.ts"
import { moduleKey } from "../nav.ts"
import type { OptionValues } from "../plugin-values.ts"
import { pollInterval, useRealtimeState } from "../realtime.ts"
import { hasUnsaved, setUnsaved } from "../unsaved.ts"
import "./module.css"

const LAST_ACCOUNT = "gge.lastAccount"
const remembered = () => { try { return localStorage.getItem(LAST_ACCOUNT) } catch { return null } }
const remember = (id: string) => { try { localStorage.setItem(LAST_ACCOUNT, id) } catch { /* the pick just isn't remembered */ } }

/** One module's page. */
export function Module() {
    const { id } = useParams()
    const { t } = useTranslation("client")
    const module = MODULES.find(m => m.id === id)
    if (!module) return <Navigate to="/" replace />
    const title = <span className="gge-module-title"><GameArt icon={module.icon} size={28} /><span>{t(`modules.${module.id}.name`)}</span></span>
    return (
        <AppLayout activeKey={moduleKey(module.id)} title={title}>
            {module.status === "live" ? <LiveModule key={module.id} module={module} /> : <ComingSoon module={module} />}
        </AppLayout>
    )
}

/** The account to show: the one in the address, else the last one picked, else the first. */
function useAccountChoice(accounts: PublicAccount[] | undefined) {
    const [params, setParams] = useSearchParams()
    const wanted = params.get("account")
    const account = accounts?.find(a => a.id === wanted) ?? accounts?.find(a => a.id === remembered()) ?? accounts?.[0]
    useEffect(() => {
        if (!account) return
        remember(account.id)
        if (wanted !== account.id) setParams(current => { current.set("account", account.id); return current }, { replace: true })
    }, [account, wanted, setParams])
    return { account, choose: (id: string) => setParams(current => { current.set("account", id); return current }, { replace: true }) }
}

function LiveModule({ module }: { module: ModuleDef }) {
    const { t } = useTranslation("client")
    const { modal } = App.useApp()
    const accounts = useQuery({ ...orpc.accounts.list.queryOptions(), refetchInterval: pollInterval(useRealtimeState()) })
    const servers = useQuery(orpc.servers.list.queryOptions())
    const catalog = useQuery(orpc.plugins.catalog.queryOptions())
    const attackLimit = useQuery(orpc.plugins.attackLimit.queryOptions())
    const { account, choose } = useAccountChoice(accounts.data)
    const entries = useMemo(() => module.plugins.flatMap(key => catalog.data?.find(e => e.key === key && !e.hidden) ?? []), [module, catalog.data])

    function pick(id: string) {
        if (id === account?.id) return
        if (!hasUnsaved()) return choose(id)
        modal.confirm({
            title: t("drawer.discardTitle"), content: t("drawer.discardBody"), okText: t("drawer.discard"), okButtonProps: { danger: true }, cancelText: t("drawer.keepEditing"),
            onOk: () => { setUnsaved(false); choose(id) },
        })
    }
    const serverLabel = new Map(servers.data?.map(s => [s.id, s.label]))

    if (module.devOnly && catalog.data && !entries.length) return <Navigate to="/" replace />
    if (accounts.isPending || catalog.isPending) return <Skeleton active paragraph={{ rows: 8 }} />
    return (
        <div className="gge-module">
            <div className="gge-module-head">
                <p className="gge-module-intro">{t(`modules.${module.id}.description`)}</p>
                {account && (
                    <div className="gge-module-picker">
                        <label htmlFor="module-account">{t("module.account")}</label>
                        <Select id="module-account" value={account.id} onChange={pick}
                            options={accounts.data!.map(a => ({ value: a.id, label: `${a.name} · ${serverLabel.get(a.serverId) ?? a.serverId}${a.externalEvent ? ` · ${t("module.event")}` : ""}` }))} />
                    </div>
                )}
            </div>
            {!account && (
                <Alert type="info" showIcon title={t("module.noAccounts")} action={<Link to="/?add=1"><Button size="small">{t("module.addAccount")}</Button></Link>} />
            )}
            {/* A new state for each account, so one account's edits never show on another. */}
            <ModuleBody key={account?.id ?? "none"} module={module} entries={entries} catalog={catalog.data!} account={account} attackLimit={attackLimit.data ?? null} />
        </div>
    )
}

function ModuleBody({ module, entries, catalog, account, attackLimit }: {
    module: ModuleDef; entries: PluginCatalogEntry[]; catalog: PluginCatalogEntry[]; account: PublicAccount | undefined; attackLimit: number | null
}) {
    const { t } = useTranslation("client")
    const { t: tb } = useTranslation("bot")
    const { t: tc } = useTranslation("common")
    const { message } = App.useApp()
    const phone = !Grid.useBreakpoint().md
    const [state, dispatch] = useReducer(moduleReducer, undefined, () => startModule(entries, account?.plugins))
    const [view, setView] = useState<View>(readView)
    const [resetKey, setResetKey] = useState(0)
    const forms = useRef(new Map<string, FormInstance>())
    const dirty = changedPlugins(entries, state).length > 0
    const readOnly = !account

    useEffect(() => {
        setUnsaved(dirty)
        return () => setUnsaved(false)
    }, [dirty])
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
            message.success(t("module.saved", { name: account?.name }))
        },
        onError: error => message.error(messageOf(error)),
    }))
    async function onSave() {
        if (!account) return
        const valid = await Promise.all([...forms.current.values()].map(form => form.validateFields().then(() => true, () => false)))
        if (valid.includes(false)) return void message.error(t("module.fixErrors"))
        save.mutate({ id: account.id, plugins: pluginsToSave(account.plugins, entries, state.values) })
    }
    function discard() {
        dispatch({ type: "discard" })
        setResetKey(n => n + 1)
    }

    const attackEntries = entries.filter(e => e.category === "attack" && !e.force)
    const on = attackPluginsOn(catalog, account?.plugins ?? {}, state.values)
    const atLimit = attackLimit !== null && on >= attackLimit
    const botRunning = account?.status?.actualState === "running"
    const hasAdvanced = entries.some(e => e.options.some(def => def.advanced))
    const advancedChanged = entries.reduce((total, entry) => total + changedAdvanced(entry, state.values[entry.key]?.options ?? {}), 0)
    const castles = account?.status?.castles ?? []

    const sections = entries.map(entry => (
        <PluginSection key={`${entry.key}-${resetKey}`} entry={entry} state={state} view={view} disabled={readOnly || save.isPending}
            castles={castles} pluginStates={botRunning ? account?.status?.pluginStates ?? {} : {}} phone={phone}
            register={form => form ? forms.current.set(entry.key, form) : forms.current.delete(entry.key)}
            onOptions={options => dispatch({ type: "options", plugin: entry.key, options })} />
    ))
    const changed = new Set(changedPlugins(entries, state))

    return (
        <>
            <ParchmentCard title={t("module.status")} extra={account?.entitled && <SigilStatus state={account.status?.actualState} detail={account.status?.lastError} sleepingUntil={account.sleepingUntil} />}>
                {attackEntries.length > 0 && (
                    <div className="gge-module-cap">
                        <Typography.Text type={attackLimit !== null && on > attackLimit ? "danger" : "secondary"}>
                            {attackLimit !== null ? t("plugins.attackCountLimited", { count: on, limit: attackLimit }) : t("plugins.attackCount", { count: on })}
                        </Typography.Text>
                        {attackLimit !== null && <Progress percent={Math.min(100, Math.round(on / attackLimit * 100))} showInfo={false} size="small" status={on > attackLimit ? "exception" : atLimit ? "active" : "normal"}
                            aria-label={t("plugins.attackCountLimited", { count: on, limit: attackLimit })} />}
                    </div>
                )}
                {entries.map(entry => <StatusRow key={entry.key} entry={entry} account={account} state={state} blocked={entry.category === "attack" && atLimit}
                    onEnabled={enabled => dispatch({ type: "enabled", plugin: entry.key, enabled })} readOnly={readOnly || save.isPending} />)}
            </ParchmentCard>

            {readOnly && <Typography.Text type="secondary" role="status">{t("module.readOnly")}</Typography.Text>}
            {hasAdvanced && (
                <div className="gge-module-tools">
                    <Segmented<View> aria-label={t("plugins.view.label")} value={view} onChange={next => { setView(next); writeView(next) }}
                        options={[{ value: "simple", label: t("plugins.view.simple") }, { value: "advanced", label: advancedChanged ? t("plugins.view.advancedChanged", { count: advancedChanged }) : t("plugins.view.advanced") }]} />
                </div>
            )}

            {module.tabs === "per-plugin" && entries.length > 1
                ? <Tabs items={entries.map((entry, i) => ({
                    key: entry.key, forceRender: true, children: sections[i],
                    label: <span>{tb(entry.key, { defaultValue: entry.key })}{changed.has(entry.key) && <Tag color="gold" style={{ marginInlineStart: 8 }}>{t("module.changed")}</Tag>}</span>,
                }))} />
                : entries.map((entry, i) => entries.length > 1
                    ? <Card key={entry.key} title={<span className="gge-display">{tb(entry.key, { defaultValue: entry.key })}</span>} className="gge-gilded">{sections[i]}</Card>
                    : <ParchmentCard key={entry.key}>{sections[i]}</ParchmentCard>)}

            {dirty && (
                <div className="gge-savebar" role="region" aria-label={t("module.unsaved")}>
                    <span>{t("module.unsaved")}</span>
                    <div className="gge-savebar-actions">
                        <Button onClick={discard} disabled={save.isPending}>{t("module.discard")}</Button>
                        <Button type="primary" loading={save.isPending} onClick={() => void onSave()} className="gge-press">{tc("action.save")}</Button>
                    </div>
                </div>
            )}
        </>
    )
}

function StatusRow({ entry, account, state, blocked, onEnabled, readOnly }: {
    entry: PluginCatalogEntry; account: PublicAccount | undefined; state: ModuleState; blocked: boolean; onEnabled: (enabled: boolean) => void; readOnly: boolean
}) {
    const { t } = useTranslation("bot")
    const { t: tc } = useTranslation("client")
    const label = t(entry.key, { defaultValue: entry.key })
    const enabled = entry.force || Boolean(state.values[entry.key]?.enabled)
    const botRunning = account?.status?.actualState === "running"
    const pill = usePluginPill(enabled, botRunning, botRunning ? account?.status?.pluginStates?.[entry.key] : undefined)
    return (
        <div className="gge-module-plugin-row">
            {entry.force
                ? <Tag color="gold" style={{ marginInlineEnd: 0 }}>{tc("plugins.alwaysOn")}</Tag>
                : <AttackAwareSwitch label={label} checked={enabled} onChange={onEnabled} blockTurningOn={blocked} disabled={readOnly} />}
            <span className="gge-module-plugin-name">{label}</span>
            {entry.breaksPeace && <BreaksPeaceTag />}
            {account && enabled && botRunning && pill && <PluginStatusPill state={pill.state} />}
            {account && enabled && botRunning && pill?.reason && <span style={{ flexBasis: "100%", color: "var(--gge-muted)", fontSize: 14 }}>{pill.reason}</span>}
        </div>
    )
}

function PluginSection({ entry, state, view, disabled, castles, pluginStates, phone, register, onOptions }: {
    entry: PluginCatalogEntry; state: ModuleState; view: View; disabled: boolean
    castles: AccountCastle[]; pluginStates: PluginStates; phone: boolean
    register: (form: FormInstance | null) => void; onOptions: (options: OptionValues) => void
}) {
    const { t } = useTranslation("client")
    const { t: tb, i18n } = useTranslation("bot")
    const [form] = Form.useForm<{ options: OptionValues }>()
    useEffect(() => { register(form); return () => register(null) }, [form, register])
    const hasAdvanced = entry.options.some(def => def.advanced)
    const showAdvanced = view === "advanced" || !hasAdvanced
    const options = state.values[entry.key]?.options ?? {}
    const descriptionKey = `${entry.key}.description`
    const checks = (entry.checks ?? []).length > 0 && (
        <SetupChecks entry={entry} beside={!phone} input={{
            options, pluginStates,
            plugins: Object.fromEntries(Object.entries(state.values).map(([key, value]) => [key, value.options])),
        }} />
    )
    return (
        <div className="gge-module-section" data-checks={checks ? "" : undefined}>
            {phone && checks}
            <div>
                {i18n.exists(descriptionKey, { ns: "bot" }) && <Typography.Paragraph type="secondary">{tb(descriptionKey)}</Typography.Paragraph>}
                {entry.breaksPeace && <Alert type="warning" showIcon title={t("plugins.breaksPeace")} description={t("plugins.breaksPeaceBody")} style={{ marginBottom: 16 }} />}
                <Form name={entry.key} form={form} layout="vertical" requiredMark={false} disabled={disabled} initialValues={{ options }}
                    onValuesChange={(_, all) => onOptions({ ...options, ...all.options })}>
                    <PluginFields entry={entry} castles={castles} showAdvanced={showAdvanced} />
                </Form>
            </div>
            {!phone && checks}
        </div>
    )
}

function PluginFields({ entry, castles, showAdvanced }: { entry: PluginCatalogEntry; castles: AccountCastle[]; showAdvanced: boolean }) {
    return (
        <Row>
            {entry.options.map((def, i) => <PluginOptionField key={def.key ?? `gap-${i}`} plugin={entry.key} def={def} castles={castles} hidden={Boolean(def.advanced) && !showAdvanced} />)}
        </Row>
    )
}
