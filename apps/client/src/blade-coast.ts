import { RecruitGroup, TOOL_ROLES, type BladeCoastSetup, type BladeCoastTrip, type BladeCoastUnit, type ToolRole } from "@gge/contracts"

/** A setup with nothing picked yet. */
export const EMPTY_SETUP: BladeCoastSetup = { castle: null, troop: null, tools: { wall: null, gate: null, ranged: null } }

/** One choice of a unit select: `value` is the "<type>#<level>" the setup stores. */
export type UnitOption = { value: string; label: string }
export type UnitGroup = { key: string; label: string; options: UnitOption[] }

/**
 * Units as a select lists them: a heading per recruit group, in the game's order, and in it a choice per type and level, by name and then
 * level. A type the game has at level 0 only is named alone. Types in `skip` are left out.
 */
export function unitOptions(units: BladeCoastUnit[], words: {
    name: (unit: BladeCoastUnit) => string; level: (name: string, level: number) => string; group: (group: string) => string
}, skip: ReadonlySet<string> = new Set()): UnitGroup[] {
    const groups = new Map<string, UnitGroup>()
    const named = units.filter(unit => !skip.has(unit.type)).map(unit => ({ unit, name: words.name(unit) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    for (const { unit, name } of named) {
        const group = groups.get(unit.recruitGroup) ?? { key: unit.recruitGroup, label: words.group(unit.recruitGroup), options: [] }
        for (const level of unit.levels)
            group.options.push({ value: `${unit.type}#${level}`, label: level === 0 && unit.levels.length === 1 ? name : words.level(name, level) })
        groups.set(unit.recruitGroup, group)
    }
    return RecruitGroup.options.flatMap(key => groups.get(key) ?? [])
}

/** What a setup still lacks, in the order the editor lists its fields: the castle, the troop, then each defence's tool. */
export const missingPicks = (setup: BladeCoastSetup): ("castle" | "troop" | ToolRole)[] => [
    ...setup.castle ? [] : ["castle" as const],
    ...setup.troop ? [] : ["troop" as const],
    ...TOOL_ROLES.filter(role => !setup.tools[role]),
]

/** The trips still on their way at `now`, soonest first. An attack whose landing time the bot doesn't know stays, last. */
export const tripsUnderWay = (trips: readonly BladeCoastTrip[], now: number) =>
    trips.filter(trip => trip.endsAt === null || trip.endsAt > now).sort((a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity))

/** How far an attack is on its way, 0 to 1; null when it isn't an attack or its times aren't known. */
export function tripProgress(trip: BladeCoastTrip, now: number): number | null {
    if (trip.kind !== "attack" || trip.sentAt === null || trip.endsAt === null || trip.endsAt <= trip.sentAt)
        return null
    return Math.min(1, Math.max(0, (now - trip.sentAt) / (trip.endsAt - trip.sentAt)))
}
