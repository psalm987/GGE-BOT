import { App, Button } from "antd"
import { describeNotification } from "@gge/contracts"
import { useMe } from "../auth.tsx"
import { useRealtime } from "../realtime.ts"
import { useOpenNotification } from "./NotificationBell.tsx"

/** Holds the live connection for the signed-in player and announces each new notification as it arrives. Renders nothing. */
export function LiveUpdates() {
    const { notification: toast } = App.useApp()
    const { open, canOpen } = useOpenNotification()
    useRealtime(useMe().data?.id, arrived => {
        const key = `notification-${arrived.id}`
        const { title, body } = describeNotification(arrived)
        toast.warning({
            key, title, description: body, placement: "topRight", duration: 10,
            actions: canOpen(arrived) && (
                <Button type="primary" size="small" onClick={() => { toast.destroy(key); open(arrived) }}>View account</Button>
            ),
        })
    })
    return null
}
