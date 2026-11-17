import cookie from "@fastify/cookie"
import { onError } from "@orpc/server"
import * as Sentry from "@sentry/node"
import { RPCHandler } from "@orpc/server/fastify"
import { sql } from "drizzle-orm"
import Fastify, { type FastifyInstance } from "fastify"
import metricsPlugin from "fastify-metrics"
import type { Db } from "@gge/db"
import type { Ctx } from "./context.ts"
import type { Env } from "./env.ts"
import { adminRouter } from "./routers/admin.ts"
import { clientRouter } from "./routers/client.ts"
import { paystackWebhook } from "./routers/paystack-webhook.ts"
import { createGeoip } from "./services/geoip.ts"
import { clientLink } from "./services/email.ts"
import { logMailer, type Mailer } from "./services/mailer.ts"
import { createNotificationMailer, type NotificationMailer } from "./services/notification-mailer.ts"
import { createPaystack } from "./services/paystack.ts"
import { createPlanExpirySweeper, type PlanExpirySweeper } from "./services/plan-expiry.ts"
import { createRateLimiter } from "./services/rate-limit.ts"

declare module "fastify" {
    interface FastifyInstance {
        /** Emails players about new notifications. It polls on its own unless the server was built with `workers: false`. */
        notificationMailer: NotificationMailer
        /** Tells players their plan ends soon, or has. It sweeps on its own unless the server was built with `workers: false`. */
        planExpiry: PlanExpirySweeper
    }
}

export async function buildServer({ db, env, logger = true, mailer: givenMailer, workers = true }: {
    db: Db
    env: Env
    logger?: boolean
    mailer?: Mailer
    /** False leaves the notification mailer and the plan expiry sweeper idle, for a caller that runs their rounds itself. */
    workers?: boolean
}): Promise<FastifyInstance> {
    // Caddy sits in front of us (the edge, or behind Dokploy's Traefik with trusted_proxies set); trust its X-Forwarded-For for req.ip.
    const app = Fastify({ logger, trustProxy: true })
    Sentry.setupFastifyErrorHandler(app)
    await app.register(cookie)
    // /metrics is for Prometheus on the internal network; Caddy only routes /rpc, /admin/rpc, /webhooks and /healthz.
    await app.register(metricsPlugin.default, { endpoint: "/metrics", routeMetrics: { routeBlacklist: ["/metrics", "/healthz"] } })
    // oRPC reads the raw body itself.
    app.addContentTypeParser("*", (_req, _payload, done) => done(null, undefined))

    const mailer = givenMailer ?? logMailer(app.log)
    const notificationMailer = createNotificationMailer({ db, mailer, log: app.log, clientUrl: clientLink({ env }, "/", {}) })
    const planExpiry = createPlanExpirySweeper({ db, log: app.log })
    app.decorate("notificationMailer", notificationMailer)
    app.decorate("planExpiry", planExpiry)
    app.addHook("onClose", () => Promise.all([notificationMailer.stop(), planExpiry.stop()]))
    if (workers) {
        notificationMailer.start()
        planExpiry.start()
    }

    const limits = {
        ip: createRateLimiter({ max: 100, windowMs: 15 * 60_000 }),
        user: createRateLimiter({ max: 10, windowMs: 15 * 60_000 }),
        userTotal: createRateLimiter({ max: 50, windowMs: 15 * 60_000 }),
        email: createRateLimiter({ max: 3, windowMs: 15 * 60_000 }),
        signup: createRateLimiter({ max: 5, windowMs: 60 * 60_000 }),
        dataExport: createRateLimiter({ max: 1, windowMs: 10 * 60_000 }),
        detect: createRateLimiter({ max: 60, windowMs: 60_000 }),
        redeemCode: createRateLimiter({ max: 10, windowMs: 15 * 60_000 }),
    }
    const lookupCountry = createGeoip({ url: env.GEOIP_URL })
    const paystack = env.PAYSTACK_SECRET_KEY ? createPaystack({ secretKey: env.PAYSTACK_SECRET_KEY, baseUrl: env.PAYSTACK_BASE_URL }) : undefined
    // oRPC turns handler errors into responses itself, so Fastify's error hook never sees them.
    const logServerError = (error: unknown) => {
        const status = (error as { status?: number })?.status
        if (status === undefined || status >= 500) {
            app.log.error(error)
            Sentry.captureException(error)
        }
    }

    const mount = (prefix: string, handler: RPCHandler<Ctx>, origins: string[]) =>
        app.all(`${prefix}/*`, async (req, reply) => {
            // Cookies ride on cross-site requests the browser makes for us; refuse any
            // call whose Origin isn't one of our apps.
            if (!origins.includes(req.headers.origin ?? ""))
                return reply.status(403).send({ message: "Origin not allowed" })
            const { matched } = await handler.handle(req, reply, { prefix: prefix as `/${string}`, context: { db, env, req, reply, log: req.log, limits, mailer, lookupCountry, paystack } })
            if (!matched)
                return reply.status(404).send({ message: "Not found" })
        })

    mount("/rpc", new RPCHandler(clientRouter, { interceptors: [onError(logServerError)] }), env.CLIENT_ORIGINS)
    mount("/admin/rpc", new RPCHandler(adminRouter, { interceptors: [onError(logServerError)] }), env.ADMIN_ORIGINS)
    await app.register(paystackWebhook({ db, secretKey: env.PAYSTACK_SECRET_KEY, paystack }))

    app.get("/healthz", async () => {
        await db.execute(sql`select 1`)
        return { ok: true }
    })
    return app
}
