import { CheckCircleOutlined, CrownOutlined, LogoutOutlined, SafetyOutlined, StopOutlined } from "@ant-design/icons"
import { useMutation, useQuery } from "@tanstack/react-query"
import { App, Button, InputNumber, Popconfirm, Select, Space } from "antd"
import { useTranslation } from "react-i18next"
import { messageOf } from "@gge/ui"
import { client, orpc, queryClient } from "../api.ts"
import { useMe } from "../auth.tsx"
import { useAttackCapOptions } from "../pages/Settings.tsx"

export type UserRow = Awaited<ReturnType<typeof client.users.list>>["items"][number]

/** The user mutations, each of which refreshes every view of the user and the audit trail. */
export function useUserActions() {
    const { message } = App.useApp()
    const { t } = useTranslation("admin")
    const settle = (done: string) => ({
        onSuccess: () => {
            message.success(done)
            for (const queryKey of [orpc.users.list.key(), orpc.users.get.key(), ["audit"]])
                void queryClient.invalidateQueries({ queryKey })
        },
        onError: (error: unknown) => message.error(messageOf(error)),
    })
    return {
        setStatus: useMutation(orpc.users.setStatus.mutationOptions(settle(t("userControls.userUpdated")))),
        setRole: useMutation(orpc.users.setRole.mutationOptions(settle(t("userControls.roleUpdated")))),
        setMaxBots: useMutation(orpc.users.setMaxBots.mutationOptions(settle(t("userControls.botLimitUpdated")))),
        setAttackCap: useMutation(orpc.users.setAttackPluginCap.mutationOptions(settle(t("userControls.attackLimitUpdated")))),
        revoke: useMutation(orpc.users.revokeSessions.mutationOptions(settle(t("userControls.signedOutEverywhere")))),
        resetTotp: useMutation(orpc.users.resetTotp.mutationOptions(settle(t("userControls.twoFactorReset")))),
    }
}

type Actions = ReturnType<typeof useUserActions>
type Controlled = { user: Pick<UserRow, "id" | "username" | "role" | "maxBots" | "attackPluginCap">; actions: Actions }

/** Edits the plan limit when the field loses focus. */
export function BotLimitInput({ user, actions }: Controlled) {
    const { t } = useTranslation("admin")
    return (
        <InputNumber key={`${user.id}:${user.maxBots}`} size="small" min={0} max={50} precision={0} defaultValue={user.maxBots} style={{ width: 64 }}
            aria-label={t("userControls.botLimitFor", { username: user.username })} disabled={user.role === "admin"} title={user.role === "admin" ? t("userControls.adminsNoLimit") : undefined}
            onBlur={e => {
                const value = Number(e.target.value)
                if (Number.isInteger(value) && value >= 0 && value <= 50 && value !== user.maxBots)
                    actions.setMaxBots.mutate({ id: user.id, maxBots: value })
            }}
            onPressEnter={e => e.currentTarget.blur()} />
    )
}

export function AttackCapSelect({ user, actions }: Controlled) {
    const { t } = useTranslation("admin")
    const capOptions = useAttackCapOptions()
    const defaults = useQuery(orpc.settings.get.queryOptions())
    const defaultLabel = capOptions.find(o => o.value === defaults.data?.attackPluginCap)?.label ?? "…"
    return (
        <Select size="small" style={{ width: 180 }} aria-label={t("userControls.attackLimitFor", { username: user.username })}
            value={user.attackPluginCap ?? "default"}
            options={[{ value: "default", label: t("userControls.defaultOption", { label: defaultLabel }) }, ...capOptions]}
            onChange={(value: string) => actions.setAttackCap.mutate({ id: user.id, cap: value === "default" ? null : value as NonNullable<UserRow["attackPluginCap"]> })} />
    )
}

/** Disable or enable, change role, sign out everywhere, and reset 2FA. */
export function UserActionButtons({ user, actions }: { user: Pick<UserRow, "id" | "username" | "role" | "status" | "totpEnabled">; actions: Actions }) {
    const me = useMe().data
    const { t } = useTranslation("admin")
    return (
        <Space wrap>
            {user.status === "active" ? (
                <Popconfirm title={t("userControls.disableConfirm", { username: user.username })} description={t("userControls.disableBody")} okText={t("userControls.disable")}
                    okButtonProps={{ danger: true }} onConfirm={() => actions.setStatus.mutate({ id: user.id, status: "disabled" })}>
                    <Button danger icon={<StopOutlined />}>{t("userControls.disable")}</Button>
                </Popconfirm>
            ) : (
                <Button icon={<CheckCircleOutlined />} onClick={() => actions.setStatus.mutate({ id: user.id, status: "active" })}>{t("userControls.enable")}</Button>
            )}
            <Button icon={<CrownOutlined />} onClick={() => actions.setRole.mutate({ id: user.id, role: user.role === "admin" ? "user" : "admin" })}>
                {user.role === "admin" ? t("userControls.makePlayer") : t("userControls.makeAdmin")}
            </Button>
            <Button icon={<LogoutOutlined />} aria-label={t("userControls.signOutFor", { username: user.username })} onClick={() => actions.revoke.mutate({ id: user.id })}>{t("userControls.signOutEverywhere")}</Button>
            {user.totpEnabled && user.id !== me?.id && (
                <Popconfirm title={t("userControls.reset2faConfirm", { username: user.username })} okText={t("userControls.reset2fa")} okButtonProps={{ danger: true }}
                    description={t("userControls.reset2faBody")}
                    onConfirm={() => actions.resetTotp.mutate({ id: user.id })}>
                    <Button icon={<SafetyOutlined />} aria-label={t("userControls.reset2faFor", { username: user.username })}>{t("userControls.reset2fa")}</Button>
                </Popconfirm>
            )}
        </Space>
    )
}
