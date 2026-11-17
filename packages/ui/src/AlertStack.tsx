import { CloseCircleFilled, CloseOutlined, InfoCircleFilled, WarningFilled } from "@ant-design/icons"
import { Button } from "antd"
import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

export type AlertSeverity = "info" | "warning" | "critical"

/** A button, or a link to another site, which opens in a new tab. */
export type AlertAction = { label: string } & ({ onClick: () => void; href?: never } | { href: string; onClick?: never })

export type AlertBanner = {
    /** Stable across renders, so React keeps a banner's place when others come and go. */
    id: string
    severity: AlertSeverity
    /** Shown bold on its own line above the message, as announcements have. */
    title?: ReactNode
    message: ReactNode
    /** At most two, the first the one that matters; most banners have one. */
    actions?: AlertAction[]
    /** Shows the close button. */
    onDismiss?: () => void
}

const ICONS: Record<AlertSeverity, ReactNode> = {
    info: <InfoCircleFilled />,
    warning: <WarningFilled />,
    critical: <CloseCircleFilled />,
}

/** How many banners show before "Show n more". */
const VISIBLE = 2

/** One banner. Exported for previews, such as the admin's announcement editor. */
export function AlertItem({ banner }: { banner: AlertBanner }) {
    const { t } = useTranslation("ui")
    const { severity, title, message, actions = [], onDismiss } = banner
    return (
        <div className="gge-alert" data-severity={severity} role={severity === "critical" ? "alert" : "status"}>
            <span className="gge-alert-icon" aria-hidden>{ICONS[severity]}</span>
            <div className="gge-alert-text">
                <span className="gge-sr-only">{t(`alerts.severity.${severity}`)}: </span>
                {title && <span className="gge-alert-title">{title}</span>}
                {message}
            </div>
            {actions.length > 0 && (
                <div className="gge-alert-action">
                    {actions.map((action, i) => (
                        <Button key={action.label} type={i === 0 ? "primary" : "default"} ghost={i === 0} onClick={action.onClick}
                            {...(action.href && { href: action.href, target: "_blank", rel: "noopener noreferrer" })}>{action.label}</Button>
                    ))}
                </div>
            )}
            {onDismiss && (
                <div className="gge-alert-close">
                    <Button type="text" icon={<CloseOutlined />} aria-label={t("alerts.close")} onClick={onDismiss} />
                </div>
            )}
        </div>
    )
}

/**
 * The banners under the page header, most urgent first as given. Two show at once and the rest wait behind
 * "Show n more", so a pile of notices never pushes the page out of sight.
 */
export function AlertStack({ banners, label }: { banners: AlertBanner[]; label: string }) {
    const { t } = useTranslation("ui")
    const [expanded, setExpanded] = useState(false)
    if (!banners.length)
        return null
    const hidden = banners.length - VISIBLE
    const shown = expanded || hidden <= 0 ? banners : banners.slice(0, VISIBLE)
    return (
        <section className="gge-alerts" aria-label={label}>
            {shown.map(banner => <AlertItem key={banner.id} banner={banner} />)}
            {hidden > 0 && (
                <Button type="link" className="gge-alerts-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                    {expanded ? t("alerts.showFewer") : t("alerts.showMore", { count: hidden })}
                </Button>
            )}
        </section>
    )
}
