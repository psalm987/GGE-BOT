import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginStatus } = require("../actions.json")
const en = require("../locales/en.json")

const MINUTE = 60_000

afterEach(() => vi.useRealTimers())

const tool = (wodID, type, extra = {}) => ({ wodID, type, name: "Workshop", level: 1, buildingLevel: 1, ...extra })
const units = [
    tool(611, "Ram", { costWood: 56, costStone: 24 }),
    tool(614, "Ladder", { costWood: 28, costStone: 12 }),
    tool(245, "SceatGate", { costComponent1: 12, costComponent6: 8, upgradeWodID: 246 }),
    tool(246, "SceatGate", { level: 2, costComponent1: 12, costComponent6: 8, downgradeWodID: 245, upgradeWodID: 247, buildingLevel: 2 }),
    tool(247, "SceatGate", { level: 3, costComponent1: 12, costComponent6: 8, downgradeWodID: 246, buildingLevel: 4 }),
    { wodID: 637, type: "DefenceRocks", name: "Dworkshop", level: 1, buildingLevel: 1, costWood: 40, costStone: 94 },
    { wodID: 10, type: "Soldier", role: "melee" },
]
const sceatSkills = [
    { skillID: 169, effects: "46&246,84&245" },
    { skillID: 170, effects: "46&247,84&246,84&245" },
]

const currencies = [["CO1", "Component1"], ["CO6", "Component6"]].map(([JSONKey, Name]) => ({ JSONKey, Name }))

const WORKSHOP_LEVEL = { 1: 165, 2: 166, 3: 167, 4: 256 }
const DEFENCE_WORKSHOP = 176

/** A castle as the game reports it. `workshop` is the siege workshop's level, `defence` whether there is a defence workshop. */
const castle = (id, { kingdom = 0, wood = 100_000, stone = 100_000, workshop = 4, defence = false, tools = {}, queue = [], slots = 5, seconds = 0, spl } = {}) =>
    ({ id, kingdom, wood, stone, workshop, defence, tools, queue, slots, seconds, spl })

/**
 * The plugin against a game that answers dcl, jca, spl, skl and bup from `world`. `skills` is the answer to skl,
 * or null for a game that stays silent.
 */
function run({ options = {}, world = [castle(10)], skills = [], movements = [], items = {}, refuse = () => 0, components = { CO1: 100_000, CO6: 100_000 } } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.playerInfo.playerID = 7
    bot.botConfig.plugins.toolsmith = { state: true, ...options }
    const sentAt = []
    const logs = []
    const reports = []
    const reply = (cmd, body, result = 0) => setTimeout(() => bot.xtHandler.emit(cmd, body, result), 100)
    const find = params => world.find(c => c.id == (params.CID ?? params.AID))
    const inventory = c => Object.entries(c.tools).map(([wodID, amount]) => [Number(wodID), amount])
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        bot.sent.push([cmd, p])
        sentAt.push(Date.now())
        if (cmd == "dcl")
            reply("dcl", { C: [...new Set(world.map(c => c.kingdom))].map(KID => ({ KID, AI: world.filter(c => c.kingdom == KID).map(c => ({ AID: c.id, W: c.wood, S: c.stone, AC: inventory(c), WS: c.workshop ? 1 : 0, DW: c.defence ? 1 : 0 })) })) })
        if (cmd == "jca") {
            const c = find(p)
            world.forEach(w => { w.current = w === c })
            const buildings = [...(c.workshop ? [[WORKSHOP_LEVEL[c.workshop]]] : []), ...(c.defence ? [[DEFENCE_WORKSHOP]] : [])].map(([wodID]) => [wodID, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
            reply("jaa", { KID: c.kingdom, grc: { KID: c.kingdom, AID: c.id, W: c.wood, S: c.stone, AC: inventory(c), WS: c.workshop ? 1 : 0, DW: c.defence ? 1 : 0, gca: { BD: buildings } }, gca: { BD: buildings, scl: { OIDL: [] } }, gpa: {} })
        }
        if (cmd == "spl") {
            const c = world.find(w => w.current)
            reply("spl", c.spl ?? { LID: 1, TCT: c.seconds, QS: [...c.queue.map(([WID, AMT]) => ({ P: { WID, AMT }, SI: { RUT: 1 } })), ...Array.from({ length: c.slots - c.queue.length }, () => ({ SI: { RUT: 1 } }))] })
        }
        if (cmd == "skl")
            skills !== null && reply("skl", { SIDS: skills })
        if (cmd == "bup") {
            const c = find(p)
            if (refuse(p))
                return reply("bup", {}, refuse(p))
            c.queue.push([p.WID, p.AMT])
            reply("bup", {})
        }
    }
    const parentPort = { postMessage: message => message[0] == PluginStatus && reports.push(message[1]), on() {} }
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    loadModule("plugins/toolsmith.js", { bot, parentPort, items: { units, sceatSkills, currencies, ...items } })
    bot.events.emit("load")
    bot.xtHandler.emit("sce", Object.entries(components), 0)
    for (const movement of movements)
        bot.xtHandler.emit("gam", movement, 0)
    const bups = () => bot.sent.filter(([cmd]) => cmd == "bup").map(([, p]) => p)
    const status = () => reports.at(-1)
    return { bot, bups, status, logs, reports, world, sentAt }
}

const ladders = (stock, extra = {}) => ({ targets: [{ tool: 614, stock }], ...extra })

describe("the catalog entry", () => {
    test("is accepted by the API and offers targets, a resource floor and a dry run", () => {
        const { mod } = loadModule("plugins/toolsmith.js", { mainThread: true })
        const entry = { key: "toolsmith", force: Boolean(mod.force), hidden: Boolean(mod.hidden), options: mod.pluginOptions, checks: mod.checks }
        expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
        expect(mod.pluginOptions.map(o => o.key)).toEqual(["targets", "castleTargets", "resourceFloor", "dryRunOrders"])
    })

    test.each(["toolsmith", "targets", "castleTargets", "resourceFloor", "dryRunOrders", "toolsmithRefused", "dryRunBup", "toolsmithQueueUnknown", "stockQueueUnknown"])("en.json names %s", key => {
        expect(en[key]).toEqual(expect.any(String))
    })

    test("every status key it reports is in en.json", () => {
        for (const key of ["Starting", "NoTargets", "NoWorkshop", "LevelLocked", "NoResources", "QueueFull", "TargetsMet", "Queued", "NoAnswer", "QueueUnknown"])
            expect(en[`statusToolsmith${key}`]).toEqual(expect.any(String))
    })
})

describe("filling the queue", () => {
    test("queues orders of at most 80 until the stock reaches the target, and no further", async () => {
        const { bups } = run({ options: ladders(200), world: [castle(10, { tools: { 614: 50 } })] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups()).toEqual([
            { LID: 1, WID: 614, AMT: 80, PO: -1, PWR: 0, SK: 73, SID: 0, AID: 10 },
            { LID: 1, WID: 614, AMT: 70, PO: -1, PWR: 0, SK: 73, SID: 0, AID: 10 },
        ])
    })

    test("a second run counts what the first queued and sends nothing more", async () => {
        const { bups, status } = run({ options: ladders(200), world: [castle(10, { tools: { 614: 50 } })] })
        await vi.advanceTimersByTimeAsync(4 * 60 * MINUTE)
        expect(bups()).toHaveLength(2)
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusToolsmithTargetsMet" })
    })

    test("stops at the free slots and finishes the rest after the queue has moved", async () => {
        const world = [castle(10, { slots: 2, seconds: 900 })]
        const { bups, status } = run({ options: ladders(400), world })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(bups().map(p => p.AMT)).toEqual([80, 80])
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusToolsmithQueued", params: { orders: 2, tools: 160 } })

        world[0].queue.length = 0
        world[0].tools[614] = 160
        await vi.advanceTimersByTimeAsync(30 * MINUTE)
        expect(bups().map(p => p.AMT)).toEqual([80, 80, 80, 80])
    })

    test("runs again when the queue time is up, not before", async () => {
        const world = [castle(10, { slots: 1, seconds: 3600 })]
        const { bot, sentAt } = run({ options: ladders(1000), world })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        const first = sentAt.filter((_, i) => bot.sent[i][0] == "spl")
        expect(first).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(45 * MINUTE)
        expect(bot.sent.filter(([cmd]) => cmd == "spl")).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(30 * MINUTE)
        expect(bot.sent.filter(([cmd]) => cmd == "spl")).toHaveLength(2)
    })

    test("never unlocks a queue slot, which costs rubies, and every order is paid with resources", async () => {
        const { bot, bups } = run({ options: ladders(1000), world: [castle(10, { slots: 0 })] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bot.sent.map(([cmd]) => cmd)).not.toContain("ups")
        expect(bups()).toEqual([])
    })

    test("builds with the workshops of every castle that has one, a castle's own queue each", async () => {
        const world = [castle(10, { slots: 1 }), castle(11, { kingdom: 1 }), castle(12, { workshop: 0 })]
        const { bups } = run({ options: ladders(120), world })
        await vi.advanceTimersByTimeAsync(30 * MINUTE)
        expect(bups().map(p => [p.SID, p.AID, p.AMT])).toEqual([[0, 10, 80], [1, 11, 40]])
    })
})

describe("a queue it can't read", () => {
    const slot = P => ({ P, SI: { RUT: 1 } })
    const free = { SI: { RUT: 1 } }

    test.each([
        ["an occupied slot whose order has an unknown shape", { QS: [slot({ X: 1 }), free, free] }],
        ["a reply with no QS", { LID: 1, TCT: 0 }],
    ])("with %s, nothing is queued there and the status says so", async (_name, spl) => {
        const { bups, status, bot } = run({ options: ladders(1000), world: [castle(10, { spl })] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups()).toEqual([])
        expect(bot.sent.map(([cmd]) => cmd)).not.toContain("ups")
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusToolsmithQueueUnknown", params: { tool: "Ladder" } })
    })

    test("a castle whose queue is unknown doesn't stop the others", async () => {
        const world = [castle(10, { spl: { QS: [slot({ X: 1 })] } }), castle(11, { kingdom: 1 })]
        const { bups } = run({ options: ladders(80), world })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups().map(p => p.AID)).toEqual([11])
    })

    test("is logged with a key", async () => {
        const warn = []
        const { bot } = run({ options: ladders(80), world: [castle(10, { spl: { LID: 1 } })] })
        console.warn.mockImplementation((...args) => warn.push(args[0]))
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(warn).toContain("toolsmithQueueUnknown")
        expect(bot).toBeDefined()
    })

    test("the order in production (PS) counts as queued", async () => {
        const spl = { QS: [free, free], PS: { WID: 614, AMT: 70 }, TCT: 7200 }
        const { bups } = run({ options: ladders(100), world: [castle(10, { spl })] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups().map(p => p.AMT)).toEqual([30])
    })
})

describe("what counts as stock", () => {
    test("tools at home, queued and travelling with an attack are all counted against the target", async () => {
        const march = { M: [{ M: { MID: 5, T: 0, KID: 0, OID: 7, SID: 7, TID: 3, TT: 3600, PT: 0, TA: [1, 0, 0, 99, 0, 0, 0, 0, 0, 0, "Camp"], SA: [1, 0, 0, 10, 0, 0, 0, 0, 0, 0, "Keep"] }, GA: { L: [[614, 20]], M: [], R: [], RW: [] } }], O: [] }
        const { bups } = run({
            options: ladders(150),
            world: [castle(10, { tools: { 614: 50 }, queue: [[614, 30]] })],
            movements: [march],
        })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups().map(p => p.AMT)).toEqual([50])
    })

    test("another player's marches are not counted", async () => {
        const march = { M: [{ M: { MID: 5, T: 0, KID: 0, OID: 3, SID: 3, TID: 8, TT: 3600, PT: 0, TA: [1, 0, 0, 99, 0, 0, 0, 0, 0, 0, "Camp"], SA: [1, 0, 0, 10, 0, 0, 0, 0, 0, 0, "Keep"] }, GA: { L: [[614, 500]], M: [], R: [], RW: [] } }], O: [] }
        const { bups } = run({ options: ladders(100), world: [castle(10)], movements: [march] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups().map(p => p.AMT)).toEqual([80, 20])
    })

    test("a castle target counts only that castle", async () => {
        const world = [castle(10, { tools: { 614: 90 } }), castle(11, { tools: { 614: 10 } })]
        const { bups } = run({ options: { castleTargets: [{ castle: { kingdom: 0, id: 11 }, tool: 614, stock: 60 }] }, world })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups().map(p => [p.AID, p.AMT])).toEqual([[11, 50]])
    })
})

describe("spending", () => {
    test("keeps the resource floor: the order is as big as what's left above it pays for", async () => {
        const { bups } = run({ options: ladders(1000, { resourceFloor: 300 }), world: [castle(10, { wood: 1000, stone: 500, slots: 1 })] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups().map(p => p.AMT)).toEqual([16])
    })

    test("queues nothing when the floor leaves nothing to spend", async () => {
        const { bups, status } = run({ options: ladders(1000, { resourceFloor: 700 }), world: [castle(10, { wood: 1000, stone: 500 })] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusToolsmithNoResources", params: { tool: "Ladder" } })
    })

    test("pays for each order out of what the one before left", async () => {
        const { bups } = run({ options: ladders(1000), world: [castle(10, { wood: 28 * 100, stone: 12 * 100 })] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups().map(p => p.AMT)).toEqual([80, 20])
    })

    test("a Sceat tool is paid with the account's components, which the floor also protects", async () => {
        const chain = { targets: [{ tool: 245, stock: 1000 }], resourceFloor: 40 }
        const { bups } = run({ options: chain, components: { CO1: 12 * 5 + 40, CO6: 8 * 9 + 40 } })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups().map(p => [p.WID, p.AMT])).toEqual([[245, 5]])
    })

    test("a game that says it lacks the resources ends the castle's run and is reported", async () => {
        const { bups, status } = run({ options: ladders(1000), world: [castle(10)], refuse: () => 10 })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups()).toHaveLength(1)
        expect(status()).toMatchObject({ reasonKey: "statusToolsmithNoResources" })
    })
})

describe("levels", () => {
    const chain = { targets: [{ tool: 245, stock: 80 }] }

    test("builds the highest level the player's Sceat skills unlock", async () => {
        const { bups } = run({ options: chain, skills: [169] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups().map(p => p.WID)).toEqual([246])
    })

    test("builds the first level when no skill unlocks a higher one", async () => {
        const { bups } = run({ options: chain, skills: [] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups().map(p => p.WID)).toEqual([245])
    })

    test("a skill that turns a level off takes it out", async () => {
        const { bups } = run({ options: chain, skills: [169, 170] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups().map(p => p.WID)).toEqual([247])
    })

    test("without skill data, builds the highest level the workshop offers", async () => {
        const { bups } = run({ options: chain, skills: null, world: [castle(10, { workshop: 2 })] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups().map(p => p.WID)).toEqual([246])
    })

    test("a level the workshop is too low for is not built, and the status says so", async () => {
        const { bups, status } = run({ options: { targets: [{ tool: 247, stock: 80 }] }, skills: [169, 170], world: [castle(10, { workshop: 2 })] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusToolsmithLevelLocked" })
    })

    test("counts the stock of the level it builds", async () => {
        const { bups } = run({ options: chain, skills: [169], world: [castle(10, { tools: { 245: 500, 246: 30 } })] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups().map(p => [p.WID, p.AMT])).toEqual([[246, 50]])
    })
})

describe("the status", () => {
    test.each([
        ["no target is set", {}, [castle(10)], "statusToolsmithNoTargets"],
        ["no castle has the workshop", ladders(100), [castle(10, { workshop: 0 })], "statusToolsmithNoWorkshop"],
        ["the tool's workshop is missing", { targets: [{ tool: 637, stock: 100 }] }, [castle(10)], "statusToolsmithNoWorkshop"],
        ["the queue is full", ladders(100), [castle(10, { slots: 1, queue: [[611, 80]] })], "statusToolsmithQueueFull"],
        ["the target is met", ladders(100), [castle(10, { tools: { 614: 100 } })], "statusToolsmithTargetsMet"],
    ])("when %s it says so", async (_name, options, world, reasonKey) => {
        const { status, bups } = run({ options, world })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(status()).toMatchObject({ state: "waiting", reasonKey })
        expect(bups()).toEqual([])
    })

    test("a defence tool is built in the defence workshop", async () => {
        const { bups } = run({ options: { targets: [{ tool: 637, stock: 100 }] }, world: [castle(10, { defence: true })] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups().map(p => [p.WID, p.AMT])).toEqual([[637, 80], [637, 20]])
    })
})

describe("dry run", () => {
    test("logs the order it would send and sends none", async () => {
        const { bups, logs, status } = run({ options: ladders(100, { dryRunOrders: true }), world: [castle(10, { tools: { 614: 20 } })] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bups()).toEqual([])
        expect(logs.map(([key, json]) => [key, JSON.parse(json)])).toEqual([
            ["dryRunBup", { LID: 1, WID: 614, AMT: 80, PO: -1, PWR: 0, SK: 73, SID: 0, AID: 10 }],
        ])
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusToolsmithQueued" })
    })
})

test("unload stops it", async () => {
    const { bot, bups } = run({ options: ladders(1000), world: [castle(10, { slots: 1, seconds: 600 })] })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(bups()).toHaveLength(1)
    bot.events.emit("unload")
    await vi.advanceTimersByTimeAsync(5 * 60 * MINUTE)
    expect(bups()).toHaveLength(1)
})
