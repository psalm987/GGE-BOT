import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { reportCleaner, createReportCleanup } = require("../reportCleanup.js")

/** A `cra` reply's movement as the game sent it for a baron attack (gge-trace-20261122-000542-92f4e2), time to impact 163 s. */
const march = (overrides = {}) => ({
    MID: 436017975, T: 0, TA: [27, 695, 528, 70, 0, -1795306049, 0, -601, 991, 200, 160, 40], TID: -601, OID: 2190967,
    PT: 0, TT: 163, KID: 0, ...overrides,
})
/** A `sne` message as the game sent it: `[id, type, header, subject, ...]`. */
const report = (header, id = 324177420, type = 6) => [id, type, header, "", -1, 0, 0, 0, 0]
const WON = "27+0+0#0+-601", LOST = "27+0+2#0+-601"
const SECOND = 1000

test("a won attack's report is deleted when it comes with the landing", () => {
    let now = 1_000_000
    const cleaner = reportCleaner(() => now)
    cleaner.track(march())
    now += 163 * SECOND - 4 * SECOND
    expect(cleaner.judge(report(WON))).toBe("delete")
})

test("a lost attack's report is kept, and it uses up its attack so the next report is not taken for it", () => {
    let now = 0
    const cleaner = reportCleaner(() => now)
    cleaner.track(march())
    now = 163 * SECOND
    expect(cleaner.judge(report(LOST))).toBe("keep")
    expect(cleaner.judge(report(WON, 324177440))).toBeUndefined()
})

test("a report of the same kind of target that no attack of this plugin explains is left alone", () => {
    let now = 0
    const cleaner = reportCleaner(() => now)
    cleaner.track(march())
    now = 163 * SECOND
    expect(cleaner.judge(report("27+0+0#0+-602"))).toBeUndefined()
    expect(cleaner.judge(report("28+0+0#0+-601"))).toBeUndefined()
    expect(cleaner.judge(report(WON))).toBe("delete")
    expect(cleaner.judge(report(WON, 324177441)), "one attack, one report").toBeUndefined()
})

test("a report in another kingdom is not this attack's", () => {
    let now = 0
    const cleaner = reportCleaner(() => now)
    cleaner.track(march({ KID: 2 }))
    now = 163 * SECOND
    expect(cleaner.judge(report(WON))).toBeUndefined()
    expect(cleaner.judge(report("27+0+0#2+-601"))).toBe("delete")
})

test("a report far from the landing is not this attack's, and a landing nobody reported is forgotten", () => {
    let now = 0
    const cleaner = reportCleaner(() => now)
    cleaner.track(march())
    now = 30 * SECOND
    expect(cleaner.judge(report(WON))).toBeUndefined()
    now = 163 * SECOND + 10 * 60 * SECOND
    expect(cleaner.judge(report(WON))).toBeUndefined()
})

test("two marches on the way go to the reports in landing order", () => {
    let now = 0
    const cleaner = reportCleaner(() => now)
    cleaner.track(march({ MID: 1, TT: 140 }))
    cleaner.track(march({ MID: 2, TT: 150 }))
    now = 140 * SECOND
    expect(cleaner.judge(report(LOST, 10))).toBe("keep")
    now = 150 * SECOND
    expect(cleaner.judge(report(WON, 11))).toBe("delete")
})

test("a march with no time to impact or no target is not tracked", () => {
    const cleaner = reportCleaner(() => 0)
    cleaner.track({ MID: 1 })
    cleaner.track(undefined)
    expect(cleaner.judge(report(WON))).toBeUndefined()
})

test("the cleanup deletes a won report through dms and leaves a lost one", async () => {
    vi.useFakeTimers()
    try {
        const xtHandler = new EventEmitter()
        const sent = []
        const cleanup = createReportCleanup({ xtHandler, sendXT: async (cmd, body) => { sent.push([cmd, JSON.parse(body)]) } })
        cleanup.track(march({ MID: 1, TT: 100 }))
        cleanup.track(march({ MID: 2, TT: 120 }))
        await vi.advanceTimersByTimeAsync(100 * SECOND)
        xtHandler.emit("sne", { MSG: [report(LOST, 5)] }, 0)
        await vi.advanceTimersByTimeAsync(20 * SECOND)
        xtHandler.emit("sne", { MSG: [report(WON, 6)] }, 0)
        await vi.advanceTimersByTimeAsync(30 * SECOND)
        expect(sent).toEqual([["dms", { MID: 6 }]])
    } finally {
        vi.useRealTimers()
    }
})

test("a delete the game refuses is logged and does not stop the plugin", async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
        const xtHandler = new EventEmitter()
        const cleanup = createReportCleanup({ xtHandler, sendXT: async () => { throw "TIMED_OUT" } })
        cleanup.track(march({ TT: 10 }))
        await vi.advanceTimersByTimeAsync(10 * SECOND)
        xtHandler.emit("sne", { MSG: [report(WON, 6)] }, 0)
        await vi.advanceTimersByTimeAsync(30 * SECOND)
        expect(warn).toHaveBeenCalledWith("couldntDeleteReport", "TIMED_OUT")
    } finally {
        warn.mockRestore()
        vi.useRealTimers()
    }
})

function attackBot() {
    const bot = fakeBot()
    bot.botConfig.plugins.attack = { attackLimit: "", attackDelaySeconds: "3", attackDelayRandomizationSeconds: "0" }
    bot.sendXT = async (cmd, params) => {
        bot.sent.push([cmd, JSON.parse(params)])
        if (cmd == "cra")
            setTimeout(() => bot.xtHandler.emit("cra", { AAM: { M: march({ TT: 20 }) } }, 0), 10)
    }
    const { mod } = loadModule("plugins/attack/attack.js", { bot, extra: { "protocols": { resources: {} } } })
    return { ...mod, bot }
}

test("sendAttack watches for its report only when the plugin asked", async () => {
    vi.useFakeTimers()
    try {
        const { sendAttack, bot } = attackBot()
        const sentFirst = sendAttack({ x: 695, y: 528 }, 0, 695, 528, { deleteReports: false })
        await vi.advanceTimersByTimeAsync(100)
        await sentFirst
        await vi.advanceTimersByTimeAsync(20 * SECOND)
        bot.xtHandler.emit("sne", { MSG: [report(WON, 6)] }, 0)
        await vi.advanceTimersByTimeAsync(30 * SECOND)
        expect(bot.sent.filter(([cmd]) => cmd == "dms")).toEqual([])

        const wanted = sendAttack({ x: 695, y: 528 }, 0, 695, 528, { deleteReports: true })
        await vi.advanceTimersByTimeAsync(100)
        await wanted
        await vi.advanceTimersByTimeAsync(20 * SECOND)
        bot.xtHandler.emit("sne", { MSG: [report(WON, 7)] }, 0)
        await vi.advanceTimersByTimeAsync(30 * SECOND)
        expect(bot.sent.filter(([cmd]) => cmd == "dms")).toEqual([["dms", { MID: 7 }]])
    } finally {
        vi.useRealTimers()
    }
})

/** A spy report as Lazy Lord reads the client: type 4 on an NPC target, 3 on a player's, header `kind+result[+areaType]#kingdomID+ownerID`. */
const spyReport = (header, id, type = 4, { archived = 0, forwarded = 0 } = {}) => [id, type, header, "", -1, 0, 0, archived, forwarded]
/** A `csm` reply's movement for spies sent to a Bloodcrow castle (area type 34, owner -1002), 60 s away. */
const spies = { MID: 77, TA: [34, 30, 30], TID: -1002, OID: 7, PT: 0, TT: 60, KID: 0 }

test("spies that got through have their report deleted, once the cleanup heard the game accept them (csm)", async () => {
    vi.useFakeTimers()
    try {
        const xtHandler = new EventEmitter()
        const sent = []
        createReportCleanup({ xtHandler, sendXT: async (cmd, body) => { sent.push([cmd, JSON.parse(body)]) } })
        xtHandler.emit("csm", { A: { M: spies } }, 0)
        await vi.advanceTimersByTimeAsync(60 * SECOND)
        xtHandler.emit("sne", { MSG: [spyReport("1+2+34#0+-1002+", 8)] }, 0)
        xtHandler.emit("sne", { MSG: [spyReport("1+0+34#0+-1002+", 9)] }, 0)
        await vi.advanceTimersByTimeAsync(10 * SECOND)
        expect(sent, "caught spies are kept, and they use up the spying").toEqual([])
        xtHandler.emit("csm", { A: { M: spies } }, 0)
        await vi.advanceTimersByTimeAsync(60 * SECOND)
        xtHandler.emit("sne", { MSG: [spyReport("1+0+34#0+-1002+", 10, 3)] }, 0)
        await vi.advanceTimersByTimeAsync(10 * SECOND)
        expect(sent).toEqual([["dms", { MID: 10 }]])
    } finally {
        vi.useRealTimers()
    }
})

test("a spy report the bot did not send for is left alone", () => {
    const cleaner = reportCleaner(() => 0)
    expect(cleaner.judge(spyReport("1+0+34#0+-1002+", 11))).toBeUndefined()
})

test("an archived or forwarded report is never deleted", () => {
    let now = 0
    const cleaner = reportCleaner(() => now)
    cleaner.track(march())
    cleaner.track(march())
    now = 163 * SECOND
    expect(cleaner.judge([1, 6, WON, "", -1, 0, 0, 1, 0])).toBe("keep")
    expect(cleaner.judge([2, 6, WON, "", -1, 0, 0, 0, 1])).toBe("keep")
})
