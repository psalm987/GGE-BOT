import { CaretRightFilled, ClockCircleFilled, CloseCircleFilled, CoffeeOutlined, DollarOutlined, ExperimentOutlined, GoldOutlined, SketchOutlined, ThunderboltOutlined, WarningFilled } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { App, Button, Skeleton, Typography } from "antd"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import type { ReactNode } from "react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import type { AccountResources, PublicAccount } from "@gge/contracts"
import { CrestEmpty, messageOf } from "@gge/ui"
import { orpc, queryClient } from "../api.ts"
import { topErrors, type ErrorClass } from "../game-errors.ts"
import { useLogFeed } from "../log-feed.ts"

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
const TOP_ERRORS = 5

/** The codes the game refused this account with most, from the warnings and errors the runner kept. Each says in words how serious it is. */
function TopErrors({ accountId }: { accountId: string }) {
    const { t, i18n } = useTranslation("client")
    const ids = useMemo(() => [accountId], [accountId])
    // No live subscription: Centrifugo refuses a second subscription to a channel, and the Logs tab holds this account's.
    const { lines, feed } = useLogFeed({ accountIds: ids, levels: [1, 2, 3], plugins: [] }, [])
    const top = useMemo(() => topErrors(lines, TOP_ERRORS), [lines])
    const number = new Intl.NumberFormat(i18n.language)
    const heading = <Typography.Title level={5} className="gge-display" style={{ margin: 0 }}>{t("overview.errors.title")}</Typography.Title>
    if (feed.isPending)
        return <section className="gge-top-errors" aria-busy>{heading}<Skeleton active title={false} paragraph={{ rows: 2 }} /></section>
    if (feed.isError)
        return <section className="gge-top-errors">{heading}<Typography.Text type="secondary" role="alert">{t("overview.errors.failed")}</Typography.Text></section>
    return (
        <section className="gge-top-errors">
            {heading}
            {top.length === 0 ? (
                <Typography.Text type="secondary">{t("overview.errors.none")}</Typography.Text>
            ) : (
                <ol className="gge-top-error-list">
                    {top.map(({ code, errorClass, count, lastAt }) => {
                        const { icon, word } = ERROR_CLASSES[errorClass ?? "other"]
                        return (
                            <li key={code} className="gge-top-error" data-class={errorClass ?? "other"}>
                                <span className="gge-top-error-class">{icon} {t(word)}</span>
                                <code>{code}</code>
                                <span className="gge-top-error-count">{t("overview.errors.times", { count, formatted: number.format(count) })}</span>
                                <time dateTime={lastAt.toISOString()} className="gge-top-error-when">{dayjs(lastAt).fromNow()}</time>
                            </li>
                        )
                    })}
                </ol>
            )}
            <Typography.Paragraph type="secondary" className="gge-overview-note">
                {t("overview.errors.basis", { count: lines.length })} <Link to={`/logs?account=${accountId}`}>{t("overview.errors.seeLogs")}</Link>
            </Typography.Paragraph>
        </section>
    )
}

/** The account at a glance: what the bot last read from the game, and how old that is. Empty until the bot has run. */
export function AccountOverview({ account }: { account: PublicAccount }) {
    const { message } = App.useApp()
    const { t, i18n } = useTranslation("client")
    const number = new Intl.NumberFormat(i18n.language)
    const start = useMutation(orpc.accounts.setDesiredState.mutationOptions({
        onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.accounts.list.key() }),
        onError: error => message.error(messageOf(error)),
    }))
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
            <TopErrors accountId={account.id} />
        </div>
    )
}
