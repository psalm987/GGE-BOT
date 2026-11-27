import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const plan = require("../berimondKingdomPlan.js")
const fixture = require("./fixtures/protocol/berimond-kingdom.json")

const MINUTE = 60_000

describe("the tower list", () => {
    test("reads a position as the game writes it, commas being thousands", () => {
        expect(plan.parseTower("1,264:67")).toEqual({ x: 1264, y: 67, key: "1264:67" })
        expect(plan.parseTower(" 1409 : 110 ")).toEqual({ x: 1409, y: 110, key: "1409:110" })
        expect(plan.parseTower("1409,110")).toBeUndefined()
        expect(plan.parseTower("")).toBeUndefined()
    })

    test("takes the five boxes in order, leaves out repeats and counts the unreadable ones", () => {
        const read = plan.readTowers({ berimondTower1: "1409:110", berimondTower2: "nonsense", berimondTower3: "", berimondTower4: "1420:123", berimondTower5: "1,409:110" })
        expect(read.towers.map(t => t.key)).toEqual(["1409:110", "1420:123"])
        expect(read.bad).toBe(1)
    })

    test("leaves out towers this event already took off the list", () => {
        const read = plan.readTowers({ berimondTower1: "1409:110", berimondTower2: "1420:123" }, ["1409:110"])
        expect(read.towers.map(t => t.key)).toEqual(["1420:123"])
    })
})

describe("looking at the first tower", () => {
    const listed = () => plan.newQueue(plan.readTowers({ berimondTower1: "1409:110", berimondTower2: "1420:123" }).towers)

    test("a tower there is attacked, and seen", () => {
        const { queue, effect } = plan.afterLook(listed(), "tower")
        expect(effect).toEqual({ use: { x: 1409, y: 110, key: "1409:110" } })
        expect(queue.seen).toEqual(["1409:110"])
    })

    test("an empty spot is a destroyed tower once one was seen there, else a tower never found; neither is a refusal", () => {
        const seen = plan.afterLook(listed(), "tower").queue
        const gone = plan.afterLook(seen, "empty")
        expect(gone.effect).toEqual({ drop: "1409:110", reason: "destroyed" })
        expect(gone.queue.towers.map(t => t.key)).toEqual(["1420:123"])
        expect(gone.queue.refusedInARow).toBe(0)

        expect(plan.afterLook(listed(), "empty").effect).toEqual({ drop: "1409:110", reason: "notFound" })
        expect(plan.afterLook(listed(), "notTower").effect).toEqual({ drop: "1409:110", reason: "wrongCoordinates" })
    })

    test("a failed look waits 2 minutes, then 4, and the third failure in a row drops the tower", () => {
        let queue = listed()
        const effects = []
        for (let i = 0; i < 3; i++) {
            const step = plan.afterLook(queue, "failed")
            queue = step.queue
            effects.push(step.effect)
        }
        expect(effects).toEqual([{ waitMs: 2 * MINUTE }, { waitMs: 4 * MINUTE }, { drop: "1409:110", reason: "lookFailed" }])
        expect(queue.towers.map(t => t.key)).toEqual(["1420:123"])
    })

    test("a good look clears the failures", () => {
        const failed = plan.afterLook(listed(), "failed").queue
        expect(plan.afterLook(failed, "tower").queue.lookFails).toEqual({})
    })

    test("dropping the last tower stops the plugin", () => {
        const one = plan.newQueue(plan.readTowers({ berimondTower1: "1409:110" }).towers)
        const { queue, effect } = plan.afterLook(one, "empty")
        expect(effect).toEqual({ drop: "1409:110", reason: "notFound" })
        expect(queue.stop).toBe("towersDone")
    })

    test("an empty list stops at once", () => {
        expect(plan.newQueue([]).stop).toBe("towersDone")
    })
})

describe("after an attack", () => {
    const listed = () => plan.newQueue(plan.readTowers({ berimondTower1: "1409:110", berimondTower2: "1420:123", berimondTower3: "1430:130" }).towers)

    test("a refused tower is dropped and the next one is up", () => {
        const { queue, effect } = plan.afterAttack(listed(), "1409:110", "refused")
        expect(effect).toEqual({ drop: "1409:110", reason: "refused" })
        expect(queue.towers.map(t => t.key)).toEqual(["1420:123", "1430:130"])
        expect(queue.stop).toBeUndefined()
    })

    test("two refusals in a row stop the plugin; an attack sent in between resets the count", () => {
        const twice = plan.afterAttack(plan.afterAttack(listed(), "1409:110", "refused").queue, "1420:123", "refused")
        expect(twice.queue.stop).toBe("twoRefusals")

        const apart = plan.afterAttack(plan.afterAttack(plan.afterAttack(listed(), "1409:110", "refused").queue, "1420:123", "sent").queue, "1420:123", "refused")
        expect(apart.queue.stop).toBeUndefined()
        expect(apart.queue.towers.map(t => t.key)).toEqual(["1430:130"])
    })

    test("with the game finding the towers, a refusal drops nothing but still counts toward two in a row", () => {
        const found = plan.newQueue([], { find: true })
        expect(found.stop).toBeUndefined()
        const once = plan.afterAttack(found, "1409:110", "refused")
        expect(once.queue.stop).toBeUndefined()
        expect(plan.afterAttack(once.queue, "1409:110", "refused").queue.stop).toBe("twoRefusals")
    })
})

describe("what a refusal means", () => {
    test.each([
        ["ATTACK_SCREEN_REFUSED", "refused"], ["FACTION_NPC_OBJECT_IS_PROTECTED", "refused"],
        ["MISSING_UNITS", "retry"], ["LORD_IS_USED", "retry"], ["TIMED_OUT", "retry"], ["CASTLE_LOCKED", "retry"],
        ["ATTACK_TOO_MANY_UNITS", "tooMany"], ["WONT_REACH_IN_TIME", "eventOver"], ["NOT_ENOUGH_CURRENCY1", "coins"],
        ["ATTACK_LIMIT_REACHED", "dailyLimit"], ["NO_MORE_TROOPS", "troops"],
    ])("%s is %s", (error, outcome) => {
        expect(plan.attackOutcome(error)).toBe(outcome)
    })
})

describe("the room on each side", () => {
    test("the tower's level is field 7 of its map record", () => {
        const record = fixture.ssi_1.reply.payload.gaa.AI[0]
        expect(plan.towerLevel({ extraData: record.slice(3) })).toBe(55)
        expect(plan.towerLevel({ extraData: [] })).toBeUndefined()
    })

    test("attackers are 5 x level + 8, at most 260, and 320 from level 70; a flank takes 20% of them", () => {
        expect(plan.troopRoom(10)).toEqual({ flank: 12, front: 34 })
        expect(plan.troopRoom(55)).toEqual({ flank: 52, front: 156 })
        expect(plan.troopRoom(69)).toEqual({ flank: 52, front: 156 })
        expect(plan.troopRoom(70)).toEqual({ flank: 64, front: 192 })
        expect(plan.troopRoom(87)).toEqual({ flank: 64, front: 192 })
    })

    test("with no level the typed limits hold, 52 a flank and 156 in the middle", () => {
        expect(plan.troopRoom(undefined)).toEqual({ flank: 52, front: 156 })
    })

    test("the commander's flank and front bonuses raise each side, rounded down", () => {
        expect(plan.troopRoom(87, { attackUnitAmountFlank: 73.6, attackUnitAmountFront: 50 })).toEqual({ flank: 111, front: 288 })
    })

    test("a cut takes soldiers off each side after the share all commanders lose", () => {
        expect(plan.troopRoom(55, {}, { cut: 4, allCut: 10 })).toEqual({ flank: 42, front: 136 })
        expect(plan.troopRoom(1, {}, { cut: 100 })).toEqual({ flank: 1, front: 1 })
    })

    test("too many units doubles this commander's cut and takes 2% more off every commander, at most 20%", () => {
        let cuts = plan.NO_CUT
        const seen = []
        for (let i = 0; i < 12; i++) {
            cuts = plan.cutAfterTooMany(cuts)
            seen.push([cuts.cut, cuts.allCut])
        }
        expect(seen.slice(0, 4)).toEqual([[1, 2], [2, 4], [4, 6], [8, 8]])
        expect(seen.at(-1)[1]).toBe(20)
    })

    test("tools are 30 a flank and 40 in the middle", () => {
        expect(plan.TOOL_ROOM).toEqual({ flank: 30, front: 40 })
    })
})

const unit = (wodID, info, amount) => ({ unitInfo: { wodID, ...info }, amount })
const archer = (amount, wodID = 546) => unit(wodID, { role: "ranged", fightType: "0", foodSupply: "1" }, amount)
const spear = amount => unit(507, { role: "melee", fightType: "0", foodSupply: "1" }, amount)
const auxiliary = amount => unit(216, { role: "ranged", fightType: "0", isAuxiliary: "1" }, amount)
const ladder = amount => unit(614, { toolCategory: "1", typ: "Attack", wallBonus: "10", slotTypes: "1,2" }, amount)
const ram = amount => unit(649, { toolCategory: "1", typ: "Attack", gateBonus: "10", slotTypes: "1" }, amount)
const mantlet = amount => unit(651, { toolCategory: "1", typ: "Attack", defRangeBonus: "10", slotTypes: "1,2" }, amount)
const wave = () => ({
    L: { T: [[-1, 0], [-1, 0]], U: [[-1, 0], [-1, 0]] },
    R: { T: [[-1, 0], [-1, 0]], U: [[-1, 0], [-1, 0]] },
    M: { T: [[-1, 0], [-1, 0], [-1, 0]], U: Array.from({ length: 6 }, () => [-1, 0]) },
})
const room = { flankUnits: 52, frontUnits: 156, flankTools: 30, frontTools: 40 }
const units = side => side.U.reduce((n, [, amount]) => n + amount, 0)
const tools = side => side.T.reduce((n, [, amount]) => n + amount, 0)

describe("autofill's first wave", () => {
    test("fills every side to its room, with soldiers the camp received and tools for the wall, the gate and the archers", () => {
        const inventory = [archer(300), spear(10), auxiliary(500), ladder(100), ram(100), mantlet(100)]
        const filled = wave()
        expect(plan.autofillWave(filled, inventory, room)).toBe(260)
        expect([units(filled.L), units(filled.M), units(filled.R)]).toEqual([52, 156, 52])
        expect([tools(filled.L), tools(filled.M), tools(filled.R)]).toEqual([30, 40, 30])
        expect(filled.L.T).toEqual([[614, 15], [651, 15]])
        expect(filled.M.T).toEqual([[614, 14], [649, 13], [651, 13]])
        expect(filled.M.U.filter(([wod]) => wod == 216)).toEqual([])
        expect(inventory.map(u => u.amount)).toEqual([40, 10, 500, 56, 87, 57])
    })

    test("takes nothing while the camp can't fill the wave, unless the camp is full", () => {
        const inventory = [archer(200), ladder(100)]
        const empty = wave()
        expect(() => plan.autofillWave(empty, inventory, room)).toThrow("NO_MORE_TROOPS")
        expect(empty).toEqual(wave())
        expect(inventory.map(u => u.amount)).toEqual([200, 100])

        const sent = wave()
        expect(plan.autofillWave(sent, inventory, room, { campFull: true })).toBe(200)
        expect(inventory[0].amount).toBe(0)
    })

    test("a full camp still needs 32 soldiers in the wave", () => {
        expect(() => plan.autofillWave(wave(), [archer(31)], room, { campFull: true })).toThrow("NO_MORE_TROOPS")
    })

    test("a tool the target bars is left in the camp", () => {
        const filled = wave()
        plan.autofillWave(filled, [archer(300), ladder(100)], room, { toolAllowed: info => info.wodID != 614 })
        expect([tools(filled.L), tools(filled.M), tools(filled.R)]).toEqual([0, 0, 0])
    })
})

describe("wave one", () => {
    test("counts its soldiers, tools left out", () => {
        expect(plan.waveOneSoldiers(fixture.cra_2.payload)).toBe(132 + 132 + 359 + 47)
        expect(plan.waveOneSoldiers({ A: [] })).toBe(0)
    })
})

describe("refilling the camp", () => {
    const sendable = { role: "ranged", foodSupply: "1" }
    test("sends the listed troops in order, up to the camp's free space", () => {
        expect(plan.resupplyPlan({ freeSpace: 185, threshold: 100, held: [[546, 81], [507, 400]] })).toEqual({ units: [[546, 81], [507, 104]] })
    })

    test("waits while the camp has less room than the threshold", () => {
        expect(plan.resupplyPlan({ freeSpace: 99, threshold: 100, held: [[546, 1000]] })).toEqual({ noRoom: true })
    })

    test("is short when the castle can't send the threshold", () => {
        expect(plan.resupplyPlan({ freeSpace: 500, threshold: 100, held: [[546, 60], [507, 20]] })).toEqual({ short: 80 })
    })

    test("its waits after a failure double from 2 minutes up to 30", () => {
        expect([1, 2, 3, 4, 5, 6].map(plan.resupplyBackoffMs)).toEqual([2, 4, 8, 16, 30, 30].map(m => m * MINUTE))
    })

    test("sends only troops that eat food or mead, never the camp's own auxiliaries nor beef eaters", () => {
        expect(plan.isSendable(sendable)).toBe(true)
        expect(plan.isSendable({ role: "melee", meadSupply: "2" })).toBe(true)
        expect(plan.isSendable({ ...sendable, isAuxiliary: "1" })).toBe(false)
        expect(plan.isSendable({ ...sendable, beefSupply: "1" })).toBe(false)
        expect(plan.isSendable({ toolCategory: "1", foodSupply: "1" })).toBe(false)
    })
})
