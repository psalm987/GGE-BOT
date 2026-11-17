import { App, Button } from "antd"
import { useTranslation } from "react-i18next"
import { useMe } from "../auth.tsx"
import { useNotificationText } from "../notification-text.ts"
import { useRealtime } from "../realtime.ts"
import { useOpenNotification } from "./NotificationBell.tsx"

/** Holds the live connection for the signed-in player and announces each new notification as it arrives. Renders nothing. */
export function LiveUpdates() {
    const { notification: toast } = App.useApp()
    const { t } = useTranslation("client")
    const textOf = useNotificationText()
    const { open, canOpen } = useOpenNotification()
    useRealtime(useMe().data?.id, arrived => {
        const key = `notification-${arrived.id}`
        const { title, body } = textOf(arrived)
        // A bot that stopped needs its owner; news about the plan doesn't.
        toast[arrived.data.accountName === undefined ? "info" : "warning"]({
            key, title, description: body, placement: "topRight", duration: 10,
            actions: canOpen(arrived) && (
                <Button type="primary" size="small" onClick={() => { toast.destroy(key); open(arrived) }}>{t("notifications.viewAccount")}</Button>
            ),
        })
    })
    return null
}
