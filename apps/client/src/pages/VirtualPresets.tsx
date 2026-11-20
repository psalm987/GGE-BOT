import { CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Alert, App, Button, Input, Skeleton, Typography } from "antd"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { MAX_VIRTUAL_PRESETS, emptyPlan, type ManualPlan, type ModuleDef, type VirtualPreset } from "@gge/contracts"
import { messageOf, ParchmentCard } from "@gge/ui"
import { orpc, queryClient } from "../api.ts"
import { planCounts, pluginsSending } from "../army-values.ts"
import { WavePlanEditor } from "../components/WavePlanEditor.tsx"
import { pollInterval, useRealtimeState } from "../realtime.ts"
import { hasUnsaved, setUnsaved } from "../unsaved.ts"
import { ModuleHead, useAccountChoice } from "./Module.tsx"
import "./module.css"

/** The preset on the editor: a new one has no id yet. */
type Draft = { id?: string; name: string; plan: ManualPlan }

/** The account's virtual presets: a list, and the wave editor for the one being written. */
export function VirtualPresets({ module }: { module: ModuleDef }) {
    const { t } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const { t: tb } = useTranslation("bot")
    const { message, modal } = App.useApp()
    const accounts = useQuery({ ...orpc.accounts.list.queryOptions(), refetchInterval: pollInterval(useRealtimeState()) })
    const { account, choose } = useAccountChoice(accounts.data)
    const presets = useQuery({ ...orpc.virtualPresets.list.queryOptions({ input: { accountId: account?.id ?? "" } }), enabled: Boolean(account) })
    const [draft, setDraft] = useState<Draft | null>(null)
    const [dirty, setDirty] = useState(false)
    const [nameMissing, setNameMissing] = useState(false)

    useEffect(() => {
        setUnsaved(dirty)
        return () => setUnsaved(false)
    }, [dirty])

    const close = () => { setDraft(null); setDirty(false); setNameMissing(false) }
    const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.virtualPresets.list.key() })
    const onSaved = (preset: VirtualPreset) => { close(); void refresh(); message.success(t("presets.saved", { name: preset.name })) }
    const onError = (error: unknown) => message.error(messageOf(error))
    const create = useMutation(orpc.virtualPresets.create.mutationOptions({ onSuccess: onSaved, onError }))
    const update = useMutation(orpc.virtualPresets.update.mutationOptions({ onSuccess: onSaved, onError }))
    const duplicate = useMutation(orpc.virtualPresets.create.mutationOptions({
        onSuccess: preset => { void refresh(); message.success(t("presets.duplicated", { name: preset.name })) }, onError,
    }))
    /** The copy's name: the preset's, marked as a copy, inside the length a name may have. */
    const copyName = (name: string) => { const mark = t("presets.copyMark"); return `${name.slice(0, 60 - mark.length - 1)} ${mark}` }
    const remove = useMutation(orpc.virtualPresets.remove.mutationOptions({ onError }))
    const saving = create.isPending || update.isPending

    /** Runs `then` at once, or after the player agrees to drop the preset they are writing. */
    function guarded(then: () => void) {
        if (!hasUnsaved()) return then()
        modal.confirm({
            title: t("drawer.discardTitle"), content: t("drawer.discardBody"), okText: t("drawer.discard"), okButtonProps: { danger: true }, cancelText: t("drawer.keepEditing"),
            onOk: () => { close(); then() },
        })
    }
    const change = (next: Partial<Draft>) => { setDraft(current => current && { ...current, ...next }); setDirty(true) }
    function save() {
        if (!draft || !account) return
        const name = draft.name.trim()
        if (!name) return setNameMissing(true)
        if (draft.id) update.mutate({ id: draft.id, name, plan: draft.plan })
        else create.mutate({ accountId: account.id, name, plan: draft.plan })
    }
    const sentBy = (preset: VirtualPreset) => pluginsSending(account?.plugins ?? {}, preset.id).map(key => tb(key, { defaultValue: key })).join(", ")
    function confirmRemove(preset: VirtualPreset) {
        // The API refuses this too; saying which modules send the preset is what the player needs to free it.
        if (sentBy(preset)) return void modal.info({ title: t("presets.inUseTitle"), content: t("presets.inUse", { name: preset.name, modules: sentBy(preset) }) })
        modal.confirm({
            title: t("presets.deleteTitle", { name: preset.name }), content: t("presets.deleteBody"), okText: t("presets.delete"), okButtonProps: { danger: true },
            onOk: () => remove.mutateAsync({ id: preset.id }).then(() => {
                if (draft?.id === preset.id) close()
                void refresh()
                message.success(t("presets.deleted", { name: preset.name }))
            }, () => {}),
        })
    }

    if (accounts.isPending) return <Skeleton active paragraph={{ rows: 6 }} />
    const list = presets.data ?? []
    const full = list.length >= MAX_VIRTUAL_PRESETS
    return (
        <div className="gge-module">
            <ModuleHead module={module} accounts={accounts.data ?? []} account={account} onPick={id => id !== account?.id && guarded(() => choose(id))} />
            {!account && <Alert type="info" showIcon title={t("presets.noAccount")} action={<Link to="/?add=1"><Button size="small">{t("module.addAccount")}</Button></Link>} />}
            {account && (
                <ParchmentCard title={t("presets.title", { name: account.name })}>
                    <div className="gge-preset-actions">
                        <Button type="primary" icon={<PlusOutlined />} disabled={full} className="gge-press" aria-describedby={full ? "preset-limit" : undefined}
                            onClick={() => guarded(() => setDraft({ name: "", plan: emptyPlan() }))}>{t("presets.new")}</Button>
                        {!presets.isPending && <Typography.Text type="secondary" data-testid="preset-count">{t("presets.count", { used: list.length, max: MAX_VIRTUAL_PRESETS })}</Typography.Text>}
                        {full && <Typography.Text id="preset-limit" type="secondary">{t("presets.limit", { max: MAX_VIRTUAL_PRESETS })}</Typography.Text>}
                    </div>
                    {presets.isPending ? <Skeleton active paragraph={{ rows: 2 }} />
                        : list.length === 0 ? <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{t("presets.empty")}</Typography.Paragraph>
                        : <ul className="gge-preset-list">
                            {list.map(preset => (
                                <li key={preset.id}>
                                    <span className="gge-preset-name">{preset.name}</span>
                                    <span className="gge-preset-summary">
                                        {t("army.summary.plan", planCounts(preset.plan))}
                                        {sentBy(preset) && <><br />{t("presets.sentBy", { modules: sentBy(preset) })}</>}
                                    </span>
                                    <Button icon={<EditOutlined />} aria-label={t("presets.editNamed", { name: preset.name })}
                                        onClick={() => guarded(() => setDraft({ id: preset.id, name: preset.name, plan: preset.plan }))}>{t("presets.edit")}</Button>
                                    <Button icon={<CopyOutlined />} aria-label={t("presets.duplicateNamed", { name: preset.name })} disabled={full || duplicate.isPending}
                                        onClick={() => duplicate.mutate({ accountId: account.id, name: copyName(preset.name), plan: preset.plan })}>{t("presets.duplicate")}</Button>
                                    <Button danger icon={<DeleteOutlined />} aria-label={t("presets.deleteNamed", { name: preset.name })}
                                        onClick={() => confirmRemove(preset)}>{t("presets.delete")}</Button>
                                </li>
                            ))}
                        </ul>}
                </ParchmentCard>
            )}
            {draft && (
                <ParchmentCard title={draft.id ? t("presets.editorEdit", { name: list.find(p => p.id === draft.id)?.name ?? draft.name }) : t("presets.editorNew")}>
                    <div className="gge-preset-editor">
                        <div className="gge-preset-field">
                            <label htmlFor="preset-name">{t("presets.name")}</label>
                            <Input id="preset-name" value={draft.name} maxLength={60} placeholder={t("presets.namePlaceholder")} status={nameMissing ? "error" : undefined}
                                aria-invalid={nameMissing} aria-describedby={nameMissing ? "preset-name-error" : undefined}
                                onChange={event => { change({ name: event.target.value }); setNameMissing(false) }} />
                            {nameMissing && <span id="preset-name-error" role="alert" className="gge-preset-error">{t("presets.nameMissing")}</span>}
                        </div>
                        <WavePlanEditor value={draft.plan} onChange={plan => change({ plan })} disabled={saving} />
                        <div className="gge-savebar-actions">
                            <Button onClick={close} disabled={saving}>{t("presets.cancel")}</Button>
                            <Button type="primary" loading={saving} onClick={save} className="gge-press">{tc("action.save")}</Button>
                        </div>
                    </div>
                </ParchmentCard>
            )}
        </div>
    )
}
