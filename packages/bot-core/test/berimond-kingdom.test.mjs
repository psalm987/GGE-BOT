import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { berimondGame, CAMP, MAIN } = require("./harness/berimond-kingdom-game.cjs")
const { PluginFinished, PluginMemory, PluginStatus } = require("../actions.json")
const fixture = require("./fixtures/protocol/berimond-kingdom.json")

afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
})

const SECOND = 1000, MINUTE = 60 * SECOND
async function runFor(ms) {
    for (let t = 0; t < ms; t += 5 * SECOND)
        await vi.advanceTimersByTimeAsync(5 * SECOND)
}
const started = async options => {
    vi.useFakeTimers({ now: 1_800_000_000_000 })
    vi.spyOn(console, "debug").mockImplementation(() => {})
    const world = berimondGame(options)
    world.startEvent()
    return world
}
/** What the plugin sends: the bot's own periodic reads (castle list, defence, presets) are left out. */
const PLUGIN_COMMANDS = new Set(["ssi", "fnt", "aci", "cra", "fuc", "kut", "msk", "pep"])
const ours = bot => bot.sent.filter(([cmd]) => PLUGIN_COMMANDS.has(cmd))
const sent = (bot, cmd) => bot.sent.filter(([c]) => c == cmd).map(([, p]) => p)
const statuses = messages => messages.filter(([type]) => type == PluginStatus).map(([, s]) => s).filter(s => s.plugin == "berimondKingdom")
const lastStatus = messages => statuses(messages).at(-1)
const finished = messages => messages.filter(([type]) => type == PluginFinished).map(([, p]) => p)
const memoryWrites = (messages, key) => messages.filter(([type, p]) => type == PluginMemory && p.key == key).map(([, p]) => p.value)

describe("the Berimond Kingdom plugin", () => {
    test("looks at the first tower, opens the attack screen from the camp and attacks it with a full first wave", async () => {
        const { bot, game, messages } = await started({ freeSpace: 0 })

        await runFor(2 * MINUTE)

        const [look] = sent(bot, "ssi")
        expect(look).toEqual({ TX: 1409, TY: 110, KID: 10 })
        expect(sent(bot, "aci")[0]).toEqual({ SX: CAMP.x, SY: CAMP.y, TX: 1409, TY: 110, KID: 10 })
        const [cra] = game.attacks
        expect(Object.keys(cra).sort()).toEqual(Object.keys(fixture.cra_1.payload).sort())
        expect(cra).toMatchObject({ SX: CAMP.x, SY: CAMP.y, TX: 1409, TY: 110, KID: 10, LID: 3, AV: 1, AST: [-1, -1, -1] })
        expect(cra.RW).toEqual(Array.from({ length: 8 }, () => [-1, 0]))
        expect(cra.A).toHaveLength(1)
        const [wave] = cra.A
        expect([wave.L.U, wave.R.U, wave.M.U[0]]).toEqual([[[546, 52], [-1, 0]], [[546, 52], [-1, 0]], [546, 156]])
        expect(wave.L.T).toEqual([[614, 15], [651, 15]])
        expect(wave.M.T).toEqual([[614, 14], [649, 13], [651, 13]])
        expect(statuses(messages).find(s => s.reasonKey == "statusBerimondAttacking")).toMatchObject({ state: "running", params: { tower: "1409:110", attacks: 1, points: 2446751 } })
    })

    test("a tower that isn't ready waits at the back of the list, the next tower is attacked, and it is looked at again later", async () => {
        const { bot, game, messages } = await started({ freeSpace: 0, refuse: (cmd, p) => cmd == "aci" && p.TX == 1409 ? "COOLING_DOWN" : undefined })

        await runFor(3 * MINUTE)

        expect(game.attacks.map(a => `${a.TX}:${a.TY}`)[0]).toBe("1420:123")
        expect(memoryWrites(messages, "dropped").flat()).not.toContain("1409:110")
        expect(statuses(messages).map(s => s.reasonKey)).not.toContain("statusBerimondTwoRefusals")

        await runFor(6 * MINUTE)
        expect(sent(bot, "ssi").filter(p => p.TX == 1409).length).toBeGreaterThan(1)
    })

    test("a destroyed tower is dropped without counting as a refusal", async () => {
        const { game, messages } = await started({ freeSpace: 0, options: { berimondTower3: "1430:130" }, towers: { "1409:110": "gone", "1420:123": 55, "1430:130": 55 },
            refuse: (cmd, p) => cmd == "aci" && p.TX == 1420 ? "COOLING_DOWN" : undefined })

        await runFor(3 * MINUTE)

        expect(game.attacks.map(a => `${a.TX}:${a.TY}`)[0]).toBe("1430:130")
        expect(statuses(messages).map(s => s.reasonKey)).not.toContain("statusBerimondTwoRefusals")
    })

    test("two refusals in a row stop the plugin for the event", async () => {
        const { bot, game, messages } = await started({ freeSpace: 0, options: { berimondTower3: "1430:130" }, towers: { "1409:110": 55, "1420:123": 55, "1430:130": 55 },
            refuse: cmd => cmd == "cra" ? "FACTION_NPC_OBJECT_IS_PROTECTED" : undefined })

        await runFor(5 * MINUTE)

        expect(sent(bot, "cra").map(a => `${a.TX}:${a.TY}`)).toEqual(["1409:110", "1420:123"])
        expect(game.attacks).toEqual([])
        expect(lastStatus(messages)).toMatchObject({ state: "stopped", reasonKey: "statusBerimondTwoRefusals" })
        const after = ours(bot).length
        await runFor(30 * MINUTE)
        expect(ours(bot).length).toBe(after)
    })

    test("too many units cuts this commander's sides on the next attack, and the tower stays", async () => {
        let refusedOnce = false
        const { game } = await started({ freeSpace: 0, refuse: cmd => cmd == "cra" && !refusedOnce && (refusedOnce = true) ? "ATTACK_TOO_MANY_UNITS" : undefined })

        await runFor(3 * MINUTE)

        const [wave] = game.attacks[0].A
        expect(game.attacks[0].TX).toBe(1409)
        expect([wave.L.U[0][1], wave.M.U[0][1]]).toEqual([Math.floor(52 * 0.98) - 1, Math.floor(156 * 0.98) - 1])
    })

    test("refills the camp from the main castle with kut and skips the two-hour trip with msk", async () => {
        const { bot } = await started({ camp: [[546, 10]] })

        await runFor(3 * MINUTE)

        expect(sent(bot, "fuc")[0]).toEqual({ CID: CAMP.id })
        expect(sent(bot, "kut")).toEqual([{ SCID: MAIN, SKID: 0, TKID: 10, CID: -1, A: [[546, 185]] }])
        expect(sent(bot, "msk")).toEqual([{ MST: "MS5", KID: "10", TT: "1" }, { MST: "MS5", KID: "10", TT: "1" }])
        const dcl = bot.sent.findIndex(([cmd]) => cmd == "dcl"), kut = bot.sent.findIndex(([cmd]) => cmd == "kut")
        expect(dcl).toBeGreaterThan(-1)
        expect(dcl).toBeLessThan(kut)
    })

    test("a dry run looks at the towers and logs the attack and the transfer, sending neither", async () => {
        const logged = []
        vi.spyOn(console, "log").mockImplementation((...parts) => logged.push(parts[0]))
        const { bot, pool } = await started({ options: { dryRun: true } })

        await runFor(10 * MINUTE)

        expect(sent(bot, "ssi").length).toBeGreaterThan(0)
        for (const cmd of ["aci", "cra", "kut", "msk"])
            expect(sent(bot, cmd)).toEqual([])
        expect(logged).toContain("dryRunAttack")
        expect(logged).toContain("berimondDryRunKut")
        expect(pool.freed.length).toBe(pool.handedOut.length)
    })

    test("when event 3 stops it sends nothing more and asks to be switched off", async () => {
        const { bot, messages, stopEvent } = await started({ freeSpace: 0 })
        await runFor(2 * MINUTE)
        expect(sent(bot, "cra").length).toBeGreaterThan(0)

        stopEvent()
        await vi.advanceTimersByTimeAsync(0)
        const before = ours(bot).length
        await runFor(30 * MINUTE)

        expect(ours(bot).length).toBe(before)
        expect(finished(messages)).toEqual([{ plugin: "berimondKingdom", reason: "eventOver" }])
        expect(lastStatus(messages)).toMatchObject({ state: "stopped", reasonKey: "statusBerimondEventOver" })
    })

    test("an attack that would land after the event ends switches the plugin off", async () => {
        const { messages } = await started({ freeSpace: 0, refuse: cmd => cmd == "cra" ? "WONT_REACH_IN_TIME" : undefined })

        await runFor(2 * MINUTE)

        expect(finished(messages)).toEqual([{ plugin: "berimondKingdom", reason: "eventOver" }])
    })

    test("after a restart the towers dropped earlier this event stay dropped", async () => {
        const memory = { dropped: ["1409:110"], eventEndsAt: 1_800_000_000_000 + 86_400_000 }
        const { bot } = await started({ freeSpace: 0, memory })

        await runFor(2 * MINUTE)

        expect(sent(bot, "ssi").map(p => p.TX)).not.toContain(1409)
        expect(sent(bot, "cra")[0]).toMatchObject({ TX: 1420, TY: 123 })
    })

    test("with no tower listed it attacks the tower the game finds", async () => {
        const { bot } = await started({ freeSpace: 0, options: { berimondTower1: "", berimondTower2: "" } })

        await runFor(2 * MINUTE)

        expect(sent(bot, "fnt")[0]).toEqual({})
        expect(sent(bot, "cra")[0]).toMatchObject({ TX: 1409, TY: 110 })
    })

    test("does nothing before event 3 runs", async () => {
        vi.useFakeTimers({ now: 1_800_000_000_000 })
        const { bot, messages } = berimondGame()
        bot.events.emit("load")
        await runFor(10 * MINUTE)
        expect(ours(bot)).toEqual([])
        expect(lastStatus(messages)).toMatchObject({ state: "waiting", reasonKey: "statusBerimondWaitingForEvent" })
    })
})
