import "./instrument.ts"
import "@gge/ui/styles.css"
import * as Sentry from "@sentry/react"
import { QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Navigate, Route, Routes } from "react-router"
import { CampaignProvider, initI18n } from "@gge/ui"
import { client, queryClient } from "./api.ts"
import { RequireAuth } from "./auth.tsx"
import { Accounts } from "./pages/Accounts.tsx"
import { Audit } from "./pages/Audit.tsx"
import { Login } from "./pages/Login.tsx"
import { Overview } from "./pages/Overview.tsx"
import { Proxies } from "./pages/Proxies.tsx"
import { Settings } from "./pages/Settings.tsx"
import { UserDetail } from "./pages/UserDetail.tsx"
import { Users } from "./pages/Users.tsx"

const guarded = (page: React.ReactNode) => <RequireAuth>{page}</RequireAuth>

await initI18n({ app: "admin", detect: () => client.i18n.detect().then(result => result.locale).catch(() => null) })

createRoot(document.getElementById("root")!, {
    onUncaughtError: Sentry.reactErrorHandler(),
    onCaughtError: Sentry.reactErrorHandler(),
    onRecoverableError: Sentry.reactErrorHandler(),
}).render(
    <StrictMode>
        <CampaignProvider>
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <Routes>
                        <Route path="/login" element={<Login />} />
                        <Route path="/" element={guarded(<Overview />)} />
                        <Route path="/users" element={guarded(<Users />)} />
                        <Route path="/users/:id" element={guarded(<UserDetail />)} />
                        <Route path="/accounts" element={guarded(<Accounts />)} />
                        <Route path="/proxies" element={guarded(<Proxies />)} />
                        <Route path="/audit" element={guarded(<Audit />)} />
                        <Route path="/settings" element={guarded(<Settings />)} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </BrowserRouter>
            </QueryClientProvider>
        </CampaignProvider>
    </StrictMode>,
)
