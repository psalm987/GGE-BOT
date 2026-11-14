import { useEffect } from "react"
import type { BotEvent, PublicAccount } from "@gge/contracts"
import { client, orpc, queryClient } from "./api.ts"

type LiveLine = Extract<BotEvent, { kind: "log" }>["line"]
const logListeners = new Map<string, Set<(line: LiveLine) => void>>()

/** Subscribe to one account's live log lines (used by the open drawer). */
export function onLiveLog(accountId: string, listener: (line: LiveLine) => void) {
    const set = logListeners.get(accountId) ?? new Set()
    set.add(listener)
    logListeners.set(accountId, set)
    return () => { set.delete(listener) }
}

/**
 * Keeps the account list's statuses current from the API's event stream, and
 * hands log lines to whoever is listening. Reconnects with backoff.
 */
export function useLiveBotEvents(enabled: boolean) {
    useEffect(() => {
        if (!enabled)
            return
        const controller = new AbortController()
        let attempt = 0
        const listKey = orpc.accounts.list.queryKey()
        ;(async () => {
            while (!controller.signal.aborted) {
                try {
                    const stream = await client.accounts.events(undefined, { signal: controller.signal })
                    attempt = 0
                    for await (const event of stream) {
                        if (event.kind === "status")
                            queryClient.setQueryData<PublicAccount[]>(listKey, accounts =>
                                accounts?.map(a => a.id === event.accountId ? { ...a, status: event.status } : a))
                        else
                            logListeners.get(event.accountId)?.forEach(l => l(event.line))
                    }
                } catch {
                    if (controller.signal.aborted)
                        return
                }
                attempt++
                await new Promise(r => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)))
            }
        })()
        return () => controller.abort()
    }, [enabled])
}
