import { MAIN_CASTLE_AREA_TYPES, type AccountCastle, type CastleRef } from "@gge/contracts"

type CastleKind = "main" | "outpost" | "capital" | "metropolis" | "castle"

/** The game's area types of the castles a player holds beside each kingdom's main castle. */
const KIND_BY_AREA_TYPE = new Map<number, CastleKind>([[4, "outpost"], [3, "capital"], [22, "metropolis"]])
/** The kinds in the order a kingdom lists its castles, each with the client key that names it. */
const KINDS: [CastleKind, string][] = [
    ["main", "plugins.castle.main"],
    ["outpost", "plugins.castle.kind.outpost"],
    ["capital", "plugins.castle.kind.capital"],
    ["metropolis", "plugins.castle.kind.metropolis"],
    ["castle", "plugins.castle.kind.castle"],
]
const KIND_ORDER = KINDS.map(([kind]) => kind)
const KIND_KEY = new Map(KINDS)
/** Great Empire, Burning Sands, Everwinter Glacier and Fire Peaks, as players list them. Other kingdoms follow by id. */
const KINGDOM_ORDER = [0, 1, 2, 3]

const castleKind = (type: number): CastleKind => MAIN_CASTLE_AREA_TYPES.includes(type) ? "main" : KIND_BY_AREA_TYPE.get(type) ?? "castle"
const rank = <T>(order: T[], value: T) => order.includes(value) ? order.indexOf(value) : order.length

export const castleKey = (ref: CastleRef) => `${ref.kingdom}:${ref.id}`
export const toCastle = (key: string): CastleRef => {
    const [kingdom, id] = key.split(":").map(Number)
    return { kingdom: kingdom!, id: id! }
}

type Translate = (key: string, params: Record<string, string | number>) => string

/** `search` is what typing in the picker matches, and `chosen` the text a closed picker shows. */
export type CastleOption = { value: string; label: string; search: string; chosen: string }
export type CastleGroup = { key: string; label: string; search: string; options: CastleOption[] }

/**
 * The account's castles as a castle picker lists them: under a heading per kingdom when they span more than one, each
 * named by what it is, its name and its position. A picker that spans kingdoms names the kingdom of the castle it shows.
 */
export function castleOptions(castles: AccountCastle[], t: Translate, kingdomName: (kingdom: number) => string): (CastleOption | CastleGroup)[] {
    const kingdoms = [...new Set(castles.map(c => c.kingdom))]
        .sort((a, b) => rank(KINGDOM_ORDER, a) - rank(KINGDOM_ORDER, b) || a - b)
    const spans = kingdoms.length > 1
    const groups = kingdoms.map(kingdom => {
        const name = kingdomName(kingdom)
        const options = castles.filter(c => c.kingdom === kingdom)
            .sort((a, b) => rank(KIND_ORDER, castleKind(a.type)) - rank(KIND_ORDER, castleKind(b.type)))
            .map(c => {
                const label = t("plugins.castle.option", { kind: t(KIND_KEY.get(castleKind(c.type))!, {}), name: c.name, x: c.x, y: c.y })
                return { value: castleKey(c), label, search: `${label} ${name}`, chosen: spans ? t("plugins.castle.chosen", { castle: label, kingdom: name }) : label }
            })
        return { key: `kingdom-${kingdom}`, label: name, search: name, options }
    })
    return spans ? groups : groups[0]?.options ?? []
}
