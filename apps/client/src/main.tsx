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
import { RequireVerified } from "./components/EmailGate.tsx"
import { LiveUpdates } from "./components/LiveUpdates.tsx"
import { ConfirmEmailChange } from "./pages/ConfirmEmailChange.tsx"
import { Dashboard } from "./pages/Dashboard.tsx"
import { ForgotPassword } from "./pages/ForgotPassword.tsx"
import { Login } from "./pages/Login.tsx"
import { Logs } from "./pages/Logs.tsx"
import { Module } from "./pages/Module.tsx"
import { Plan } from "./pages/Plan.tsx"
import { PlanReturn } from "./pages/PlanReturn.tsx"
import { Redeem } from "./pages/Redeem.tsx"
import { ResetPassword } from "./pages/ResetPassword.tsx"
import { Settings } from "./pages/Settings.tsx"
import { Signup } from "./pages/Signup.tsx"
import { VerifyEmail } from "./pages/VerifyEmail.tsx"

function Root() {
    return (
        <CampaignProvider>
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    {/* Outside <Routes>, so moving between pages keeps the one live connection. */}
                    <LiveUpdates />
                    <Routes>
                        <Route path="/login" element={<Login />} />
                        <Route path="/signup" element={<Signup />} />
                        <Route path="/forgot-password" element={<ForgotPassword />} />
                        <Route path="/reset-password" element={<ResetPassword />} />
                        <Route path="/verify-email" element={<VerifyEmail />} />
                        <Route path="/confirm-email-change" element={<ConfirmEmailChange />} />
                        <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
                        <Route path="/" element={<RequireAuth><RequireVerified><Dashboard /></RequireVerified></RequireAuth>} />
                        <Route path="/logs" element={<RequireAuth><RequireVerified><Logs /></RequireVerified></RequireAuth>} />
                        <Route path="/m/:id" element={<RequireAuth><RequireVerified><Module /></RequireVerified></RequireAuth>} />
                        <Route path="/plan" element={<RequireAuth><RequireVerified><Plan /></RequireVerified></RequireAuth>} />
                        <Route path="/plan/return" element={<RequireAuth><RequireVerified><PlanReturn /></RequireVerified></RequireAuth>} />
                        <Route path="/redeem" element={<Redeem />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </BrowserRouter>
            </QueryClientProvider>
        </CampaignProvider>
    )
}

await initI18n({ app: "client", detect: () => client.i18n.detect().then(result => result.locale).catch(() => null) })

createRoot(document.getElementById("root")!, {
    onUncaughtError: Sentry.reactErrorHandler(),
    onCaughtError: Sentry.reactErrorHandler(),
    onRecoverableError: Sentry.reactErrorHandler(),
}).render(<StrictMode><Root /></StrictMode>)
