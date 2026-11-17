import { useMutation, useQuery } from "@tanstack/react-query"
import { App, Alert, Button, Drawer, Form, Grid, Input, Select, Space, Switch, Tabs } from "antd"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { PublicAccount, Schedule } from "@gge/contracts"
import { messageOf, SigilStatus } from "@gge/ui"
import { orpc, queryClient } from "../api.ts"
import { AccountLogs, AccountRuns } from "./AccountHistory.tsx"
import { AccountOverview } from "./AccountOverview.tsx"
import { withPluginOptions } from "../plugin-values.ts"
import { PluginSettingsForm, pluginFormValues, toPluginSettings, type PluginFormValues, type SavePluginOptions } from "./PluginSettingsForm.tsx"
import { ScheduleEditor, scheduleProblem } from "./ScheduleEditor.tsx"

type Values = { name: string; serverId: number; password?: string; externalEvent: boolean; plugins: PluginFormValues; schedule: Schedule | null }

/**
 * Add or edit one game account: settings, plugins and schedule, and for existing accounts its logs and runs.
 * With twinOf, it adds that account's event twin, prefilled with its name and server.
 */
export function AccountDrawer({ open, account, twinOf, openPlugin, onClose }: { open: boolean; account?: PublicAccount; twinOf?: PublicAccount; openPlugin?: string; onClose: () => void }) {
    const { message, modal } = App.useApp()
    const { t } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const [form] = Form.useForm<Values>()
    const servers = useQuery(orpc.servers.list.queryOptions())
    const catalog = useQuery(orpc.plugins.catalog.queryOptions())
    const isNew = !account
    const phone = !Grid.useBreakpoint().md
    const [tab, setTab] = useState("overview")
    // `account` is as it was when the drawer opened, so the form isn't reset under the player. The status shown is the current one.
    const current = useQuery({ ...orpc.accounts.list.queryOptions(), select: list => list.find(a => a.id === account?.id), enabled: Boolean(account) }).data ?? account

    // The command palette opens a plugin's settings, which live on the Settings tab.
    useEffect(() => {
        if (open && openPlugin)
            setTab("settings")
    }, [open, openPlugin])

    useEffect(() => {
        if (!open || !catalog.data)
            return
        form.resetFields()
        form.setFieldsValue({
            name: account?.name ?? twinOf?.name ?? "",
            serverId: account?.serverId ?? twinOf?.serverId,
            externalEvent: account?.externalEvent ?? Boolean(twinOf),
            plugins: pluginFormValues(catalog.data, account?.plugins),
            schedule: account?.schedule ?? null,
        })
    }, [open, account, twinOf, catalog.data, form])

    const shut = () => {
        setTab("overview")
        onClose()
    }
    const done = (text: string) => {
        void queryClient.invalidateQueries({ queryKey: orpc.accounts.list.key() })
        message.success(text)
        shut()
    }
    const create = useMutation(orpc.accounts.create.mutationOptions({ onSuccess: a => done(t("drawer.added", { name: a.name })) }))
    const update = useMutation(orpc.accounts.update.mutationOptions({ onSuccess: a => done(t("drawer.saved", { name: a.name })) }))
    // One plugin's dialog saves at once, without the rest of the drawer and without closing it.
    const savePlugin = useMutation(orpc.accounts.update.mutationOptions({ onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.accounts.list.key() }) }))
    const savePluginOptions: SavePluginOptions | undefined = account && (async (entry, options) => {
        await savePlugin.mutateAsync({ id: account.id, plugins: withPluginOptions(current?.plugins ?? account.plugins, entry, options) })
    })
    const saving = create.isPending || update.isPending
    const error = create.error ?? update.error

    function save(values: Values) {
        const plugins = toPluginSettings(catalog.data ?? [], values.plugins)
        // Read from the form's store: `values` leaves the schedule out until its tab has been opened.
        const schedule: Schedule | null = form.getFieldValue("schedule")
        if (isNew)
            create.mutate({ name: values.name, serverId: values.serverId, password: values.password!, externalEvent: values.externalEvent, plugins, schedule })
        else
            update.mutate({
                id: account.id, name: values.name, serverId: values.serverId, externalEvent: values.externalEvent, plugins, schedule,
                ...(values.password ? { password: values.password } : {}),
            })
    }

    function close() {
        if (!form.isFieldsTouched())
            return shut()
        modal.confirm({
            title: t("drawer.discardTitle"),
            content: t("drawer.discardBody"),
            okText: t("drawer.discard"),
            okButtonProps: { danger: true },
            cancelText: t("drawer.keepEditing"),
            onOk: shut,
        })
    }

    // A new account has no tabs, so its schedule is a section under the plugins.
    const schedule = (
        <Form.Item name="schedule" label={isNew ? t("drawer.schedule") : undefined} validateTrigger="onSubmit"
            rules={[{ validator: (_, value: Schedule | null) => scheduleProblem(value) ? Promise.reject(new Error(t("drawer.scheduleInvalid"))) : Promise.resolve() }]}>
            <ScheduleEditor seed={account?.id} />
        </Form.Item>
    )
    const settings = (
        <>
            <Form.Item label={t("drawer.nameLabel")} name="name" rules={[{ required: true, whitespace: true, message: t("drawer.nameRequired") }]}>
                <Input autoComplete="off" />
            </Form.Item>
            <Form.Item label={tc("field.server")} name="serverId" rules={[{ required: true, message: t("drawer.serverRequired") }]}>
                <Select showSearch={{ optionFilterProp: "label" }} loading={servers.isPending} placeholder={t("drawer.serverPlaceholder")}
                    options={servers.data?.map(s => ({ value: s.id, label: s.label }))} />
            </Form.Item>
            <Form.Item label={isNew ? t("drawer.passwordNew") : t("drawer.passwordEdit")} name="password"
                extra={isNew ? t("drawer.passwordHintNew") : t("drawer.passwordHintEdit")}
                rules={isNew ? [{ required: true, message: t("drawer.passwordRequired") }] : []}>
                <Input.Password autoComplete="new-password" placeholder={isNew ? undefined : t("drawer.passwordUnchanged")} />
            </Form.Item>
            <Form.Item label={t("drawer.eventLabel")} name="externalEvent" valuePropName="checked"
                extra={t("drawer.eventHint")}>
                <Switch />
            </Form.Item>
            <Form.Item label={t("drawer.plugins")}>
                <PluginSettingsForm catalog={catalog.data ?? []} account={current} onSavePlugin={savePluginOptions} openPlugin={open ? openPlugin : undefined} />
            </Form.Item>
            {isNew && schedule}
        </>
    )

    return (
        <Drawer open={open} onClose={close} size={phone ? "100%" : 620} destroyOnHidden
            title={<Space wrap size={[12, 4]}>
                <span className="gge-display">{isNew ? (twinOf ? t("account.addTwinFor", { name: twinOf.name }) : t("drawer.titleNew")) : account.name}</span>
                {current?.entitled && <SigilStatus state={current.status?.actualState} detail={current.status?.lastError} sleepingUntil={current.sleepingUntil} />}
            </Space>}
            footer={<Space style={{ width: "100%", justifyContent: "flex-end" }}>
                <Button onClick={close}>{tc("action.cancel")}</Button>
                <Button type="primary" loading={saving} onClick={() => form.submit()} className="gge-press">{isNew ? t("account.add") : t("drawer.saveChanges")}</Button>
            </Space>}>
            <Form form={form} layout="vertical" requiredMark={false} onFinish={save} disabled={saving}
                onFinishFailed={({ errorFields }) => setTab(errorFields[0]?.name[0] === "schedule" ? "schedule" : "settings")}>
                {error && <Alert type="error" showIcon title={messageOf(error)} style={{ marginBottom: 16 }} role="alert" />}
                {isNew ? settings : (
                    <Tabs className="gge-account-tabs" activeKey={tab} onChange={setTab} size={phone ? "small" : "middle"} tabBarGutter={phone ? 14 : undefined} items={[
                        { key: "overview", label: t("drawer.overview"), children: <AccountOverview account={current ?? account} /> },
                        { key: "settings", label: tc("nav.settings"), children: settings },
                        { key: "schedule", label: t("drawer.schedule"), children: schedule },
                        { key: "logs", label: t("nav.logs"), children: <AccountLogs key={account.id} accountId={account.id} /> },
                        { key: "runs", label: t("drawer.runHistory"), children: <AccountRuns accountId={account.id} /> },
                    ]} />
                )}
            </Form>
        </Drawer>
    )
}
