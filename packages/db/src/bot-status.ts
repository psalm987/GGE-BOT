import { AccountCastle, GamePreset, PluginStates, ReadBack, type PublicAccount } from "@gge/contracts"
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

/** A bot_status row as the API and the realtime events show it. Castles, in-game presets and the read-back snapshot live in the worker's last resources report. */
export function publicStatus(row: Pick<typeof botStatus.$inferSelect, "actualState" | "heartbeatAt" | "lastError" | "bannedUntil" | "pluginStates" | "resources">): NonNullable<PublicAccount["status"]> {
    const castles = AccountCastle.array().safeParse((row.resources as { castles?: unknown } | null)?.castles)
    const pluginStates = PluginStates.safeParse(row.pluginStates)
    const commanders = (row.resources as { commanders?: unknown } | null)?.commanders
    const gamePresets = GamePreset.array().safeParse((row.resources as { gamePresets?: unknown } | null)?.gamePresets)
    const readBack = ReadBack.safeParse((row.resources as { readBack?: unknown } | null)?.readBack)
    return {
        actualState: row.actualState, heartbeatAt: row.heartbeatAt, lastError: row.lastError, bannedUntil: row.bannedUntil,
        pluginStates: pluginStates.success ? pluginStates.data : {},
        castles: castles.success ? castles.data : [],
        commanders: typeof commanders === "number" && Number.isInteger(commanders) && commanders >= 0 ? commanders : null,
        gamePresets: gamePresets.success ? gamePresets.data : [],
        resources: figuresOf(row.resources),
        readBack: readBack.success ? readBack.data : null,
    }
}
