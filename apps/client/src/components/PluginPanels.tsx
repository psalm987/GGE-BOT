import { CheckCircleFilled, ClockCircleOutlined, InfoCircleFilled, MinusCircleOutlined, PauseCircleOutlined, WarningFilled } from "@ant-design/icons"
import { Switch, Tag, Typography } from "antd"
import { type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { runChecks, type CheckLevel, type PluginCatalogEntry, type PluginRunState, type PluginState } from "@gge/contracts"
import { palette } from "@gge/ui"

/** What the status pill shows: a plugin's own report, or why it can't be running. */
export type PillState = PluginRunState | "off" | "botStopped"
export type PluginPill = { state: PillState; reason: string | null }

const PILLS: Record<PillState, { color: string; text: string; icon: ReactNode }> = {
    running: { color: palette.emerald, text: palette.emeraldText, icon: <CheckCircleFilled /> },
    waiting: { color: palette.amber, text: palette.amber, icon: <ClockCircleOutlined /> },
    stopped: { color: palette.muted, text: palette.muted, icon: <MinusCircleOutlined /> },
    error: { color: palette.crimson, text: palette.crimsonText, icon: <WarningFilled /> },
    off: { color: palette.muted, text: palette.muted, icon: <PauseCircleOutlined /> },
    botStopped: { color: palette.muted, text: palette.muted, icon: <MinusCircleOutlined /> },
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
        <Tag icon={<span style={{ color: pill.color }}>{pill.icon}</span>} variant="outlined"
            style={{ color: pill.text, borderColor: pill.color, background: "transparent", fontWeight: 500, marginInlineEnd: 0 }}>
            {t(`plugins.state.${state}`)}
        </Tag>
    )
}

export function BreaksPeaceTag() {
    const { t } = useTranslation("client")
    return (
        <Tag icon={<WarningFilled style={{ color: palette.crimson }} />} variant="outlined"
            style={{ color: palette.crimsonText, borderColor: palette.crimson, background: "transparent", fontWeight: 500, marginInlineEnd: 0 }}>
            {t("plugins.breaksPeace")}
        </Tag>
    )
}

const CHECK_ICONS: Record<CheckLevel, { color: string; text: string; icon: ReactNode }> = {
    ok: { color: palette.emerald, text: palette.emeraldText, icon: <CheckCircleFilled /> },
    warn: { color: palette.amber, text: palette.amber, icon: <WarningFilled /> },
    info: { color: palette.azure, text: palette.azureText, icon: <InfoCircleFilled /> },
}

/** Beside the form it stays in view while the form scrolls; above it, on a phone, it scrolls away with it. */
export function SetupChecks({ entry, input, beside }: { entry: PluginCatalogEntry; input: Parameters<typeof runChecks>[1]; beside: boolean }) {
    const { t } = useTranslation("client")
    const results = runChecks(entry.checks ?? [], input)
    return (
        <aside aria-labelledby={`checks-${entry.key}`} style={{ position: beside ? "sticky" : undefined, top: 0, background: palette.terminal, border: `1px solid ${palette.rule}`, borderRadius: 6, padding: "12px 14px" }}>
            <Typography.Title level={5} id={`checks-${entry.key}`} className="gge-display" style={{ marginTop: 0, fontSize: 15 }}>{t("plugins.checks.title")}</Typography.Title>
            {results.length === 0
                ? <Typography.Text type="secondary">{t("plugins.checks.empty")}</Typography.Text>
                : <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
                    {results.map((check, i) => {
                        const look = CHECK_ICONS[check.level]
                        return (
                            <li key={i} style={{ display: "grid", gridTemplateColumns: "20px 1fr", gap: 8 }}>
                                <span aria-hidden style={{ color: look.color, paddingTop: 2 }}>{look.icon}</span>
                                <span>
                                    <strong style={{ color: look.text, fontSize: 13, display: "block" }}>{t(`plugins.check.level.${check.level}`)}</strong>
                                    {t(`plugins.check.${check.key}`, check.params)}
                                </span>
                            </li>
                        )
                    })}
                </ul>}
        </aside>
    )
}

export type View = "simple" | "advanced"
const VIEW_KEY = "gge.pluginSettingsView"
export function readView(): View {
    try { return localStorage.getItem(VIEW_KEY) === "advanced" ? "advanced" : "simple" } catch { return "simple" }
}
export function writeView(view: View) {
    try { localStorage.setItem(VIEW_KEY, view) } catch { /* the choice just isn't remembered */ }
}


/** An enable switch that can't be turned on while the account is at its attack plugin limit; it can always be turned off. */
export function AttackAwareSwitch({ label, blockTurningOn, checked, onChange, disabled }: {
    label: string; blockTurningOn: boolean; checked?: boolean; onChange?: (v: boolean) => void; disabled?: boolean
}) {
    const { t } = useTranslation("client")
    return <Switch size="small" aria-label={t("plugins.enable", { label })} checked={checked} onChange={onChange}
        disabled={disabled || (blockTurningOn && !checked)} title={blockTurningOn && !checked ? t("plugins.attackLimitReached") : undefined} />
}
