import { CheckCircleFilled, ClockCircleOutlined, CloseCircleFilled, KeyOutlined, MinusCircleOutlined, MoonFilled, StopOutlined, WarningFilled } from "@ant-design/icons"
import { Tag, Tooltip } from "antd"
import dayjs from "dayjs"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { palette } from "./palette.ts"

export type BotState = "starting" | "running" | "stopped" | "auth_failed" | "banned" | "error" | "crash_loop"

/** One colour draws the icon, the border and the label, so it passes 4.5:1 on every ground. */
const SIGILS: Record<BotState, { color: string; icon: ReactNode }> = {
    running: { color: palette.emerald, icon: <CheckCircleFilled /> },
    starting: { color: palette.azure, icon: <ClockCircleOutlined /> },
    stopped: { color: palette.muted, icon: <MinusCircleOutlined /> },
    auth_failed: { color: palette.amber, icon: <KeyOutlined /> },
    banned: { color: palette.crimson, icon: <StopOutlined /> },
    error: { color: palette.crimson, icon: <WarningFilled /> },
    crash_loop: { color: palette.crimson, icon: <CloseCircleFilled /> },
}

/** A moment within the coming week, in the viewer's own time: "Tue 08:07". */
export const weekdayTime = (at: Date) => dayjs(at).format("ddd HH:mm")

/**
 * A bot's state as icon, colour and words together, so colour is never the only signal.
 * With `sleepingUntil`, the bot is waiting for its next run window, and that is shown instead of the state.
 */
export function SigilStatus({ state, detail, sleepingUntil }: { state: BotState | null | undefined; detail?: string | null; sleepingUntil?: Date | null }) {
    const { t } = useTranslation("ui")
    if (sleepingUntil)
        return (
            <Tag icon={<MoonFilled style={{ color: palette.dusk }} />} variant="outlined" style={{ color: palette.dusk, borderColor: palette.dusk, background: "transparent", fontWeight: 500 }}>
                {t("status.sleepingUntil", { time: weekdayTime(sleepingUntil) })}
            </Tag>
        )
    const key = state ?? "stopped"
    const sigil = SIGILS[key]
    const tag = (
        <Tag icon={sigil.icon} variant="outlined" style={{ color: sigil.color, borderColor: sigil.color, background: "transparent", fontWeight: 500 }}>
            {t(`status.${key}`)}
        </Tag>
    )
    return detail ? <Tooltip title={detail}>{tag}</Tooltip> : tag
}
