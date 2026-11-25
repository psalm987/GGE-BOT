import * as z from "zod"

/** The goods a castle stores, in the order the screens list them. */
export const STOCK_KEYS = ["wood", "stone", "food", "coal", "oil", "glass", "iron", "honey", "mead", "aqua"] as const
export type StockKey = (typeof STOCK_KEYS)[number]

/** The most castles and marches one snapshot carries, which bounds its size. */
export const READ_BACK_MAX_CASTLES = 40
export const READ_BACK_MAX_MOVEMENTS = 50

/** One good in one castle. `perHour` is production less what the castle eats, so it is negative when the stock is running down. */
export const Stock = z.object({
    amount: z.number().int().min(0),
    max: z.number().int().min(0),
    perHour: z.number().int(),
})
export type Stock = z.infer<typeof Stock>

/** A castle's stores as the game last listed them. The castle's name and place are in `BotStatus.castles`, by `kingdom` and `id`. */
export const ReadBackCastle = z.object({
    kingdom: z.number().int(),
    id: z.number().int(),
    /** When the game listed these stores, epoch milliseconds. Forecasts count from here. */
    readAt: z.number().int(),
    /** Only the goods the castle holds or makes. */
    stock: z.partialRecord(z.enum(STOCK_KEYS), Stock),
})
export type ReadBackCastle = z.infer<typeof ReadBackCastle>

/** One end of a march. `name` is set for a player's castle; `type` is the game's area type. */
export const MarchPlace = z.object({
    type: z.number().int(),
    x: z.number().int(),
    y: z.number().int(),
    name: z.string().max(64).nullable(),
})
export type MarchPlace = z.infer<typeof MarchPlace>

/**
 * Whose march it is, seen from the account: its own, an attack on it, friendly troops coming to it, or anyone else's
 * that the game lists (alliance members' marches).
 */
export const MarchSide = z.enum(["own", "incoming", "support", "other"])
export type MarchSide = z.infer<typeof MarchSide>
export const MarchKind = z.enum(["attack", "station", "return", "other"])
export type MarchKind = z.infer<typeof MarchKind>

/** A march on the map. How far along it is follows from `arrivesAt` and `totalSeconds`, so a screen can move the bar without a new report. */
export const ReadBackMovement = z.object({
    id: z.number().int(),
    side: MarchSide,
    kind: MarchKind,
    kingdom: z.number().int(),
    from: MarchPlace,
    to: MarchPlace,
    /** The player who sent it, when that isn't the account. */
    sender: z.string().max(64).nullable(),
    /** Soldiers in the march; null when the game hides its army. */
    troops: z.number().int().min(0).nullable(),
    totalSeconds: z.number().int().min(0),
    /** Epoch milliseconds. */
    arrivesAt: z.number().int(),
})
export type ReadBackMovement = z.infer<typeof ReadBackMovement>

/** What the account gained since the bot signed in; a figure is null until the game has reported it. */
export const SessionGains = z.object({
    /** Epoch milliseconds. */
    startedAt: z.number().int(),
    coins: z.number().int().nullable(),
    rubies: z.number().int().nullable(),
})
export type SessionGains = z.infer<typeof SessionGains>

/** What the bot last read from the game, for the screens that show it back to the player. Rides in the worker's status report. */
export const ReadBack = z.object({
    /** When the worker put this together, epoch milliseconds. */
    at: z.number().int(),
    castles: z.array(ReadBackCastle).max(READ_BACK_MAX_CASTLES),
    /** The marches worth showing first, at most READ_BACK_MAX_MOVEMENTS of them. */
    movements: z.array(ReadBackMovement).max(READ_BACK_MAX_MOVEMENTS),
    /** How many marches the game listed, which can be more than `movements` holds. */
    movementCount: z.number().int().min(0),
    session: SessionGains,
})
export type ReadBack = z.infer<typeof ReadBack>

/** Where a stock is heading: it is at its limit already, or reaches it in `hours`. null when it isn't moving. */
export type StockForecast = { state: "full" | "empty" } | { state: "fillsIn" | "emptiesIn"; hours: number }

/** `hoursSinceRead` moves the forecast on from when the game listed the stock, so an old snapshot doesn't promise time that has passed. */
export function stockForecast({ amount, max, perHour }: Stock, hoursSinceRead = 0): StockForecast | null {
    if (perHour > 0) {
        const hours = (max - amount) / perHour - hoursSinceRead
        return hours > 0 ? { state: "fillsIn", hours } : { state: "full" }
    }
    if (perHour < 0) {
        const hours = amount / -perHour - hoursSinceRead
        return hours > 0 ? { state: "emptiesIn", hours } : { state: "empty" }
    }
    return max > 0 && amount >= max ? { state: "full" } : null
}

/** A session younger than this has too little behind it for an hourly rate to mean anything. */
export const RATE_AFTER_MS = 5 * 60_000

/** The hourly rate of a session's gain, or null while the session is too young for one. */
export function hourlyRate(gain: number, elapsedMs: number) {
    return elapsedMs >= RATE_AFTER_MS ? Math.round(gain / (elapsedMs / 3_600_000)) : null
}

/** How much of a march is behind it at `now`, from 0 to 1. */
export function marchProgress({ arrivesAt, totalSeconds }: Pick<ReadBackMovement, "arrivesAt" | "totalSeconds">, now: number) {
    if (totalSeconds <= 0) return 1
    return Math.min(1, Math.max(0, 1 - (arrivesAt - now) / (totalSeconds * 1000)))
}
