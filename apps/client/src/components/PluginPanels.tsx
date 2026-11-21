import { CheckCircleFilled, ClockCircleOutlined, MinusCircleOutlined, PauseCircleOutlined, WarningFilled } from "@ant-design/icons"
import { Switch, Tag } from "antd"
import { type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import type { PluginRunState, PluginState } from "@gge/contracts"
import { palette } from "@gge/ui"

/** What the status pill shows: a plugin's own report, or why it can't be running. */
export type PillState = PluginRunState | "off" | "botStopped"
export type PluginPill = { state: PillState; reason: string | null }

const PILLS: Record<PillState, { color: string; icon: ReactNode }> = {
    running: { color: palette.emerald, icon: <CheckCircleFilled /> },
    waiting: { color: palette.amber, icon: <ClockCircleOutlined /> },
    stopped: { color: palette.muted, icon: <MinusCircleOutlined /> },
    error: { color: palette.crimson, icon: <WarningFilled /> },
    off: { color: palette.muted, icon: <PauseCircleOutlined /> },
    botStopped: { color: palette.muted, icon: <MinusCircleOutlined /> },
}

/** The pill for a plugin, or null while it runs and hasn't said anything yet. */
export function usePluginPill(enabled: boolean, botRunning: boolean, report: PluginState | undefined): PluginPill | null {
    const { t } = useTranslation("client")
    const { t: tb } = useTranslation("bot")
    if (!enabled)
        return { state: "off", reason: t("plugins.reason.off") }
    if (!botRunning)
        return { state: "botStopped", reason: t("plugins.reason.botStopped") }
    if (!report)
        return null
    return { state: report.state, reason: report.reasonKey ? tb(report.reasonKey, { ...report.params, defaultValue: report.reasonKey }) : null }
}

export function PluginStatusPill({ state }: { state: PillState }) {
    const { t } = useTranslation("client")
    const pill = PILLS[state]
    return (
        <Tag icon={pill.icon} variant="outlined"
            style={{ color: pill.color, borderColor: pill.color, background: "transparent", fontWeight: 500, marginInlineEnd: 0 }}>
            {t(`plugins.state.${state}`)}
        </Tag>
    )
}

export function BreaksPeaceTag() {
    const { t } = useTranslation("client")
    return (
        <Tag icon={<WarningFilled style={{ color: palette.crimson }} />} variant="outlined"
            style={{ color: palette.crimson, borderColor: palette.crimson, background: "transparent", fontWeight: 500, marginInlineEnd: 0 }}>
            {t("plugins.breaksPeace")}
        </Tag>
    )
}

/** An enable switch that can't be turned on while the account is at its attack plugin limit; it can always be turned off. */
export function AttackAwareSwitch({ label, blockTurningOn, checked, onChange, disabled }: {
    label: string; blockTurningOn: boolean; checked?: boolean; onChange?: (v: boolean) => void; disabled?: boolean
}) {
    const { t } = useTranslation("client")
    return <Switch size="small" aria-label={t("plugins.enable", { label })} checked={checked} onChange={onChange}
        disabled={disabled || (blockTurningOn && !checked)} title={blockTurningOn && !checked ? t("plugins.attackLimitReached") : undefined} />
}
