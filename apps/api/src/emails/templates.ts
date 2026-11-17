import { LOCALES, isLocale, type Translate } from "@gge/i18n"

const escapeHtml = (value: string) =>
    value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

export type Rendered = { subject: string; html: string; text: string }

/** A paragraph, or a heading with the paragraph under it. */
type Paragraph = string | { heading: string; text: string }

type Layout = { t: Translate; locale: string }

function render({ t, locale }: Layout, subject: string, paragraphs: Paragraph[], action?: { label: string; url: string }): Rendered {
    const dir = isLocale(locale) ? LOCALES[locale].dir : "ltr"
    const html = [
        `<div lang="${escapeHtml(locale)}" dir="${dir}" style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#222">`,
        `<h2>${escapeHtml(subject)}</h2>`,
        ...paragraphs.map(p => typeof p === "string" ? `<p>${escapeHtml(p)}</p>` : `<p><strong>${escapeHtml(p.heading)}</strong><br>${escapeHtml(p.text)}</p>`),
        action && `<p><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 18px;background:#7a4b1e;color:#fff;text-decoration:none;border-radius:4px">${escapeHtml(action.label)}</a></p>`,
        action && `<p style="font-size:12px;color:#666">${escapeHtml(t("link.fallback"))}<br>${escapeHtml(action.url)}</p>`,
        `</div>`,
    ].filter(Boolean).join("")
    const text = [...paragraphs.map(p => typeof p === "string" ? p : `${p.heading}\n${p.text}`), action && `${action.label}: ${action.url}`].filter(Boolean).join("\n\n")
    return { subject, html, text }
}

type Link = { link: string }

/** Each template reads its texts from the `emails` namespace through `t`, in the recipient's language. */
type Template<D> = (t: Translate, data: D, locale: string) => Rendered

export const templates = {
    verify_email: ((t, { link }, locale) =>
        render({ t, locale }, t("verify_email.subject"), [t("verify_email.body")], { label: t("verify_email.action"), url: link })) satisfies Template<Link>,
    reset_password: ((t, { link }, locale) =>
        render({ t, locale }, t("reset_password.subject"), [t("reset_password.body")], { label: t("reset_password.action"), url: link })) satisfies Template<Link>,
    password_changed: ((t, _, locale) =>
        render({ t, locale }, t("password_changed.subject"), [t("password_changed.body")])) satisfies Template<Record<string, never>>,
    change_email: ((t, { link }, locale) =>
        render({ t, locale }, t("change_email.subject"), [t("change_email.body")], { label: t("change_email.action"), url: link })) satisfies Template<Link>,
    /** To the address being replaced. It carries no link, so whoever reads the old inbox can't confirm the change. */
    email_change_requested: ((t, { newEmail }, locale) =>
        render({ t, locale }, t("email_change_requested.subject"), [t("email_change_requested.asked", { newEmail }), t("email_change_requested.advice")])) satisfies Template<{ newEmail: string }>,
    email_changed: ((t, { newEmail }, locale) =>
        render({ t, locale }, t("email_changed.subject"), [t("email_changed.body", { newEmail }), t("email_changed.advice")])) satisfies Template<{ newEmail: string }>,
    account_deleted: ((t, { username }, locale) =>
        render({ t, locale }, t("account_deleted.subject"), [t("account_deleted.body", { username }), t("account_deleted.advice")])) satisfies Template<{ username: string }>,
    recovery_code_used: ((t, { remaining }, locale) =>
        render({ t, locale }, t("recovery_code_used.subject"), [t("recovery_code_used.body"), t("recovery_code_used.remaining", { count: remaining }), t("recovery_code_used.advice")])) satisfies Template<{ remaining: number }>,
    /** One email for every notification since the last one, each already worded in the recipient's language. `server` names the bot's server; a notice about the plan has none. */
    bot_alerts: ((t, { alerts, link }, locale) => {
        const allBots = alerts.every(alert => alert.server !== undefined)
        const intro = !allBots ? t("bot_alerts.introPlan") : alerts.length === 1 ? t("bot_alerts.introOneBot") : t("bot_alerts.introManyBots")
        const subject = alerts.length === 1 ? alerts[0]!.title : t(allBots ? "bot_alerts.subjectBots" : "bot_alerts.subjectMixed", { count: alerts.length })
        return render({ t, locale }, subject, [
            intro,
            ...alerts.map(alert => ({ heading: alert.server ? t("bot_alerts.withServer", { title: alert.title, server: alert.server }) : alert.title, text: alert.body })),
            t("bot_alerts.footer"),
        ], { label: t(allBots ? "bot_alerts.actionBots" : "bot_alerts.actionPlan"), url: link })
    }) satisfies Template<{ alerts: { title: string; body: string; server?: string }[]; link: string }>,
}

export type EmailKind = keyof typeof templates
export type TemplateData<K extends EmailKind> = Parameters<(typeof templates)[K]>[1]
