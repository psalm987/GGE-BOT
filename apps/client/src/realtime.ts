import { Centrifuge, UnauthorizedError, connectingCodes, disconnectedCodes, type SubscribedContext } from "centrifuge"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { BotChannelEvent, UserEvent, botChannel, userChannel, type FeedLine, type Notification, type PublicAccount } from "@gge/contracts"
import { applyUserEvent } from "./account-events.ts"
import { mergeFeed } from "./log-merge.ts"
import { client, notificationsQuery, orpc, queryClient } from "./api.ts"
import { patchQuery } from "./live-cache.ts"
import { applyNotificationEvent, type NotificationPages } from "./notification-events.ts"

/**
 * Where live updates stand:
 * - `connecting`: the first connection is being made;
 * - `live`: events arrive as they happen;
 * - `polling`: the connection dropped and is being retried;
 * - `off`: this server has no live updates, or refused this session, so nothing is retried.
 * Pages refetch on a timer in `polling` and `off`.
 */
export type RealtimeState = "connecting" | "live" | "polling" | "off"

const POLL_MS = 15_000
/** How often a query that live events would keep current should refetch instead; false while they do. */
export const pollInterval = (state: RealtimeState) => state === "polling" || state === "off" ? POLL_MS : false

let state: RealtimeState = "connecting"
const watchers = new Set<() => void>()
function setState(next: RealtimeState) {
    if (next === state)
        return
    state = next
    watchers.forEach(notify => notify())
}
const watch = (notify: () => void) => {
    watchers.add(notify)
    return () => { watchers.delete(notify) }
}
export const useRealtimeState = () => useSyncExternalStore(watch, () => state)

/** Answers that won't change by asking again: signed out, email not confirmed, no Centrifugo, not the caller's account. */
const REFUSALS = new Set(["UNAUTHORIZED", "FORBIDDEN", "NOT_IMPLEMENTED", "NOT_FOUND"])

/** Runs a token request. A refusal becomes UnauthorizedError, which stops the SDK's retries; any other failure is retried. */
async function guarded<T>(request: () => Promise<T>) {
    try {
        return await request()
    } catch (error) {
        const code = (error as { code?: string }).code
        if (code === "UNAUTHORIZED")
            void queryClient.invalidateQueries({ queryKey: orpc.auth.me.queryKey() })
        throw code && REFUSALS.has(code) ? new UnauthorizedError(code) : error
    }
}
const tokenFrom = async (request: () => Promise<{ token: string }>) => (await guarded(request)).token

type TokenWaiter = { accountId: string; resolve: (token: string) => void; reject: (error: unknown) => void }
let tokenQueue: TokenWaiter[] = []

/** A bot channel's token. Requests made in the same microtask share one call, so mounting a feed of many accounts is one round trip. */
function botToken(accountId: string) {
    return new Promise<string>((resolve, reject) => {
        if (!tokenQueue.length)
            queueMicrotask(flushTokens)
        tokenQueue.push({ accountId, resolve, reject })
    })
}

async function flushTokens() {
    const waiting = tokenQueue
    tokenQueue = []
    try {
        const tokens = await guarded(() => client.realtime.subscriptionTokens({ accountIds: [...new Set(waiting.map(w => w.accountId))] }))
        for (const w of waiting) {
            const token = tokens[w.accountId]
            if (token) w.resolve(token)
            else w.reject(new Error("The server sent no token for this account"))
        }
    } catch (error) {
        waiting.forEach(w => w.reject(error))
    }
}

const centrifuge = new Centrifuge(`${window.location.origin.replace(/^http/, "ws")}/connection/websocket`, {
    getToken: () => tokenFrom(() => client.realtime.connectionToken()),
})
centrifuge.on("connected", () => setState("live"))
centrifuge.on("connecting", ({ code }) => setState(code === connectingCodes.connectCalled ? "connecting" : "polling"))
centrifuge.on("error", () => {
    if (state === "connecting")
        setState("polling")
})
centrifuge.on("disconnected", ({ code }) => setState(code === disconnectedCodes.disconnectCalled ? "connecting" : "off"))

let warned = false
/** The event in a publication, or undefined for one this build doesn't understand (a newer server's, say). */
function parse<T>(schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false; error: unknown } }, data: unknown) {
    const result = schema.safeParse(data)
    if (result.success)
        return result.data
    if (!warned)
        console.warn("Ignoring a live event this app doesn't understand", result.error)
    warned = true
}

/** True when events may have been missed: a first subscribe, or a resubscribe the server's history couldn't cover. */
const missedEvents = (ctx: SubscribedContext) => !ctx.recovered

/**
 * Keeps the account list and the notifications current for the signed-in player while mounted, and calls
 * `onNotification` for each new one. Pass undefined while signed out. It owns the one connection, so mount it
 * once, above the routes: a second mount, or one that remounts on navigation, would reconnect.
 */
export function useRealtime(userId: string | undefined, onNotification: (notification: Notification) => void) {
    const notify = useRef(onNotification)
    useEffect(() => { notify.current = onNotification })
    useEffect(() => {
        if (!userId)
            return
        const listKey = orpc.accounts.list.queryKey()
        const subscription = centrifuge.newSubscription(userChannel(userId))
        subscription.on("publication", ({ data }) => {
            const event = parse(UserEvent, data)
            if (!event)
                return
            if (event.kind === "status" || event.kind === "account") {
                const before = queryClient.getQueryData<PublicAccount[]>(listKey)?.find(a => a.id === event.accountId)
                patchQuery<PublicAccount[]>(queryClient, listKey, accounts => applyUserEvent(accounts, event))
                // Whether a scheduled account is sleeping comes from the server's clock, which no event carries, so a change of state asks again.
                if (before?.schedule && (event.kind === "account" || event.status.actualState !== before.status?.actualState))
                    void queryClient.invalidateQueries({ queryKey: listKey })
                return
            }
            if (event.kind === "alerts") {
                // An admin changed the plan or limit: the banners, the plan page and which accounts may run all follow from it.
                for (const queryKey of [orpc.alerts.key(), orpc.billing.key(), listKey, orpc.auth.me.queryKey()])
                    void queryClient.invalidateQueries({ queryKey })
                return
            }
            patchQuery<NotificationPages>(queryClient, notificationsQuery.queryKey, loaded => applyNotificationEvent(loaded, event))
            if (event.kind === "notification") {
                // The runner switched a plugin off in the saved settings, which the account list carries.
                if (event.notification.kind === "plugin_finished")
                    void queryClient.invalidateQueries({ queryKey: listKey })
                notify.current(event.notification)
            }
        })
        subscription.on("subscribed", ctx => {
            if (!missedEvents(ctx))
                return
            void queryClient.invalidateQueries({ queryKey: listKey })
            void queryClient.invalidateQueries({ queryKey: notificationsQuery.queryKey })
        })
        subscription.subscribe()
        centrifuge.connect()
        return () => {
            centrifuge.removeSubscription(subscription)
            centrifuge.disconnect()
        }
    }, [userId])
}

/**
 * The log lines of several accounts as they happen, merged newest first, since this was mounted.
 * `onGap` is called with an account whose lines may have been missed, so the caller can fetch them: once it first
 * subscribes (a line written after the caller's fetch but before then never arrives live), and after a reconnect
 * the server's history couldn't cover.
 */
export function useBotLogs(accountIds: string[], { onGap }: { onGap?: (accountId: string) => void } = {}) {
    const [lines, setLines] = useState<FeedLine[]>([])
    const gap = useRef(onGap)
    useEffect(() => { gap.current = onGap })
    const key = [...new Set(accountIds)].sort().join(",")
    useEffect(() => {
        const ids = key ? key.split(",") : []
        setLines(lines => lines.filter(line => ids.includes(line.accountId)))
        const subscriptions = ids.map(accountId => {
            const subscription = centrifuge.newSubscription(botChannel(accountId), { getToken: () => botToken(accountId) })
            subscription.on("publication", ({ data }) => {
                const event = parse(BotChannelEvent, data)
                if (event)
                    setLines(lines => mergeFeed(lines, [{ ...event.line, accountId: event.accountId }]))
            })
            subscription.on("subscribed", ctx => {
                if (missedEvents(ctx))
                    gap.current?.(accountId)
            })
            subscription.subscribe()
            return subscription
        })
        return () => subscriptions.forEach(s => centrifuge.removeSubscription(s))
    }, [key])
    return lines
}
