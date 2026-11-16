import { Table, Tag } from "antd"
import dayjs from "dayjs"
import duration from "dayjs/plugin/duration"

dayjs.extend(duration)

export type RunRow = { id: number; startedAt: Date; endedAt: Date | null; endReason: string | null; error: string | null }

const REASONS: Record<string, { label: string; color?: string }> = {
    stopped: { label: "Stopped" },
    restart: { label: "Settings changed" },
    crash: { label: "Crashed", color: "red" },
    error: { label: "Error", color: "red" },
    stale: { label: "Stopped responding", color: "red" },
    banned: { label: "Banned", color: "red" },
    auth_failed: { label: "Wrong password", color: "orange" },
    shutoff: { label: "Shutoff timer" },
    deploy: { label: "Server restart" },
    runner_lost: { label: "Runner lost", color: "orange" },
}

const humanize = (ms: number) => {
    const d = dayjs.duration(ms)
    return d.asHours() >= 1 ? `${Math.floor(d.asHours())}h ${d.minutes()}m` : d.asMinutes() >= 1 ? `${d.minutes()}m ${d.seconds()}s` : `${d.seconds()}s`
}

/** The runs it is given: when each started, how long it lasted, why it ended. */
export function RunsPanel({ runs, loading }: { runs: RunRow[] | undefined; loading: boolean }) {
    return (
        <Table rowKey="id" size="small" loading={loading} dataSource={runs} pagination={false}
            locale={{ emptyText: "This bot hasn't run yet." }}
            columns={[
                { title: "Started", dataIndex: "startedAt", render: (v: Date) => dayjs(v).format("D MMM HH:mm") },
                { title: "Ran for", render: (_, r) => r.endedAt ? humanize(r.endedAt.getTime() - r.startedAt.getTime()) : <Tag color="green">Running · {humanize(Date.now() - r.startedAt.getTime())}</Tag> },
                { title: "Ended because", render: (_, r) => r.endReason ? <Tag color={REASONS[r.endReason]?.color}>{REASONS[r.endReason]?.label ?? r.endReason}</Tag> : "—" },
                { title: "Detail", dataIndex: "error", render: (v: string | null) => v ?? "", ellipsis: true },
            ]} />
    )
}
