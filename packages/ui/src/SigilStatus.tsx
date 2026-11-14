import { CheckCircleFilled, ClockCircleOutlined, KeyOutlined, MinusCircleOutlined, StopOutlined, WarningFilled } from "@ant-design/icons"
import { Tag, Tooltip } from "antd"
import type { ReactNode } from "react"
import { palette } from "./theme.ts"

export type BotState = "starting" | "running" | "stopped" | "auth_failed" | "banned" | "error"

const SIGILS: Record<BotState, { label: string; color: string; icon: ReactNode }> = {
    running: { label: "Running", color: palette.emerald, icon: <CheckCircleFilled /> },
    starting: { label: "Starting", color: palette.azure, icon: <ClockCircleOutlined /> },
    stopped: { label: "Stopped", color: palette.muted, icon: <MinusCircleOutlined /> },
    auth_failed: { label: "Wrong password", color: palette.amber, icon: <KeyOutlined /> },
    banned: { label: "Banned", color: palette.crimson, icon: <StopOutlined /> },
    error: { label: "Error", color: palette.crimson, icon: <WarningFilled /> },
}

/** A bot's state as icon, colour and words together, so colour is never the only signal. */
export function SigilStatus({ state, detail }: { state: BotState | null | undefined; detail?: string | null }) {
    const sigil = SIGILS[state ?? "stopped"]
    const tag = (
        <Tag icon={sigil.icon} variant="outlined" style={{ color: sigil.color, borderColor: sigil.color, background: "transparent", fontWeight: 500 }}>
            {sigil.label}
        </Tag>
    )
    return detail ? <Tooltip title={detail}>{tag}</Tooltip> : tag
}
