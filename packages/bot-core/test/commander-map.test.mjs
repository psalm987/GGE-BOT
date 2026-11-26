import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { describe, expect, test } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginStatus } = require("../actions.json")
const en = require("../locales/en.json")
const { BUCKETS, assignedTo, writeRanges } = require("../commanderMap.js")

class Lord { constructor(e) { this.lordID = e.ID; this.lordPosition = e.VIS } }

/** A map from what the settings page shows: `{ attackKhan: [1, 2], commanderBucketBarons: [5] }` by commander number. */
function mapOf(owners) {
    const map = []
    for (const [owner, numbers] of Object.entries(owners))
        for (const number of numbers)
            map[number - 1] = owner
    return Array.from(map, owner => owner ?? "")
}

/** The real pool on an account with `owned` commanders (lord ids 101 on), under the commander map `owners`. */
function pool(owners = {}, { owned = 20 } = {}) {
    const bot = fakeBot()
    bot.botConfig.plugins.commander = { state: true, commanderMap: mapOf(owners) }
    const reports = []
    const parentPort = { postMessage: ([action, payload]) => action == PluginStatus && reports.push(payload), on() {} }
    const { mod } = loadModule("plugins/commander.js", { bot, parentPort, extra: { "protocols.js": { ClassTypes: { Lord }, movementEvents: new EventEmitter() } } })
    bot.xtHandler.emit("gli", { C: Array.from({ length: owned }, (_, i) => ({ ID: 101 + i, VIS: i })) }, 0)
    const number = lord => lord && lord.lordPosition + 1
    return {
        ...mod, reports, number,
        status: plugin => reports.findLast(report => report.plugin == plugin),
        /** Saves a new map the way a settings change reaches a running bot. */
        remap(next) {
            bot.botConfig.plugins.commander.commanderMap = mapOf(next)
            bot.events.emit("configModified")
        },
        take: plugin => number(mod.takeFreeCommander("1-50", `/plugins/attack/${plugin}.js`)),
        wait: (plugin, sort) => mod.waitForCommanderAvailable("1-50", undefined, sort, `/plugins/attack/${plugin}.js`).then(number),
    }
}

const settled = async promise => {
    let value = "pending"
    promise.then(v => (value = v))
    for (let i = 0; i < 20; i++)
        await Promise.resolve()
    return value
}

describe("the catalog entry", () => {
    const { mod } = loadModule("plugins/commander.js", { mainThread: true })

    test("is always on, is listed with the account's settings, and the API accepts its commander map", () => {
        const entry = PluginCatalogEntry.parse({ key: "commander", force: Boolean(mod.force), hidden: Boolean(mod.hidden), options: mod.pluginOptions })
        expect(entry).toMatchObject({ force: true, hidden: false })
        expect(entry.options).toMatchObject([{ type: "CommanderMap", key: "commanderMap", default: [] }])
    })

    test("offers the four shared buckets, each with its English name", () => {
        expect(BUCKETS.map(bucket => bucket.key)).toEqual(["commanderBucketBarons", "commanderBucketBaronsFortresses", "commanderBucketKhanNomads", "commanderBucketSamuraiDaimyo"])
        for (const bucket of BUCKETS)
            expect(en[bucket.key], bucket.key).toBeTruthy()
    })
})

describe("with no commander map", () => {
    test("a plugin sends the commanders of its own list, as before", async () => {
        const { waitForCommanderAvailable, takeFreeCommander, number, reports } = pool()
        expect(number(await waitForCommanderAvailable("5;2", undefined, undefined, "/plugins/attack/attackKhan.js"))).toBe(5)
        expect(number(takeFreeCommander("5;2", "/plugins/autoStation.js"))).toBe(2)
        expect(reports.filter(report => report.plugin != "commander")).toEqual([])
    })

    test("a map with every commander unassigned is no map", async () => {
        const { wait } = pool({ "": [1, 2, 3] })
        expect(await wait("attackKhan")).toBe(1)
    })
})

describe("with a commander map", () => {
    const owners = { attackKhan: [7, 3], commanderBucketKhanNomads: [1, 2], attackBarronsFirePeaks: [10], commanderBucketBarons: [11] }

    test("a plugin sends its own commanders first, then its bucket's, and never another plugin's", async () => {
        const { wait } = pool(owners)
        expect([await wait("attackKhan"), await wait("attackKhan"), await wait("attackKhan"), await wait("attackKhan")]).toEqual([3, 7, 1, 2])
        expect(await settled(wait("attackKhan")), "the other commanders are free, but they are not Khan's").toBe("pending")
    })

    test("every plugin of a bucket may send the bucket's commanders", async () => {
        const { wait, take } = pool(owners)
        expect(await wait("attackNomads")).toBe(1)
        expect(take("attackKhan"), "Khan's own").toBe(3)
        expect(take("attackNomads")).toBe(2)
        expect(take("attackNomads")).toBeUndefined()
    })

    test("the plugin's own list is not read", async () => {
        const { waitForCommanderAvailable, number } = pool(owners)
        expect(number(await waitForCommanderAvailable("15-20", undefined, undefined, "/plugins/attack/attackKhan.js"))).toBe(3)
    })

    test("a plugin's own order picks among its own commanders, and then among its bucket's", async () => {
        const { wait } = pool(owners)
        const highestFirst = (a, b) => b.lordPosition - a.lordPosition
        expect([await wait("attackKhan", highestFirst), await wait("attackKhan", highestFirst), await wait("attackKhan", highestFirst)]).toEqual([7, 3, 2])
    })

    test("a plugin with no commander says so and sends nothing, until the map gives it one", async () => {
        const { wait, status, remap } = pool(owners)
        const waiting = wait("attackStormForts")
        expect(await settled(waiting)).toBe("pending")
        expect(status("attackStormForts")).toEqual({ plugin: "attackStormForts", state: "waiting", reasonKey: "statusNoCommandersAssigned", params: {} })
        expect(en.statusNoCommandersAssigned).toBeTruthy()

        remap({ ...owners, attackStormForts: [15] })
        expect(await settled(waiting)).toBe(15)
        expect(status("attackStormForts")).toMatchObject({ state: "running", reasonKey: null })
    })

    test("commanders the account doesn't have are skipped, and the commander plugin's status names them", () => {
        const { status, take } = pool({ attackKhan: [3, 21, 22, 23], attackNomads: [30] }, { owned: 20 })
        expect(status("commander")).toEqual({ plugin: "commander", state: "running", reasonKey: "statusCommanderMapSkipped", params: { list: "21-23, 30" } })
        expect(en.statusCommanderMapSkipped).toContain("{{list}}")
        expect([take("attackKhan"), take("attackKhan")]).toEqual([3, undefined])
    })

    test("a plugin whose commanders the account doesn't have says which ones", async () => {
        const { wait, status } = pool({ attackKhan: [3], attackNomads: [30, 31] }, { owned: 20 })
        expect(await settled(wait("attackNomads"))).toBe("pending")
        expect(status("attackNomads")).toEqual({ plugin: "attackNomads", state: "waiting", reasonKey: "statusCommandersNotOwned", params: { list: "30-31" } })
        expect(en.statusCommandersNotOwned).toContain("{{list}}")
    })

    test("the commander plugin's status says how many commanders the map hands out", () => {
        expect(pool(owners).status("commander")).toEqual({ plugin: "commander", state: "running", reasonKey: "statusCommanderMapOn", params: { count: 6 } })
        expect(pool().status("commander")).toMatchObject({ reasonKey: "statusCommanderMapOff" })
    })

    test("a fortress waiting for a shared commander gets it before a baron that asked first", async () => {
        const { wait, freeCommander } = pool({ commanderBucketBaronsFortresses: [1] })
        expect(await wait("attackBarronsFirePeaks")).toBe(1)
        const baron = wait("attackBarronsGreatEmpire")
        const fortress = wait("attackFortressesFirePeaks")
        freeCommander(101)
        expect(await settled(fortress)).toBe(1)
        expect(await settled(baron)).toBe("pending")
    })
})

describe("a reserved commander", () => {
    const AUTO_STATION = "/plugins/autoStation.js"

    test("is a free one when there is one", () => {
        const { reserveCommander, takeFreeCommander } = pool({}, { owned: 1 })
        const held = []
        reserveCommander("1-50", AUTO_STATION, lord => held.push(lord.lordID))
        expect(held).toEqual([101])
        expect(takeFreeCommander("1-50")).toBeUndefined()
    })

    test("is the first to come home, ahead of an attack that was waiting for it", async () => {
        const { reserveCommander, wait, freeCommander } = pool({}, { owned: 1 })
        expect(await wait("attackKhan")).toBe(1)
        const attack = wait("attackKhan")
        const held = []
        reserveCommander("1-50", AUTO_STATION, lord => held.push(lord.lordID))
        freeCommander(101)
        expect(held).toEqual([101])
        expect(await settled(attack), "the attack keeps waiting").toBe("pending")

        freeCommander(101)
        expect(await settled(attack), "once the reservation lets go, the attack gets it").toBe(1)
    })

    test("called off before a commander comes home, takes none", async () => {
        const { reserveCommander, wait, freeCommander } = pool({}, { owned: 1 })
        expect(await wait("attackKhan")).toBe(1)
        const held = []
        const cancel = reserveCommander("1-50", AUTO_STATION, lord => held.push(lord.lordID))
        cancel()
        freeCommander(101)
        expect(held).toEqual([])
        expect(await wait("attackKhan")).toBe(1)
    })

    test("comes only from the commanders the map gives the plugin", async () => {
        const { reserveCommander, wait, freeCommander } = pool({ attackKhan: [1], autoStation: [2] }, { owned: 2 })
        expect([await wait("attackKhan"), await wait("autoStation")]).toEqual([1, 2])
        const held = []
        reserveCommander("1-50", AUTO_STATION, lord => held.push(lord.lordID))
        freeCommander(101)
        expect(held, "Khan's commander is not Auto Station's").toEqual([])
        freeCommander(102)
        expect(held).toEqual([102])
    })
})

describe("reading the map", () => {
    test("positions are 0-based, own and shared apart, and no map reads as undefined", () => {
        expect(assignedTo(mapOf({ attackKhan: [2], commanderBucketKhanNomads: [4] }), "attackKhan")).toEqual({ own: [1], shared: [3], first: false })
        expect(assignedTo(mapOf({ commanderBucketBaronsFortresses: [1] }), "attackFortressesFirePeaks")).toMatchObject({ shared: [0], first: true })
        expect(assignedTo([], "attackKhan")).toBeUndefined()
        expect(assignedTo(undefined, "attackKhan")).toBeUndefined()
    })

    test("commander numbers are written as ranges", () => {
        expect(writeRanges([3, 1, 2, 9, 12, 11])).toBe("1-3, 9, 11-12")
        expect(writeRanges([])).toBe("")
    })
})
