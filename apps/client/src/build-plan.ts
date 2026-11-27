import { MAIN_CASTLE, MAIN_CASTLE_AREA_TYPES, buildingCountLimit, buildingFitsKingdom, type AccountCastle, type BuildPlan, type BuildPlanRow, type BuildingChoice, type CastleRef } from "@gge/contracts"

/** The account's castle a plan part names. A main-castle ref is the kingdom's main castle. Undefined when the account no longer lists it. */
export const castleOfPart = (castles: AccountCastle[], ref: CastleRef) => ref.id === MAIN_CASTLE
    ? castles.find(c => c.kingdom === ref.kingdom && MAIN_CASTLE_AREA_TYPES.includes(c.type))
    : castles.find(c => c.kingdom === ref.kingdom && c.id === ref.id)

/** The buildings a castle may plan: its kingdom's, and its castle type's when the account lists the castle. */
export const offeredTo = (choices: BuildingChoice[], kingdom: number, castle: AccountCastle | undefined) =>
    choices.filter(choice => buildingFitsKingdom(choice, kingdom) && (!castle || !choice.areaTypes.length || choice.areaTypes.includes(castle.type)))

const CATEGORIES: BuildingChoice["category"][] = ["CASTLE", "CIVIL", "MILITARY", "DECO"]
export type BuildingOption = { value: string; label: string }
export type BuildingGroup = { key: string; label: string; options: BuildingOption[] }

/** Buildings as a select lists them: a heading per category, in it each building by name. Names in `skip` are left out. */
export function buildingOptions(choices: BuildingChoice[], words: { name: (choice: BuildingChoice) => string; group: (category: string) => string }, skip: ReadonlySet<string> = new Set()): BuildingGroup[] {
    const listed = choices.filter(choice => !skip.has(choice.name)).map(choice => ({ choice, label: words.name(choice) }))
        .sort((a, b) => a.label.localeCompare(b.label))
    return CATEGORIES.flatMap(category => {
        const options = listed.filter(({ choice }) => choice.category === category).map(({ choice, label }) => ({ value: choice.name, label }))
        return options.length ? [{ key: category, label: words.group(category), options }] : []
    })
}

/** A row for a building just picked: one of it at level 1. An upgrade-only kind is there already, so it starts a level up. */
export const newRow = (choice: BuildingChoice): BuildPlanRow =>
    ({ building: choice.name, level: choice.upgradeOnly ? Math.min(2, choice.maxLevel) : 1, count: 1 })

/** How many a row may ask for. `fixed` when there is nothing to choose, and `all` when the row stands for every one the castle has. */
export const countOf = (choice: BuildingChoice) => {
    const max = buildingCountLimit(choice)
    return { max, fixed: max === 1, all: choice.all }
}

/** What a level needs of the player, or undefined when it needs nothing above level 1. */
export function requirementOf(choice: BuildingChoice, level: number) {
    const [playerLevel, legendLevel] = choice.requires[level - 1] ?? [0, 0]
    return playerLevel > 1 || legendLevel > 0 ? { level: playerLevel, legendLevel } : undefined
}

export const addCastle = (plan: BuildPlan, castle: CastleRef): BuildPlan =>
    [...plan, { castle: { kingdom: castle.kingdom, id: castle.id }, useSkips: false, buyExpansions: false, rows: [] }]

export const addRow = (plan: BuildPlan, index: number, choice: BuildingChoice): BuildPlan =>
    plan.map((part, i) => i === index ? { ...part, rows: [...part.rows, newRow(choice)] } : part)

/** The account's castles that have no part in the plan yet. */
export const unplannedCastles = (castles: AccountCastle[], plan: BuildPlan) => {
    const planned = new Set(plan.map(part => castleOfPart(castles, part.castle)))
    return castles.filter(castle => !planned.has(castle))
}
