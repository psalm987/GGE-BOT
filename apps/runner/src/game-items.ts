import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { notInArray, sql } from "drizzle-orm"
import { GameItemBonus, type GameItem, type GameItemKind, type GameItemVariant } from "@gge/contracts"
import { gameItems, type Db } from "@gge/db"

const require = createRequire(import.meta.url)
const { orderListOf } = require("@gge/bot-core/orderable.js") as { orderListOf: (unit: unknown) => 0 | 1 | null }

type Unit = Record<string, unknown> & { wodID: number; type: string }

const isUnit = (unit: unknown): unit is Unit => {
    const u = unit as Partial<Unit> | null
    return Number.isInteger(u?.wodID) && typeof u?.type === "string" && u.type !== ""
}

/** Support tools take slot type 10; a banner is whatever has a glory bonus; a tool is a plain attack or defence one. */
function kindOf(unit: Unit): GameItemKind | null {
    if (unit.role === "melee" || unit.role === "ranged")
        return "troop"
    if (String(unit.slotTypes ?? "").split(",").includes("10"))
        return "supportTool"
    if (Number(unit.fameBonus) > 0)
        return "banner"
    if (unit.typ === "Attack" || unit.typ === "Defence")
        return "tool"
    return null
}

const numberOrNull = (value: unknown) => {
    const n = Number(value)
    return value === undefined || value === "" || !Number.isFinite(n) ? null : n
}

export type Entry = { unit: Unit; item: GameItem }

const BONUSES = GameItemBonus.options

/** Jade tools carry their tier as the last digit of the type's second comment; battleground tools are the Maya copies of workshop defence tools. */
function specialOf({ comment1, comment2 }: Unit): GameItemVariant | null {
    const tier = /(\d)$/.exec(String(comment2 ?? "").trim())
    if (String(comment1 ?? "").includes("Jade") && tier)
        return { kind: "jade", tier: Number(tier[1]) }
    return String(comment1 ?? "").trim() === "Battleground" ? { kind: "battleground" } : null
}

/** The first bonus field that every entry has and no two share. */
function bonusOf(entries: Entry[]): Map<number, GameItemVariant> | null {
    for (const bonus of BONUSES) {
        const values = entries.map(e => numberOrNull(e.unit[bonus]))
        if (values.every(v => v !== null) && new Set(values).size === values.length)
            return new Map(entries.map((e, i) => [e.item.id, { kind: "bonus", bonus, value: values[i]! }]))
    }
    return null
}

/** 1-based place along the upgrade chain, counting only the group's own entries. */
function versionsOf(entries: Entry[]): Map<number, GameItemVariant> {
    const ids = new Set(entries.map(e => e.item.id))
    const down = new Map(entries.map(e => [e.item.id, numberOrNull(e.unit.downgradeWodID)]))
    const step = (id: number) => {
        let n = 1
        for (let below = down.get(id); below != null && ids.has(below) && n <= ids.size; below = down.get(below))
            n++
        return n
    }
    return new Map(entries.map(e => [e.item.id, { kind: "version", step: step(e.item.id) }]))
}

/**
 * Tells apart the items that share a kind, name and level, since a picker shows only those. Jade and battleground
 * tools are named first, then the one bonus that differs, then the upgrade chain. Level 0 and no level are the same.
 */
export function variantsOf(entries: Entry[]): Map<number, GameItemVariant> {
    const groups = Map.groupBy(entries, ({ item }) => `${item.kind}\0${item.name}\0${item.level ?? 0}`)
    const variants = new Map<number, GameItemVariant>()
    for (const group of groups.values()) {
        if (group.length < 2)
            continue
        for (const entry of group) {
            const special = specialOf(entry.unit)
            if (special)
                variants.set(entry.item.id, special)
        }
        const rest = group.filter(e => !variants.has(e.item.id))
        if (rest.length < 2)
            continue
        for (const [id, variant] of bonusOf(rest) ?? versionsOf(rest))
            variants.set(id, variant)
    }
    return variants
}

/** The game's soldiers, tools and banners from its items file, named from the English language file. */
export async function readGameItems(dataDir: string): Promise<GameItem[]> {
    const units: unknown = JSON.parse(await readFile(path.join(dataDir, "items", "units.json"), "utf8"))
    const lang = JSON.parse(await readFile(path.join(dataDir, "lang", "en.json"), "utf8").catch(() => "{}")) as Record<string, string>
    const assets = require("@gge/bot-core/assets.json") as Record<string, string>
    const entries: Entry[] = []
    for (const unit of Array.isArray(units) ? units : []) {
        if (!isUnit(unit))
            continue
        const kind = kindOf(unit)
        if (!kind)
            continue
        const { type } = unit
        const nameKey = [`${type}_name`, `${type[0]!.toLowerCase()}${type.slice(1)}_name`, `${type.toLowerCase()}_name`].find(key => key in lang) ?? `${type}_name`
        entries.push({ unit, item: {
            id: unit.wodID, kind, nameKey, name: lang[nameKey] ?? type,
            level: numberOrNull(unit.level), fameBonus: numberOrNull(unit.fameBonus), orderList: orderListOf(unit),
            image: assets[`${unit.name}_${unit.group}_${type}`] ?? null, variant: null,
        } })
    }
    const variants = variantsOf(entries)
    return entries.map(({ item }) => ({ ...item, variant: variants.get(item.id) ?? null }))
}

export async function publishGameItems(db: Db, items: GameItem[]) {
    await db.transaction(async tx => {
        for (const item of items)
            await tx.insert(gameItems).values({ ...item, updatedAt: new Date() })
                .onConflictDoUpdate({ target: gameItems.id, set: { ...item, updatedAt: sql`now()` } })
        await tx.delete(gameItems).where(notInArray(gameItems.id, items.map(i => i.id)))
    })
}
