import * as z from "zod"

/** The Blade Coast maps by id, in the order a player plays them: Normal, Hard and Hard plus. */
export const BLADE_COAST_MAPS = [22, 27, 28] as const
export const BladeCoastMap = z.literal(BLADE_COAST_MAPS)
export type BladeCoastMap = z.infer<typeof BladeCoastMap>
/** A map's level, 1 to 3. */
export const bladeCoastLevel = (map: BladeCoastMap) => BLADE_COAST_MAPS.indexOf(map) + 1

/**
 * What the Blade Coast plugin is doing: travelling to the camp, building its storehouses, tents or morale, filling it
 * with troops and tools, attacking, waiting for an attack (one on the Kraken), done with the map, or stopped for the
 * event after losing an island twice.
 */
export const BladeCoastPhase = z.enum(["joining", "storehouses", "tents", "morale", "filling", "attacking", "attackOut", "krakenAttackOut", "mapDone", "stopped"])
export type BladeCoastPhase = z.infer<typeof BladeCoastPhase>

const count = z.number().int().min(0)
/** A time in ms since the epoch. */
const at = z.number()

/**
 * Something on its way on the Blade Coast, kept apart from the account's marches: an attack on an island, troops or
 * goods sailing to the camp.
 */
export const BladeCoastTrip = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("attack"), island: z.number().int(), level: count, kraken: z.boolean(), sentAt: at.nullable(), endsAt: at.nullable() }),
    z.object({ kind: z.literal("troops"), amount: count, endsAt: at }),
    z.object({ kind: z.literal("goods"), endsAt: at }),
])
export type BladeCoastTrip = z.infer<typeof BladeCoastTrip>

/**
 * The Blade Coast camp and map as the plugin last read them, in the worker's status report as `bladeCoast`. After Lazy
 * Lord's be/plugins/bladeCoast.js status. `morale.bonus` is the strength morale gives in battle, in percent of normal
 * (100 is none, as the game's CombatConst.getMoralBonus works it out). `islands` counts the islands
 * on the way to the Kraken, which is counted on its own. `nextIsland` is the one the plugin attacks next.
 */
export const BladeCoastStatus = z.object({
    map: BladeCoastMap,
    phase: BladeCoastPhase,
    camp: z.object({
        space: count, spaceTarget: count, soldiers: count, minSoldiers: count, storehouses: count, storehousesTarget: count,
        wood: count, stone: count, food: count, storage: count,
    }),
    morale: z.object({ value: z.number().int(), bonus: z.number(), target: z.number().int() }),
    warship: z.object({ level: count, max: count }),
    islands: z.object({ won: count, total: count, krakenWon: z.boolean() }),
    nextIsland: z.object({ id: z.number().int(), level: count, kraken: z.boolean() }).nullable(),
    trips: z.array(BladeCoastTrip).max(10),
})
export type BladeCoastStatus = z.infer<typeof BladeCoastStatus>
