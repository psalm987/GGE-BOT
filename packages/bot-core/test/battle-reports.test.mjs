import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { battleReportHeader, parseBattleLog, readBattleLog } = require("../battleReports.js")
const fixture = require("./fixtures/protocol/battle-report-bloodcrow.json")

const log = fixture.bls_1.reply.payload
const [push] = fixture.sne_battle_report_push.payload.MSG

describe("the header of a battle report", () => {
    test("the Bloodcrow report of the trace reads as an attack on a Bloodcrow camp in the Great Empire", () => {
        expect(battleReportHeader(push)).toMatchObject({ messageID: 325886158, areaType: 34, kingdomID: 0, ownerID: -1002 })
    })

    test("a spy report and every other message type are not battle reports", () => {
        expect(battleReportHeader([325886159, 4, "1+0+34#0+-1002+", "", -1, 0, 0, 0, 0])).toBeUndefined()
        expect(battleReportHeader([1, 67, "34+0+0#0+-1002"])).toBeUndefined()
        expect(battleReportHeader([1, 6])).toBeUndefined()
    })
})

describe("the battle log of a hit", () => {
    test("the player's row gives the glory and the loot", () => {
        const result = parseBattleLog(log, fixture.playerID)

        expect(result.glory).toBe(8_681_411)
        expect(result.loot).toMatchObject({ W: 218_500, S: 218_500, F: 198_500, C1: 11_736 })
    })

    test("without the player's row the attacker's row is read", () => {
        expect(parseBattleLog(log, 1).glory).toBe(8_681_411)
    })

    test("a log with no rows reads as nothing", () => {
        expect(parseBattleLog({ PBI: [] }, 1)).toBeUndefined()
        expect(parseBattleLog({}, 1)).toBeUndefined()
    })
})

describe("asking for a battle log", () => {
    const bot = (answer, sent = []) => ({
        sendXT: async (cmd, params) => sent.push([cmd, JSON.parse(params)]),
        waitForResult: async () => answer(),
        playerInfo: { playerID: fixture.playerID },
    })

    test("sends bls for the message without marking it read, and parses the reply", async () => {
        const sent = []
        const result = await readBattleLog(bot(() => [log, 0], sent), 325886158)

        expect(sent).toEqual([["bls", fixture.bls_1.payload]])
        expect(result.glory).toBe(8_681_411)
    })

    test("a refusal or a timeout gives undefined", async () => {
        expect(await readBattleLog(bot(() => [{}, 1]), 1)).toBeUndefined()
        expect(await readBattleLog(bot(() => { throw "timeout" }), 1)).toBeUndefined()
    })
})
