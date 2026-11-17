import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { notInArray, sql } from "drizzle-orm"
import type { GameItem, GameItemKind } from "@gge/contracts"
import { gameItems, type Db } from "@gge/db"

const require = createRequire(import.meta.url)

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

/** The game's soldiers, tools and banners from its items file, named from the English language file. */
export async function readGameItems(dataDir: string): Promise<GameItem[]> {
    const units: unknown = JSON.parse(await readFile(path.join(dataDir, "items", "units.json"), "utf8"))
    const lang = JSON.parse(await readFile(path.join(dataDir, "lang", "en.json"), "utf8").catch(() => "{}")) as Record<string, string>
    const assets = require("@gge/bot-core/assets.json") as Record<string, string>
    const items: GameItem[] = []
    for (const unit of Array.isArray(units) ? units : []) {
        if (!isUnit(unit))
            continue
        const kind = kindOf(unit)
        if (!kind)
            continue
        const { type } = unit
        const nameKey = [`${type}_name`, `${type[0]!.toLowerCase()}${type.slice(1)}_name`, `${type.toLowerCase()}_name`].find(key => key in lang) ?? `${type}_name`
        items.push({
            id: unit.wodID, kind, nameKey, name: lang[nameKey] ?? type,
            level: numberOrNull(unit.level), fameBonus: numberOrNull(unit.fameBonus),
            image: assets[`${unit.name}_${unit.group}_${type}`] ?? null,
        })
    }
    return items
}

export async function publishGameItems(db: Db, items: GameItem[]) {
    await db.transaction(async tx => {
        for (const item of items)
            await tx.insert(gameItems).values({ ...item, updatedAt: new Date() })
                .onConflictDoUpdate({ target: gameItems.id, set: { ...item, updatedAt: sql`now()` } })
        await tx.delete(gameItems).where(notInArray(gameItems.id, items.map(i => i.id)))
    })
}
