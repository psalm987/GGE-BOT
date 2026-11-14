import * as Sentry from "@sentry/node"

// Loaded with `node --import` so Sentry can patch Fastify and pg before they load.
// Without SENTRY_DSN the SDK stays off.
const production = process.env.NODE_ENV === "production"

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? (production ? "production" : "development"),
    release: process.env.GGE_VERSION,
    tracesSampleRate: production ? 0.1 : 1,
    integrations: [Sentry.pinoIntegration({ log: { levels: ["warn", "error", "fatal"] } })],
    initialScope: { tags: { app: "api" } },
})
