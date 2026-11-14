import * as Sentry from "@sentry/node"

// Loaded with `node --import` so Sentry can patch pg before it loads.
// Without SENTRY_DSN the SDK stays off.
const production = process.env.NODE_ENV === "production"

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? (production ? "production" : "development"),
    release: process.env.GGE_VERSION,
    tracesSampleRate: production ? 0.1 : 1,
    integrations: [Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] })],
    initialScope: { tags: { app: "runner" } },
})
