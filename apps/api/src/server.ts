import cookie from "@fastify/cookie"
import { onError } from "@orpc/server"
import { RPCHandler } from "@orpc/server/fastify"
import { sql } from "drizzle-orm"
import Fastify, { type FastifyInstance } from "fastify"
import metricsPlugin from "fastify-metrics"
import type { Db } from "@gge/db"
import type { Ctx } from "./context.ts"
import type { Env } from "./env.ts"
import { adminRouter } from "./routers/admin.ts"
import { clientRouter } from "./routers/client.ts"
import { createBotEventHub } from "./services/bot-events.ts"
import { createRateLimiter } from "./services/rate-limit.ts"

export async function buildServer({ db, env, logger = true }: { db: Db; env: Env; logger?: boolean }): Promise<FastifyInstance> {
    // Caddy terminates TLS in front of us; trust its X-Forwarded-For for req.ip.
    const app = Fastify({ logger, trustProxy: true })
    await app.register(cookie)
    // /metrics is for Prometheus on the internal network; Caddy only routes /rpc, /admin/rpc and /healthz.
    await app.register(metricsPlugin.default, { endpoint: "/metrics", routeMetrics: { routeBlacklist: ["/metrics", "/healthz"] } })
    // oRPC reads the raw body itself.
    app.addContentTypeParser("*", (_req, _payload, done) => done(null, undefined))

    const hub = await createBotEventHub(env.DATABASE_URL, app.log)
    app.addHook("onClose", () => hub.close())
    const limits = {
        ip: createRateLimiter({ max: 100, windowMs: 15 * 60_000 }),
        user: createRateLimiter({ max: 10, windowMs: 15 * 60_000 }),
    }
    const logServerError = (error: unknown) => {
        const status = (error as { status?: number })?.status
        if (status === undefined || status >= 500)
            app.log.error(error)
    }

    const mount = (prefix: string, handler: RPCHandler<Ctx>, origins: string[]) =>
        app.all(`${prefix}/*`, async (req, reply) => {
            // Cookies ride on cross-site requests the browser makes for us; refuse any
            // call whose Origin isn't one of our apps.
            if (!origins.includes(req.headers.origin ?? ""))
                return reply.status(403).send({ message: "Origin not allowed" })
            const { matched } = await handler.handle(req, reply, { prefix: prefix as `/${string}`, context: { db, env, req, reply, limits, botEvents: hub.emitter } })
            if (!matched)
                return reply.status(404).send({ message: "Not found" })
        })

    mount("/rpc", new RPCHandler(clientRouter, { interceptors: [onError(logServerError)] }), env.CLIENT_ORIGINS)
    mount("/admin/rpc", new RPCHandler(adminRouter, { interceptors: [onError(logServerError)] }), env.ADMIN_ORIGINS)

    app.get("/healthz", async () => {
        await db.execute(sql`select 1`)
        return { ok: true }
    })
    return app
}
