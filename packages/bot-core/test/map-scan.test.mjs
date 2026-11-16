import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { afterEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

const CAMP = 27
const instantLimiter = { RateLimiter: class { removeTokens = async () => 1 } }

/**
 * The real getAreaInfo and map scan against a game that answers every `gaa`
 * with the map objects inside the asked rectangle, which may be none.
 */
function game(objects, { mapGrid = false } = {}) {
    const bot = fakeBot()
    bot.botConfig.ggeConfig = { humanize: { map_grid: mapGrid } }
    const requests = []
    bot.sendXT = async (cmd, params) => {
        const req = JSON.parse(params)
        if (cmd != "gaa")
            return
        requests.push(req)
        const AI = objects.filter(([, x, y]) => x >= req.AX1 && x <= req.AX2 && y >= req.AY1 && y <= req.AY2)
        setImmediate(() => bot.xtHandler.emit("gaa", { KID: req.KID, AI }, 0))
    }
    const { getAreaInfo } = loadModule("protocols.js", { bot, extra: { limiter: instantLimiter } }).mod.ClientCommands
    const scan = loadModule("mapScan.js", { bot }).mod
    return { getAreaInfo, requests, ...scan }
}

const castle = { x: 600, y: 600 }
const isCamp = ai => ai.type == CAMP
const at = areas => areas.map(a => [a.x, a.y])
/** One camp on every 7th tile in both directions: 34,000 across the map, far more than any scan needs. */
const dense = () => {
    const camps = []
    for (let x = 3; x <= 1286; x += 7)
        for (let y = 3; y <= 1286; y += 7)
            camps.push([CAMP, x, y])
    return camps
}
const near = [[CAMP, 601, 602], [CAMP, 590, 610], [CAMP, 630, 575], [CAMP, 566, 566]]
/** Inside the 101×101 rectangle (550 to 650) but outside the 7×7 boxes (559 to 649). */
const beyondTheGrid = [CAMP, 555, 600]
const other = [1, 600, 601]

describe("with map_grid off", () => {
    test("a scan around the castle is one request for the 101×101 tiles around it", async () => {
        const { getAreaInfo, requests, areasAround } = game([...near, beyondTheGrid, other])
        const found = await areasAround(getAreaInfo, 0, castle, isCamp)

        expect(requests).toEqual([{ KID: 0, AX1: 550, AY1: 550, AX2: 650, AY2: 650 }])
        expect(at(found)).toEqual(at([...near, beyondTheGrid].map(([, x, y]) => ({ x, y }))))
    })

    test("a whole-map scan is 169 requests", async () => {
        const { getAreaInfo, requests, wholeMapRects } = game(dense())
        for (const rect of wholeMapRects(castle.x, castle.y))
            await getAreaInfo(0, rect.x, rect.y, rect.w, rect.h)

        expect(requests).toHaveLength(169)
        expect(requests[0]).toEqual({ KID: 0, AX1: 550, AY1: 550, AX2: 650, AY2: 650 })
    })
})

describe("with map_grid on", () => {
    test("a scan asks for at most 49 boxes of 13×13 tiles on the grid, nearest first", async () => {
        const { getAreaInfo, requests, scanGrid } = game([...near, beyondTheGrid, other], { mapGrid: true })
        await scanGrid(getAreaInfo, 0, castle, isCamp)

        expect(requests).toHaveLength(49)
        for (const req of requests) {
            expect([req.AX1 % 13, req.AY1 % 13]).toEqual([0, 0])
            expect([req.AX2 - req.AX1, req.AY2 - req.AY1]).toEqual([12, 12])
        }
        expect(requests[0]).toEqual({ KID: 0, AX1: 598, AY1: 598, AX2: 610, AY2: 610 })
        expect(Math.min(...requests.map(r => r.AX1))).toBe(598 - 3 * 13)
        expect(Math.max(...requests.map(r => r.AX2))).toBe(610 + 3 * 13)
        expect(new Set(requests.map(r => `${r.AX1}_${r.AY1}`)).size).toBe(49)
    })

    test("the scan finds every target inside its radius and none outside, though most boxes are empty", async () => {
        const { getAreaInfo, scanGrid } = game([...near, beyondTheGrid, other], { mapGrid: true })
        const found = await scanGrid(getAreaInfo, 0, castle, isCamp)

        expect(at(found).toSorted()).toEqual(near.map(([, x, y]) => [x, y]).toSorted())
    })

    test("the scan stops once it has 30 targets", async () => {
        const { getAreaInfo, requests, scanGrid, SCAN_TARGETS } = game(dense(), { mapGrid: true })
        const found = await scanGrid(getAreaInfo, 0, castle, isCamp)

        expect(SCAN_TARGETS).toBe(30)
        expect(found.length).toBeGreaterThanOrEqual(30)
        expect(requests.length).toBeLessThan(49)
        expect(found.length).toBeLessThan(30 + 4)
    })

    test("a second scan of the same boxes within a minute is answered from the cache", async () => {
        const { getAreaInfo, requests, scanGrid } = game(near, { mapGrid: true })
        const first = await scanGrid(getAreaInfo, 0, castle, isCamp)
        const second = await scanGrid(getAreaInfo, 0, castle, isCamp)

        expect(requests).toHaveLength(49)
        expect(at(second)).toEqual(at(first))
    })

    test("two scans at once share every box instead of asking twice", async () => {
        const { getAreaInfo, requests, scanGrid } = game(near, { mapGrid: true })
        const [a, b] = await Promise.all([scanGrid(getAreaInfo, 0, castle, isCamp), scanGrid(getAreaInfo, 0, castle, ai => ai.type == 1)])

        expect(requests).toHaveLength(49)
        expect(a).toHaveLength(near.length)
        expect(b).toHaveLength(0)
    })

    test("boxes off the map are skipped and boxes on its edge are cut to it", async () => {
        const { getAreaInfo, requests, scanGrid } = game([], { mapGrid: true })
        await scanGrid(getAreaInfo, 0, { x: 1286, y: 0 }, isCamp)

        expect(requests).toHaveLength(16)
        expect(Math.max(...requests.map(r => r.AX2))).toBe(1286)
        expect(Math.min(...requests.map(r => r.AY1))).toBe(0)
    })

    test("areasAround returns what the grid found", async () => {
        const { getAreaInfo, requests, areasAround } = game([...near, beyondTheGrid], { mapGrid: true })
        const found = await areasAround(getAreaInfo, 0, castle, isCamp)

        expect(requests).toHaveLength(49)
        expect(found).toHaveLength(near.length)
    })

    test("when the grid finds nothing, areasAround falls back to the one wide request", async () => {
        const { getAreaInfo, requests, areasAround } = game([beyondTheGrid], { mapGrid: true })
        const found = await areasAround(getAreaInfo, 0, castle, isCamp)

        expect(requests).toHaveLength(50)
        expect(requests.at(-1)).toEqual({ KID: 0, AX1: 550, AY1: 550, AX2: 650, AY2: 650 })
        expect(at(found)).toEqual([[555, 600]])
    })
})

describe("the attack plugins", () => {
    afterEach(() => vi.useRealTimers())

    const FORTRESS = 11, BARRON = 2
    const never = () => new Promise(() => {})

    /** A plugin with every commander free and nothing ready to hit, so only its scan talks to the game. */
    function loadPlugin(file, objects, mapGrid) {
        // The plugins' idle wait must not fire, or it would loop for the rest of the test run.
        vi.useFakeTimers({ toFake: ["setTimeout"] })
        const bot = fakeBot()
        bot.botConfig.ggeConfig = { humanize: { map_grid: mapGrid } }
        const requests = []
        const protocols = {
            KingdomID: {}, AreaType: { fortress: FORTRESS, barron: BARRON, externalKingdom: 12, mainCastle: 1 },
            castles: [{ kingdomID: 1, areaInfo: { type: 12, ...castle } }], movements: [], movementEvents: new EventEmitter(), resources: {},
            ClientCommands: {
                preSpyInfo: async () => {},
                getAreaInfo: async (kingdomID, x1, y1, x2, y2) => {
                    requests.push([x1, y1, x2, y2])
                    const now = Date.now()
                    return {
                        areaInfo: objects.filter(([, x, y]) => x >= x1 && x <= x2 && y >= y1 && y <= y2)
                            .map(([type, x, y]) => ({ type, x, y, extraData: [0, 0, 600], timeSinceRequest: now })),
                    }
                },
            },
        }
        const { mod } = loadModule(file, {
            bot,
            extra: {
                "protocols": protocols,
                "./attack": { waitToAttack: job => job(), getAttackInfo() {} },
                "./attack.js": { waitToAttack: job => job(), getAttackInfo() {} },
                "../commander": { waitForCommanderAvailable: async () => ({ lordID: 1, getEffects: () => ({}) }), freeCommander() {}, useCommander() {} },
                "../skips.js": { spendSkip() {}, haveEnoughSkips: () => false },
            },
        })
        return { run: mod, requests }
    }
    const settle = () => new Promise(resolve => setImmediate(resolve)).then(() => new Promise(resolve => setImmediate(resolve)))
    const wide = ([x1, , x2]) => x2 - x1 == 100
    const fortresses = [[FORTRESS, 620, 590], [FORTRESS, 900, 100]]

    test("the fortress scan asks for the whole map in 169 requests with map_grid off", async () => {
        const { run, requests } = loadPlugin("plugins/attack/sharedFortressAttackLogic.js", fortresses, false)
        run(1, 60, {})
        await settle()

        expect(requests).toHaveLength(169)
        expect(requests.every(([x1, y1, x2, y2]) => x2 - x1 > 12 && y2 - y1 > 12)).toBe(true)
    })

    test("the fortress scan asks for 49 grid boxes with map_grid on", async () => {
        const { run, requests } = loadPlugin("plugins/attack/sharedFortressAttackLogic.js", fortresses, true)
        run(1, 60, {})
        await settle()

        expect(requests).toHaveLength(49)
        expect(requests.every(([x1, y1, x2, y2]) => x2 - x1 == 12 && y2 - y1 == 12)).toBe(true)
    })

    test("a fortress grid scan that finds nothing is followed by the whole-map scan", async () => {
        const { run, requests } = loadPlugin("plugins/attack/sharedFortressAttackLogic.js", [fortresses[1]], true)
        run(1, 60, {})
        await settle()

        expect(requests).toHaveLength(49 + 169)
    })

    test("the robber baron scan is one wide request with map_grid off and 49 boxes with it on", async () => {
        const barons = [[BARRON, 605, 596], [BARRON, 640, 640]]
        const off = loadPlugin("plugins/attack/sharedBarronAttackLogic.js", barons, false)
        off.run(BARRON, 1, {}, 10)
        await settle()
        expect(off.requests).toEqual([[550, 550, 650, 650]])

        const on = loadPlugin("plugins/attack/sharedBarronAttackLogic.js", barons, true)
        on.run(BARRON, 1, {}, 10)
        await settle()
        expect(on.requests).toHaveLength(49)
        expect(on.requests.some(wide)).toBe(false)
    })
})
