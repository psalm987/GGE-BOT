import { AccountCastle, PluginStates, type PublicAccount } from "@gge/contracts"
import type { botStatus } from "./schema.ts"

const figure = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null

/** The figures in a worker's last report, which names the aquamarine figure `aquamarin_name`. null when the row has no report. */
function figuresOf(resources: unknown): NonNullable<PublicAccount["status"]>["resources"] {
    if (!resources || typeof resources !== "object")
        return null
    const report = resources as Record<string, unknown>
    const reportedAt = typeof report.reportedAt === "string" ? new Date(report.reportedAt) : null
    return {
        food: figure(report.food), mead: figure(report.mead), cash: figure(report.cash), gold: figure(report.gold),
        aquamarine: figure(report.aquamarin_name), attackDailyCount: figure(report.attackDailyCount),
        reportedAt: reportedAt && !Number.isNaN(reportedAt.getTime()) ? reportedAt : null,
    }
}

/** A bot_status row as the API and the realtime events show it. Castles live in the worker's last resources report. */
export function publicStatus(row: Pick<typeof botStatus.$inferSelect, "actualState" | "heartbeatAt" | "lastError" | "bannedUntil" | "pluginStates" | "resources">): NonNullable<PublicAccount["status"]> {
    const castles = AccountCastle.array().safeParse((row.resources as { castles?: unknown } | null)?.castles)
    const pluginStates = PluginStates.safeParse(row.pluginStates)
    return {
        actualState: row.actualState, heartbeatAt: row.heartbeatAt, lastError: row.lastError, bannedUntil: row.bannedUntil,
        pluginStates: pluginStates.success ? pluginStates.data : {},
        castles: castles.success ? castles.data : [],
        resources: figuresOf(row.resources),
    }
}
