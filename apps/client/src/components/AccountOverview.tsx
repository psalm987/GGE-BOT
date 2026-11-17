import { CaretRightFilled, CoffeeOutlined, DollarOutlined, ExperimentOutlined, GoldOutlined, SketchOutlined, ThunderboltOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { App, Button, Typography } from "antd"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import type { AccountResources, PublicAccount } from "@gge/contracts"
import { CrestEmpty, messageOf } from "@gge/ui"
import { orpc, queryClient } from "../api.ts"

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
        </div>
    )
}
