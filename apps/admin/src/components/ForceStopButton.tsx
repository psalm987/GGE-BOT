import { StopOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { App, Button, Popconfirm } from "antd"
import { messageOf, orpc, queryClient } from "../api.ts"

/** Stops a running account after a confirmation; renders nothing for one that is already stopped. */
export function ForceStopButton({ account }: { account: { id: string; name: string; desiredState: "running" | "stopped" } }) {
    const { message } = App.useApp()
    const forceStop = useMutation(orpc.accounts.forceStop.mutationOptions({
        onSuccess: () => { message.success("Account stopped"); void queryClient.invalidateQueries({ queryKey: orpc.accounts.list.key() }) },
        onError: error => message.error(messageOf(error)),
    }))
    if (account.desiredState !== "running")
        return null
    return (
        <Popconfirm title={`Force stop ${account.name}?`} description="The bot stops now and the account is set to stopped. Its owner can start it again." okText="Force stop" okButtonProps={{ danger: true }}
            onConfirm={() => forceStop.mutate({ id: account.id })}>
            <Button danger icon={<StopOutlined />}>Force stop</Button>
        </Popconfirm>
    )
}
