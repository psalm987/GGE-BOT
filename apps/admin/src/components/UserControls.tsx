import { CheckCircleOutlined, CrownOutlined, LogoutOutlined, SafetyOutlined, StopOutlined } from "@ant-design/icons"
import { useMutation, useQuery } from "@tanstack/react-query"
import { App, Button, InputNumber, Popconfirm, Select, Space } from "antd"
import { client, messageOf, orpc, queryClient } from "../api.ts"
import { useMe } from "../auth.tsx"
import { ATTACK_CAP_OPTIONS } from "../pages/Settings.tsx"

export type UserRow = Awaited<ReturnType<typeof client.users.list>>["items"][number]

/** The user mutations, each of which refreshes every view of the user and the audit trail. */
export function useUserActions() {
    const { message } = App.useApp()
    const settle = (done: string) => ({
        onSuccess: () => {
            message.success(done)
            for (const queryKey of [orpc.users.list.key(), orpc.users.get.key(), ["audit"]])
                void queryClient.invalidateQueries({ queryKey })
        },
        onError: (error: unknown) => message.error(messageOf(error)),
    })
    return {
        setStatus: useMutation(orpc.users.setStatus.mutationOptions(settle("User updated"))),
        setRole: useMutation(orpc.users.setRole.mutationOptions(settle("Role updated"))),
        setMaxBots: useMutation(orpc.users.setMaxBots.mutationOptions(settle("Bot limit updated"))),
        setAttackCap: useMutation(orpc.users.setAttackPluginCap.mutationOptions(settle("Attack plugin limit updated"))),
        revoke: useMutation(orpc.users.revokeSessions.mutationOptions(settle("Signed out everywhere"))),
        resetTotp: useMutation(orpc.users.resetTotp.mutationOptions(settle("Two-factor sign-in reset"))),
    }
}

type Actions = ReturnType<typeof useUserActions>
type Controlled = { user: Pick<UserRow, "id" | "username" | "role" | "maxBots" | "attackPluginCap">; actions: Actions }

/** Edits the plan limit when the field loses focus. */
export function BotLimitInput({ user, actions }: Controlled) {
    return (
        <InputNumber key={`${user.id}:${user.maxBots}`} size="small" min={0} max={50} precision={0} defaultValue={user.maxBots} style={{ width: 64 }}
            aria-label={`Bot limit for ${user.username}`} disabled={user.role === "admin"} title={user.role === "admin" ? "Admins have no limit" : undefined}
            onBlur={e => {
                const value = Number(e.target.value)
                if (Number.isInteger(value) && value >= 0 && value <= 50 && value !== user.maxBots)
                    actions.setMaxBots.mutate({ id: user.id, maxBots: value })
            }}
            onPressEnter={e => e.currentTarget.blur()} />
    )
}

export function AttackCapSelect({ user, actions }: Controlled) {
    const defaults = useQuery(orpc.settings.get.queryOptions())
    const defaultLabel = ATTACK_CAP_OPTIONS.find(o => o.value === defaults.data?.attackPluginCap)?.label ?? "…"
    return (
        <Select size="small" style={{ width: 180 }} aria-label={`Attack plugin limit for ${user.username}`}
            value={user.attackPluginCap ?? "default"}
            options={[{ value: "default", label: `Default (${defaultLabel})` }, ...ATTACK_CAP_OPTIONS]}
            onChange={(value: string) => actions.setAttackCap.mutate({ id: user.id, cap: value === "default" ? null : value as NonNullable<UserRow["attackPluginCap"]> })} />
    )
}

/** Disable or enable, change role, sign out everywhere, and reset 2FA. */
export function UserActionButtons({ user, actions }: { user: Pick<UserRow, "id" | "username" | "role" | "status" | "totpEnabled">; actions: Actions }) {
    const me = useMe().data
    return (
        <Space wrap>
            {user.status === "active" ? (
                <Popconfirm title={`Disable ${user.username}?`} description="Disabling ends their sessions and stops their bots." okText="Disable"
                    okButtonProps={{ danger: true }} onConfirm={() => actions.setStatus.mutate({ id: user.id, status: "disabled" })}>
                    <Button danger icon={<StopOutlined />}>Disable</Button>
                </Popconfirm>
            ) : (
                <Button icon={<CheckCircleOutlined />} onClick={() => actions.setStatus.mutate({ id: user.id, status: "active" })}>Enable</Button>
            )}
            <Button icon={<CrownOutlined />} onClick={() => actions.setRole.mutate({ id: user.id, role: user.role === "admin" ? "user" : "admin" })}>
                {user.role === "admin" ? "Make player" : "Make admin"}
            </Button>
            <Button icon={<LogoutOutlined />} aria-label={`Sign ${user.username} out everywhere`} onClick={() => actions.revoke.mutate({ id: user.id })}>Sign out everywhere</Button>
            {user.totpEnabled && user.id !== me?.id && (
                <Popconfirm title={`Reset 2FA for ${user.username}?`} okText="Reset 2FA" okButtonProps={{ danger: true }}
                    description="Their authenticator and recovery codes stop working and they're signed out of the admin app. They set up a new authenticator at their next sign-in."
                    onConfirm={() => actions.resetTotp.mutate({ id: user.id })}>
                    <Button icon={<SafetyOutlined />} aria-label={`Reset 2FA for ${user.username}`}>Reset 2FA</Button>
                </Popconfirm>
            )}
        </Space>
    )
}
