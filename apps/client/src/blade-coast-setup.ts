import { RecruitGroup, TOOL_ROLES, type BladeCoastSetup, type BladeCoastUnit, type ToolRole } from "@gge/contracts"

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
