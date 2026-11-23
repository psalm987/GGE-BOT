import type { FastifyInstance, FastifyRequest } from "fastify"
import * as z from "zod"
import type { Env } from "../env.ts"
import type { Mailer } from "../services/mailer.ts"
import type { RateLimiter } from "../services/rate-limit.ts"
import { verifyTurnstile } from "../services/turnstile.ts"

export const CONTACT_TOPICS = ["account", "bot", "modules", "billing", "bug", "other"] as const

const Body = z.object({
    email: z.email().max(200),
    name: z.string().trim().max(80).optional(),
    topic: z.enum(CONTACT_TOPICS),
    message: z.string().trim().min(20).max(5000),
    page: z.string().max(200).regex(/^\/[\w\-./~%#?=&]*$/).optional(),
    website: z.string().max(500).optional(),
    turnstileToken: z.string().max(2048).optional(),
})

function json(body: unknown): unknown {
    try {
        return Buffer.isBuffer(body) ? JSON.parse(body.toString("utf8")) : null
    } catch {
        return null
    }
}

const subjectOf = (topic: string, message: string) => {
    const gist = message.replace(/\s+/g, " ").trim()
    return `[GGE Command] ${topic}: ${gist.length > 60 ? `${gist.slice(0, 60).trimEnd()}...` : gist}`
}

const userAgentOf = (req: FastifyRequest) => String(req.headers["user-agent"] ?? "unknown").replace(/\s+/g, " ").slice(0, 300)

const honeypotFilled = (raw: unknown) =>
    typeof raw === "object" && raw !== null && typeof (raw as { website?: unknown }).website === "string" && (raw as { website: string }).website !== ""

/**
 * POST /contact, the docs site's contact form. Plain text goes to SUPPORT_EMAIL with the sender as Reply-To.
 * A filled honeypot answers 200 and sends nothing. The message body and the sender's address are never logged.
 */
export function contactRoute({ env, mailer, limits }: { env: Env; mailer: Mailer; limits: { short: RateLimiter; day: RateLimiter } }) {
    return async (scope: FastifyInstance) => {
        scope.removeAllContentTypeParsers()
        scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 32_768 }, (_req, body, done) => done(null, body))
        scope.post("/contact", async (req, reply) => {
            if (!(env.DOCS_ORIGINS ?? []).includes(req.headers.origin ?? ""))
                return reply.status(403).send({ error: "ORIGIN_NOT_ALLOWED" })
            if (!env.SUPPORT_EMAIL)
                return reply.status(503).send({ error: "CONTACT_UNAVAILABLE" })
            if (!limits.short.hit(req.ip) || !limits.day.hit(req.ip)) {
                req.log.info({ outcome: "rate_limited" }, "contact")
                return reply.status(429).send({ error: "TOO_MANY_ATTEMPTS" })
            }
            const raw = json(req.body)
            if (honeypotFilled(raw)) {
                req.log.info({ outcome: "honeypot" }, "contact")
                return reply.status(200).send({ ok: true })
            }
            const parsed = Body.safeParse(raw)
            if (!parsed.success)
                return reply.status(400).send({ error: "INVALID_BODY", fields: [...new Set(parsed.error.issues.map(issue => String(issue.path[0] ?? "")))] })
            const { email, name, topic, message, page, turnstileToken } = parsed.data
            if (!await verifyTurnstile(env.TURNSTILE_SECRET_KEY, turnstileToken, req.ip))
                return reply.status(400).send({ error: "CAPTCHA_FAILED" })
            const text = [
                `Name: ${name || "(not given)"}`,
                `Email: ${email}`,
                `Topic: ${topic}`,
                `Page: ${page ?? "(not given)"}`,
                `User agent: ${userAgentOf(req)}`,
                `Received: ${new Date().toISOString()}`,
                "",
                message,
            ].join("\n")
            try {
                await mailer.send({ to: env.SUPPORT_EMAIL, replyTo: email, subject: subjectOf(topic, message), html: "", text, tag: "contact" })
            } catch (error) {
                req.log.error({ outcome: "send_failed", topic, err: (error as Error).message }, "contact")
                return reply.status(502).send({ error: "SEND_FAILED" })
            }
            req.log.info({ outcome: "sent", topic }, "contact")
            return reply.status(200).send({ ok: true })
        })
    }
}
