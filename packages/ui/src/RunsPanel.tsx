import { Table, Tag } from "antd"
import dayjs from "dayjs"
import duration from "dayjs/plugin/duration"
import { useTranslation } from "react-i18next"

dayjs.extend(duration)

export type RunRow = { id: number; startedAt: Date; endedAt: Date | null; endReason: string | null; error: string | null }

const REASON_COLORS: Record<string, string | undefined> = {
    stopped: undefined,
    restart: undefined,
    crash: "red",
    error: "red",
    stale: "red",
    banned: "red",
    auth_failed: "orange",
    shutoff: undefined,
    deploy: undefined,
    runner_lost: "orange",
    schedule: undefined,
}

/** The runs it is given: when each started, how long it lasted, why it ended. */
export function RunsPanel({ runs, loading }: { runs: RunRow[] | undefined; loading: boolean }) {
    const { t } = useTranslation("ui")
    const humanize = (ms: number) => {
        const d = dayjs.duration(ms)
        return d.asHours() >= 1
            ? t("duration.hoursMinutes", { hours: Math.floor(d.asHours()), minutes: d.minutes() })
            : d.asMinutes() >= 1 ? t("duration.minutesSeconds", { minutes: d.minutes(), seconds: d.seconds() }) : t("duration.seconds", { seconds: d.seconds() })
    }
    const reasonLabel = (reason: string) => reason in REASON_COLORS ? t(`runs.reason.${reason}`) : reason
    return (
        <Table rowKey="id" size="small" loading={loading} dataSource={runs} pagination={false}
            locale={{ emptyText: t("runs.empty") }}
            columns={[
                { title: t("runs.started"), dataIndex: "startedAt", render: (v: Date) => dayjs(v).format("D MMM HH:mm") },
                { title: t("runs.ranFor"), render: (_, r) => r.endedAt ? humanize(r.endedAt.getTime() - r.startedAt.getTime()) : <Tag color="green">{t("runs.runningFor", { duration: humanize(Date.now() - r.startedAt.getTime()) })}</Tag> },
                { title: t("runs.endedBecause"), render: (_, r) => r.endReason ? <Tag color={REASON_COLORS[r.endReason]}>{reasonLabel(r.endReason)}</Tag> : "—" },
                { title: t("runs.detail"), dataIndex: "error", render: (v: string | null) => v ?? "", ellipsis: true },
            ]} />
    )
}
