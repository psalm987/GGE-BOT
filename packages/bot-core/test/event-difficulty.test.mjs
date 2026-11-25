import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

const rows = [{ eventID: 72, difficultyTypeID: 5, difficultyID: 105 }]
const load = (answer = ["", 0], items = rows) => {
    const bot = fakeBot()
    const record = bot.sendXT
    bot.sendXT = async (cmd, params) => {
        await record(cmd, params)
        setImmediate(() => bot.xtHandler.emit(cmd, ...answer))
    }
    const { mod } = loadModule("eventDifficulty.js", { bot, items: { eventAutoScalingDifficulties: items } })
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

describe("Highest unlocked difficulty", () => {
    const HIGHEST = 13
    const tier = (eventID, difficultyTypeID, isLocked = "0", rentC2Cost = "0") => ({ eventID, difficultyTypeID, difficultyID: eventID * 10 + difficultyTypeID, isLocked, rentC2Cost })
    test("sets the top tier of the event that costs no rubies", async () => {
        const { settleDifficulty, sedes } = load(["", 0], [tier(72, 1), tier(72, 4), tier(72, 7, "1", "50"), tier(80, 9)])
        expect(await settleDifficulty(72, -1, HIGHEST)).toEqual({ EDID: 724 })
        expect(sedes()).toEqual([["sede", { EID: 72, EDID: 724, C2U: 0 }]])
    })
    test("a tier with no rent cost counts as unlocked even when flagged locked", async () => {
        const { settleDifficulty } = load(["", 0], [tier(72, 4), tier(72, 6, "1", "0")])
        expect(await settleDifficulty(72, -1, HIGHEST)).toEqual({ EDID: 726 })
    })
    test("an event whose every tier needs rubies is refused rather than rented", async () => {
        const { settleDifficulty, sedes } = load(["", 0], [tier(72, 4, "1", "50")])
        expect(await settleDifficulty(72, -1, HIGHEST)).toEqual({ refused: "NO_UNLOCKED_DIFFICULTY" })
        expect(sedes()).toEqual([])
    })
    test("an event that already has a difficulty is left alone", async () => {
        const { settleDifficulty, sedes } = load(["", 0], [tier(72, 4)])
        expect(await settleDifficulty(72, 105, HIGHEST)).toEqual({ EDID: 105 })
        expect(sedes()).toEqual([])
    })
})
