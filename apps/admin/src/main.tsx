import "./instrument.ts"
import "@gge/ui/styles.css"
import * as Sentry from "@sentry/react"
import { QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Navigate, Route, Routes } from "react-router"
import { CampaignProvider } from "@gge/ui"
import { queryClient } from "./api.ts"
import { RequireAuth } from "./auth.tsx"
import { Accounts } from "./pages/Accounts.tsx"
import { Audit } from "./pages/Audit.tsx"
import { Login } from "./pages/Login.tsx"
import { Overview } from "./pages/Overview.tsx"
import { Users } from "./pages/Users.tsx"

const guarded = (page: React.ReactNode) => <RequireAuth>{page}</RequireAuth>

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
                        <Route path="/accounts" element={guarded(<Accounts />)} />
                        <Route path="/audit" element={guarded(<Audit />)} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </BrowserRouter>
            </QueryClientProvider>
        </CampaignProvider>
    </StrictMode>,
)
