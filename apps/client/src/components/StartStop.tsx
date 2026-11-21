import { CaretRightFilled, PauseOutlined } from "@ant-design/icons"
import { Button, Tooltip, Typography } from "antd"
import { useTranslation } from "react-i18next"
import type { PublicAccount } from "@gge/contracts"
import { SigilStatus } from "@gge/ui"
import { usePlanHint, useSetDesiredState } from "../account-state.ts"

const FAILED = new Set(["auth_failed", "banned", "error", "crash_loop"])

/** The account's Start or Stop button, its label saying which. A plan that doesn't cover the account gets the reason instead. */
export function StartStop({ account }: { account: PublicAccount | undefined }) {
    const { t } = useTranslation("client")
    const set = useSetDesiredState()
    const hint = usePlanHint()
    if (!account)
        return (
            <Tooltip title={t("module.startNoAccount")}>
                <Button type="primary" icon={<CaretRightFilled />} disabled aria-label={t("overview.start")}>{t("overview.start")}</Button>
            </Tooltip>
        )
    if (!account.entitled)
        return <Typography.Text type="secondary" role="status">{t("dashboard.overPlanStart", { hint })}</Typography.Text>
    const wanted = account.desiredState === "running"
    return wanted
        ? <Button icon={<PauseOutlined />} loading={set.isPending} onClick={() => set.mutate({ ids: [account.id], state: "stopped" })}>{t("overview.stop")}</Button>
        : <Button type="primary" icon={<CaretRightFilled />} loading={set.isPending} onClick={() => set.mutate({ ids: [account.id], state: "running" })}>{t("overview.start")}</Button>
}

/** What the bot is doing beyond the button: starting, sleeping until its window, or why it failed. Nothing while it just runs or is stopped. */
export function StartStopDetail({ account }: { account: PublicAccount | undefined }) {
    if (!account?.entitled) return null
    const actual = account.status?.actualState
    const wanted = account.desiredState === "running"
    if (account.sleepingUntil || (actual && FAILED.has(actual)))
        return <SigilStatus state={actual} detail={account.status?.lastError} sleepingUntil={account.sleepingUntil} />
    if (wanted && actual !== "running")
        return <SigilStatus state="starting" />
    return null
}
