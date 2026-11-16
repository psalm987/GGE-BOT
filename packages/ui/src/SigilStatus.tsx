import { CheckCircleFilled, ClockCircleOutlined, CloseCircleFilled, KeyOutlined, MinusCircleOutlined, MoonFilled, StopOutlined, WarningFilled } from "@ant-design/icons"
import { Tag, Tooltip } from "antd"
import dayjs from "dayjs"
import type { ReactNode } from "react"
import { palette } from "./theme.ts"

export type BotState = "starting" | "running" | "stopped" | "auth_failed" | "banned" | "error" | "crash_loop"

/** `color` draws the icon and border (3:1), `text` the label (4.5:1). */
const SIGILS: Record<BotState, { label: string; color: string; text: string; icon: ReactNode }> = {
    running: { label: "Running", color: palette.emerald, text: palette.emeraldText, icon: <CheckCircleFilled /> },
    starting: { label: "Starting", color: palette.azure, text: palette.azureText, icon: <ClockCircleOutlined /> },
    stopped: { label: "Stopped", color: palette.muted, text: palette.muted, icon: <MinusCircleOutlined /> },
    auth_failed: { label: "Wrong password", color: palette.amber, text: palette.amber, icon: <KeyOutlined /> },
    banned: { label: "Banned", color: palette.crimson, text: palette.crimsonText, icon: <StopOutlined /> },
    error: { label: "Error", color: palette.crimson, text: palette.crimsonText, icon: <WarningFilled /> },
    crash_loop: { label: "Stopped after repeated crashes", color: palette.crimson, text: palette.crimsonText, icon: <CloseCircleFilled /> },
}

/** A moment within the coming week, in the viewer's own time: "Tue 08:07". */
export const weekdayTime = (at: Date) => dayjs(at).format("ddd HH:mm")

/**
 * A bot's state as icon, colour and words together, so colour is never the only signal.
 * With `sleepingUntil`, the bot is waiting for its next run window, and that is shown instead of the state.
 */
export function SigilStatus({ state, detail, sleepingUntil }: { state: BotState | null | undefined; detail?: string | null; sleepingUntil?: Date | null }) {
    if (sleepingUntil)
        return (
            <Tag icon={<MoonFilled style={{ color: palette.dusk }} />} variant="outlined" style={{ color: palette.dusk, borderColor: palette.dusk, background: "transparent", fontWeight: 500 }}>
                Sleeping until {weekdayTime(sleepingUntil)}
            </Tag>
        )
    const sigil = SIGILS[state ?? "stopped"]
    const tag = (
        <Tag icon={<span style={{ color: sigil.color }}>{sigil.icon}</span>} variant="outlined" style={{ color: sigil.text, borderColor: sigil.color, background: "transparent", fontWeight: 500 }}>
            {sigil.label}
        </Tag>
    )
    return detail ? <Tooltip title={detail}>{tag}</Tooltip> : tag
}
