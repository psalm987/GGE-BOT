import { useMutation, useQuery } from "@tanstack/react-query"
import { App, Alert, Button, Drawer, Form, Grid, Input, Select, Space, Switch, Tabs } from "antd"
import { useEffect } from "react"
import type { PublicAccount } from "@gge/contracts"
import { messageOf, orpc, queryClient } from "../api.ts"
import { LogsPanel } from "./LogsPanel.tsx"
import { PluginSettingsForm, pluginFormValues, toPluginSettings, type PluginFormValues } from "./PluginSettingsForm.tsx"
import { RunsPanel } from "./RunsPanel.tsx"

type Values = { name: string; serverId: number; password?: string; externalEvent: boolean; plugins: PluginFormValues }

/**
 * Add or edit one game account: settings, plugins, and for existing accounts its logs and runs.
 * With twinOf, it adds that account's event twin, prefilled with its name and server.
 */
export function AccountDrawer({ open, account, twinOf, onClose }: { open: boolean; account?: PublicAccount; twinOf?: PublicAccount; onClose: () => void }) {
    const { message, modal } = App.useApp()
    const [form] = Form.useForm<Values>()
    const servers = useQuery(orpc.servers.list.queryOptions())
    const catalog = useQuery(orpc.plugins.catalog.queryOptions())
    const isNew = !account
    const phone = !Grid.useBreakpoint().md

    useEffect(() => {
        if (!open || !catalog.data)
            return
        form.resetFields()
        form.setFieldsValue({
            name: account?.name ?? twinOf?.name ?? "",
            serverId: account?.serverId ?? twinOf?.serverId,
            externalEvent: account?.externalEvent ?? Boolean(twinOf),
            plugins: pluginFormValues(catalog.data, account?.plugins),
        })
    }, [open, account, twinOf, catalog.data, form])

    const done = (text: string) => {
        void queryClient.invalidateQueries({ queryKey: orpc.accounts.list.key() })
        message.success(text)
        onClose()
    }
    const create = useMutation(orpc.accounts.create.mutationOptions({ onSuccess: a => done(`${a.name} added`) }))
    const update = useMutation(orpc.accounts.update.mutationOptions({ onSuccess: a => done(`${a.name} saved`) }))
    const saving = create.isPending || update.isPending
    const error = create.error ?? update.error

    function save(values: Values) {
        const plugins = toPluginSettings(catalog.data ?? [], values.plugins)
        if (isNew)
            create.mutate({ name: values.name, serverId: values.serverId, password: values.password!, externalEvent: values.externalEvent, plugins })
        else
            update.mutate({
                id: account.id, name: values.name, serverId: values.serverId, externalEvent: values.externalEvent, plugins,
                ...(values.password ? { password: values.password } : {}),
            })
    }

    function close() {
        if (!form.isFieldsTouched())
            return onClose()
        modal.confirm({
            title: "Discard your changes?",
            content: "The changes you made to this account haven't been saved.",
            okText: "Discard",
            okButtonProps: { danger: true },
            cancelText: "Keep editing",
            onOk: onClose,
        })
    }

    const settings = (
        <Form form={form} layout="vertical" requiredMark={false} onFinish={save} disabled={saving}>
            {error && <Alert type="error" showIcon title={messageOf(error)} style={{ marginBottom: 16 }} role="alert" />}
            <Form.Item label="Game account name" name="name" rules={[{ required: true, whitespace: true, message: "Enter the in-game name" }]}>
                <Input autoComplete="off" />
            </Form.Item>
            <Form.Item label="Server" name="serverId" rules={[{ required: true, message: "Pick the account's server" }]}>
                <Select showSearch={{ optionFilterProp: "label" }} loading={servers.isPending} placeholder="Choose a server"
                    options={servers.data?.map(s => ({ value: s.id, label: s.label }))} />
            </Form.Item>
            <Form.Item label={isNew ? "Game password" : "New game password"} name="password"
                extra={isNew ? "Stored encrypted. Nobody can read it back, admins included." : "Leave empty to keep the current password."}
                rules={isNew ? [{ required: true, message: "Enter the game password" }] : []}>
                <Input.Password autoComplete="new-password" placeholder={isNew ? undefined : "Unchanged"} />
            </Form.Item>
            <Form.Item label="External event account" name="externalEvent" valuePropName="checked"
                extra="Plays the temporary event server. Pair it with this account's normal twin for the fastest start.">
                <Switch />
            </Form.Item>
            <Form.Item label="Plugins">
                <PluginSettingsForm catalog={catalog.data ?? []} />
            </Form.Item>
        </Form>
    )

    return (
        <Drawer open={open} onClose={close} size={phone ? "100%" : 620} destroyOnHidden title={<span className="gge-display">{isNew ? (twinOf ? `Add event twin for ${twinOf.name}` : "Add game account") : account.name}</span>}
            footer={<Space style={{ width: "100%", justifyContent: "flex-end" }}>
                <Button onClick={close}>Cancel</Button>
                <Button type="primary" loading={saving} onClick={() => form.submit()} className="gge-press">{isNew ? "Add account" : "Save changes"}</Button>
            </Space>}>
            {isNew ? settings : (
                <Tabs items={[
                    { key: "settings", label: "Settings", children: settings },
                    { key: "logs", label: "Logs", children: <LogsPanel accountId={account.id} /> },
                    { key: "runs", label: "Run history", children: <RunsPanel accountId={account.id} /> },
                ]} />
            )}
        </Drawer>
    )
}
