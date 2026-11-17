import { and, eq, isNull, ne, or } from "drizzle-orm"
import { resolveLocale, type Locale } from "@gge/i18n"
import { users } from "@gge/db"
import { ORPCError } from "@orpc/server"
import type { Ctx } from "../context.ts"

export type Detected = { locale: Locale; country: string | null; source: "ip" | "header" | "default" }

/**
 * The language "Automatic" gives this caller: their IP's country, else Accept-Language, else English.
 * A signed-in caller's result is kept on the user, so emails can be localised without a request.
 */
export async function detectLocale(ctx: Ctx, userId?: string): Promise<Detected> {
    if (!ctx.limits.detect.hit(ctx.req.ip))
        throw new ORPCError("TOO_MANY_REQUESTS", { message: "Too many requests" })
    const country = await ctx.lookupCountry(ctx.req.ip)
    const { locale, source } = resolveLocale({ country, acceptLanguage: ctx.req.headers["accept-language"] })
    if (userId)
        await ctx.db.update(users).set({ detectedLocale: locale })
            .where(and(eq(users.id, userId), or(isNull(users.detectedLocale), ne(users.detectedLocale, locale))))
    return { locale, country, source: source === "preference" ? "default" : source }
}

export async function setLocale(ctx: Pick<Ctx, "db">, userId: string, locale: Locale | null) {
    await ctx.db.update(users).set({ locale, updatedAt: new Date() }).where(eq(users.id, userId))
}
