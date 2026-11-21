import { useMutation, useQuery } from "@tanstack/react-query"
import { Alert, App, Button, Card, Progress, Select, Skeleton, Tabs, Tag, Typography, type FormInstance } from "antd"
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Link, Navigate, useParams, useSearchParams } from "react-router"
import { MODULES, commanderUsage, type ModuleDef, type PluginCatalogEntry, type PublicAccount } from "@gge/contracts"
import { Icon, messageOf, ParchmentCard } from "@gge/ui"
import { orpc, queryClient } from "../api.ts"
import { ComingSoon } from "./ComingSoon.tsx"
import { VirtualPresets } from "./VirtualPresets.tsx"
import { AppLayout } from "../components/AppLayout.tsx"
import { StartStop, StartStopDetail } from "../components/StartStop.tsx"
import { GlobalCard, KingdomPanel } from "../components/KingdomPanels.tsx"
import { CopyToAll } from "../components/PluginOptionField.tsx"
import { PluginSection } from "../components/PluginSection.tsx"
import { AttackAwareSwitch, BreaksPeaceTag, PluginStatusPill, usePluginPill } from "../components/PluginPanels.tsx"
import { attackPluginsOn, changedPlugins, dailyAsked, moduleReducer, pluginsToSave, startModule, type ModuleState } from "../module-values.ts"
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
    const [params] = useSearchParams()
    const module = MODULES.find(m => m.id === id)
    // Account settings was a module before it became a tab of the account's side panel, so its old address leads there.
    if (id === "account-settings") return <Navigate to={params.get("account") ? `/?account=${params.get("account")}&tab=account-settings` : "/"} replace />
    if (!module) return <Navigate to="/" replace />
    const title = <span className="gge-module-title"><Icon icon={module.icon} size={28} /><span>{t(`modules.${module.id}.name`)}</span></span>
    return (
        <AppLayout activeKey={moduleKey(module.id)} title={title}>
            {module.page === "virtualPresets" ? <VirtualPresets module={module} />
                : module.status === "live" ? <LiveModule key={module.id} module={module} /> : <ComingSoon module={module} />}
        </AppLayout>
    )
}

/** The account to show: the one in the address, else the last one picked, else the first. */
export function useAccountChoice(accounts: PublicAccount[] | undefined) {
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

/** What the module does, and the account its page is about. */
export function ModuleHead({ module, accounts, account, onPick }: { module: ModuleDef; accounts: PublicAccount[]; account: PublicAccount | undefined; onPick: (id: string) => void }) {
    const { t } = useTranslation("client")
    const servers = useQuery(orpc.servers.list.queryOptions())
    const serverLabel = new Map(servers.data?.map(s => [s.id, s.label]))
    return (
        <div className="gge-module-head">
            <p className="gge-module-intro">{t(`modules.${module.id}.description`)}</p>
            {account && (
                <div className="gge-module-picker">
                    <label htmlFor="module-account">{t("module.account")}</label>
                    <Select id="module-account" value={account.id} onChange={onPick}
                        options={accounts.map(a => ({ value: a.id, label: `${a.name} · ${serverLabel.get(a.serverId) ?? a.serverId}${a.externalEvent ? ` · ${t("module.event")}` : ""}` }))} />
                </div>
            )}
        </div>
    )
}

function LiveModule({ module }: { module: ModuleDef }) {
    const { t } = useTranslation("client")
    const { modal } = App.useApp()
    const accounts = useQuery({ ...orpc.accounts.list.queryOptions(), refetchInterval: pollInterval(useRealtimeState()) })
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

    if (module.devOnly && catalog.data && !entries.length) return <Navigate to="/" replace />
    if (accounts.isPending || catalog.isPending) return <Skeleton active paragraph={{ rows: 8 }} />
    return (
        <div className="gge-module">
            <ModuleHead module={module} accounts={accounts.data!} account={account} onPick={pick} />
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
    const [state, dispatch] = useReducer(moduleReducer, undefined, () => startModule(entries, account?.plugins))
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
    const castles = account?.status?.castles ?? []

    const sections = entries.map(entry => (
        <PluginSection key={`${entry.key}-${resetKey}`} entry={entry} state={state} disabled={readOnly || save.isPending}
            castles={castles} accountId={account?.id} commanders={account?.status?.commanders ?? null}
            register={form => form ? forms.current.set(entry.key, form) : forms.current.delete(entry.key)}
            onOptions={options => dispatch({ type: "options", plugin: entry.key, options })} />
    ))
    const changed = new Set(changedPlugins(entries, state))
    const byKingdom = module.tabs === "kingdoms"
    const commanderOption = module.global?.commanderOption
    /** One option's value, put into every plugin of the page: the forms that are drawn, and the page's own state. */
    function copyToAll(key: string, value: unknown) {
        for (const entry of entries) {
            forms.current.get(entry.key)?.setFieldValue(["options", key], value)
            dispatch({ type: "options", plugin: entry.key, options: { ...state.values[entry.key]?.options, [key]: value as OptionValues[string] } })
        }
        message.success(t(each === "events" ? "plugins.copiedToAllEvents" : "plugins.copiedToAll", { label: tb(key, { defaultValue: key }) }))
    }
    const each = module.global?.each ?? "kingdoms"
    const tabbed = module.tabs === "per-plugin" && entries.length > 1 && (
        <Tabs items={entries.map((entry, i) => ({
            key: entry.key, forceRender: true, children: sections[i],
            label: <span>{tb(entry.key, { defaultValue: entry.key })}{changed.has(entry.key) && <Tag color="gold" style={{ marginInlineStart: 8 }}>{t("module.changed")}</Tag>}</span>,
        }))} />
    )

    return (
        <>
            <ParchmentCard title={t("module.status")} extra={<StartStop account={account} />}>
                <StartStopDetail account={account} />
                {attackEntries.length > 0 && (
                    <div className="gge-module-cap">
                        <Typography.Text type={attackLimit !== null && on > attackLimit ? "danger" : "secondary"}>
                            {attackLimit !== null ? t("plugins.attackCountLimited", { count: on, limit: attackLimit }) : t("plugins.attackCount", { count: on })}
                        </Typography.Text>
                        {attackLimit !== null && <Progress percent={Math.min(100, Math.round(on / attackLimit * 100))} showInfo={false} size="small" status={on > attackLimit ? "exception" : atLimit ? "active" : "normal"}
                            aria-label={t("plugins.attackCountLimited", { count: on, limit: attackLimit })} />}
                    </div>
                )}
                {!byKingdom && entries.map(entry => <StatusRow key={entry.key} entry={entry} account={account} state={state} blocked={entry.category === "attack" && atLimit}
                    onEnabled={enabled => dispatch({ type: "enabled", plugin: entry.key, enabled })} readOnly={readOnly || save.isPending} />)}
            </ParchmentCard>
            <GlobalCard module={module} account={account} asked={dailyAsked(entries, state, module.global?.dailyCapOption)}
                commanders={commanderOption === undefined ? undefined : commanderUsage(entries.filter(e => state.values[e.key]?.enabled).map(e => String(state.values[e.key]?.options[commanderOption] ?? "")), account?.status?.commanders)}
                attackLimit={(account?.plugins.attack?.options.attackLimit as string | undefined) || catalog.find(e => e.key === "attack")?.options.flatMap(def => def.key === "attackLimit" && def.type === "Text" ? def.default ?? [] : [])[0]} />

            {readOnly && <Typography.Text type="secondary" role="status">{t("module.readOnly")}</Typography.Text>}

            {byKingdom
                ? <CopyToAll value={{ copy: copyToAll, each }}>
                    <div className="gge-kingdoms">
                        {entries.map((entry, i) => {
                            const kingdom = module.kingdoms![module.plugins.indexOf(entry.key)]!
                            return (
                                <KingdomSection key={entry.key} entry={entry} kingdom={kingdom} module={module} account={account} state={state} changed={changed.has(entry.key)}
                                    blocked={entry.category === "attack" && atLimit} readOnly={readOnly || save.isPending} locked={castles.length > 0 && !castles.some(c => c.kingdom === kingdom)}
                                    onEnabled={enabled => dispatch({ type: "enabled", plugin: entry.key, enabled })}>
                                    {sections[i]}
                                </KingdomSection>
                            )
                        })}
                    </div>
                </CopyToAll>
                : tabbed
                ? module.global ? <CopyToAll value={{ copy: copyToAll, each }}>{tabbed}</CopyToAll> : tabbed
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

function KingdomSection({ entry, kingdom, module, account, state, changed, blocked, readOnly, locked, onEnabled, children }: {
    entry: PluginCatalogEntry; kingdom: number; module: ModuleDef; account: PublicAccount | undefined; state: ModuleState; changed: boolean
    blocked: boolean; readOnly: boolean; locked: boolean; onEnabled: (enabled: boolean) => void; children: ReactNode
}) {
    const enabled = Boolean(state.values[entry.key]?.enabled)
    const botRunning = account?.status?.actualState === "running"
    const pill = usePluginPill(enabled, botRunning, botRunning ? account?.status?.pluginStates?.[entry.key] : undefined)
    return (
        <KingdomPanel kingdom={kingdom} icon={module.icon} enabled={enabled} onEnabled={onEnabled} blocked={blocked} readOnly={readOnly} changed={changed}
            pill={account && enabled && botRunning ? pill : null} locked={locked}>
            {children}
        </KingdomPanel>
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
