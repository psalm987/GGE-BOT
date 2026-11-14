import { StopOutlined } from "@ant-design/icons"
import { useMutation, useQuery } from "@tanstack/react-query"
import { App, Button, Popconfirm, Table, Tooltip, Typography } from "antd"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { CrestEmpty, ParchmentCard, SigilStatus } from "@gge/ui"
import { client, messageOf, orpc, queryClient } from "../api.ts"
import { AdminPage, QueryError } from "../components/AdminPage.tsx"

dayjs.extend(relativeTime)

type Account = Awaited<ReturnType<typeof client.accounts.list>>[number]

export function Accounts() {
    const { message } = App.useApp()
    const accounts = useQuery(orpc.accounts.list.queryOptions())
    const forceStop = useMutation(orpc.accounts.forceStop.mutationOptions({
        onSuccess: () => { message.success("Account stopped"); void queryClient.invalidateQueries({ queryKey: orpc.accounts.list.key() }) },
        onError: error => message.error(messageOf(error)),
    }))
    const list = accounts.data ?? []

    return (
        <AdminPage title="Accounts">
            {accounts.error && <QueryError error={accounts.error} onRetry={() => void accounts.refetch()} />}
            <ParchmentCard title="All game accounts">
                {!accounts.isPending && !accounts.error && list.length === 0 ? (
                    <CrestEmpty title="No game accounts" hint="Players haven't added any yet." />
                ) : (
                    <Table<Account> rowKey="id" loading={accounts.isPending} dataSource={list} pagination={list.length > 20 ? { pageSize: 20 } : false} scroll={{ x: 900 }}
                        columns={[
                            { title: "Name", dataIndex: "name", render: (n: string) => <Typography.Text strong>{n}</Typography.Text> },
                            { title: "Owner", dataIndex: "owner" },
                            { title: "Server", dataIndex: "serverId", width: 90 },
                            { title: "Desired", dataIndex: "desiredState", render: (s: Account["desiredState"]) => s === "running" ? "Running" : "Stopped" },
                            { title: "Status", key: "status", render: (_, a) => <SigilStatus state={a.status?.actualState} detail={a.status?.lastError} /> },
                            {
                                title: "Last seen", key: "seen",
                                render: (_, a) => a.status?.heartbeatAt
                                    ? <Tooltip title={dayjs(a.status.heartbeatAt).format("D MMM YYYY HH:mm:ss")}>{dayjs(a.status.heartbeatAt).fromNow()}</Tooltip>
                                    : <Typography.Text type="secondary">Never</Typography.Text>,
                            },
                            {
                                title: "", key: "actions", align: "right",
                                render: (_, a) => a.desiredState === "running" && (
                                    <Popconfirm title={`Force stop ${a.name}?`} description="The bot stops now and the account is set to stopped. Its owner can start it again." okText="Force stop" okButtonProps={{ danger: true }}
                                        onConfirm={() => forceStop.mutate({ id: a.id })}>
                                        <Button danger icon={<StopOutlined />}>Force stop</Button>
                                    </Popconfirm>
                                ),
                            },
                        ]} />
                )}
            </ParchmentCard>
        </AdminPage>
    )
}
