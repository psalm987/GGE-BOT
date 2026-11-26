import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { afterEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginStatus } = require("../actions.json")
const foreignLords = require("./fixtures/protocol/foreign-lords.json")
const bloodcrow = require("./fixtures/protocol/bloodcrow.json")
const costTables = require("./fixtures/protocol/cost-tables.json")
const dethroneFrames = require("./fixtures/protocol/dethrone-rae.json")
const battleReport = require("./fixtures/protocol/battle-report-bloodcrow.json")

afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
})

const EVENT = {
    attackForeign: { EID: foreignLords.pick_difficulty_sede.payload.EID, type: foreignLords.find_target_fnm.payload.T },
    attackBloodcrows: { EID: bloodcrow.pick_difficulty_sede.payload.EID, type: bloodcrow.find_target_fnm.payload.T },
}

/** The game's items, in the shape the downloaded items file has them. */
const items = {
    eventAutoScalingDifficulties: costTables.alienDifficulties_sede_EDID,
    rerollCosts: costTables.dethrone_rerollCosts_alien.map(row => ({
        type: "alien", rerollCount: String(row.rerollCount), c1Cost: String(row.exile_c1), c2Cost: String(row.fortify_c2),
        costGoldToken: String(row.exile_goldToken), costSilverToken: String(row.exile_silverToken), costSamuraiToken: String(row.exile_samuraiToken),
    })),
}

/** A camp as `gaa` describes it: area type, X, Y, then the `extraData` the fixture's AI shape lists. */
const camp = (x, y, { type = 21, level = 50, peace = 0, dethroned = 0 } = {}) =>
    ({ type, x, y, extraData: [level, 0, peace, 0, 0, 0, dethroned, -1] })

const unit = (wodID, amount, info) => ({ amount, unitInfo: { wodID, fightType: "0", ...info } })
const melee = (wodID, amount, info) => unit(wodID, amount, { role: "melee", meleeAttack: "10", foodSupply: "1", ...info })
const ranged = (wodID, amount, info) => unit(wodID, amount, { role: "ranged", rangeAttack: "10", foodSupply: "1", ...info })
const tool = (wodID, amount, bonus) => unit(wodID, amount, { toolCategory: "Basic", typ: "Attack", slotTypes: "1,2,9", ...bonus })
const banner = (wodID, amount, fameBonus) => unit(wodID, amount, { typ: "Attack", slotTypes: "1,2,9", fameBonus: String(fameBonus), canBeUsedToAttackNPC: "0" })
const LADDER = 614, RAM = 611, BUNDLE = 650, MANTLET = 615
const siegeTools = () => [
    tool(LADDER, 500, { wallBonus: "10" }),
    tool(RAM, 500, { gateBonus: "10", slotTypes: "1,9" }),
    tool(BUNDLE, 500, { moatBonus: "15" }),
    tool(MANTLET, 500, { defRangeBonus: "10" }),
]
const army = () => [melee(1, 5000), ranged(2, 5000), ...siegeTools()]

/**
 * Runs one glory plugin against a stand-in game. The real attack engine builds and sends the `cra`; the map,
 * the castle, the commanders and the game's replies are stood in for. `attacks` commanders are handed out, then
 * the event ends.
 */
async function glory(plugin, {
    options = {}, start = {}, camps = [camp(20, 20, { type: EVENT[plugin].type })], nextCamp, inventory = army(),
    player = {}, resources = {}, attacks = 1, points = 0, replies = {}, protection = { NS: 0, PMS: -1, PMT: 0 }, movements = [], onCommander,
} = {}) {
    const { EID } = EVENT[plugin]
    const bot = fakeBot()
    Object.assign(bot.playerInfo, { level: 70, rubies: 0, coin: 0 }, player)
    bot.botConfig.plugins[plugin] = options
    const statuses = []
    const parentPort = { postMessage: ([type, report]) => type == PluginStatus && statuses.push(report), on() {} }
    const castle = { id: 1, kingdomID: 0, areaInfo: { type: 1, x: 10, y: 10 }, unlockedHorses: [], unitInventory: inventory }
    const askedForArea = []
    const askedForNext = []

    const send = bot.sendXT
    bot.sendXT = async (cmd, params) => {
        await send(cmd, params)
        const payload = JSON.parse(params)
        const reply = replies[cmd] ? replies[cmd](payload, bot) : {
            cra: () => [{ AAM: { UM: { L: { VIS: 0 } }, M: { KID: 0, TA: [0, payload.TX, payload.TY], TT: 60, PT: 0 } } }, 0],
            pep: () => [{ EID, OR: [1, 1], OP: [points, 0] }, 0],
            uap: () => [{ KID: 0, ...protection }, 0],
            sede: () => [{}, 0],
            gas: () => [{ S: [] }, 0],
            rae: () => [{}, 0],
            dcl: () => [{}, 0],
        }[cmd]?.()
        if (reply)
            setImmediate(() => bot.xtHandler.emit(cmd, ...reply))
    }

    const engine = loadModule("plugins/attack/attack.js", { bot, extra: { protocols: { resources: {} } } }).mod
    let handedOut = 0
    loadModule(`plugins/attack/${plugin}.js`, {
        bot, items, parentPort,
        extra: {
            "protocols.js": {
                resources, movementEvents: new EventEmitter(), movements, castles: [castle], ClassTypes: {},
                AreaType: { mainCastle: 1, alienCastle: 21, bloodcrowCastle: 34 }, KingdomID: { greatEmpire: 0 },
                ClientCommands: {
                    getAreaInfo: async (...area) => { askedForArea.push(area); return { areaInfo: camps, result: 0 } },
                    getNextMapObject: async (...args) => { askedForNext.push(args); return nextCamp ? { areaInfo: nextCamp, result: 0 } : { result: 1 } },
                },
            },
            "./attack.js": { ...engine, waitToAttack: job => job() },
            "commander.js": {
                waitForCommanderAvailable: async () => {
                    onCommander?.(handedOut, bot)
                    if (handedOut++ >= attacks)
                        bot.events.emit("eventStop", { EID })
                    return { lordID: handedOut, getEffects: () => ({}) }
                },
                freeCommander() {}, useCommander() {},
            },
        },
    })
    const startedAt = statuses.length
    bot.events.emit("eventStart", { EID, EDID: 1, RS: 24 * 60 * 60, CRE: 1, RCKS: ["C1"], RCSC: 0, RCHC: 0, ...start })
    for (let i = 0; i < 400; i++)
        await new Promise(resolve => setImmediate(resolve))

    const sent = cmd => bot.sent.filter(([name]) => name == cmd).map(([, payload]) => payload)
    return { bot, resources, sent, statuses, startedAt, askedForArea, askedForNext, targets: () => sent("cra").map(cra => [cra.TX, cra.TY]) }
}

const logged = spy => spy.mock.calls.map(([key]) => key)

describe("outside the event", () => {
    test.each(["attackForeign", "attackBloodcrows"])("%s waits, saying no event is running", plugin => {
        const statuses = []
        const parentPort = { postMessage: ([type, report]) => type == PluginStatus && statuses.push(report), on() {} }
        loadModule(`plugins/attack/${plugin}.js`, {
            items, parentPort,
            extra: { "protocols.js": { AreaType: { alienCastle: 21, bloodcrowCastle: 34 }, KingdomID: { greatEmpire: 0 } }, "./attack.js": {}, "commander.js": {}, "mapScan.js": {} },
        })

        expect(statuses).toEqual([{ plugin, state: "waiting", reasonKey: "statusEventClosed", params: {} }])
    })

    test("when the event ends the plugin goes back to waiting", async () => {
        const { statuses } = await glory("attackForeign", { attacks: 1 })

        expect(statuses.at(-1)).toEqual({ plugin: "attackForeign", state: "waiting", reasonKey: "statusEventClosed", params: {} })
        expect(statuses.map(s => s.state)).toContain("running")
    })
})

describe("targets", () => {
    test("the nearest open camp goes first, then the rest in distance order, passing camps in peace mode or out of sight", async () => {
        const camps = [
            camp(40, 40),
            camp(14, 14),
            camp(11, 11, { peace: 1 }),
            { type: 21, x: 12, y: 12, extraData: [50] },
            camp(13, 13, { type: 1 }),
        ]

        const { targets } = await glory("attackForeign", { camps, attacks: 3 })

        expect(targets()).toEqual([[14, 14], [40, 40], [14, 14]])
    })

    test("the camps are searched around the castle in the Great Empire", async () => {
        const { askedForArea } = await glory("attackForeign")

        expect(askedForArea[0]).toEqual([0, 10 - 50, 10 - 50, 10 + 50, 10 + 50])
    })

    test("a camp the game says is cooling down is passed over for the next one", async () => {
        let first = true
        const { targets, statuses } = await glory("attackForeign", {
            camps: [camp(14, 14), camp(30, 30)], attacks: 2,
            replies: {
                cra: payload => {
                    if (first) {
                        first = false
                        return [{}, 95]
                    }
                    return [{ AAM: { UM: { L: { VIS: 0 } }, M: { KID: 0, TA: [0, payload.TX, payload.TY], TT: 60, PT: 0 } } }, 0]
                },
            },
        })

        expect(targets()).toEqual([[14, 14], [30, 30]])
        expect(statuses.map(s => s.state)).not.toContain("error")
    })

    test("with no camp in reach it asks the game for the next invasion camp, as the event dialog does", async () => {
        const { askedForNext, targets } = await glory("attackForeign", { camps: [], nextCamp: camp(90, 90) })

        expect(askedForNext[0]).toEqual([foreignLords.find_target_fnm.payload.T, foreignLords.find_target_fnm.payload.KID, foreignLords.find_target_fnm.payload.NID])
        expect(targets()).toEqual([[90, 90]])
    })

    test("Bloodcrows attack only their own camps", async () => {
        const { targets, askedForNext } = await glory("attackBloodcrows", {
            camps: [camp(12, 12, { type: 21 }), camp(30, 30, { type: 34 })],
        })

        expect(targets()).toEqual([[30, 30]])
        expect(askedForNext).toEqual([])
    })
})

describe("difficulty", () => {
    const sede = (EID, EDID, C2U) => ({ EID, EDID, C2U })

    test("'highest unlocked without rubies' picks the top free tier and never rents one, whatever the rubies", async () => {
        const { sent } = await glory("attackForeign", { options: { gloryDifficulty: 0 }, start: { EDID: -1 }, player: { rubies: 10_000_000 } })

        expect(sent("sede")).toEqual([sede(71, 4, 0)])
    })

    test("Bloodcrows use their own difficulty ids", async () => {
        const { sent } = await glory("attackBloodcrows", { options: { gloryDifficulty: 0 }, start: { EDID: -1 } })

        expect(sent("sede")).toEqual([sede(103, 104, 0)])
    })

    test("a free tier is picked as it is", async () => {
        const { sent } = await glory("attackForeign", { options: { gloryDifficulty: 2 }, start: { EDID: -1 } })

        expect(sent("sede")).toEqual([sede(71, 2, 0)])
    })

    test("a tier from 5 up is rented when the account can pay for it", async () => {
        const { sent, targets } = await glory("attackForeign", { options: { gloryDifficulty: 5 }, start: { EDID: -1 }, player: { rubies: 10_000 } })

        expect(sent("sede")).toEqual([sede(71, 5, 1)])
        expect(targets()).toHaveLength(1)
    })

    test("a rented tier the account can't pay for is refused, and nothing is sent", async () => {
        const { sent, statuses } = await glory("attackForeign", { options: { gloryDifficulty: 6 }, start: { EDID: -1 }, player: { rubies: 17_499 } })

        expect(sent("sede")).toEqual([])
        expect(sent("cra")).toEqual([])
        expect(statuses.at(-1)).toEqual({ plugin: "attackForeign", state: "stopped", reasonKey: "statusRentTooExpensive", params: { cost: 17500 } })
    })

    test("a difficulty already chosen for this event is kept", async () => {
        const { sent } = await glory("attackForeign", { options: { gloryDifficulty: 0 }, start: { EDID: 3 } })

        expect(sent("sede")).toEqual([])
    })
})

describe("score target", () => {
    test("a score already at the target when the event opens means no attack", async () => {
        const { sent, statuses } = await glory("attackForeign", { options: { scoreShutoff: 1000 }, points: 1200, attacks: 3 })

        expect(sent("pep")).toEqual([{ EID: 71 }])
        expect(sent("cra")).toEqual([])
        expect(statuses.at(-1)).toEqual({ plugin: "attackForeign", state: "stopped", reasonKey: "statusScoreReached", params: { score: 1200 } })
    })

    test("the plugin stops once the event score reaches the target", async () => {
        const { sent, statuses } = await glory("attackForeign", {
            options: { scoreShutoff: 1000 }, points: 900, attacks: 3,
            replies: {
                cra: (payload, bot) => {
                    setImmediate(() => bot.xtHandler.emit("pep", { EID: 71, OR: [1, 1], OP: [1000, 0] }, 0))
                    return [{ AAM: { UM: { L: { VIS: 0 } }, M: { KID: 0, TA: [0, payload.TX, payload.TY], TT: 60, PT: 0 } } }, 0]
                },
            },
        })

        expect(sent("cra")).toHaveLength(1)
        expect(statuses.at(-1)).toEqual({ plugin: "attackForeign", state: "stopped", reasonKey: "statusScoreReached", params: { score: 1000 } })
    })

    test("another event's score is not this one's", async () => {
        const { sent } = await glory("attackForeign", {
            options: { scoreShutoff: 1000 }, points: 0, attacks: 2,
            replies: {
                cra: (payload, bot) => {
                    setImmediate(() => bot.xtHandler.emit("pep", { EID: 103, OR: [1, 1], OP: [5000, 0] }, 0))
                    return [{ AAM: { UM: { L: { VIS: 0 } }, M: { KID: 0, TA: [0, payload.TX, payload.TY], TT: 60, PT: 0 } } }, 0]
                },
            },
        })

        expect(sent("cra")).toHaveLength(2)
    })

    test("0 as the score target means no limit", async () => {
        const { sent } = await glory("attackForeign", { options: { scoreShutoff: 0 }, points: 5_000_000, attacks: 2 })

        expect(sent("cra")).toHaveLength(2)
    })
})

describe("stopping before the event ends", () => {
    test("with less time left than the margin, nothing is sent", async () => {
        const { sent, statuses } = await glory("attackForeign", { options: { stopMinutesBefore: 30 }, start: { RS: 20 * 60 }, attacks: 3 })

        expect(sent("cra")).toEqual([])
        expect(statuses.at(-1)).toEqual({ plugin: "attackForeign", state: "stopped", reasonKey: "statusStopBeforeEnd", params: { minutes: 30 } })
    })

    test("the plugin stops once the event gets within the margin", async () => {
        vi.useFakeTimers({ toFake: ["Date"] })
        vi.setSystemTime(new Date("2026-11-17T12:00:00Z"))
        const { sent, statuses } = await glory("attackForeign", {
            options: { stopMinutesBefore: 30 }, start: { RS: 60 * 60 }, attacks: 3,
            onCommander: n => n == 1 && vi.setSystemTime(new Date("2026-11-17T12:31:00Z")),
        })

        expect(sent("cra")).toHaveLength(1)
        expect(statuses.at(-1)).toEqual({ plugin: "attackForeign", state: "stopped", reasonKey: "statusStopBeforeEnd", params: { minutes: 30 } })
    })

    test("the margin defaults to 30 minutes", async () => {
        const { sent } = await glory("attackForeign", { start: { RS: 29 * 60 } })

        expect(sent("cra")).toEqual([])
    })
})

describe("glory banners", () => {
    const empty = [-1, 0]
    // At camp level 50 a flank takes 30 tools in 2 slots and the front 40 in 3; one tooled wave leaves waves 2 to 4 for banners.
    const withBanners = options => glory("attackForeign", {
        options: { toolWaves: 1, ...options },
        inventory: [melee(1, 5000), ranged(2, 5000), ...siegeTools(), banner(661, 10, 2), banner(77, 10, 3), banner(660, 10, 1)],
    })
    const bannerSlots = cra => cra.A.slice(1).map(wave => [wave.L.T, wave.R.T, wave.M.T])

    test("lowest bonus first", async () => {
        const { sent } = await withBanners({ bannerOrder: 2 })

        expect(bannerSlots(sent("cra")[0])[0]).toEqual([[[660, 10], [661, 10]], [[77, 10], empty], [empty, empty, empty]])
    })

    test("highest bonus first", async () => {
        const { sent } = await withBanners({ bannerOrder: 1 })

        expect(bannerSlots(sent("cra")[0])[0]).toEqual([[[77, 10], [661, 10]], [[660, 10], empty], [empty, empty, empty]])
    })

    test("in the listed order, using only the listed banners", async () => {
        const { sent } = await withBanners({ bannerOrder: 0, bannerList: [661, 660] })

        expect(bannerSlots(sent("cra")[0])[0]).toEqual([[[661, 10], [660, 10]], [empty, empty], [empty, empty, empty]])
    })

    test("with no list, in the order the castle holds them", async () => {
        const { sent } = await withBanners({ bannerOrder: 0, bannerList: [] })

        expect(bannerSlots(sent("cra")[0])[0]).toEqual([[[661, 10], [77, 10]], [[660, 10], empty], [empty, empty, empty]])
    })

    test("the banners-per-attack cap counts across every wave", async () => {
        const { sent } = await withBanners({ bannerOrder: 1, bannersPerAttack: 15 })

        expect(bannerSlots(sent("cra")[0])).toEqual([
            [[[77, 10], [661, 5]], [empty, empty], [empty, empty, empty]],
            [[empty, empty], [empty, empty], [empty, empty, empty]],
            [[empty, empty], [empty, empty], [empty, empty, empty]],
        ])
    })

    test("banners that the game marks as not for NPC targets still go to invader camps", async () => {
        const { sent } = await withBanners({ bannerOrder: 2 })

        expect(bannerSlots(sent("cra")[0]).flat(2).filter(([wodID]) => wodID != -1).map(([wodID]) => wodID)).toEqual([660, 661, 77])
    })
})

describe("siege tools", () => {
    const frontTools = cra => cra.A.map(wave => wave.M.T.map(([wodID]) => wodID))

    test("tooled waves carry wall, gate and moat tools at the front, and the rest carry none", async () => {
        const { sent } = await glory("attackForeign", { options: { toolWaves: 2, waveTemplate: 0 } })

        expect(frontTools(sent("cra")[0])).toEqual([[LADDER, RAM, BUNDLE], [LADDER, RAM, BUNDLE], [-1, -1, -1], [-1, -1, -1]])
    })

    test("the mantlet template swaps the moat tool for a mantlet", async () => {
        const { sent } = await glory("attackForeign", { options: { toolWaves: 1, waveTemplate: 1 } })

        expect(frontTools(sent("cra")[0])[0]).toEqual([LADDER, RAM, MANTLET])
    })

    test("support tools fill AST from the list, skipping ones the castle lacks", async () => {
        const support = wodID => unit(wodID, 3, { typ: "Attack", toolCategory: "Combo", slotTypes: "9,10" })
        const { sent } = await glory("attackForeign", {
            options: { supportTools: [359, 400, 360, 361, 362] },
            inventory: [...army(), support(359), support(360), support(361), support(362)],
        })

        expect(sent("cra")[0].AST).toEqual([359, 360, 361])
    })
})

describe("soldiers", () => {
    const sentSoldiers = cra => [...cra.A.flatMap(wave => [wave.L.U, wave.M.U, wave.R.U]).flat(), ...cra.RW]
        .filter(([wodID]) => wodID != -1)

    test("'Mead only' leaves food soldiers at home", async () => {
        const { sent } = await glory("attackForeign", {
            options: { soldiers: 2 },
            inventory: [melee(1, 5000), melee(3, 5000, { foodSupply: undefined, meadSupply: "1" })],
        })

        expect(new Set(sentSoldiers(sent("cra")[0]).map(([wodID]) => wodID))).toEqual(new Set([3]))
    })

    test("the troops to keep at home stay home", async () => {
        const { sent } = await glory("attackForeign", {
            options: { minTroopsHome: 900 },
            inventory: [melee(1, 1000)],
        })

        const total = sentSoldiers(sent("cra")[0]).reduce((n, [, amount]) => n + amount, 0)
        expect(total).toBe(100)
    })

    test("too few soldiers above the troops kept home means no attack", async () => {
        const { sent } = await glory("attackForeign", { options: { minTroopsHome: 950 }, inventory: [melee(1, 1000)] })

        expect(sent("cra")).toEqual([])
    })
})

describe("dethrone", () => {
    const exile = { dethrone: 1, dethroneMaxEach: 100_000, dethroneMaxTotal: 1_000_000, dethroneKeep: 0 }
    const rae = (XPOS, YPOS, RCK) => ({ XPOS, YPOS, RCK })

    test("it is off unless turned on", async () => {
        const { sent } = await glory("attackForeign", { player: { coin: 1e9, rubies: 1e9 } })

        expect(sent("rae")).toEqual([])
    })

    test("allowed, a camp is exiled with coins before its first attack, as the client sends it", async () => {
        const { bot } = await glory("attackForeign", { options: exile, camps: [camp(110, 210)], player: { coin: 1e6 } })

        const frames = bot.sent.filter(([cmd]) => ["rae", "cra"].includes(cmd))
        expect(frames[0]).toEqual(["rae", dethroneFrames.exile_with_coins.payload])
        expect(frames[1][0]).toBe("cra")
    })

    test("Fortify pays in rubies", async () => {
        const { sent } = await glory("attackForeign", {
            options: { ...exile, dethrone: 2, dethroneMaxEach: 1200 }, camps: [camp(110, 210)], player: { rubies: 5000 },
        })

        expect(sent("rae")).toEqual([dethroneFrames.fortify_with_rubies.payload])
    })

    describe("with event tokens", () => {
        const tokens = { dethroneMaxEach: 100_000, dethroneMaxTotal: 1_000_000, dethroneKeep: 0 }
        const gold = { dethrone: 3, ...tokens }

        test("a gold token exile sends the event's key and pays the table's token cost", async () => {
            const { sent, resources } = await glory("attackForeign", {
                options: gold, camps: [camp(110, 210)], start: { RCKS: ["GTO", "STO", "ST"] }, resources: { goldToken: 1000 },
            })

            expect(sent("rae")).toEqual([rae(110, 210, "GTO")])
            expect(resources.goldToken).toBe(1000 - 80)
        })

        test.each([
            ["silver", 4, "STO", "silverToken", 300],
            ["samurai", 5, "ST", "samuraiToken", 100],
        ])("a %s token exile pays from its own balance", async (_, choice, key, field, cost) => {
            const { sent, resources } = await glory("attackForeign", {
                options: { ...tokens, dethrone: choice }, camps: [camp(110, 210)], start: { RCKS: ["GTO", "STO", "ST"] }, resources: { [field]: 5000, goldToken: 5000 },
            })

            expect(sent("rae")).toEqual([rae(110, 210, key)])
            expect(resources[field]).toBe(5000 - cost)
            expect(resources.goldToken).toBe(5000)
        })

        test.each([
            ["one exile would cost more than the cap", { dethroneMaxEach: 79 }, { goldToken: 1000 }],
            ["the account would drop below the tokens to keep", { dethroneKeep: 921 }, { goldToken: 1000 }],
            ["the account has no gold tokens", {}, {}],
        ])("refused when %s", async (_, caps, resources) => {
            const spy = vi.spyOn(console, "log").mockImplementation(() => {})
            const { sent } = await glory("attackForeign", { options: { ...gold, ...caps }, start: { RCKS: ["GTO"] }, resources })

            expect(sent("rae")).toEqual([])
            expect(sent("cra")).toHaveLength(1)
            expect(logged(spy)).toContain("gloryDethroneRefused")
        })

        test("an exile whose key the event doesn't list is refused once per camp, and the attack still goes", async () => {
            const spy = vi.spyOn(console, "log").mockImplementation(() => {})
            const { sent } = await glory("attackForeign", {
                options: gold, attacks: 2, start: { RCKS: ["C1", "STO"] }, resources: { goldToken: 1000 },
            })

            expect(sent("rae")).toEqual([])
            expect(sent("cra")).toHaveLength(2)
            expect(spy.mock.calls.filter(([key, , , reason]) => key == "gloryDethroneRefused" && reason == "gloryDethroneNotOffered")).toHaveLength(1)
        })

        test("coins are refused when the event's keys leave out C1", async () => {
            const { sent } = await glory("attackForeign", { options: exile, start: { RCKS: ["GTO"] }, player: { coin: 1e6 } })

            expect(sent("rae")).toEqual([])
            expect(sent("cra")).toHaveLength(1)
        })

        test("Fortify needs no key in the event's list", async () => {
            const { sent } = await glory("attackForeign", {
                options: { ...exile, dethrone: 2, dethroneMaxEach: 1200 }, start: { RCKS: ["GTO"] }, player: { rubies: 5000 },
            })

            expect(sent("rae")).toEqual([rae(20, 20, "C2")])
        })

        test("the server's count replaces ours: a push that resets it makes the next exile cost the first row again", async () => {
            const { sent, resources } = await glory("attackForeign", {
                options: gold, camps: [camp(14, 14), camp(30, 30)], attacks: 2, start: { RCKS: ["GTO"] }, resources: { goldToken: 1000 },
                onCommander: (handed, bot) => handed == 1 && bot.xtHandler.emit("rce", { RCSC: 0, RCHC: 0 }),
            })

            expect(sent("rae")).toHaveLength(2)
            expect(resources.goldToken).toBe(1000 - 80 - 80)
        })

        test("without a push our own count carries on, and a push of a higher count moves the cost up", async () => {
            const own = await glory("attackForeign", {
                options: gold, camps: [camp(14, 14), camp(30, 30)], attacks: 2, start: { RCKS: ["GTO"] }, resources: { goldToken: 1000 },
            })
            const pushed = await glory("attackForeign", {
                options: gold, camps: [camp(14, 14), camp(30, 30)], attacks: 2, start: { RCKS: ["GTO"] }, resources: { goldToken: 1000 },
                onCommander: (handed, bot) => handed == 1 && bot.xtHandler.emit("rce", { RCSC: 4, RCHC: 0 }),
            })

            expect(own.resources.goldToken).toBe(1000 - 80 - 160)
            expect(pushed.resources.goldToken).toBe(1000 - 80 - 640)
        })
    })

    test("a camp already dethroned is left as it is", async () => {
        const { sent } = await glory("attackForeign", { options: exile, camps: [camp(14, 14, { dethroned: 1 })], player: { coin: 1e6 } })

        expect(sent("rae")).toEqual([])
    })

    test("a camp an army of ours is heading to is not dethroned", async () => {
        const { sent } = await glory("attackForeign", {
            options: exile, camps: [camp(14, 14)], player: { coin: 1e6 },
            movements: [{ targetAttack: { x: 14, y: 14, type: 21 }, kingdomID: 0 }],
        })

        expect(sent("rae")).toEqual([])
    })

    test("below level 70 there is no dethrone", async () => {
        const { sent } = await glory("attackForeign", { options: exile, player: { coin: 1e6, level: 69 } })

        expect(sent("rae")).toEqual([])
    })

    test.each([
        ["no cap is set", { dethroneMaxEach: 0 }, { coin: 1e6 }, {}],
        ["one dethrone would cost more than the cap", { dethroneMaxEach: 47_999 }, { coin: 1e6 }, { RCSC: 1 }],
        ["the account would drop below the coins to keep", { dethroneKeep: 10_001 }, { coin: 34_000 }, {}],
    ])("refused when %s, and the attack still goes", async (_, caps, player, start) => {
        const spy = vi.spyOn(console, "log").mockImplementation(() => {})
        const { sent } = await glory("attackForeign", { options: { ...exile, ...caps }, player, start })

        expect(sent("rae")).toEqual([])
        expect(sent("cra")).toHaveLength(1)
        expect(logged(spy)).toContain("gloryDethroneRefused")
    })

    test("refused once the event's total would pass its cap: the cost grows with each dethrone", async () => {
        const { sent } = await glory("attackForeign", {
            options: { ...exile, dethroneMaxTotal: 50_000 }, camps: [camp(14, 14), camp(30, 30)], attacks: 2, player: { coin: 1e6 },
        })

        expect(sent("rae")).toEqual([rae(14, 14, "C1")])
        expect(sent("cra")).toHaveLength(2)
    })

    test("refused when the event doesn't allow dethroning", async () => {
        const { sent } = await glory("attackForeign", { options: exile, player: { coin: 1e6 }, start: { CRE: 0 } })

        expect(sent("rae")).toEqual([])
    })
})

describe("glory per hit", () => {
    const [report] = battleReport.sne_battle_report_push.payload.MSG
    const push = (header = report[2]) => [{ MSG: [[report[0], report[1], header, ...report.slice(3)]] }]
    const options = { player: { playerID: battleReport.playerID }, replies: { bls: () => [battleReport.bls_1.reply.payload, 0] } }
    const hearing = (...frames) => (handed, bot) => handed == 0 && frames.forEach(frame => bot.xtHandler.emit("sne", ...frame))

    test("a battle report on the plugin's own camps is read and logs its glory and the run's total", async () => {
        const spy = vi.spyOn(console, "log").mockImplementation(() => {})
        const { sent } = await glory("attackBloodcrows", { ...options, onCommander: hearing(push(), push()) })

        expect(sent("bls")).toEqual([battleReport.bls_1.payload, battleReport.bls_1.payload])
        expect(spy.mock.calls.filter(([key]) => key == "gloryHitGained")).toEqual([
            ["gloryHitGained", 8_681_411, " ", 8_681_411],
            ["gloryHitGained", 8_681_411, " ", 17_362_822],
        ])
    })

    test.each([
        ["another event's camps", "21+0+0#0+-701"],
        ["the same camps in another kingdom", "34+0+0#2+-1002"],
    ])("a report on %s is not read", async (_, header) => {
        const { sent } = await glory("attackBloodcrows", { ...options, onCommander: hearing(push(header)) })

        expect(sent("bls")).toEqual([])
    })

    test("a report the game refuses to give leaves the run attacking", async () => {
        const spy = vi.spyOn(console, "log").mockImplementation(() => {})
        const { sent } = await glory("attackBloodcrows", { ...options, replies: { bls: () => [{}, 1] }, attacks: 2, onCommander: hearing(push()) })

        expect(sent("bls")).toHaveLength(1)
        expect(sent("cra")).toHaveLength(2)
        expect(logged(spy)).not.toContain("gloryHitGained")
    })
})

describe("protection", () => {
    test("under beginner protection the plugin waits instead of attacking", async () => {
        const { sent, statuses } = await glory("attackForeign", { protection: { NS: 3600, PMS: -1, PMT: 0 } })

        expect(sent("uap")).toEqual([{ KID: 0 }])
        expect(sent("cra")).toEqual([])
        expect(statuses).toContainEqual({ plugin: "attackForeign", state: "waiting", reasonKey: "statusProtected", params: {} })
    })

    test("in peace mode the plugin waits instead of attacking", async () => {
        const { sent } = await glory("attackForeign", { protection: { NS: 0, PMS: 1, PMT: 86400 } })

        expect(sent("cra")).toEqual([])
    })

    test("with 'attack while under protection' on, it attacks anyway", async () => {
        const { sent } = await glory("attackForeign", { options: { attackUnderProtection: true }, protection: { NS: 3600, PMS: 1, PMT: 86400 } })

        expect(sent("uap")).toEqual([])
        expect(sent("cra")).toHaveLength(1)
    })
})

describe("dry run", () => {
    test("sends no cra and no rae, and logs what it would have sent", async () => {
        const spy = vi.spyOn(console, "log").mockImplementation(() => {})
        const { sent } = await glory("attackForeign", {
            options: { dryRun: true, dethrone: 1, dethroneMaxEach: 100_000, dethroneMaxTotal: 1_000_000 }, player: { coin: 1e6 }, attacks: 2,
        })

        expect(sent("cra")).toEqual([])
        expect(sent("rae")).toEqual([])
        expect(logged(spy).filter(key => key == "dryRunAttack")).toHaveLength(2)
        expect(logged(spy)).toContain("dryRunDethrone")
    })

    test("leaves the castle's troop counts as they were", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {})
        const inventory = army()
        await glory("attackForeign", { options: { dryRun: true }, inventory })

        expect(inventory.map(u => u.amount)).toEqual(army().map(u => u.amount))
    })
})

describe("logging", () => {
    test("each decision logs a translation key: target, dethrone cost, banners, attack and event points", async () => {
        const spy = vi.spyOn(console, "log").mockImplementation(() => {})
        vi.spyOn(console, "info").mockImplementation((...args) => spy(...args))
        await glory("attackForeign", {
            options: { dethrone: 1, dethroneMaxEach: 100_000, dethroneMaxTotal: 1_000_000, toolWaves: 1 },
            inventory: [...army(), banner(660, 10, 1)], player: { coin: 1e6 }, points: 40,
        })

        const en = require("../locales/en.json")
        const keys = logged(spy)
        for (const key of ["gloryTargetFound", "gloryDethroneCost", "gloryBannersUsed", "gloryAttackSent", "gloryEventPoints"]) {
            expect(keys).toContain(key)
            expect(en[key]).toBeTypeOf("string")
        }
    })
})

describe("unit order", () => {
    const mixed = () => [melee(1, 5000), melee(3, 5000, { meleeAttack: "50" }), ranged(2, 5000), ranged(4, 5000, { rangeAttack: "50" }), ...siegeTools()]
    const firstPicks = cra => ({ melee: cra.A[0].L.U[0][0], ranged: cra.A[0].M.U[0][0] })

    test("without one the troops go in the castle's order, as before", async () => {
        const { sent } = await glory("attackForeign", { inventory: mixed() })
        expect(firstPicks(sent("cra")[0])).toEqual({ melee: 1, ranged: 2 })
    })

    test("strongest first sends the strongest melee and ranged troops first", async () => {
        const { sent } = await glory("attackForeign", { options: { unitOrder: 2 }, inventory: mixed() })
        expect(firstPicks(sent("cra")[0])).toEqual({ melee: 3, ranged: 4 })
    })
})

describe("a wave plan", () => {
    const side = (tools, units) => ({ tools: Array(tools).fill(null), units: Array(units).fill(null) })
    const custom = () => ({ kind: "custom", left: side(2, 2), front: side(3, 6), right: side(2, 2) })
    const empty = { kind: "preset", preset: 0 }
    const plan = () => {
        const first = custom()
        first.left = { tools: [{ item: LADDER, amount: 10 }, null], units: [{ item: 2, amount: 40 }, null] }
        first.front.units[0] = { item: 1, amount: 9999 }
        return { kind: "manual", waves: [first, empty, empty, empty], ast: [null, null, null], rw: [{ item: 1, amount: 60 }, null, null, null, null, null, null, null] }
    }
    const banners = () => [...army(), banner(700, 500, 25)]

    test("is sent as written, with no banners or siege tools added", async () => {
        const { sent } = await glory("attackForeign", { options: { armyMode: "waves", waves: plan() }, inventory: banners() })
        const cra = sent("cra")[0]
        expect(cra.A[0].L).toEqual({ T: [[LADDER, 10], [-1, 0]], U: [[2, 40], [-1, 0]] })
        expect(cra.A[0].M.U[0]).toEqual([1, 154])
        expect(cra.A[0].R.T).toEqual([[-1, 0], [-1, 0]])
        expect(cra.A.slice(1).flatMap(wave => [wave.L, wave.M, wave.R]).flatMap(part => [...part.T, ...part.U]).every(([wodID]) => wodID == -1)).toBe(true)
        expect(cra.RW[0]).toEqual([1, 60])
    })

    test("with dry run it is logged and nothing is sent or taken", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {})
        const inventory = banners()
        const { sent } = await glory("attackForeign", { options: { armyMode: "waves", waves: plan(), dryRun: true }, inventory })
        expect(sent("cra")).toEqual([])
        const logged = log.mock.calls.find(([key]) => key == "dryRunAttack")
        expect(JSON.parse(logged[1]).A[0].L.U[0]).toEqual([2, 40])
        expect(inventory.find(unit => unit.unitInfo.wodID == 2).amount).toBe(5000)
    })

    test("that names an in-game preset the game doesn't list stops the run with the reason", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {})
        const waves = { ...plan(), waves: [{ kind: "preset", preset: 4 }, empty, empty, empty] }
        const { sent, statuses } = await glory("attackForeign", { options: { armyMode: "waves", waves } })
        expect(sent("cra")).toEqual([])
        expect(statuses.at(-1)).toEqual({ plugin: "attackForeign", state: "error", reasonKey: "statusArmyServerPreset", params: { preset: 4 } })
    })
})
