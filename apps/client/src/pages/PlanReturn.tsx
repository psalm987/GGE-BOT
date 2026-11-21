import { CheckCircleFilled, ClockCircleFilled, CloseCircleFilled } from "@ant-design/icons"
import { useQuery } from "@tanstack/react-query"
import { Button, Skeleton, Typography } from "antd"
import { useEffect, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate, useSearchParams } from "react-router"
import { messageOf, palette, ParchmentCard } from "@gge/ui"
import { formatWhen } from "../alert-banners.ts"
import { orpc } from "../api.ts"
import { AppLayout } from "../components/AppLayout.tsx"
import { refreshPlan } from "../components/plan/RedeemCodeCard.tsx"
import { returnState } from "../plan-model.ts"
import "./plan.css"

/** Where Paystack sends the buyer back. It asks the API, which asks Paystack, how the payment went; the browser's word counts for nothing. */
export function PlanReturn() {
    const { t, i18n } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const navigate = useNavigate()
    const reference = useSearchParams()[0].get("reference") ?? ""
    const outcome = useQuery({ ...orpc.billing.confirm.queryOptions({ input: { reference } }), enabled: !!reference, retry: false, staleTime: 0 })
    const state = outcome.data && returnState(outcome.data)
    useEffect(() => { if (state === "delivered") refreshPlan() }, [state])

    const toPlan = <Button type="primary" size="large" onClick={() => navigate("/plan")}>{t("planReturn.toPlan")}</Button>
    const again = <Button size="large" loading={outcome.isFetching} onClick={() => void outcome.refetch()}>{t("planReturn.checkAgain")}</Button>
    const screen = (icon: ReactNode, title: string, body: ReactNode, actions: ReactNode) => (
        <div className="gge-return" role="status">
            {icon}
            <Typography.Title level={3} className="gge-display" style={{ margin: 0 }}>{title}</Typography.Title>
            <Typography.Paragraph style={{ margin: 0 }}>{body}</Typography.Paragraph>
            <div className="gge-return-actions">{actions}</div>
        </div>
    )

    let content: ReactNode
    if (!reference)
        content = screen(<CloseCircleFilled style={{ color: palette.crimson }} />, t("planReturn.missingTitle"), t("planReturn.missingBody"), toPlan)
    else if (outcome.isPending)
        content = <div className="gge-return" role="status" aria-busy><Typography.Text>{t("planReturn.checking")}</Typography.Text><Skeleton active paragraph={{ rows: 2 }} /></div>
    else if (outcome.error)
        content = screen(<CloseCircleFilled style={{ color: palette.crimson }} />, t("planReturn.errorTitle"), messageOf(outcome.error), <>{again}{toPlan}</>)
    else if (state === "delivered") {
        const { period, codes, points } = outcome.data.delivered!
        const days = period && Math.round((period.endsAt.getTime() - period.startsAt.getTime()) / 86_400_000)
        content = screen(
            <CheckCircleFilled style={{ color: palette.emerald }} />,
            t("planReturn.paidTitle"),
            <>
                {period
                    ? t("planReturn.paidPeriod", { days, plan: tc(`plan.${period.planId}`), date: formatWhen(period.endsAt, i18n.language, new Date()) })
                    : t("planReturn.paidCodes", { count: codes })}
                {points > 0 && <> {t("planReturn.paidPoints", { count: points })}</>}
            </>,
            toPlan,
        )
    } else if (state === "waiting")
        content = screen(<ClockCircleFilled style={{ color: palette.amber }} />, t("planReturn.waitingTitle"), t("planReturn.waitingBody"), <>{again}{toPlan}</>)
    else if (state === "refunded")
        content = screen(<CloseCircleFilled style={{ color: palette.muted }} />, t("planReturn.refundedTitle"), t("planReturn.refundedBody"), toPlan)
    else
        content = screen(<CloseCircleFilled style={{ color: palette.crimson }} />, t("planReturn.failedTitle"), t("planReturn.failedBody"), <>{again}{toPlan}</>)

    return (
        <AppLayout activeKey="plan" title={t("plan.title")}>
            <ParchmentCard style={{ maxWidth: 640, margin: "0 auto" }}>{content}</ParchmentCard>
        </AppLayout>
    )
}
