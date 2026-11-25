import { expect, test } from "vitest"
import type { CommanderBucket, PluginCatalogEntry } from "@gge/contracts"
import { NOBODY, assignRange, isMapSet, mapDecides, ownerOf, ownerRows, toggleOwner, writeRanges } from "../src/commander-map.ts"

const sender = (key: string): PluginCatalogEntry =>
    ({ key, force: false, hidden: false, options: [{ type: "Text", key: "commanderWhiteList", default: "1-50" }], checks: [{ type: "commanders", option: "commanderWhiteList" }] })
const catalog: PluginCatalogEntry[] = [sender("attackNomads"), sender("attackKhan"), sender("attackBarronsFirePeaks"), { key: "feast", force: false, hidden: false, options: [] }]
const buckets: CommanderBucket[] = [{ key: "commanderBucketKhanNomads", members: ["attackKhan", "attackNomads"] }]

test("a range goes to one owner, whoever had those commanders, and each commander has one owner", () => {
    const map = assignRange(assignRange([], "attackKhan", 1, 4), "attackNomads", 3, 6)
    expect(map).toEqual(["attackKhan", "attackKhan", "attackNomads", "attackNomads", "attackNomads", "attackNomads"])
    expect([ownerOf(map, 2), ownerOf(map, 3), ownerOf(map, 7)]).toEqual(["attackKhan", "attackNomads", NOBODY])
})

test("a range past the 50 commanders stops at 50, and one written backwards gives nothing", () => {
    expect(assignRange([], "attackKhan", 49, 80)).toHaveLength(50)
    expect(assignRange([], "attackKhan", 0, 1)).toEqual(["attackKhan"])
    expect(assignRange([], "attackKhan", 9, 3)).toEqual([])
})

test("clearing every commander stores the empty default, which is no map", () => {
    const map = assignRange([], "attackKhan", 5, 9)
    expect(isMapSet(map)).toBe(true)
    const cleared = assignRange(map, NOBODY, 1, 50)
    expect(cleared).toEqual([])
    expect(isMapSet(cleared)).toBe(false)
})

test("a click gives the commander to the picked owner, and a second click takes it away", () => {
    const map = toggleOwner(["attackKhan"], "attackNomads", 3)
    expect(map).toEqual(["attackKhan", "", "attackNomads"])
    expect(toggleOwner(map, "attackNomads", 3)).toEqual(["attackKhan"])
    expect(toggleOwner(map, "attackNomads", 1), "a click takes it from another owner").toEqual(["attackNomads", "", "attackNomads"])
})

test("commander numbers are written as ranges", () => {
    expect(writeRanges([17, 18, 20, 21, 22])).toBe("17-18, 20-22")
    expect(writeRanges([4])).toBe("4")
})

test("the owners are the plugins that send commanders, in the sidebar's order, then the shared buckets", () => {
    const rows = ownerRows(catalog, buckets, [], {})
    expect(rows.map(row => row.key)).toEqual(["attackBarronsFirePeaks", "attackNomads", "attackKhan", "commanderBucketKhanNomads"])
    expect(rows.map(row => row.shared)).toEqual([false, false, false, true])
})

test("a plugin that is on with no commander under a set map is marked, unless a bucket of it has one", () => {
    const on = { attackKhan: { enabled: true, options: {} }, attackNomads: { enabled: true, options: {} }, attackBarronsFirePeaks: { enabled: true, options: {} } }
    const starved = (map: string[]) => ownerRows(catalog, buckets, map, on).filter(row => row.starved).map(row => row.key)
    expect(starved([]), "no map, so every plugin keeps its own list").toEqual([])
    expect(starved(["attackKhan"])).toEqual(["attackBarronsFirePeaks", "attackNomads"])
    expect(starved(["attackKhan", "commanderBucketKhanNomads"])).toEqual(["attackBarronsFirePeaks"])
    expect(ownerRows(catalog, buckets, ["attackKhan"], {}).filter(row => row.starved), "plugins that are off are not marked").toEqual([])
})

test("a defence plugin the map gives nothing keeps its own list: not starved, and its picker isn't overridden", () => {
    const withStation = [...catalog, sender("autoStation")]
    const on = { autoStation: { enabled: true, options: {} }, attackKhan: { enabled: true, options: {} } }
    const map = assignRange([], "attackKhan", 1, 5)
    expect(ownerRows(withStation, buckets, map, on, ["autoStation"]).find(row => row.key == "autoStation")?.starved).toBe(false)
    expect(ownerRows(withStation, buckets, map, on).find(row => row.key == "autoStation")?.starved).toBe(true)
    expect(mapDecides(map, buckets, ["autoStation"], ["autoStation"])).toBe(false)
    expect(mapDecides(assignRange(map, "autoStation", 6, 6), buckets, ["autoStation"], ["autoStation"])).toBe(true)
    expect(mapDecides(map, buckets, ["autoStation"], ["attackNomads"])).toBe(true)
    expect(mapDecides([], buckets, ["autoStation"], ["attackKhan"])).toBe(false)
})
