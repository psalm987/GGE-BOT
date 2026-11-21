import { Progress, Skeleton, Tag, Typography } from "antd"
import { useTranslation } from "react-i18next"
import type { MyPlan } from "@gge/contracts"
import { ParchmentCard, palette } from "@gge/ui"
import { formatWhen } from "../../alert-banners.ts"

const DAY_MS = 24 * 60 * 60 * 1000

/** The plan covering now, how far the accounts fill it, and the time queued behind it. */
export function CurrentPlanCard({ plan, admin }: { plan: MyPlan | undefined; admin: boolean }) {
    const { t, i18n } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const now = new Date()
    const when = (date: Date) => formatWhen(date, i18n.language, now)
    if (!plan)
        return <ParchmentCard title={t("plan.current.title")} style={{ height: "100%" }}><Skeleton active paragraph={{ rows: 4 }} /></ParchmentCard>

    const { current, periods, limit, counted } = plan
    const daysLeft = current ? Math.max(0, Math.ceil((current.endsAt.getTime() - now.getTime()) / DAY_MS)) : 0
    const over = limit !== null && counted > limit
    return (
        <ParchmentCard title={t("plan.current.title")} style={{ height: "100%" }}>
            {current ? (
                <div className="gge-plan-head">
                    <div>
                        <span className="gge-plan-name gge-display">{tc(`plan.${current.planId}`)}</span>
                        {current.isTrial && <Tag color="gold" style={{ marginInlineStart: 10, verticalAlign: "middle" }}>{t("plan.current.trial")}</Tag>}
                    </div>
                    <div className="gge-plan-ends">
                        <Typography.Text type="secondary">{t("plan.current.ends", { date: when(current.endsAt) })}</Typography.Text>
                        <strong>{t("plan.current.daysLeft", { count: daysLeft })}</strong>
                    </div>
                </div>
            ) : (
                <div className="gge-plan-none">
                    <Typography.Title level={4} className="gge-display" style={{ margin: 0 }}>{admin ? t("plan.current.adminTitle") : t("plan.current.noneTitle")}</Typography.Title>
                    <Typography.Text type="secondary">{admin ? t("plan.current.adminHint") : t("plan.current.noneHint")}</Typography.Text>
                </div>
            )}

            {limit !== null && (
                <div className="gge-plan-usage">
                    <div className="gge-plan-usage-label">
                        <span id="plan-usage">{t("plan.current.accounts")}</span>
                        <strong>{t("plan.current.used", { counted, limit })}</strong>
                    </div>
                    <Progress percent={limit ? Math.min(100, (counted / limit) * 100) : counted ? 100 : 0} showInfo={false}
                        strokeColor={over ? palette.amber : palette.primary} railColor={palette.raised} aria-labelledby="plan-usage" />
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                        {over ? t("plan.current.over", { count: counted - limit }) : t("plan.current.twinsFree")}
                    </Typography.Text>
                </div>
            )}

            {periods.length > 0 && (
                <div className="gge-plan-queue">
                    <Typography.Text strong id="plan-queue">{t("plan.current.queue")}</Typography.Text>
                    <ol aria-labelledby="plan-queue">
                        {periods.map((period, i) => (
                            <li key={period.id} data-now={i === 0 && current ? "" : undefined}>
                                <span className="gge-plan-queue-what">
                                    {tc(`plan.${period.planId}`)} · {t(`plan.source.${period.source}`)}
                                    {i === 0 && current && <Tag style={{ marginInlineStart: 8 }}>{t("plan.current.now")}</Tag>}
                                </span>
                                <span className="gge-plan-queue-when">{t("plan.current.range", { from: when(period.startsAt), to: when(period.endsAt) })}</span>
                            </li>
                        ))}
                    </ol>
                </div>
            )}
        </ParchmentCard>
    )
}
