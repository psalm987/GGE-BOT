import * as Sentry from "@sentry/react"

// Imported first in main.tsx. Without VITE_SENTRY_DSN the SDK stays off.
Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.PROD ? "production" : "development",
    release: import.meta.env.VITE_GGE_VERSION,
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1,
    // The API is same-origin (/rpc), so only relative URLs carry trace headers.
    tracePropagationTargets: [/^\//],
    // Replay masks all text and inputs by default; game passwords never leave the page.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1,
    initialScope: { tags: { app: "client" } },
})
