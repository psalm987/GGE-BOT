import { App, ConfigProvider } from "antd"
import type { ReactNode } from "react"
import { LOCALES } from "@gge/i18n"
import { useLocale } from "./i18n/store.ts"
import { campaignTheme } from "./theme.ts"

/** Theme, the active language's direction and antd strings, and antd's App context (message, modal, notification). */
export function CampaignProvider({ children }: { children: ReactNode }) {
    const { locale, antdLocale } = useLocale()
    return (
        <ConfigProvider theme={campaignTheme} direction={LOCALES[locale].dir} locale={antdLocale}>
            <App>{children}</App>
        </ConfigProvider>
    )
}
