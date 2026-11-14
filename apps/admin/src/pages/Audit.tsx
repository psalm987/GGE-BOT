import { useInfiniteQuery } from "@tanstack/react-query"
import { Button, Table, Typography } from "antd"
import dayjs from "dayjs"
import { CrestEmpty, ParchmentCard } from "@gge/ui"
import { client, messageOf } from "../api.ts"
import { AdminPage, QueryError } from "../components/AdminPage.tsx"

type Entry = Awaited<ReturnType<typeof client.audit.list>>[number]
const LIMIT = 100

export function Audit() {
    const audit = useInfiniteQuery({
        queryKey: ["audit"],
        initialPageParam: undefined as number | undefined,
        queryFn: ({ pageParam }) => client.audit.list({ limit: LIMIT, before: pageParam }),
        getNextPageParam: last => last.length < LIMIT ? undefined : last[last.length - 1]!.id,
    })
    const rows = audit.data?.pages.flat() ?? []

    return (
        <AdminPage title="Audit log">
            {audit.error && !audit.isFetchNextPageError && <QueryError error={audit.error} onRetry={() => void audit.refetch()} />}
            <ParchmentCard title="Recent actions">
                {!audit.isPending && !audit.error && rows.length === 0 ? (
                    <CrestEmpty title="Nothing recorded yet" hint="Admin actions will appear here." />
                ) : (
                    <>
                        <Table<Entry> rowKey="id" loading={audit.isPending} dataSource={rows} pagination={false} scroll={{ x: 720 }}
                            columns={[
                                { title: "Time", dataIndex: "ts", render: (d: Date) => dayjs(d).format("D MMM YYYY HH:mm:ss") },
                                { title: "Actor", dataIndex: "actor", render: (a: string | null) => a ?? <Typography.Text type="secondary">system</Typography.Text> },
                                { title: "Action", dataIndex: "action", render: (a: string) => <Typography.Text code>{a}</Typography.Text> },
                                { title: "Target", key: "target", render: (_, e) => e.targetType ? `${e.targetType} ${e.targetId ?? ""}` : "" },
                            ]} />
                        {audit.isFetchNextPageError && <Typography.Text type="danger" role="alert">{messageOf(audit.error)}</Typography.Text>}
                        {audit.hasNextPage && (
                            <div style={{ textAlign: "center", marginTop: 16 }}>
                                <Button loading={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>Load older</Button>
                            </div>
                        )}
                    </>
                )}
            </ParchmentCard>
        </AdminPage>
    )
}
