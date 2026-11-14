import { sentryVitePlugin } from "@sentry/bundler-plugins/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Uploads hidden source maps to Sentry, then deletes them so they're never served.
// Without SENTRY_AUTH_TOKEN (local builds) it does nothing.
const sentry = sentryVitePlugin({
    org: "neise-solutions",
    project: "gge-bot-frontend",
    authToken: process.env.SENTRY_AUTH_TOKEN,
    disable: !process.env.SENTRY_AUTH_TOKEN,
    release: { name: process.env.VITE_GGE_VERSION },
    sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
    telemetry: false,
})

// In development the API runs on :3000; the proxy keeps the browser's Origin
// (http://localhost:5173), which the API must list in CLIENT_ORIGINS.
export default defineConfig({
    plugins: [react(), sentry],
    server: { port: 5173, proxy: { "/rpc": { target: "http://localhost:3000" } } },
    build: { chunkSizeWarningLimit: 1500, sourcemap: process.env.SENTRY_AUTH_TOKEN ? "hidden" : false },
})
