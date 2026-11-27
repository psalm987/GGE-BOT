import * as z from "zod"

/** The goods a castle stores, in the order the screens list them. */
export const STOCK_KEYS = ["wood", "stone", "food", "coal", "oil", "glass", "iron", "honey", "mead", "aqua"] as const
export type StockKey = (typeof STOCK_KEYS)[number]

/** The most castles and marches one snapshot carries, which bounds its size. */
export const READ_BACK_MAX_CASTLES = 40
export const READ_BACK_MAX_MOVEMENTS = 50
/** The most tool slots one wall side or moat side carries, and the most kinds of defence tool listed from storage. */
export const READ_BACK_MAX_DEFENCE_SLOTS = 8
export const READ_BACK_MAX_DEFENCE_TOOLS = 24
/** The most kinds of unit one castle lists in each group of `ReadBackCastle.units`. */
export const READ_BACK_MAX_UNIT_KINDS = 24

/** One good in one castle. `perHour` is production less what the castle eats, so it is negative when the stock is running down. */
export const Stock = z.object({
    amount: z.number().int().min(0),
    max: z.number().int().min(0),
    perHour: z.number().int(),
})
export type Stock = z.infer<typeof Stock>

/** Units of one kind. `wodID` is the game's number for the soldier or tool, which the game items catalog names. */
export const UnitCount = z.object({ wodID: z.number().int(), amount: z.number().int().min(0) })
export type UnitCount = z.infer<typeof UnitCount>
/** Tools of one kind. */
export const ToolCount = UnitCount
export type ToolCount = UnitCount

const UnitList = z.array(UnitCount).max(READ_BACK_MAX_UNIT_KINDS)
/** What a castle's units do, in the order the screens list them: soldiers that defend, soldiers that attack, and the tools of each. */
export const UNIT_GROUPS = ["defenders", "attackers", "defenceTools", "attackTools"] as const
export type UnitGroup = (typeof UNIT_GROUPS)[number]
const CastleUnits = z.object({ defenders: UnitList, attackers: UnitList, defenceTools: UnitList, attackTools: UnitList })
const NO_UNITS = { defenders: [], attackers: [], defenceTools: [], attackTools: [] }

/**
 * A castle's stores, units and order as the game last listed them. The castle's name and place are in `BotStatus.castles`,
 * by `kingdom` and `id`. A figure added after the first snapshots has a default, so a stored older snapshot still reads.
 */
export const ReadBackCastle = z.object({
    kingdom: z.number().int(),
    id: z.number().int(),
    /** When the game listed these stores, epoch milliseconds. Forecasts count from here. */
    readAt: z.number().int(),
    /** Only the goods the castle holds or makes. */
    stock: z.partialRecord(z.enum(STOCK_KEYS), Stock),
    /** The castle's units, its keep's troops included, the largest stocks first. */
    units: CastleUnits.default(NO_UNITS),
    /** Decoration less riot and sickness. Research and castellan bonuses aren't counted. Null when the game didn't say. */
    publicOrder: z.number().int().nullable().default(null),
    /** What public order does to production, in percent: 100 at none, more above it and less below. */
    productivity: z.number().int().min(0).nullable().default(null),
    guards: z.number().int().min(0).nullable().default(null),
    population: z.number().int().min(0).nullable().default(null),
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
/** What a march is: a fight, troops sent to stand in a castle, an army coming home, goods on a market cart, troops moved between the account's castles, or anything else. */
export const MarchKind = z.enum(["attack", "station", "return", "market", "transfer", "other"])
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
    /** When an army that stays at its target leaves again, epoch milliseconds; null for a march that doesn't stay. */
    stationedUntil: z.number().int().nullable().default(null),
})
export type ReadBackMovement = z.infer<typeof ReadBackMovement>

/**
 * What the bot gained for the account from when the player started it until they stopped it. Reconnects and restarts
 * stay in one session. Only rises count, so spending takes nothing off. The runner keeps it, so it outlives the worker.
 */
export const SessionGains = z.object({
    /** Epoch milliseconds. */
    startedAt: z.number().int(),
    /** When the player stopped the bot, epoch milliseconds; null while the session goes on. */
    endedAt: z.number().int().nullable(),
    coins: z.number().int().min(0),
    rubies: z.number().int().min(0),
    /** Aquamarine in the Storm Islands castle. */
    aqua: z.number().int().min(0),
    /** Each event's points as the game last reported them this session, by event id. Totals, not gains. */
    eventPoints: z.record(z.string().regex(/^\d+$/), z.number().int().min(0)).default({}),
})
export type SessionGains = z.infer<typeof SessionGains>

/** The tool slots of one side, in the game's order. An empty slot is null. */
const DefenceSlots = z.array(ToolCount.nullable()).max(READ_BACK_MAX_DEFENCE_SLOTS)
/** A part of the castle's works: its building level and the defence figure the game's defence screen shows for it, in percent. Either is null when the game didn't say. */
const DefenceWorks = z.object({ level: z.number().int().min(0).nullable(), defence: z.number().min(0).nullable() })

export const DEFENCE_SIDES = ["left", "front", "right"] as const
/** The front wall's slots that hold gate tools, by place; the others hold wall tools (the game client's `DefenseConst.ITEMS_MIDDLEWALL`). */
export const FRONT_GATE_SLOTS: readonly number[] = [1, 4]
export type DefenceSide = (typeof DEFENCE_SIDES)[number]
const WallSide = z.object({
    /** The share of the wall's troops that stand on this side, in percent. */
    share: z.number().int().min(0).max(100),
    slots: DefenceSlots,
})

/** The main castle's defence as the game last listed it. The castle's name and place are in `BotStatus.castles`, by `kingdom` and `id`. */
export const ReadBackDefence = z.object({
    kingdom: z.number().int(),
    id: z.number().int(),
    /** When the game listed this defence, epoch milliseconds. */
    readAt: z.number().int(),
    wall: DefenceWorks.extend({
        /** Troops on the wall and how many it has room for. */
        troops: z.number().int().min(0),
        room: z.number().int().min(0),
        /** Whether each flank has the fifth tool slot the legendary skill "additional defence tool slot on the flank" gives. */
        extraFlankSlot: z.boolean().default(false),
        sides: z.object({ left: WallSide, front: WallSide, right: WallSide }),
    }),
    gate: DefenceWorks,
    moat: DefenceWorks.extend({ sides: z.object({ left: DefenceSlots, front: DefenceSlots, right: DefenceSlots }) }),
    /** Troops in the courtyard, its room for the account's own troops, and its extra room for alliance support. */
    courtyard: z.object({ troops: z.number().int().min(0), room: z.number().int().min(0), allianceRoom: z.number().int().min(0), slots: DefenceSlots.default([]) }),
    /** Defensive soldiers in the castle's storage when the defence was read. */
    defenders: z.number().int().min(0),
    /** The same soldiers by kind, the largest stocks first. */
    defenderUnits: UnitList.default([]),
    /** Defence tools in the castle's storage, the largest stocks first, at most READ_BACK_MAX_DEFENCE_TOOLS kinds. */
    tools: z.array(ToolCount).max(READ_BACK_MAX_DEFENCE_TOOLS),
})
export type ReadBackDefence = z.infer<typeof ReadBackDefence>

/** Why the Khan plugin isn't spending a full rage bar on a taunt, in the order it checks them. */
export const KHAN_TAUNT_HOLDS = ["off", "stopped", "defenceLost", "defenceShort", "defendersShort", "toolsShort", "defenceUnread"] as const
export const KhanTauntHold = z.enum(KHAN_TAUNT_HOLDS)
export type KhanTauntHold = z.infer<typeof KhanTauntHold>

/** The Khan plugin's rage bar. A full bar is spent on a taunt, which sends the Khan at the main castle. */
export const ReadBackKhanRage = z.object({
    rage: z.number().int().min(0),
    /** The rage a full bar takes at the camp the account last fought; null until the bot has sent an attack there. */
    needed: z.number().int().positive().nullable(),
    /** That camp's level, null with `needed`. */
    campLevel: z.number().int().min(0).nullable(),
    /** The rage the last hit earned and when, epoch milliseconds; null until a hit has landed this session. */
    lastGain: z.number().int().positive().nullable(),
    lastGainAt: z.number().int().nullable(),
    eventRunning: z.boolean(),
    hold: KhanTauntHold.nullable(),
    /** The rage a hit on that camp earns before tools and critical hits; null until the camp is on the bot's map. */
    baseRage: z.number().int().positive().nullable().default(null),
    /** That camp's chance of a critical hit, in percent; null with `needed`. */
    critChance: z.number().min(0).max(100).nullable().default(null),
    /** Rage tools in the main castle's storage when its defence was read; null until the bot has read it. */
    rageTools: z.array(UnitCount).max(READ_BACK_MAX_DEFENCE_TOOLS).nullable().default(null),
})
export type ReadBackKhanRage = z.infer<typeof ReadBackKhanRage>

/** What the bot last read from the game, for the screens that show it back to the player. Rides in the worker's status report. */
export const ReadBack = z.object({
    /** When the worker put this together, epoch milliseconds. */
    at: z.number().int(),
    castles: z.array(ReadBackCastle).max(READ_BACK_MAX_CASTLES),
    /** The marches worth showing first, at most READ_BACK_MAX_MOVEMENTS of them. */
    movements: z.array(ReadBackMovement).max(READ_BACK_MAX_MOVEMENTS),
    /** How many marches the game listed, which can be more than `movements` holds. */
    movementCount: z.number().int().min(0),
    /** Absent until the game has listed the main castle's defence this session. */
    defence: ReadBackDefence.optional(),
    /** Absent while the Khan plugin is off, or on with no Khan event seen this session. */
    khanRage: ReadBackKhanRage.optional(),
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

/** How full the rage bar is, from 0 to 1; null while the bot doesn't know what a full bar takes. */
export function rageProgress({ rage, needed }: Pick<ReadBackKhanRage, "rage" | "needed">) {
    return needed === null ? null : Math.min(1, rage / needed)
}

/** How much of a march is behind it at `now`, from 0 to 1. */
export function marchProgress({ arrivesAt, totalSeconds }: Pick<ReadBackMovement, "arrivesAt" | "totalSeconds">, now: number) {
    if (totalSeconds <= 0) return 1
    return Math.min(1, Math.max(0, 1 - (arrivesAt - now) / (totalSeconds * 1000)))
}
