import { useTranslation } from "react-i18next"
import { notificationText, type NotificationContent, type Translate } from "@gge/contracts"

/** A notification's title and body in the player's language, re-read when the language changes. */
export function useNotificationText() {
    const { i18n } = useTranslation("notifications")
    return (notification: NotificationContent) => notificationText(i18n.t as unknown as Translate, notification)
}
