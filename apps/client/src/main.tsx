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
import { RequireVerified } from "./components/EmailGate.tsx"
import { LiveUpdates } from "./components/LiveUpdates.tsx"
import { useLanguage } from "./i18n.ts"
import { Dashboard } from "./pages/Dashboard.tsx"
import { ForgotPassword } from "./pages/ForgotPassword.tsx"
import { Login } from "./pages/Login.tsx"
import { ResetPassword } from "./pages/ResetPassword.tsx"
import { Settings } from "./pages/Settings.tsx"
import { Signup } from "./pages/Signup.tsx"
import { VerifyEmail } from "./pages/VerifyEmail.tsx"

function Root() {
    const language = useLanguage()
    return (
        <CampaignProvider direction={language === "ar" ? "rtl" : "ltr"}>
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
                        <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
                        <Route path="/" element={<RequireAuth><RequireVerified><Dashboard /></RequireVerified></RequireAuth>} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </BrowserRouter>
            </QueryClientProvider>
        </CampaignProvider>
    )
}

createRoot(document.getElementById("root")!, {
    onUncaughtError: Sentry.reactErrorHandler(),
    onCaughtError: Sentry.reactErrorHandler(),
    onRecoverableError: Sentry.reactErrorHandler(),
}).render(<StrictMode><Root /></StrictMode>)
