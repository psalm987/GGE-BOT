const escapeHtml = (value: string) =>
    value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

export type Rendered = { subject: string; html: string; text: string }

function render(subject: string, paragraphs: string[], action?: { label: string; url: string }): Rendered {
    const html = [
        `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#222">`,
        `<h2>${escapeHtml(subject)}</h2>`,
        ...paragraphs.map(p => `<p>${escapeHtml(p)}</p>`),
        action && `<p><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 18px;background:#7a4b1e;color:#fff;text-decoration:none;border-radius:4px">${escapeHtml(action.label)}</a></p>`,
        action && `<p style="font-size:12px;color:#666">Or paste this link into your browser:<br>${escapeHtml(action.url)}</p>`,
        `</div>`,
    ].filter(Boolean).join("")
    const text = [...paragraphs, action && `${action.label}: ${action.url}`].filter(Boolean).join("\n\n")
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
    invite: ({ link }: Link) =>
        render("You're invited to GGE Bot", ["You've been invited to create a GGE Bot account. This address is already confirmed once you sign up through this link."], { label: "Create your account", url: link }),
}

export type EmailKind = keyof typeof templates
export type TemplateData<K extends EmailKind> = Parameters<(typeof templates)[K]>[0]
