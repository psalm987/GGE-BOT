import { StopOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { App, Button, Popconfirm } from "antd"
import { useTranslation } from "react-i18next"
import { messageOf } from "@gge/ui"
import { orpc, queryClient } from "../api.ts"

/** Stops a running account after a confirmation; renders nothing for one that is already stopped. */
export function ForceStopButton({ account }: { account: { id: string; name: string; desiredState: "running" | "stopped" } }) {
    const { message } = App.useApp()
    const { t } = useTranslation("admin")
    const forceStop = useMutation(orpc.accounts.forceStop.mutationOptions({
        onSuccess: () => { message.success(t("forceStop.done")); void queryClient.invalidateQueries({ queryKey: orpc.accounts.list.key() }) },
        onError: error => message.error(messageOf(error)),
    }))
    if (account.desiredState !== "running")
        return null
    return (
        <Popconfirm title={t("forceStop.confirm", { name: account.name })} description={t("forceStop.body")} okText={t("forceStop.button")} okButtonProps={{ danger: true }}
            onConfirm={() => forceStop.mutate({ id: account.id })}>
            <Button danger icon={<StopOutlined />}>{t("forceStop.button")}</Button>
        </Popconfirm>
    )
}
