import { CheckCircleFilled, CloseCircleFilled } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Button, Skeleton, Typography } from "antd"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Navigate, useNavigate, useSearchParams } from "react-router"
import { ParchmentCard, palette } from "@gge/ui"
import { formatWhen } from "../alert-banners.ts"
import { orpc } from "../api.ts"
import { useMe } from "../auth.tsx"
import { AppLayout } from "../components/AppLayout.tsx"
import { RequireVerified } from "../components/EmailGate.tsx"
import { refreshPlan, useCodeError } from "../components/plan/RedeemCodeCard.tsx"
import { clearPendingCode, pendingCode, savePendingCode } from "../plan-model.ts"
import "./plan.css"

/**
 * A shared /redeem?code= link. The code is kept in this browser first, so it survives signing in, signing up and
 * confirming the email in another tab; once the player can redeem, it is redeemed once and forgotten.
 */
export function Redeem() {
    const { t } = useTranslation("client")
    const me = useMe()
    const [params, setParams] = useSearchParams()
    const linked = params.get("code")
    const [code] = useState(() => {
        if (linked)
            savePendingCode(linked)
        return linked ?? pendingCode()
    })
    useEffect(() => {
        if (linked)
            setParams({}, { replace: true })
    }, [linked, setParams])

    if (me.isPending)
        return null
    if (!me.data)
        return <Navigate to="/login" replace state={{ from: "/redeem", notice: t("redeem.signInFirst") }} />
    if (!code)
        return <Navigate to="/plan?focus=redeem" replace />
    return <RequireVerified><Redeeming code={code} /></RequireVerified>
}

function Redeeming({ code }: { code: string }) {
    const { t, i18n } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const navigate = useNavigate()
    const codeError = useCodeError()
    const redeem = useMutation(orpc.billing.redeemCode.mutationOptions({
        onSuccess: refreshPlan,
        onSettled: clearPendingCode,
    }))
    const started = useRef(false)
    useEffect(() => {
        if (started.current)
            return
        started.current = true
        redeem.mutate({ code })
    }, [code, redeem])

    const period = redeem.data?.period
    const notLive = (redeem.error as { data?: { code?: string } } | null)?.data?.code === "BILLING_NOT_LIVE"
    return (
        <AppLayout activeKey="plan" title={t("redeem.title")}>
            <ParchmentCard style={{ maxWidth: 640, margin: "0 auto" }}>
                {redeem.isPending || redeem.isIdle ? (
                    <div className="gge-return" role="status" aria-busy><Typography.Text>{t("redeem.working", { code })}</Typography.Text><Skeleton active paragraph={{ rows: 2 }} /></div>
                ) : period ? (
                    <div className="gge-return" role="status">
                        <CheckCircleFilled style={{ color: palette.emerald }} />
                        <Typography.Title level={3} className="gge-display" style={{ margin: 0 }}>{t("redeem.doneTitle")}</Typography.Title>
                        <Typography.Paragraph style={{ margin: 0 }}>
                            {t("plan.redeem.done", { days: Math.round((period.endsAt.getTime() - period.startsAt.getTime()) / 86_400_000), plan: tc(`plan.${period.planId}`) })}{" "}
                            {t("plan.redeem.doneUntil", { date: formatWhen(period.endsAt, i18n.language, new Date()) })}
                        </Typography.Paragraph>
                        <div className="gge-return-actions"><Button type="primary" size="large" onClick={() => navigate("/plan")}>{t("planReturn.toPlan")}</Button></div>
                    </div>
                ) : (
                    <div className="gge-return" role="alert">
                        <CloseCircleFilled style={{ color: palette.crimson }} />
                        <Typography.Title level={3} className="gge-display" style={{ margin: 0 }}>{t("redeem.failedTitle")}</Typography.Title>
                        <Typography.Paragraph style={{ margin: 0 }}>{notLive ? t("redeem.notLive") : codeError(redeem.error)}</Typography.Paragraph>
                        <code className="gge-code">{code}</code>
                        <div className="gge-return-actions">
                            <Button size="large" onClick={() => navigate(notLive ? "/" : "/plan?focus=redeem")}>{notLive ? t("redeem.toAccounts") : t("redeem.tryAnother")}</Button>
                        </div>
                    </div>
                )}
            </ParchmentCard>
        </AppLayout>
    )
}
