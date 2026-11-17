import { GiftOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, Button, Input, type InputRef } from "antd"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { CODE_INVALID, CODE_REVOKED, CODE_USED } from "@gge/contracts"
import { ParchmentCard } from "@gge/ui"
import { formatWhen } from "../../alert-banners.ts"
import { messageOf, orpc, queryClient } from "../../api.ts"
import { codeComplete, maskCode } from "../../plan-model.ts"

const KNOWN = new Set([CODE_INVALID, CODE_USED, CODE_REVOKED])

/** Why a code wasn't redeemed, in words the player can act on. */
export function useCodeError() {
    const { t } = useTranslation("client")
    return (error: unknown) => {
        const { code, data } = error as { code?: string; data?: { code?: string } }
        if (data?.code && KNOWN.has(data.code))
            return t(`plan.redeem.error.${data.code}`)
        if (code === "TOO_MANY_REQUESTS")
            return t("plan.redeem.error.tooMany")
        return messageOf(error)
    }
}

/** Every view of the player's plan, after something added time or spent points. */
export const refreshPlan = () => {
    for (const queryKey of [orpc.billing.key(), orpc.alerts.key(), orpc.accounts.list.queryKey()])
        void queryClient.invalidateQueries({ queryKey })
}

/** A Team code or any single-use code: typed, pasted or masked as it goes, with the reason under the field when it fails. */
export function RedeemCodeCard({ focus }: { focus: boolean }) {
    const { t, i18n } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const codeError = useCodeError()
    const [code, setCode] = useState("")
    const input = useRef<InputRef>(null)
    useEffect(() => { if (focus) input.current?.focus({ cursor: "end" }) }, [focus])
    const redeem = useMutation(orpc.billing.redeemCode.mutationOptions({
        onSuccess: () => { setCode(""); refreshPlan() },
    }))
    const error = redeem.error && codeError(redeem.error)
    const added = redeem.data?.period

    return (
        <ParchmentCard id="redeem" title={t("plan.redeem.title")} style={{ height: "100%" }}>
            <form className="gge-field" onSubmit={e => { e.preventDefault(); if (codeComplete(code)) redeem.mutate({ code }) }}>
                <label className="gge-field-label" htmlFor="redeem-code">{t("plan.redeem.label")}</label>
                <Input id="redeem-code" ref={input} size="large" value={code} autoComplete="off" spellCheck={false} autoCapitalize="characters"
                    className="gge-code-input" placeholder="GGE-XXXX-XXXX-XXXX" maxLength={18} status={error ? "error" : undefined}
                    aria-invalid={!!error} aria-describedby={error ? "redeem-error" : "redeem-hint"}
                    onChange={e => { setCode(maskCode(e.target.value)); if (redeem.error || redeem.data) redeem.reset() }} />
                {error
                    ? <div id="redeem-error" role="alert" className="gge-field-error">{error}</div>
                    : <div id="redeem-hint" className="gge-field-hint">{t("plan.redeem.hint")}</div>}
                <Button htmlType="submit" icon={<GiftOutlined />} size="large" loading={redeem.isPending} disabled={!codeComplete(code)} style={{ marginTop: 8 }}>
                    {t("plan.redeem.submit")}
                </Button>
            </form>
            {added && (
                <Alert type="success" showIcon role="status" style={{ marginTop: 16 }}
                    title={t("plan.redeem.done", { days: Math.round((added.endsAt.getTime() - added.startsAt.getTime()) / 86_400_000), plan: tc(`plan.${added.planId}`) })}
                    description={t("plan.redeem.doneUntil", { date: formatWhen(added.endsAt, i18n.language, new Date()) })} />
            )}
        </ParchmentCard>
    )
}
