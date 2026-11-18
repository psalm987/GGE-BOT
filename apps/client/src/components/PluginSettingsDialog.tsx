import { Alert, App, Button, Form, Grid, Modal, Row, Segmented, Space, Typography } from "antd"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { AccountCastle, PluginCatalogEntry, PluginStates } from "@gge/contracts"
import { messageOf, palette } from "@gge/ui"
import { changedAdvanced, type OptionValues, type PluginFormValues } from "../plugin-values.ts"
import { PluginOptionField } from "./PluginOptionField.tsx"
import { BreaksPeaceTag, PluginStatusPill, SetupChecks, readView, writeView, type PluginPill, type View } from "./PluginPanels.tsx"

export { BreaksPeaceTag, PluginStatusPill, usePluginPill, type PillState, type PluginPill } from "./PluginPanels.tsx"

export type PluginDialogProps = {
    entry: PluginCatalogEntry
    label: string
    initial: OptionValues
    pill: PluginPill | null
    /** Every plugin's values in the account form, for checks that read another plugin's settings. */
    allValues: PluginFormValues | undefined
    pluginStates: PluginStates
    castles: AccountCastle[]
    onSave: (options: OptionValues) => Promise<void>
    onClose: () => void
}

/**
 * One plugin's settings: its status and why, a Simple/Advanced switch, Setup checks beside the form (above it on a
 * phone), and a footer that stays in view.
 */
export function PluginSettingsDialog({ entry, label, initial, pill, allValues, pluginStates, castles, onSave, onClose }: PluginDialogProps) {
    const { t } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const { t: tb, i18n } = useTranslation("bot")
    const { modal } = App.useApp()
    const phone = !Grid.useBreakpoint().md
    const [form] = Form.useForm<{ options: OptionValues }>()
    const [view, setView] = useState<View>(readView)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string>()
    const watched = Form.useWatch("options", form) as OptionValues | undefined
    const options = { ...initial, ...watched }
    const hasAdvanced = entry.options.some(def => def.advanced)
    const advancedChanged = changedAdvanced(entry, options)
    const showAdvanced = view === "advanced" || !hasAdvanced
    const descriptionKey = `${entry.key}.description`
    const description = i18n.exists(descriptionKey, { ns: "bot" }) ? tb(descriptionKey) : null

    const checks = (entry.checks ?? []).length > 0 && (
        <SetupChecks entry={entry} beside={!phone} input={{
            options,
            plugins: { ...Object.fromEntries(Object.entries(allValues ?? {}).map(([key, value]) => [key, value.options])), [entry.key]: options },
            pluginStates,
        }} />
    )

    async function save() {
        const values = await form.validateFields().catch(() => undefined)
        if (!values)
            return
        setSaving(true)
        setError(undefined)
        try {
            await onSave({ ...initial, ...form.getFieldValue("options") })
            onClose()
        } catch (e) {
            setError(messageOf(e))
        } finally {
            setSaving(false)
        }
    }

    function cancel() {
        if (!form.isFieldsTouched())
            return onClose()
        modal.confirm({
            title: t("drawer.discardTitle"),
            content: t("drawer.discardBody"),
            okText: t("drawer.discard"),
            okButtonProps: { danger: true },
            cancelText: t("drawer.keepEditing"),
            onOk: onClose,
        })
    }

    return (
        <Modal open onCancel={cancel} width={phone ? "100%" : 980} centered={!phone} mask={{ closable: false }} destroyOnHidden
            style={phone ? { top: 0, maxWidth: "100vw", margin: 0, paddingBottom: 0 } : undefined}
            styles={{ body: { maxHeight: phone ? "calc(100dvh - 210px)" : "calc(100dvh - 300px)", overflowY: "auto", paddingInlineEnd: 4 } }}
            title={
                <div style={{ display: "grid", gap: 8, paddingInlineEnd: 32 }}>
                    <Space wrap size={[10, 6]}>
                        <span className="gge-display" style={{ fontSize: 20 }}>{t("plugins.settingsFor", { plugin: label })}</span>
                        {entry.breaksPeace && <BreaksPeaceTag />}
                    </Space>
                    {description && <Typography.Paragraph style={{ margin: 0, fontWeight: 400, fontSize: 14, color: palette.muted }}>{description}</Typography.Paragraph>}
                    {pill && (
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontWeight: 400, fontSize: 14 }}>
                            <PluginStatusPill state={pill.state} />
                            {pill.reason && <span style={{ color: palette.muted }}>{pill.reason}</span>}
                        </div>
                    )}
                </div>
            }
            footer={
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
                    {hasAdvanced
                        ? <Segmented<View> aria-label={t("plugins.view.label")} value={view} onChange={next => { setView(next); writeView(next) }}
                            options={[
                                { value: "simple", label: t("plugins.view.simple") },
                                { value: "advanced", label: advancedChanged ? t("plugins.view.advancedChanged", { count: advancedChanged }) : t("plugins.view.advanced") },
                            ]} />
                        : <span />}
                    <Space>
                        <Button onClick={cancel}>{tc("action.cancel")}</Button>
                        <Button type="primary" loading={saving} onClick={() => void save()} className="gge-press">{tc("action.save")}</Button>
                    </Space>
                </div>
            }>
            <div style={{ display: "grid", gap: 16, gridTemplateColumns: phone || !checks ? "minmax(0, 1fr)" : "minmax(0, 1fr) 280px", alignItems: "start" }}>
                {phone && checks}
                <div>
                    {entry.breaksPeace && <Alert type="warning" showIcon title={t("plugins.breaksPeace")} description={t("plugins.breaksPeaceBody")} style={{ marginBottom: 16 }} />}
                    {error && <Alert type="error" showIcon title={error} role="alert" style={{ marginBottom: 16 }} />}
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ options: initial }} disabled={saving}>
                        <Row gutter={16}>
                            {entry.options.map((def, i) => <PluginOptionField key={def.key ?? `gap-${i}`} plugin={entry.key} def={def} castles={castles} hidden={Boolean(def.advanced) && !showAdvanced} />)}
                        </Row>
                    </Form>
                </div>
                {!phone && checks}
            </div>
        </Modal>
    )
}
