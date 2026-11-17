import { eq } from "drizzle-orm"
import { isLocale, type Locale, type Translate } from "@gge/i18n"
import { serverT } from "@gge/i18n/server"
import { users } from "@gge/db"
import type { Ctx } from "../context.ts"
import { templates, type EmailKind, type TemplateData } from "../emails/templates.ts"
import { audit } from "./audit.ts"

/** The language to write to a player in: the one they chose, else the one detected for them, else English. */
export function emailLocale(user: { locale: string | null; detectedLocale: string | null } | undefined): Locale {
    const language = user?.locale ?? user?.detectedLocale
    return isLocale(language) ? language : "en"
}

/** The server's translator for one language, reading the `emails` namespace. A text the language lacks reads in English. */
export function emailTranslator(locale: Locale): Translate {
    const t = serverT(locale)
    return (key, options) => t(key, { ns: "emails", ...options })
}

/** The client app's URL plus a path and query, for links in emails. */
export function clientLink(ctx: Pick<Ctx, "env">, path: string, params: Record<string, string>) {
    const url = new URL(path, ctx.env.CLIENT_ORIGINS[0])
    for (const [key, value] of Object.entries(params))
        url.searchParams.set(key, value)
    return url.toString()
}

/**
 * Sends one templated email in the recipient's language: `locale` when the caller knows it (the account is gone, or not made yet),
 * else the language stored for `actorId`'s user. A delivery failure is logged and audited, never thrown: callers answer the same either way.
 */
export async function sendEmail<K extends EmailKind>(
    ctx: Pick<Ctx, "db" | "mailer" | "log">,
    kind: K,
    to: string,
    data: TemplateData<K>,
    actorId: string | null,
    locale?: Locale,
) {
    try {
        const language = locale ?? (actorId ? emailLocale((await ctx.db.select({ locale: users.locale, detectedLocale: users.detectedLocale }).from(users).where(eq(users.id, actorId)))[0]) : "en")
        const render = templates[kind] as (t: Translate, data: TemplateData<K>, locale: Locale) => ReturnType<(typeof templates)[K]>
        const rendered = render(emailTranslator(language), data, language)
        await ctx.mailer.send({ to, tag: kind, ...rendered })
        return true
    } catch (error) {
        ctx.log.error({ err: error, kind }, "email delivery failed")
        await audit(ctx.db, { actorId, action: "email.send_failed", meta: { kind } }).catch(() => {})
        return false
    }
}
