import type { Ctx } from "../context.ts"
import { templates, type EmailKind, type TemplateData } from "../emails/templates.ts"
import { audit } from "./audit.ts"

/** The client app's URL plus a path and query, for links in emails. */
export function clientLink(ctx: Pick<Ctx, "env">, path: string, params: Record<string, string>) {
    const url = new URL(path, ctx.env.CLIENT_ORIGINS[0])
    for (const [key, value] of Object.entries(params))
        url.searchParams.set(key, value)
    return url.toString()
}

/** Sends one templated email. A delivery failure is logged and audited, never thrown: callers answer the same either way. */
export async function sendEmail<K extends EmailKind>(
    ctx: Pick<Ctx, "db" | "mailer" | "req">,
    kind: K,
    to: string,
    data: TemplateData<K>,
    actorId: string | null,
) {
    try {
        const rendered = (templates[kind] as (data: TemplateData<K>) => ReturnType<(typeof templates)[K]>)(data)
        await ctx.mailer.send({ to, tag: kind, ...rendered })
        return true
    } catch (error) {
        ctx.req.log.error({ err: error, kind }, "email delivery failed")
        await audit(ctx.db, { actorId, action: "email.send_failed", meta: { kind } }).catch(() => {})
        return false
    }
}
