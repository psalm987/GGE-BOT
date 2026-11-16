const escapeHtml = (value: string) =>
    value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

export type Rendered = { subject: string; html: string; text: string }

/** A paragraph, or a heading with the paragraph under it. */
type Paragraph = string | { heading: string; text: string }

function render(subject: string, paragraphs: Paragraph[], action?: { label: string; url: string }): Rendered {
    const html = [
        `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#222">`,
        `<h2>${escapeHtml(subject)}</h2>`,
        ...paragraphs.map(p => typeof p === "string" ? `<p>${escapeHtml(p)}</p>` : `<p><strong>${escapeHtml(p.heading)}</strong><br>${escapeHtml(p.text)}</p>`),
        action && `<p><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 18px;background:#7a4b1e;color:#fff;text-decoration:none;border-radius:4px">${escapeHtml(action.label)}</a></p>`,
        action && `<p style="font-size:12px;color:#666">Or paste this link into your browser:<br>${escapeHtml(action.url)}</p>`,
        `</div>`,
    ].filter(Boolean).join("")
    const text = [...paragraphs.map(p => typeof p === "string" ? p : `${p.heading}\n${p.text}`), action && `${action.label}: ${action.url}`].filter(Boolean).join("\n\n")
    return { subject, html, text }
}

type Link = { link: string }

export const templates = {
    verify_email: ({ link }: Link) =>
        render("Verify your email", ["Confirm this address to finish setting up your GGE Bot account. The link works for 24 hours."], { label: "Verify email", url: link }),
    reset_password: ({ link }: Link) =>
        render("Reset your password", ["We got a request to reset your GGE Bot password. The link works for 1 hour. If this wasn't you, ignore this email."], { label: "Choose a new password", url: link }),
    password_changed: (_: Record<string, never>) =>
        render("Your password was changed", ["The password on your GGE Bot account was just changed and other devices were signed out. If this wasn't you, reset your password right away."]),
    recovery_code_used: ({ remaining }: { remaining: number }) =>
        render("A recovery code was used to sign in", [
            "Someone just signed in to the GGE Bot admin app with your password and one of your recovery codes, in place of an authenticator code.",
            `You have ${remaining} recovery ${remaining === 1 ? "code" : "codes"} left. Make new ones under Settings in the admin app.`,
            "If this wasn't you, reset your password right away and ask another admin to reset your two-factor sign-in.",
        ]),
    /** One email for everything that stopped a player's bots since the last one. */
    bot_alerts: ({ alerts, link }: { alerts: { title: string; body: string; server: string }[]; link: string }) =>
        render(alerts.length === 1 ? alerts[0]!.title : `${alerts.length} of your bots need attention`, [
            alerts.length === 1 ? "A bot on your GGE Bot account stopped and won't start again until you act." : "These bots on your GGE Bot account stopped and won't start again until you act.",
            ...alerts.map(alert => ({ heading: `${alert.title} (${alert.server})`, text: alert.body })),
            "You can choose which of these emails you get under Settings.",
        ], { label: "Open your accounts", url: link }),
}

export type EmailKind = keyof typeof templates
export type TemplateData<K extends EmailKind> = Parameters<(typeof templates)[K]>[0]
