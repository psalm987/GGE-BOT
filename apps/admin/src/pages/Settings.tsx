import { useMutation, useQuery } from "@tanstack/react-query"
import { App, Button, Form, Modal, Select, Typography } from "antd"
import { useState } from "react"
import { ParchmentCard } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"
import { AdminPage, QueryError } from "../components/AdminPage.tsx"
import { CODE_RULES, CodeInput } from "../components/CodeInput.tsx"
import { RecoveryCodes } from "../components/RecoveryCodes.tsx"

export const ATTACK_CAP_OPTIONS = [
    { value: "4", label: "4 attack plugins" },
    { value: "6", label: "6 attack plugins" },
    { value: "none", label: "No limit" },
] as const

export function Settings() {
    const { message } = App.useApp()
    const settings = useQuery(orpc.settings.get.queryOptions())
    const setCap = useMutation(orpc.settings.setAttackPluginCap.mutationOptions({
        onSuccess: () => {
            message.success("Default updated")
            void queryClient.invalidateQueries({ queryKey: orpc.settings.get.key() })
            void queryClient.invalidateQueries({ queryKey: orpc.users.list.key() })
        },
        onError: (error: unknown) => message.error(messageOf(error)),
    }))
    return (
        <AdminPage title="Settings">
            {settings.error && <QueryError error={settings.error} onRetry={() => void settings.refetch()} />}
            <ParchmentCard title="Attack plugins">
                <Typography.Paragraph type="secondary">
                    How many attack plugins one game account may run at once. Players with an override on the Users page use that instead.
                    Bots already over a new limit stop until their owner turns some plugins off.
                </Typography.Paragraph>
                <Form layout="vertical">
                    <Form.Item label="Default limit" htmlFor="attack-cap-default">
                        <Select id="attack-cap-default" style={{ width: 220 }} loading={settings.isPending} disabled={setCap.isPending}
                            value={settings.data?.attackPluginCap} options={[...ATTACK_CAP_OPTIONS]}
                            onChange={cap => setCap.mutate({ cap })} />
                    </Form.Item>
                </Form>
            </ParchmentCard>
            <TwoFactorCard />
        </AdminPage>
    )
}

type Regenerate = { name: "closed" } | { name: "asking" } | { name: "done"; codes: string[] }

function TwoFactorCard() {
    const { message } = App.useApp()
    const [state, setState] = useState<Regenerate>({ name: "closed" })
    const [form] = Form.useForm<{ code: string }>()
    const regenerate = useMutation(orpc.security.regenerateRecoveryCodes.mutationOptions({
        onSuccess: codes => setState({ name: "done", codes }),
        onError: (error: unknown) => message.error(messageOf(error)),
    }))
    const close = () => { form.resetFields(); setState({ name: "closed" }) }
    return (
        <ParchmentCard title="Two-factor sign-in" style={{ marginTop: 16 }}>
            <Typography.Paragraph type="secondary">
                You sign in with your password and a code from your authenticator app. A recovery code signs you in once if you lose the app.
                Making new recovery codes retires the old ones.
            </Typography.Paragraph>
            <Button onClick={() => setState({ name: "asking" })}>Regenerate recovery codes</Button>
            <Modal open={state.name !== "closed"} onCancel={close} destroyOnHidden
                title={state.name === "done" ? "Your new recovery codes" : "Regenerate recovery codes"}
                footer={state.name === "done"
                    ? <Button type="primary" onClick={close}>I've saved them</Button>
                    : [<Button key="cancel" onClick={close}>Cancel</Button>, <Button key="ok" type="primary" loading={regenerate.isPending} onClick={() => form.submit()}>Regenerate</Button>]}>
                {state.name === "done" ? <RecoveryCodes codes={state.codes} /> : (
                    <Form form={form} layout="vertical" requiredMark={false} disabled={regenerate.isPending} onFinish={values => regenerate.mutate(values)}>
                        <Form.Item label="Authenticator code" name="code" extra="Enter a current code to confirm it's you. Your old recovery codes stop working." rules={CODE_RULES}>
                            <CodeInput autoFocus />
                        </Form.Item>
                    </Form>
                )}
            </Modal>
        </ParchmentCard>
    )
}
