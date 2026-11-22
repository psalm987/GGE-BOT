import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

const rows = [{ eventID: 72, difficultyTypeID: 5, difficultyID: 105 }]
const load = (answer = ["", 0]) => {
    const bot = fakeBot()
    const record = bot.sendXT
    bot.sendXT = async (cmd, params) => {
        await record(cmd, params)
        setImmediate(() => bot.xtHandler.emit(cmd, ...answer))
    }
    const { mod } = loadModule("eventDifficulty.js", { bot, items: { eventAutoScalingDifficulties: rows } })
    return { settleDifficulty: mod.settleDifficulty, bot, sedes: () => bot.sent.filter(([cmd]) => cmd == "sede") }
}

describe("settling the difficulty of an event", () => {
    test("two plugins starting on the same event send one sede and both get its difficulty", async () => {
        const { settleDifficulty, sedes } = load()
        const answers = await Promise.all([settleDifficulty(72, -1, 5), settleDifficulty(72, -1, 5)])
        expect(answers).toEqual([{ EDID: 105 }, { EDID: 105 }])
        expect(await settleDifficulty(72, -1, 5)).toEqual({ EDID: 105 })
        expect(sedes()).toEqual([["sede", { EID: 72, EDID: 105, C2U: 0 }]])
    })
    test("a refusal reaches every caller by its error name", async () => {
        const { settleDifficulty, sedes } = load(["", 437])
        const answers = await Promise.all([settleDifficulty(72, -1, 5), settleDifficulty(72, -1, 5)])
        expect(answers).toEqual([{ refused: "INVALID_EVENT_DIFFICULTY_ID" }, { refused: "INVALID_EVENT_DIFFICULTY_ID" }])
        expect(sedes()).toHaveLength(1)
    })
    test("the event stopping forgets the answer, so its next start asks again", async () => {
        const { settleDifficulty, bot, sedes } = load()
        await settleDifficulty(72, -1, 5)
        bot.events.emit("eventStop", { EID: 72 })
        await settleDifficulty(72, -1, 5)
        expect(sedes()).toHaveLength(2)
    })
    test("a plugin whose own choice is Classic still gets the difficulty another plugin set", async () => {
        const { settleDifficulty, sedes } = load()
        const answers = await Promise.all([settleDifficulty(72, -1, 5), settleDifficulty(72, -1, 0)])
        expect(answers).toEqual([{ EDID: 105 }, { EDID: 105 }])
        expect(sedes()).toHaveLength(1)
    })
    test("an event with a difficulty, or a choice without a row (Classic), asks nothing", async () => {
        const { settleDifficulty, sedes } = load()
        expect(await settleDifficulty(72, 105, 5)).toEqual({ EDID: 105 })
        expect(await settleDifficulty(72, -1, 0)).toEqual({ EDID: -1 })
        expect(sedes()).toEqual([])
    })
})
