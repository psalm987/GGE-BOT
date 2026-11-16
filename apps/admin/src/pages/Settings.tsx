import { useMutation, useQuery } from "@tanstack/react-query"
import { App, Form, Select, Typography } from "antd"
import { ParchmentCard } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"
import { AdminPage, QueryError } from "../components/AdminPage.tsx"

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
        </AdminPage>
    )
}
