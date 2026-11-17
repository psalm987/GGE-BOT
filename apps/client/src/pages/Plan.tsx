import { useQuery } from "@tanstack/react-query"
import { Alert, Col, Row } from "antd"
import { useTranslation } from "react-i18next"
import { Navigate, useSearchParams } from "react-router"
import { orpc } from "../api.ts"
import { useMe } from "../auth.tsx"
import { AppLayout } from "../components/AppLayout.tsx"
import { BuyCard } from "../components/plan/BuyCard.tsx"
import { CurrentPlanCard } from "../components/plan/CurrentPlanCard.tsx"
import { PlanHistory } from "../components/plan/PlanHistory.tsx"
import { PointsCard } from "../components/plan/PointsCard.tsx"
import { RedeemCodeCard } from "../components/plan/RedeemCodeCard.tsx"
import { useBillingConfig } from "../use-billing.ts"
import "./plan.css"

/**
 * The player's plan: what covers them now, what to buy, a code to redeem and points to spend, with history below.
 * On a wide screen the plan and the packages take two thirds and the code and points the rest; on a phone the
 * cards stack in that same order: plan, code, packages, points.
 */
export function Plan() {
    const { t } = useTranslation("client")
    const me = useMe().data
    const admin = me?.role === "admin"
    const config = useBillingConfig()
    const [params] = useSearchParams()
    const focus = params.get("focus")
    const open = admin || !!config.data?.billingLive
    const plan = useQuery({ ...orpc.billing.myPlan.queryOptions(), enabled: open })
    const points = useQuery({ ...orpc.billing.points.queryOptions({ input: { limit: 50 } }), enabled: open })
    const codes = useQuery({ ...orpc.billing.myCodes.queryOptions(), enabled: open })
    const purchases = useQuery({ ...orpc.billing.myPurchases.queryOptions(), enabled: open })

    if (config.data && !open)
        return <Navigate to="/" replace />

    return (
        <AppLayout activeKey="plan" title={t("plan.title")}>
            {admin && config.data && !config.data.billingLive && (
                <Alert type="info" showIcon title={t("plan.adminPreview")} style={{ marginBottom: 16 }} />
            )}
            <Row gutter={[16, 16]} className="gge-plan">
                <Col xs={24} lg={16}><CurrentPlanCard plan={plan.data} admin={admin} /></Col>
                <Col xs={24} lg={8}><RedeemCodeCard focus={focus === "redeem"} /></Col>
                <Col xs={24} lg={16}><BuyCard config={config.data} /></Col>
                <Col xs={24} lg={8}><PointsCard points={points.data} focus={focus === "points"} /></Col>
                <Col span={24}>
                    <PlanHistory codes={codes.data ?? []} purchases={purchases.data ?? []} points={points.data?.history ?? []}
                        loading={codes.isPending || purchases.isPending || points.isPending} />
                </Col>
            </Row>
        </AppLayout>
    )
}
