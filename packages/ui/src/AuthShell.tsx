import { Typography } from "antd"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Crest } from "./Crest.tsx"
import { LanguagePicker } from "./LanguagePicker.tsx"
import { palette } from "./palette.ts"

/** Sign-in layout: a heraldic banner beside the form; the banner folds away on phones. */
export function AuthShell({ title, subtitle, children, footer, wide }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
    const { t } = useTranslation("ui")
    return (
        <div style={{ minHeight: "100dvh", display: "flex" }}>
            <aside className="gge-heraldry gge-auth-banner" aria-hidden="true" style={{ flex: "1 1 45%", display: "flex", alignItems: "center", justifyContent: "center", borderInlineEnd: `1px solid ${palette.rule}` }}>
                <div style={{ textAlign: "center", padding: 32, background: "rgba(7, 46, 35, 0.8)", border: "1px solid rgba(255, 255, 255, 0.18)", borderRadius: 8 }}>
                    <Crest size={96} />
                    <div className="gge-display" style={{ fontSize: 28, fontWeight: 700, color: palette.navText, marginTop: 16 }}>GGE Command</div>
                    <hr className="gge-rule" style={{ margin: "12px auto", width: "70%" }} />
                    <div style={{ color: palette.navMuted }}>{t("auth.tagline")}</div>
                </div>
            </aside>
            <main style={{ flex: "1 1 55%", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 20px" }}>
                <div style={{ width: "100%", maxWidth: wide ? 480 : 400 }}>
                    <div className="gge-auth-mark" style={{ display: "none", justifyContent: "center", marginBottom: 16 }}><Crest size={56} title="GGE Command" /></div>
                    <Typography.Title level={2} className="gge-display" style={{ marginBottom: 4 }}>{title}</Typography.Title>
                    {subtitle && <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>{subtitle}</Typography.Paragraph>}
                    {children}
                    {footer && <div style={{ marginTop: 24 }}>{footer}</div>}
                    <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}><LanguagePicker /></div>
                </div>
            </main>
            <style>{`@media (max-width: 860px) { .gge-auth-banner { display: none !important } .gge-auth-mark { display: flex !important } }`}</style>
        </div>
    )
}
