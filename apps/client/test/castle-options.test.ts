import { expect, test } from "vitest"
import type { AccountCastle } from "@gge/contracts"
import { castleOptions, type CastleGroup, type CastleOption } from "../src/castle-options.ts"
import en from "../../../packages/i18n/catalogs/en/client.json" with { type: "json" }

const words = en as Record<string, string>
const t = (key: string, params: Record<string, string | number>) => words[key]!.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name]))
const kingdomName = (kingdom: number) => words[`plugins.kingdom.${kingdom}`] ?? `Kingdom ${kingdom}`
const castle = (kingdom: number, id: number, type: number, name: string, x: number, y: number): AccountCastle => ({ kingdom, id, type, name, x, y })

const account = [
    castle(10, 900, 15, "Ironhold", 50, 50),
    castle(2, 200, 12, "Ironhold", 120, 77),
    castle(0, 104, 22, "Old Harbour", 700, 640),
    castle(0, 103, 3, "Stonebridge", 520, 410),
    castle(0, 102, 4, "Ironhold Watch", 430, 301),
    castle(0, 101, 1, "Ironhold", 412, 288),
    castle(1, 300, 12, "Ironhold", 900, 15),
    castle(3, 400, 12, "Ironhold", 33, 66),
    castle(1, 301, 3, "Dune Gate", 870, 40),
    castle(0, 105, 4, "East Watch", 460, 330),
]

test("castles across kingdoms are grouped under each kingdom's name: Green, Sands, Ice, Fire, then the others", () => {
    const groups = castleOptions(account, t, kingdomName) as CastleGroup[]
    expect(groups.map(group => group.label)).toEqual(["Great Empire", "Burning Sands", "Everwinter Glacier", "Fire Peaks", "Berimond"])
})

test("a kingdom lists its main castle, then its outposts, its capital and its metropolis, each named by what it is", () => {
    const [green, sands] = castleOptions(account, t, kingdomName) as CastleGroup[]
    expect(green!.options.map(option => option.label)).toEqual([
        "Main castle · Ironhold (412:288)",
        "Outpost · Ironhold Watch (430:301)",
        "Outpost · East Watch (460:330)",
        "Capital · Stonebridge (520:410)",
        "Metropolis · Old Harbour (700:640)",
    ])
    expect(sands!.options.map(option => option.label)).toEqual(["Main castle · Ironhold (900:15)", "Capital · Dune Gate (870:40)"])
    expect(green!.options.map(option => option.value)).toEqual(["0:101", "0:102", "0:105", "0:103", "0:104"])
})

test("a castle of a type the client doesn't know is still listed, as a castle", () => {
    const [option] = castleOptions([castle(4, 7, 99, "Stormkeep", 5, 6)], t, kingdomName) as CastleOption[]
    expect(option!.label).toBe("Castle · Stormkeep (5:6)")
})

test("typing matches what a castle is, its name, its position and its kingdom", () => {
    const [green] = castleOptions(account, t, kingdomName) as CastleGroup[]
    const matches = (text: string) => green!.options.filter(option => option.search.toUpperCase().includes(text.toUpperCase())).map(option => option.value)
    expect(matches("outpost")).toEqual(["0:102", "0:105"])
    expect(matches("stonebridge")).toEqual(["0:103"])
    expect(matches("700:640")).toEqual(["0:104"])
    expect(matches("great empire")).toHaveLength(5)
})

test("a closed picker that spans kingdoms names the kingdom, since every kingdom's castle can share one name", () => {
    const groups = castleOptions(account, t, kingdomName) as CastleGroup[]
    const ice = groups.find(group => group.label === "Everwinter Glacier")!
    expect(ice.options[0]!.chosen).toBe("Main castle · Ironhold (120:77) · Everwinter Glacier")
})

test("a picker limited to one kingdom lists its castles without a heading, and shows a pick as listed", () => {
    const options = castleOptions(account.filter(c => c.kingdom === 1), t, kingdomName) as CastleOption[]
    expect(options.map(option => [option.value, option.chosen])).toEqual([["1:300", "Main castle · Ironhold (900:15)"], ["1:301", "Capital · Dune Gate (870:40)"]])
    expect(castleOptions([], t, kingdomName)).toEqual([])
})
