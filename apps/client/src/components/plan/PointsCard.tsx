import { StarFilled } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, App, Button, Popconfirm, Progress, Skeleton, Typography } from "antd"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import type { PointsSummary } from "@gge/contracts"
import { messageOf, palette, ParchmentCard } from "@gge/ui"
import { formatWhen } from "../../alert-banners.ts"
import { orpc } from "../../api.ts"
import { pointsStanding } from "../../plan-model.ts"
import { refreshPlan } from "./RedeemCodeCard.tsx"

/** The balance, how close it is to a free period, and the button that spends it, disabled with the reason when it can't. */
export function PointsCard({ points, focus }: { points: PointsSummary | undefined; focus: boolean }) {
    const { message } = App.useApp()
    const { t, i18n } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const card = useRef<HTMLDivElement>(null)
    useEffect(() => { if (focus) card.current?.scrollIntoView({ block: "center" }) }, [focus])
    // One key per attempt, kept until it succeeds, so a double click or a retry after a lost answer spends once.
    const attempt = useRef<string | null>(null)
    const redeem = useMutation(orpc.billing.redeemPoints.mutationOptions({
        onSuccess: () => { attempt.current = null; refreshPlan() },
        onError: error => message.error(messageOf(error)),
    }))

    if (!points)
        return <ParchmentCard title={t("plan.points.title")} style={{ height: "100%" }}><Skeleton active paragraph={{ rows: 3 }} /></ParchmentCard>
    const standing = pointsStanding(points.balance, points.cost)
    const reward = t("plan.points.reward", { days: points.days, plan: tc(`plan.${points.plan}`) })
    const spend = () => {
        attempt.current ??= crypto.randomUUID()
        redeem.mutate({ idempotencyKey: attempt.current })
    }

    return (
        <ParchmentCard title={t("plan.points.title")} style={{ height: "100%" }}>
            <div id="points" ref={card} className="gge-points">
                <div className="gge-points-balance">
                    <StarFilled aria-hidden style={{ color: palette.gold }} />
                    <span>{t("plan.points.balance", { count: points.balance })}</span>
                </div>
                <div>
                    <Progress percent={(standing.toward / points.cost) * 100} showInfo={false} strokeColor={palette.gold} railColor={palette.raised}
                        aria-label={t("plan.points.progressLabel")} />
                    <Typography.Text type="secondary">
                        {standing.canRedeem ? t("plan.points.ready", { reward }) : t("plan.points.toward", { have: standing.toward, cost: points.cost, reward })}
                    </Typography.Text>
                </div>
                <Popconfirm title={t("plan.points.confirm", { cost: points.cost, reward })} okText={t("plan.points.redeem")} onConfirm={spend} disabled={!standing.canRedeem}>
                    <Button size="large" block loading={redeem.isPending} disabled={!standing.canRedeem} aria-describedby={standing.canRedeem ? undefined : "points-why"}>
                        {t("plan.points.redeem")}
                    </Button>
                </Popconfirm>
                {!standing.canRedeem && (
                    <Typography.Text id="points-why" type="secondary" style={{ fontSize: 13 }}>
                        {standing.why === "negative" ? t("plan.points.negative") : t("plan.points.short", { count: standing.needed })}
                    </Typography.Text>
                )}
                {redeem.data && (
                    <Alert type="success" showIcon role="status"
                        title={t("plan.points.done", { reward })}
                        description={t("plan.redeem.doneUntil", { date: formatWhen(redeem.data.period.endsAt, i18n.language, new Date()) })} />
                )}
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>{t("plan.points.earn")}</Typography.Text>
            </div>
        </ParchmentCard>
    )
}
