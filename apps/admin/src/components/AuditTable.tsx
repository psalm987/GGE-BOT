import { useInfiniteQuery } from "@tanstack/react-query"
import { Button, Table, Typography } from "antd"
import dayjs from "dayjs"
import { useTranslation } from "react-i18next"
import { CrestEmpty } from "@gge/ui"
import { client, messageOf } from "../api.ts"
import { QueryError } from "./AdminPage.tsx"

type Entry = Awaited<ReturnType<typeof client.audit.list>>[number]
const LIMIT = 100

/** Audit entries, newest first and paged with `before`. Given `actorId` or `targetId` (or both), only entries by or about that user. */
export function AuditTable({ actorId, targetId, emptyHint }: { actorId?: string; targetId?: string; emptyHint: string }) {
    const { t } = useTranslation("admin")
    const audit = useInfiniteQuery({
        queryKey: ["audit", { actorId, targetId }],
        initialPageParam: undefined as number | undefined,
        queryFn: ({ pageParam }) => client.audit.list({ limit: LIMIT, before: pageParam, actorId, targetId }),
        getNextPageParam: last => last.length < LIMIT ? undefined : last[last.length - 1]!.id,
    })
    const rows = audit.data?.pages.flat() ?? []

    return (
        <>
            {audit.error && !audit.isFetchNextPageError && <QueryError error={audit.error} onRetry={() => void audit.refetch()} />}
            {!audit.isPending && !audit.error && rows.length === 0 ? (
                <CrestEmpty title={t("audit.empty")} hint={emptyHint} />
            ) : (
                <>
                    <Table<Entry> rowKey="id" loading={audit.isPending} dataSource={rows} pagination={false} scroll={{ x: 720 }}
                        columns={[
                            { title: t("audit.time"), dataIndex: "ts", render: (d: Date) => dayjs(d).format("D MMM YYYY HH:mm:ss") },
                            { title: t("audit.actor"), dataIndex: "actor", render: (a: string | null) => a ?? <Typography.Text type="secondary">{t("audit.system")}</Typography.Text> },
                            { title: t("audit.action"), dataIndex: "action", render: (a: string) => <Typography.Text code>{a}</Typography.Text> },
                            { title: t("audit.target"), key: "target", render: (_, e) => e.targetType ? `${e.targetType} ${e.targetId ?? ""}` : "" },
                        ]} />
                    {audit.isFetchNextPageError && <Typography.Text type="danger" role="alert">{messageOf(audit.error)}</Typography.Text>}
                    {audit.hasNextPage && (
                        <div style={{ textAlign: "center", marginTop: 16 }}>
                            <Button loading={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>{t("audit.loadOlder")}</Button>
                        </div>
                    )}
                </>
            )}
        </>
    )
}
