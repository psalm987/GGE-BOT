import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const bannerWave = require("./fixtures/protocol/cra-banner-wave.json").payload

const horses = [
    { wodID: 1, costFactorC1: "1", costFactorC2: "0", unitBoost: "10" },
    { wodID: 2, costFactorC1: "1", costFactorC2: "0", unitBoost: "5" },
    { wodID: 3, costFactorC1: "0", costFactorC2: "5", unitBoost: "1" },
]

function engine({ playerLevel = 70, pegasusTicket = 0 } = {}) {
    const bot = fakeBot()
    bot.playerInfo.level = playerLevel
    return loadModule("plugins/attack/attack.js", { bot, items: { horses }, extra: { "protocols": { resources: { pegasusTicket } } } }).mod
}

const castle = { areaInfo: { x: 100, y: 200 }, unlockedHorses: [1, 2, 3] }
const target = { x: 110, y: 210 }
const empty = [-1, 0]
const attack = (extras, { level = 50, waves = 1 } = {}) =>
    engine().getAttackInfo(0, castle, target, { lordID: 1 }, level, waves, {}, 0, extras)

describe("the cra getAttackInfo builds", () => {
    test("is the same, byte for byte, when no support tools or courtyard are given", () => {
        // Captured from getAttackInfo before it took support tools and a courtyard.
        expect(JSON.stringify(engine({ playerLevel: 30 }).getAttackInfo(0, castle, target, { lordID: 4 }, 40, undefined, { useCoin: true }, undefined)))
            .toBe('{"SX":100,"SY":200,"TX":110,"TY":210,"KID":0,"LID":4,"WT":0,"HBW":2,"BPC":0,"ATT":0,"AV":0,"LP":0,"FC":0,"PTT":0,"SD":0,"ICA":0,"CD":99,"A":[{"L":{"T":[[-1,0],[-1,0]],"U":[[-1,0],[-1,0]]},"R":{"T":[[-1,0],[-1,0]],"U":[[-1,0],[-1,0]]},"M":{"T":[[-1,0],[-1,0],[-1,0]],"U":[[-1,0],[-1,0],[-1,0],[-1,0],[-1,0],[-1,0]]}},{"L":{"T":[[-1,0],[-1,0]],"U":[[-1,0],[-1,0]]},"R":{"T":[[-1,0],[-1,0]],"U":[[-1,0],[-1,0]]},"M":{"T":[[-1,0],[-1,0],[-1,0]],"U":[[-1,0],[-1,0],[-1,0],[-1,0],[-1,0],[-1,0]]}},{"L":{"T":[[-1,0],[-1,0]],"U":[[-1,0],[-1,0]]},"R":{"T":[[-1,0],[-1,0]],"U":[[-1,0],[-1,0]]},"M":{"T":[[-1,0],[-1,0],[-1,0]],"U":[[-1,0],[-1,0],[-1,0],[-1,0],[-1,0],[-1,0]]}}],"BKS":[],"AST":[-1,-1,-1],"RW":[[-1,0],[-1,0],[-1,0],[-1,0],[-1,0],[-1,0],[-1,0],[-1,0]],"ASCT":0}')
        expect(JSON.stringify(engine({ pegasusTicket: 2 }).getAttackInfo(2, castle, target, { lordID: 5 }, 10, 1, { useFeather: true }, 1)))
            .toBe('{"SX":100,"SY":200,"TX":110,"TY":210,"KID":2,"LID":5,"WT":0,"HBW":-1,"BPC":0,"ATT":0,"AV":0,"LP":0,"FC":0,"PTT":1,"SD":0,"ICA":0,"CD":99,"A":[{"L":{"T":[[-1,0]],"U":[[-1,0]]},"R":{"T":[[-1,0]],"U":[[-1,0]]},"M":{"T":[[-1,0]],"U":[[-1,0],[-1,0]]}}],"BKS":[],"AST":[-1,-1,-1],"RW":[[-1,0],[-1,0],[-1,0],[-1,0],[-1,0],[-1,0],[-1,0],[-1,0]],"ASCT":0}')
    })

    test("has the client's cra fields in the client's order", () => {
        const cra = attack()
        expect(Object.keys(cra)).toEqual(Object.keys(bannerWave))
        expect(cra.AST).toEqual(bannerWave.AST)
        expect(cra.RW).toEqual(bannerWave.RW)
    })

    test("puts up to 3 support tools in AST in the order given, with -1 for an empty slot", () => {
        expect(attack({ supportTools: [359] }).AST).toEqual([359, -1, -1])
        expect(attack({ supportTools: [359, 371, 383, 395] }).AST).toEqual([359, 371, 383])
    })

    test("fills the courtyard wave in the order given and stops at 8 slots", () => {
        const courtyard = Array.from({ length: 10 }, (_, i) => [10 + i, 5 * (i + 1)])

        expect(attack({ courtyard: courtyard.slice(0, 2) }).RW).toEqual([[10, 5], [11, 10], empty, empty, empty, empty, empty, empty])
        const cra = attack({ courtyard })
        expect(cra.RW).toEqual(courtyard.slice(0, 8))

        cra.RW[0][1] = 0
        expect(courtyard[0]).toEqual([10, 5])
    })
})

describe("fillEventTools", () => {
    const { fillEventTools } = engine()
    const banner = (wodID, fameBonus, amount, slotTypes = "1,2,9") => ({ unitInfo: { wodID, fameBonus: String(fameBonus), slotTypes }, amount })
    const maxTools = { flank: 20, front: 30 }
    const toolSlots = ({ L, R, M }) => [L.T, R.T, M.T]

    test("fills the flank tool room the ram leaves, as in cra-banner-wave.json", () => {
        const [wave] = attack(undefined, { level: 10 }).A
        wave.M.T[0] = [611, 10]

        fillEventTools([wave], [banner(661, 2, 10)], { maxTools: { flank: 5, front: 10 } })

        expect(toolSlots(wave)).toEqual(toolSlots(bannerWave.A[0]))
    })

    test("highest puts the strongest banners first, and each side stops at its limit", () => {
        const [wave] = attack().A
        const owned = [banner(660, 1, 100), banner(476, 13, 25), banner(661, 2, 40)]

        expect(fillEventTools([wave], owned, { maxTools, order: "highest" })).toBe(70)
        expect(toolSlots(wave)).toEqual([[[476, 20], empty], [[476, 5], [661, 15]], [[661, 25], [660, 5], empty]])
        expect(owned.map(unit => unit.amount)).toEqual([95, 0, 0])
    })

    test("lowest puts the weakest banners first", () => {
        const [wave] = attack().A

        fillEventTools([wave], [banner(476, 13, 25), banner(660, 1, 100), banner(661, 2, 40)], { maxTools, order: "lowest" })

        expect(toolSlots(wave)).toEqual([[[660, 20], empty], [[660, 20], empty], [[660, 30], empty, empty]])
    })

    test("listed follows the given list and leaves out banners it does not name", () => {
        const [wave] = attack().A
        const owned = [banner(660, 1, 100), banner(476, 13, 25), banner(661, 2, 40)]

        fillEventTools([wave], owned, { maxTools, order: "listed", list: [661, 476] })

        expect(toolSlots(wave)).toEqual([[[661, 20], empty], [[661, 20], empty], [[476, 25], empty, empty]])
        expect(owned[0].amount).toBe(100)
    })

    test("listed without a list keeps the order of the owned banners", () => {
        const [wave] = attack().A

        fillEventTools([wave], [banner(661, 2, 40), banner(660, 1, 100)], { maxTools })

        expect(toolSlots(wave)).toEqual([[[661, 20], empty], [[661, 20], empty], [[660, 30], empty, empty]])
    })

    test("stops at maxPerAttack across all the waves it is given", () => {
        const { A } = attack(undefined, { waves: 2 })

        expect(fillEventTools(A, [banner(661, 2, 1000)], { maxTools, maxPerAttack: 50 })).toBe(50)
        expect(A.map(toolSlots)).toEqual([
            [[[661, 20], empty], [[661, 20], empty], [[661, 10], empty, empty]],
            [[empty, empty], [empty, empty], [empty, empty, empty]],
        ])
    })

    test("a tool made for the front never goes on a flank", () => {
        const [wave] = attack().A

        fillEventTools([wave], [banner(564, 9, 50, "1,9"), banner(661, 2, 50)], { maxTools, order: "highest" })

        expect(toolSlots(wave)).toEqual([[[661, 20], empty], [[661, 20], empty], [[564, 30], empty, empty]])
    })

    test("only uses free slots, and counts the tools already in a side against its limit", () => {
        const [wave] = attack().A
        wave.L.T[0] = [614, 15]
        wave.M.T[0] = [611, 30]

        fillEventTools([wave], [banner(661, 2, 100)], { maxTools })

        expect(toolSlots(wave)).toEqual([[[614, 15], [661, 5]], [[661, 20], empty], [[611, 30], empty, empty]])
    })

    test("only places tools that carry the bonus field", () => {
        const ladder = { unitInfo: { wodID: 614 }, amount: 50 }
        const rage = { unitInfo: { wodID: 106, ragePointBonus: "1" }, amount: 10 }
        const [glory] = attack().A
        const [khan] = attack().A

        expect(fillEventTools([glory], [ladder, rage], { maxTools })).toBe(0)
        expect(fillEventTools([khan], [ladder, rage], { maxTools, bonusField: "ragePointBonus" })).toBe(10)
        expect(khan.L.T[0]).toEqual([106, 10])
    })
})
