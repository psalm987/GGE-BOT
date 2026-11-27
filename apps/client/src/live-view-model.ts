import {
    DEFENCE_SIDES, FRONT_GATE_SLOTS, STOCK_KEYS, UNIT_GROUPS, hourlyRate, rageProgress, stockForecast,
    type AccountCastle, type DefenceSide, type MarchSide, type ReadBack, type ReadBackCastle, type ReadBackDefence, type ReadBackKhanRage, type ReadBackMovement,
    type Stock, type StockForecast, type StockKey, type ToolCount, type UnitCount, type UnitGroup,
} from "@gge/contracts"

const HOUR_MS = 3_600_000

export type GoodRow = { key: StockKey; stock: Stock; forecast: StockForecast | null }
export type CastleOrder = Pick<ReadBackCastle, "publicOrder" | "productivity" | "guards" | "population">
export type UnitRow = { group: UnitGroup; units: UnitCount[] }
/** A castle's stores, order and units, with the name and place the settings' castle pickers know it by; null for a castle they don't list. */
export type CastleStores = { kingdom: number; id: number; castle: AccountCastle | null; goods: GoodRow[]; order: CastleOrder; units: UnitRow[] }

/** A castle's units by what they do, in the order the screens list the groups, leaving out a group it has none of. */
export const castleUnits = ({ units }: ReadBackCastle): UnitRow[] => UNIT_GROUPS.flatMap(group => units[group].length ? [{ group, units: units[group] }] : [])

/** The castles' stores by kingdom, kingdoms in the game's order. Forecasts are counted on to `now` from when the game listed each castle. */
export function storesByKingdom(readBack: ReadBack, castles: readonly AccountCastle[], now: number): { kingdom: number; castles: CastleStores[] }[] {
    const groups = new Map<number, CastleStores[]>()
    for (const listed of readBack.castles) {
        const { kingdom, id, readAt, stock, publicOrder, productivity, guards, population } = listed
        const hours = Math.max(0, now - readAt) / HOUR_MS
        const goods = STOCK_KEYS.flatMap(key => stock[key] ? [{ key, stock: stock[key], forecast: stockForecast(stock[key], hours) }] : [])
        const castle = castles.find(c => c.kingdom === kingdom && c.id === id) ?? null
        groups.set(kingdom, [...groups.get(kingdom) ?? [], { kingdom, id, castle, goods, order: { publicOrder, productivity, guards, population }, units: castleUnits(listed) }])
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

/** The marches still on the map at `now`: on their way, or an army that stays at its target until its stay ends. */
export const marchesUnderWay = (readBack: ReadBack, now: number) => readBack.movements.filter(march => Math.max(march.arrivesAt, march.stationedUntil ?? 0) > now)

/** Whether the march has arrived and its army now stands at the target. */
export const isStationed = (march: ReadBackMovement, now: number) => march.arrivesAt <= now && (march.stationedUntil ?? 0) > now

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

export const DEFENCE_PARTS = ["wall", "gate", "moat"] as const
/** One tool slot as the page shows it: a tool or an empty slot, either of which may hold gate tools, or a flank's fifth slot the account hasn't unlocked. */
export type SlotCell = { kind: "tool"; tool: ToolCount; gate: boolean } | { kind: "empty"; gate: boolean } | { kind: "locked" }
export type DefenceRow = { side: DefenceSide; share: number; wall: SlotCell[]; moat: SlotCell[] }
/** A flank has this many slots once the legendary skill adds the fifth. */
const FLANK_SLOTS_WITH_SKILL = 5

const cellsOf = (slots: (ToolCount | null)[], gateAt: readonly number[] = []): SlotCell[] =>
    slots.map((tool, index) => tool ? { kind: "tool", tool, gate: gateAt.includes(index) } : { kind: "empty", gate: gateAt.includes(index) })

function wallCells(side: DefenceSide, defence: ReadBackDefence): SlotCell[] {
    const { slots } = defence.wall.sides[side]
    if (side === "front") return cellsOf(slots, FRONT_GATE_SLOTS)
    const locked = !defence.wall.extraFlankSlot && slots.length > 0 && slots.length < FLANK_SLOTS_WITH_SKILL
    return [...cellsOf(slots), ...locked ? [{ kind: "locked" } as const] : []]
}

/** The main castle's defence laid out for the page: the castle by the name the bot found for it, the three works, one row a side with its wall and moat slots, and the courtyard's slots. */
export function defencePanel(defence: ReadBackDefence, castles: readonly AccountCastle[]) {
    return {
        castle: castles.find(c => c.kingdom === defence.kingdom && c.id === defence.id) ?? null,
        works: DEFENCE_PARTS.map(part => ({ part, level: defence[part].level, defence: defence[part].defence })),
        sides: DEFENCE_SIDES.map((side): DefenceRow => ({ side, share: defence.wall.sides[side].share, wall: wallCells(side, defence), moat: cellsOf(defence.moat.sides[side]) })),
        courtyard: cellsOf(defence.courtyard.slots),
    }
}

/** Where the rage bar stands: the event is over, a taunt is held, the bar is full and the next report spends it, or it is filling. */
export type RageState = "eventOver" | "held" | "full" | "filling"

/** The rage bar for the page. `percent` is null while the bot doesn't know what a full bar takes. */
export function rageMeter(rage: ReadBackKhanRage): { percent: number | null; state: RageState } {
    const progress = rageProgress(rage)
    const state = !rage.eventRunning ? "eventOver" : rage.hold ? "held" : progress === 1 ? "full" : "filling"
    return { percent: progress === null ? null : Math.floor(progress * 100), state }
}
