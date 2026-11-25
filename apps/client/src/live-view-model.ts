import {
    STOCK_KEYS, hourlyRate, stockForecast, type AccountCastle, type MarchSide, type ReadBack, type ReadBackMovement, type Stock, type StockForecast, type StockKey,
} from "@gge/contracts"

const HOUR_MS = 3_600_000

export type GoodRow = { key: StockKey; stock: Stock; forecast: StockForecast | null }
/** A castle's stores, with the name and place the settings' castle pickers know it by; null for a castle they don't list. */
export type CastleStores = { kingdom: number; id: number; castle: AccountCastle | null; goods: GoodRow[] }

/** The castles' stores by kingdom, kingdoms in the game's order. Forecasts are counted on to `now` from when the game listed each castle. */
export function storesByKingdom(readBack: ReadBack, castles: readonly AccountCastle[], now: number): { kingdom: number; castles: CastleStores[] }[] {
    const groups = new Map<number, CastleStores[]>()
    for (const { kingdom, id, readAt, stock } of readBack.castles) {
        const hours = Math.max(0, now - readAt) / HOUR_MS
        const goods = STOCK_KEYS.flatMap(key => stock[key] ? [{ key, stock: stock[key], forecast: stockForecast(stock[key], hours) }] : [])
        groups.set(kingdom, [...groups.get(kingdom) ?? [], { kingdom, id, castle: castles.find(c => c.kingdom === kingdom && c.id === id) ?? null, goods }])
    }
    return [...groups].sort(([a], [b]) => a - b).map(([kingdom, list]) => ({ kingdom, castles: list }))
}

/** A duration as the one unit a forecast is said in: minutes under an hour, hours under two days, else days. */
export function forecastTime(hours: number): { value: number; unit: "minute" | "hour" | "day" } {
    if (hours < 1) return { value: Math.max(1, Math.round(hours * 60)), unit: "minute" }
    if (hours < 48) return { value: Math.round(hours), unit: "hour" }
    return { value: Math.round(hours / 24), unit: "day" }
}

export const SIDE_FILTERS = ["all", "own", "incoming", "support", "other"] as const
export type SideFilter = (typeof SIDE_FILTERS)[number]

/** The marches still on their way at `now`. One that has landed since the report is gone from the map, so it is left out. */
export const marchesUnderWay = (readBack: ReadBack, now: number) => readBack.movements.filter(march => march.arrivesAt > now)

export function sideCounts(marches: readonly ReadBackMovement[]): Record<SideFilter, number> {
    const counts: Record<SideFilter, number> = { all: marches.length, own: 0, incoming: 0, support: 0, other: 0 }
    for (const march of marches) counts[march.side satisfies MarchSide]++
    return counts
}

/** Time left as a clock: 6:37, or 1:02:03 from an hour up. */
export function countdown(ms: number) {
    const seconds = Math.max(0, Math.ceil(ms / 1000))
    const pad = (n: number) => String(n).padStart(2, "0")
    const [h, m, s] = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export type Gain = { gain: number; perHour: number | null }

/** What the session gained up to the report, and how long it had run by then. A figure the game hasn't reported is null. */
export function sessionGains(readBack: ReadBack): { elapsedMs: number; coins: Gain | null; rubies: Gain | null } {
    const elapsedMs = Math.max(0, readBack.at - readBack.session.startedAt)
    const gainOf = (gain: number | null) => gain === null ? null : { gain, perHour: hourlyRate(gain, elapsedMs) }
    return { elapsedMs, coins: gainOf(readBack.session.coins), rubies: gainOf(readBack.session.rubies) }
}
