import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { BladeCoastStatus } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { bladeCoastGame, nodesOf } = require("./harness/blade-coast-game.cjs")
const { PluginFinished, PluginMemory, StatusUser } = require("../actions.json")

afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
})

const MINUTE = 60_000
/** Runs the bot's clock forward in half-minute steps, so every wait and reply in between happens. */
async function runFor(ms) {
    for (let t = 0; t < ms; t += 30_000)
        await vi.advanceTimersByTimeAsync(30_000)
}
const started = async options => {
    vi.useFakeTimers({ now: 1_800_000_000_000 })
    const world = bladeCoastGame(options)
    await world.startEvent()
    return world
}
/** What the plugin sent: the bot's own periodic reads of the castle list (dcl) and defence (dfc) are left out. */
const ours = bot => bot.sent.filter(([cmd]) => cmd != "dfc" && cmd != "dcl")
const commands = bot => ours(bot).map(([cmd]) => cmd)
const finished = messages => messages.filter(([type]) => type == PluginFinished).map(([, payload]) => payload)
const lastCard = messages => messages.filter(([type]) => type == StatusUser).at(-1)?.[1].bladeCoast

/** Requests that would spend rubies, boost a march or skip a cooldown, by what the game reads in them. */
const rubySpend = ([cmd, p]) => ["tkt", "sdc"].includes(cmd) || p.OC2 === 1 || p.PWR === 1 || p.SC === 1 || p.BT === 1 ||
    (cmd == "thm" && p.BT !== 2) || (cmd == "msm" && ![1, 2].includes(p.TT)) || (cmd == "ule" && p.C1 !== 0) || (cmd == "csc" && (p.PWR !== 0 || p.OC2 !== 0))

describe("the Blade Coast plugin", () => {
    test("plays all three maps through, never with rubies, and is done after the last Kraken", async () => {
        const { bot, game, messages } = await started()

        await runFor(12 * 60 * MINUTE)

        expect(game.closed).toEqual(new Set([22, 27]))
        for (const mid of [22, 27, 28])
            expect(game.camps.get(mid).won).toEqual(new Set(Object.values(nodesOf(mid))))
        expect(ours(bot).filter(([cmd]) => cmd == "csc").map(([, p]) => p)).toEqual([
            { ID: 29, PWR: 0, OC2: 0, SID: 22 }, { ID: 29, PWR: 0, OC2: 0, SID: 27 }, { ID: 29, PWR: 0, OC2: 0, SID: 28 },
        ])
        expect(new Set(commands(bot))).toEqual(new Set(["tmp", "csc", "sje", "jea", "ebu", "tut", "tai", "gas", "thm", "ule", "tfm"]))
        expect(ours(bot).filter(rubySpend)).toEqual([])
        expect(ours(bot).filter(([cmd]) => cmd == "thm").map(([, p]) => p.LID)).toEqual([-12, -12, -12, -12, -12, -12])
        expect(finished(messages)).toEqual([{ plugin: "bladeCoast", reason: "done" }])
        expect(lastCard(messages)).toBeUndefined()

        const after = ours(bot).length
        await runFor(3 * 60 * MINUTE)
        expect(ours(bot).length).toBe(after)
    })

    test("builds the camp in order, fills it, attacks one island at a time and pays the port in between", async () => {
        const { bot, messages } = await started()

        await runFor(90 * MINUTE)

        const map22 = ours(bot).filter(([cmd, p]) => cmd != "tmp" && cmd != "jea" && cmd != "gas" && (p.MID ?? p.SID ?? 22) == 22)
        const order = map22.map(([cmd, p]) => cmd == "ebu" ? `ebu ${p.WID}` : cmd == "thm" || cmd == "tai" ? `${cmd} ${p.NID}` : cmd)
        expect(order.slice(0, 12)).toEqual(["csc", "sje", "ebu 265", "ebu 263", "ebu 330", "tut", "tai 221", "thm 221", "ule", "tai 222", "thm 222", "tfm"])
        const tut = ours(bot).find(([cmd]) => cmd == "tut")[1]
        expect(tut).toEqual({ MID: 22, SCID: 1001, KID: 0, I: [[1, 349], [20, 1000], [21, 1000], [22, 1000]] })
        const card = messages.filter(([type]) => type == StatusUser).map(([, s]) => s.bladeCoast).find(c => c?.phase == "attackOut")
        expect(BladeCoastStatus.parse(card)).toMatchObject({ map: 22, nextIsland: { id: 221, kraken: false }, trips: [{ kind: "attack", island: 221, kraken: false }] })
    })

    test("a dry run reads the camp and logs each change instead of sending it; playing the logged requests by hand finishes the map", async () => {
        const logged = []
        vi.spyOn(console, "log").mockImplementation((...parts) => parts[0] == "bladeDryRun" && logged.push([parts[1], JSON.parse(parts[3])]))
        const { bot, game, answer } = await started({ options: { dryRun: true } })

        for (let minutes = 0; !game.closed.has(22) && minutes < 6 * 60; minutes++) {
            const before = logged.length
            await runFor(MINUTE)
            for (const [cmd, payload] of logged.slice(before))
                answer(cmd, payload)
        }

        expect(new Set(commands(bot))).toEqual(new Set(["tmp", "jea", "tai", "gas"]))
        const played = logged.map(([cmd, p]) => cmd == "ebu" ? `ebu ${p.WID}` : cmd)
        expect(played.slice(0, played.indexOf("tfm") + 1)).toEqual(["csc", "ebu 265", "ebu 263", "ebu 330", "tut", "thm", "ule", "thm", "tfm"])
        expect(game.camps.get(22).won).toEqual(new Set(Object.values(nodesOf(22))))
        expect(logged.filter(rubySpend)).toEqual([])
    })

    test("after a restart it remembers the maps closed this event and goes on with the next level", async () => {
        const memory = { closedMaps: [22], eventEndsAt: 1_800_000_000_000 + 3 * 86_400_000 }
        const won22 = new Set(Object.values(nodesOf(22)))
        const { bot, messages } = await started({ memory, camps: { 22: { won: won22 } } })

        await runFor(5 * MINUTE)

        expect(commands(bot)).not.toContain("tfm")
        expect(ours(bot).filter(([cmd]) => cmd == "tmp").map(([, p]) => p.MID)).not.toContain(22)
        expect(ours(bot).find(([cmd]) => cmd == "csc")[1]).toMatchObject({ SID: 27 })
        expect(messages).toContainEqual([PluginMemory, { plugin: "bladeCoast", key: "closedMaps", value: [22] }])
    })

    test("memory from an earlier event is forgotten: the finished map is closed again", async () => {
        const memory = { closedMaps: [22, 27], eventEndsAt: 1_800_000_000_000 - 86_400_000 }
        const { bot, messages } = await started({ memory, camps: { 22: { won: new Set(Object.values(nodesOf(22))) } } })

        await runFor(5 * MINUTE)

        expect(ours(bot).filter(([cmd]) => cmd == "tfm")).toEqual([["tfm", { MID: 22 }]])
        expect(messages).toContainEqual([PluginMemory, { plugin: "bladeCoast", key: "closedMaps", value: [] }])
        expect(messages).toContainEqual([PluginMemory, { plugin: "bladeCoast", key: "closedMaps", value: [22] }])
    })

    test("with the last Kraken beaten it says it is done and sends nothing more", async () => {
        const memory = { closedMaps: [22, 27], eventEndsAt: 1_800_000_000_000 + 86_400_000 }
        const { bot, messages } = await started({ memory, camps: { 28: { won: new Set(Object.values(nodesOf(28))) } } })

        await runFor(5 * MINUTE)

        expect(finished(messages)).toEqual([{ plugin: "bladeCoast", reason: "done" }])
        expect(ours(bot)).toEqual([["tmp", { MID: 28 }]])
        await runFor(60 * MINUTE)
        expect(ours(bot)).toHaveLength(1)
    })

    test("when event 4 stops it clears its card and sends nothing more", async () => {
        const { bot, messages, stopEvent } = await started()
        await runFor(10 * MINUTE)
        expect(commands(bot)).toContain("csc")
        expect(lastCard(messages)).toMatchObject({ map: 22 })

        stopEvent()
        await vi.advanceTimersByTimeAsync(0)
        const sent = ours(bot).length

        await runFor(2 * 60 * MINUTE)
        expect(ours(bot).length).toBe(sent)
        expect(lastCard(messages)).toBeUndefined()
    })

    test("does nothing before event 4 runs, and nothing at all when the setup has no castle", async () => {
        vi.useFakeTimers({ now: 1_800_000_000_000 })
        const idle = bladeCoastGame()
        idle.bot.events.emit("load")
        await runFor(30 * MINUTE)
        expect(ours(idle.bot)).toEqual([])

        const unset = bladeCoastGame({ options: { bladeSetup: null } })
        await unset.startEvent()
        await runFor(30 * MINUTE)
        expect(ours(unset.bot)).toEqual([])
    })
})
