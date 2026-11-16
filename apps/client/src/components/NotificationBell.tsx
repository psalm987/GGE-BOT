import { BellOutlined } from "@ant-design/icons"
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query"
import { Badge, Button, Popover, Typography } from "antd"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { useState } from "react"
import { useNavigate } from "react-router"
import { describeNotification, type Notification } from "@gge/contracts"
import { notificationsQuery, orpc, queryClient } from "../api.ts"
import { useMe } from "../auth.tsx"
import { applyNotificationEvent, unreadCount } from "../notification-events.ts"
import { pollInterval, useRealtimeState } from "../realtime.ts"

dayjs.extend(relativeTime)

function useMarkRead() {
    return useMutation(orpc.notifications.markRead.mutationOptions({
        // Shown as read at once. The server's own announcement of it, if live updates are on, then changes nothing.
        onMutate: which => {
            queryClient.setQueryData(notificationsQuery.queryKey, loaded => applyNotificationEvent(loaded, { v: 1, kind: "notifications_read", ...which }))
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: notificationsQuery.queryKey }),
    }))
}

/**
 * `open` marks a notification read and shows its account on the Accounts page.
 * `canOpen` is false once that account has been removed: the notification still says which one it was.
 */
export function useOpenNotification() {
    const navigate = useNavigate()
    const verified = Boolean(useMe().data?.emailVerified)
    const accounts = useQuery({ ...orpc.accounts.list.queryOptions(), enabled: verified })
    const markRead = useMarkRead()
    const canOpen = (notification: Notification) => accounts.data?.some(a => a.id === notification.accountId) ?? false
    return {
        canOpen,
        open(notification: Notification) {
            if (!notification.readAt)
                markRead.mutate({ ids: [notification.id] })
            if (canOpen(notification))
                navigate(`/?account=${notification.accountId}`)
        },
    }
}

/** The header bell: how many notifications are unread, and the list behind it. */
export function NotificationBell() {
    const [open, setOpen] = useState(false)
    const list = useInfiniteQuery({ ...notificationsQuery, refetchInterval: pollInterval(useRealtimeState()) })
    const markRead = useMarkRead()
    const opener = useOpenNotification()
    const unread = unreadCount(list.data)
    const items = list.data?.pages.flatMap(page => page.items) ?? []

    const panel = (
        <div className="gge-notifications">
            <div className="gge-notifications-head">
                <Typography.Text strong className="gge-display">Notifications</Typography.Text>
                <Button type="link" size="small" disabled={!unread} loading={markRead.isPending && "all" in (markRead.variables ?? {})}
                    onClick={() => markRead.mutate({ all: true })}>Mark all read</Button>
            </div>
            {items.length === 0 ? (
                <Typography.Paragraph type="secondary" style={{ margin: "12px 0" }}>
                    {list.isPending ? "Loading…" : list.isError ? "Couldn't load your notifications." : "Nothing yet. You'll hear here when a bot stops and needs you."}
                </Typography.Paragraph>
            ) : (
                <ul>
                    {items.map(n => {
                        const { title, body } = describeNotification(n)
                        const gone = !opener.canOpen(n)
                        return (
                            <li key={n.id}>
                                <button type="button" className={n.readAt ? undefined : "gge-unread"}
                                    onClick={() => {
                                        opener.open(n)
                                        if (!gone)
                                            setOpen(false)
                                    }}>
                                    <strong>{!n.readAt && <span className="gge-sr-only">Unread: </span>}{title}</strong>
                                    <span>{body}</span>
                                    <small>
                                        {n.data.serverLabel} · <time dateTime={n.createdAt.toISOString()}>{dayjs(n.createdAt).fromNow()}</time>
                                        {gone && " · This account is no longer on your roster"}
                                    </small>
                                </button>
                            </li>
                        )
                    })}
                </ul>
            )}
            {list.hasNextPage && (
                <Button block type="text" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button>
            )}
        </div>
    )
    return (
        // Centred under the bell, antd slides it back inside the window; the padding keeps it off the window's edge.
        <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottom" arrow={false} content={panel} styles={{ root: { paddingInline: 12 } }}>
            <Badge count={unread} size="small" offset={[-6, 8]}>
                <Button type="text" icon={<BellOutlined />} aria-label={`Notifications, ${unread} unread`} aria-expanded={open} style={{ height: 44, width: 44 }} />
            </Badge>
        </Popover>
    )
}
