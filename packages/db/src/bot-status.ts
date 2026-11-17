import { AccountCastle, PluginStates, type PublicAccount } from "@gge/contracts"
import type { botStatus } from "./schema.ts"

/** A bot_status row as the API and the realtime events show it. Castles live in the worker's last resources report. */
export function publicStatus(row: Pick<typeof botStatus.$inferSelect, "actualState" | "heartbeatAt" | "lastError" | "bannedUntil" | "pluginStates" | "resources">): NonNullable<PublicAccount["status"]> {
    const castles = AccountCastle.array().safeParse((row.resources as { castles?: unknown } | null)?.castles)
    const pluginStates = PluginStates.safeParse(row.pluginStates)
    return {
        actualState: row.actualState, heartbeatAt: row.heartbeatAt, lastError: row.lastError, bannedUntil: row.bannedUntil,
        pluginStates: pluginStates.success ? pluginStates.data : {},
        castles: castles.success ? castles.data : [],
    }
}
