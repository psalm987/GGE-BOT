import { CheckCircleOutlined, CloseCircleOutlined, TeamOutlined, ThunderboltOutlined, WarningOutlined } from "@ant-design/icons"
import { useQuery } from "@tanstack/react-query"
import { Button, Skeleton, Statistic, Typography } from "antd"
import { useMemo, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ACTIVITY_WINDOW, LOG_RETENTION, type PublicAccount } from "@gge/contracts"
import { CrestEmpty, palette, ParchmentCard, SigilStatus } from "@gge/ui"
import { orpc } from "../api.ts"
import { topAccounts, totalsOf, type Counted } from "../dashboard-model.ts"
import { pollInterval, useRealtimeState } from "../realtime.ts"

const ACTIVITY_MS = 60_000
const TOP = 5

/** A count from the kept lines. A trailing plus, with "at least" for a screen reader, says the cap may have cut the window short. */
function CountedValue({ counted, format }: { counted: Counted; format: (n: number) => string }) {
    const { t } = useTranslation("client")
    return (
        <>
            {format(counted.count)}
            {!counted.complete && <><span aria-hidden>+</span><span className="gge-sr-only">{t("dashboard.kpi.atLeast")}</span></>}
        </>
    )
}

function Kpi({ icon, title, note, children }: { icon: ReactNode; title: string; note?: string; children: ReactNode }) {
    return (
        <ParchmentCard>
            <div className="gge-kpi-card">
                <span className="gge-kpi-title">{icon} {title}</span>
                {children}
                {note && <span className="gge-kpi-note">{note}</span>}
            </div>
        </ParchmentCard>
    )
}

/**
 * The page's figures above the roster: how many accounts are online, the attacks of the last 24 hours, the errors of the last
 * 7 days, how many need attention, and the accounts that attacked most. Attacks and errors are counted from the lines the
 * runner keeps per account, and the page says so.
 */
export function DashboardOverview({ accounts, counted, limit, online, attention, onOpen }: {
    accounts: PublicAccount[]
    counted: number
    limit: number | undefined
    online: number
    attention: number
    onOpen: (account: PublicAccount) => void
}) {
    const { t, i18n } = useTranslation("client")
    const number = useMemo(() => new Intl.NumberFormat(i18n.language).format, [i18n.language])
    const poll = pollInterval(useRealtimeState())
    const activity = useQuery({ ...orpc.logs.activity.queryOptions(), refetchInterval: poll || ACTIVITY_MS })
    const totals = totalsOf(activity.data)
    const top = useMemo(() => topAccounts(accounts, activity.data, TOP), [accounts, activity.data])
    const counting = activity.isPending
    const failed = activity.isError

    return (
        <section className="gge-dashboard-overview" aria-label={t("dashboard.overview")}>
            <div className="gge-kpi-row">
                <Kpi icon={<TeamOutlined aria-hidden />} title={t("dashboard.stats.accounts")}>
                    <Statistic value={counted} suffix={limit !== undefined && `/ ${limit}`} />
                </Kpi>
                <Kpi icon={<CheckCircleOutlined aria-hidden />} title={t("dashboard.stats.online")} note={t("dashboard.kpi.ofAccounts", { count: accounts.length })}>
                    <Statistic value={online} styles={{ content: { color: palette.emeraldText } }} />
                </Kpi>
                <Kpi icon={<ThunderboltOutlined aria-hidden />} title={t("dashboard.kpi.attacks")} note={t("dashboard.kpi.attacksWindow", { hours: ACTIVITY_WINDOW.attackHours })}>
                    {counting ? <Skeleton.Input active size="small" /> : failed || !totals ? <span className="gge-kpi-value" data-missing>{"—"}</span> : (
                        <Statistic value={totals.attacks.count} formatter={() => <CountedValue counted={totals.attacks} format={number} />} />
                    )}
                </Kpi>
                <Kpi icon={<CloseCircleOutlined aria-hidden />} title={t("dashboard.kpi.errors")} note={t("dashboard.kpi.errorsWindow", { days: ACTIVITY_WINDOW.errorDays })}>
                    {counting ? <Skeleton.Input active size="small" /> : failed || !totals ? <span className="gge-kpi-value" data-missing>{"—"}</span> : (
                        <Statistic value={totals.errors.count} styles={{ content: { color: totals.errors.count ? palette.crimsonText : undefined } }}
                            formatter={() => <CountedValue counted={totals.errors} format={number} />} />
                    )}
                </Kpi>
                <Kpi icon={<WarningOutlined aria-hidden />} title={t("dashboard.stats.attention")}>
                    <Statistic value={attention} styles={{ content: { color: attention ? palette.crimsonText : undefined } }} />
                </Kpi>
            </div>
            <Typography.Paragraph type="secondary" className="gge-kpi-footnote">
                {failed ? t("dashboard.kpi.failed") : t("dashboard.kpi.basis", { count: LOG_RETENTION.perAccount, days: LOG_RETENTION.days })}
            </Typography.Paragraph>

            {accounts.length > 1 && (
                <ParchmentCard title={t("dashboard.top.title")} extra={<Typography.Text type="secondary">{t("dashboard.top.window", { hours: ACTIVITY_WINDOW.attackHours })}</Typography.Text>}>
                    {counting ? <Skeleton active paragraph={{ rows: 3 }} /> : top.length === 0 ? (
                        <CrestEmpty title={t("dashboard.top.emptyTitle")} hint={t("dashboard.top.emptyHint")} />
                    ) : (
                        <table className="gge-top-accounts">
                            <caption className="gge-sr-only">{t("dashboard.top.title")}</caption>
                            <thead>
                                <tr>
                                    <th scope="col">{t("dashboard.col.account")}</th>
                                    <th scope="col" className="gge-num">{t("dashboard.top.attacks")}</th>
                                    <th scope="col" className="gge-num">{t("dashboard.top.errors")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {top.map(({ account, attacks, errors, complete }) => (
                                    <tr key={account.id}>
                                        <th scope="row">
                                            <div className="gge-top-accounts-cell">
                                                <Button type="link" className="gge-top-accounts-name" onClick={() => onOpen(account)} aria-label={t("dashboard.top.open", { name: account.name })}>{account.name}</Button>
                                                <SigilStatus state={account.status?.actualState} detail={account.status?.lastError} sleepingUntil={account.sleepingUntil} />
                                            </div>
                                        </th>
                                        <td className="gge-num"><CountedValue counted={{ count: attacks, complete }} format={number} /></td>
                                        <td className="gge-num">{number(errors)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </ParchmentCard>
            )}
        </section>
    )
}
