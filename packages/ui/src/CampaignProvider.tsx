import { App, ConfigProvider } from "antd"
import type { ReactNode } from "react"
import { campaignTheme } from "./theme.ts"

/** Theme, right-to-left support and antd's App context (message, modal, notification). */
export function CampaignProvider({ children, direction = "ltr" }: { children: ReactNode; direction?: "ltr" | "rtl" }) {
    return (
        <ConfigProvider theme={campaignTheme} direction={direction}>
            <App>{children}</App>
        </ConfigProvider>
    )
}
