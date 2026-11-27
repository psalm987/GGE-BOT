import { CaretRightFilled, ClockCircleFilled, CloseCircleFilled, CoffeeOutlined, DollarOutlined, ExperimentOutlined, GoldOutlined, SketchOutlined, ThunderboltOutlined, WarningFilled } from "@ant-design/icons"
import { useQuery } from "@tanstack/react-query"
import { Button, Skeleton, Typography } from "antd"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import type { ReactNode } from "react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { PROBLEMS_KEPT, type AccountResources, type PublicAccount } from "@gge/contracts"
import { CrestEmpty } from "@gge/ui"
import { useSetDesiredState } from "../account-state.ts"
import { orpc } from "../api.ts"
import { problemRows, type ErrorClass } from "../game-errors.ts"

dayjs.extend(relativeTime)

type FigureKey = Exclude<keyof AccountResources, "reportedAt">

const FIGURES: { key: FigureKey; icon: ReactNode }[] = [
    { key: "cash", icon: <DollarOutlined aria-hidden /> },
    { key: "gold", icon: <GoldOutlined aria-hidden /> },
    { key: "food", icon: <CoffeeOutlined aria-hidden /> },
    { key: "mead", icon: <ExperimentOutlined aria-hidden /> },
    { key: "aquamarine", icon: <SketchOutlined aria-hidden /> },
    { key: "attackDailyCount", icon: <ThunderboltOutlined aria-hidden /> },
]

/** One figure of the account as a tile: the number in tabular figures, or a dash and a spoken reason when the bot hasn't reported it. */
function Tile({ label, icon, value, format, missing }: { label: string; icon: ReactNode; value: number | null; format: (n: number) => string; missing: string }) {
    return (
        <div className="gge-kpi">
            <span className="gge-kpi-label">{icon} {label}</span>
            {value === null
                ? <span className="gge-kpi-value" data-missing><span aria-hidden>{"—"}</span><span className="gge-sr-only">{missing}</span></span>
                : <span className="gge-kpi-value">{format(value)}</span>}
        </div>
    )
}

const ERROR_CLASSES: Record<ErrorClass | "other", { icon: ReactNode; word: string }> = {
    severe: { icon: <CloseCircleFilled aria-hidden />, word: "overview.errors.severe" },
    notNow: { icon: <ClockCircleFilled aria-hidden />, word: "overview.errors.notNow" },
    other: { icon: <WarningFilled aria-hidden />, word: "overview.errors.other" },
}
/** How often a running bot's problems are read again. */
const PROBLEMS_REFRESH_MS = 30_000

/** The game's refusals of the account's requests in plain words, each with the plugin that asked, how serious it is, how often and when last. */
function Problems({ account }: { account: PublicAccount }) {
    const { t, i18n } = useTranslation("client")
    const { t: tb } = useTranslation("bot")
    const running = account.status?.actualState === "running"
    const problems = useQuery({ ...orpc.accounts.problems.queryOptions({ input: { id: account.id } }), refetchInterval: running ? PROBLEMS_REFRESH_MS : false })
    const rows = useMemo(() => problemRows(problems.data ?? [], key => i18n.exists(key, { ns: "client" })), [problems.data, i18n])
    const number = new Intl.NumberFormat(i18n.language)
    const heading = <Typography.Title level={5} className="gge-display" style={{ margin: 0 }}>{t("overview.problems.title")}</Typography.Title>
    if (problems.isPending)
        return <section className="gge-problems" aria-busy>{heading}<Skeleton active title={false} paragraph={{ rows: 2 }} /></section>
    if (problems.isError)
        return <section className="gge-problems">{heading}<Typography.Text type="secondary" role="alert">{t("overview.errors.failed")}</Typography.Text></section>
    return (
        <section className="gge-problems">
            {heading}
            <Typography.Paragraph type="secondary" className="gge-overview-note">{t("overview.problems.intro")}</Typography.Paragraph>
            {rows.length === 0 ? (
                <Typography.Text type="secondary">{t("overview.errors.none")}</Typography.Text>
            ) : (
                <ol className="gge-problem-list" aria-label={t("overview.problems.list")}>
                    {rows.map(row => {
                        const { icon, word } = ERROR_CLASSES[row.errorClass ?? "other"]
                        return (
                            <li key={`${row.plugin} ${row.command} ${row.error}`} className="gge-problem" data-class={row.errorClass ?? "other"}>
                                <span className="gge-problem-class">{icon} {t(word)}</span>
                                <span className="gge-problem-text">{t("overview.problems.refused", { action: t(row.action), reason: t(row.reason, { error: row.error }) })}</span>
                                <span className="gge-problem-meta">
                                    <span className="gge-problem-plugin">{tb(row.plugin, { defaultValue: row.plugin })}</span>
                                    <code>{row.command} {row.error}</code>
                                    <span>{t("overview.errors.times", { count: row.count, formatted: number.format(row.count) })}</span>
                                    <time dateTime={row.lastAt.toISOString()} title={dayjs(row.lastAt).format("D MMM YYYY HH:mm:ss")}>{dayjs(row.lastAt).fromNow()}</time>
                                </span>
                            </li>
                        )
                    })}
                </ol>
            )}
            <Typography.Paragraph type="secondary" className="gge-overview-note">
                {t("overview.problems.kept", { count: PROBLEMS_KEPT })} <Link to={`/logs?account=${account.id}`}>{t("overview.errors.seeLogs")}</Link>
            </Typography.Paragraph>
        </section>
    )
}

/** The account at a glance: what the bot last read from the game, and how old that is. Empty until the bot has run. */
export function AccountOverview({ account }: { account: PublicAccount }) {
    const { t, i18n } = useTranslation("client")
    const number = new Intl.NumberFormat(i18n.language)
    const start = useSetDesiredState()
    const resources = account.status?.resources ?? null

    if (!resources) {
        const wanted = account.desiredState === "running"
        return (
            <CrestEmpty
                title={t("overview.emptyTitle")}
                hint={wanted ? t("overview.emptyStarting") : account.entitled ? t("overview.emptyStopped") : t("overview.emptyLimit")}
                action={!wanted && account.entitled && (
                    <Button type="primary" icon={<CaretRightFilled />} loading={start.isPending} onClick={() => start.mutate({ ids: [account.id], state: "running" })}>{t("overview.start")}</Button>
                )} />
        )
    }

    const stamp = resources.reportedAt ?? account.status?.heartbeatAt ?? null
    const running = account.status?.actualState === "running"
    return (
        <div className="gge-overview">
            <ul className="gge-kpis" aria-label={t("overview.figures")}>
                {FIGURES.map(({ key, icon }) => (
                    <li key={key}>
                        <Tile label={t(`overview.figure.${key}`)} icon={icon} value={resources[key]} format={number.format} missing={t("overview.notReported")} />
                    </li>
                ))}
            </ul>
            <Typography.Paragraph type="secondary" className="gge-overview-note">
                {stamp
                    ? <time dateTime={stamp.toISOString()} title={dayjs(stamp).format("D MMM YYYY HH:mm:ss")}>{t(running ? "overview.updated" : "overview.lastKnown", { when: dayjs(stamp).fromNow() })}</time>
                    : t("overview.updatedUnknown")}
                {" "}{t("overview.stormNote")}
            </Typography.Paragraph>
            <Problems account={account} />
        </div>
    )
}
