import { Centrifuge, UnauthorizedError, connectingCodes, disconnectedCodes, type SubscribedContext } from "centrifuge"
import { useEffect, useState, useSyncExternalStore } from "react"
import { BotChannelEvent, UserEvent, botChannel, userChannel, type PublicAccount } from "@gge/contracts"
import { applyUserEvent } from "./account-events.ts"
import { client, orpc, queryClient } from "./api.ts"

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

/** A token for the SDK. A refusal becomes UnauthorizedError, which stops its retries; any other failure is retried. */
async function tokenFrom(request: () => Promise<{ token: string }>) {
    try {
        return (await request()).token
    } catch (error) {
        const code = (error as { code?: string }).code
        if (code === "UNAUTHORIZED")
            void queryClient.invalidateQueries({ queryKey: orpc.auth.me.queryKey() })
        throw code && REFUSALS.has(code) ? new UnauthorizedError(code) : error
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

/** Keeps the account list current for the signed-in player while mounted. Pass undefined while signed out. */
export function useRealtime(userId: string | undefined) {
    useEffect(() => {
        if (!userId)
            return
        const listKey = orpc.accounts.list.queryKey()
        const subscription = centrifuge.newSubscription(userChannel(userId))
        subscription.on("publication", ({ data }) => {
            const event = parse(UserEvent, data)
            if (event)
                queryClient.setQueryData<PublicAccount[]>(listKey, accounts => applyUserEvent(accounts, event))
        })
        subscription.on("subscribed", ctx => {
            if (missedEvents(ctx))
                void queryClient.invalidateQueries({ queryKey: listKey })
        })
        subscription.subscribe()
        centrifuge.connect()
        return () => {
            centrifuge.removeSubscription(subscription)
            centrifuge.disconnect()
        }
    }, [userId])
}

export type LiveLine = BotChannelEvent["line"]

/** One account's log lines as they happen, newest first, since this was mounted. */
export function useBotLog(accountId: string) {
    const [log, setLog] = useState<{ accountId: string; lines: LiveLine[] }>({ accountId, lines: [] })
    useEffect(() => {
        const subscription = centrifuge.newSubscription(botChannel(accountId), {
            getToken: () => tokenFrom(() => client.realtime.subscriptionToken({ accountId })),
        })
        subscription.on("publication", ({ data }) => {
            const line = parse(BotChannelEvent, data)?.line
            if (line)
                setLog(log => ({ accountId, lines: [line, ...(log.accountId === accountId ? log.lines : [])].slice(0, 500) }))
        })
        subscription.on("subscribed", ctx => {
            if (!missedEvents(ctx))
                return
            // The fetched page is the truth again; lines from before the gap would sit above a hole.
            setLog({ accountId, lines: [] })
            void queryClient.invalidateQueries({ queryKey: orpc.accounts.logs.key({ input: { id: accountId } }) })
        })
        subscription.subscribe()
        return () => centrifuge.removeSubscription(subscription)
    }, [accountId])
    return log.accountId === accountId ? log.lines : []
}
