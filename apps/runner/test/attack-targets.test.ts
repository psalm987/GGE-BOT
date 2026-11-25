import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, expect, test } from "vitest"
import { allowedAtTargets } from "@gge/contracts"
import { readPluginRegistry } from "@gge/bot-core/pluginRegistry.mts"
import { readGameItems } from "../src/game-items.ts"

const require = createRequire(import.meta.url)
const { toolAllowedAt } = require("@gge/bot-core/attackTargets.js") as { toolAllowedAt: (info: { allowedToAttack?: string }, target: { kingdom: number; areaType: number }) => boolean }

const dirs: string[] = []
afterAll(() => Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true }))))

const tool = (wodID: number, allowedToAttack?: string) => ({ wodID, type: `Tool${wodID}`, typ: "Attack", toolCategory: "Event", name: "x", group: "y", ...(allowedToAttack !== undefined && { allowedToAttack }) })

test("an item's attack targets come from its allowedToAttack, and an unrestricted or unreadable one has none", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "gge-items-"))
    dirs.push(dataDir)
    await mkdir(path.join(dataDir, "items"))
    await writeFile(path.join(dataDir, "items", "units.json"), JSON.stringify([tool(1), tool(2, "0+29"), tool(3, "0+21#0+34"), tool(4, "garbage")]))
    const items = new Map((await readGameItems(dataDir)).map(item => [item.id, item.attackTargets]))
    expect(items.get(1)).toBeNull()
    expect(items.get(2)).toEqual([{ kingdom: 0, areaType: 29 }])
    expect(items.get(3)).toEqual([{ kingdom: 0, areaType: 21 }, { kingdom: 0, areaType: 34 }])
    expect(items.get(4)).toBeNull()
})

test("the editor's rule and the bot's rule answer alike for every value and target", () => {
    const values = [undefined, "0+29", "0+21#0+34", "-1+37", "0+-1", "10+15", "garbage", "0+"]
    const targets = [0, 1, 10].flatMap(kingdom => [2, 15, 21, 29, 37].map(areaType => ({ kingdom, areaType })))
    for (const value of values)
        for (const target of targets) {
            const attackTargets = value === undefined ? [] : JSON.parse(JSON.stringify(require("@gge/bot-core/attackTargets.js").parseAllowedToAttack(value)))
            expect(allowedAtTargets(attackTargets, [target]), `${value} at ${JSON.stringify(target)}`).toBe(toolAllowedAt({ allowedToAttack: value }, target))
        }
})

test("every attack plugin with a wave plan names what it attacks, and Samurai and Daimyo name different castles", () => {
    const catalog = readPluginRegistry({ discordHub: true }).catalog
    const waved = catalog.filter(entry => entry.category === "attack" && entry.options.some(def => def.type === "Waves"))
    expect(waved.length).toBeGreaterThan(10)
    expect(waved.filter(entry => !entry.targets?.length).map(entry => entry.key), "attack plugins with no target").toEqual([])
    const targetsOf = (key: string) => catalog.find(entry => entry.key === key)!.targets
    expect(targetsOf("attackSamurai")).toEqual([{ kingdom: 0, areaType: 29 }])
    expect(targetsOf("attackDaimyo")).toEqual([{ kingdom: 0, areaType: 37 }])
})
