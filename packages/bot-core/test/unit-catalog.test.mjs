import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const {
    recruitCatalog, bladeCoastCatalog, bladeCoastWods, fitsBladeCoast, canTravelTo, canAttackAt, slotsOf, toolRolesOf, usableAgainstNpc,
} = require("../unitCatalog.js")

// Hand-made rows in the shape of the game's units.json, not copied from it.
const recruitCost = { recruitmentTime: "600", costC1: "100" }
const units = [
    { wodID: 1, type: "Swordsman", name: "Barracks", role: "melee", fightType: "0", ...recruitCost },
    { wodID: 2, type: "Bowman", name: "Barracks", role: "ranged", fightType: "0", level: "1", ...recruitCost },
    { wodID: 3, type: "Bowman", name: "Barracks", role: "ranged", fightType: "0", level: "2", ...recruitCost },
    { wodID: 4, type: "Spearguard", name: "Barracks", role: "melee", fightType: "1", ...recruitCost },
    { wodID: 5, type: "Homeguard", name: "Barracks", role: "melee", fightType: "0", allowedToTravel: "0+-1#1+-1", ...recruitCost },
    { wodID: 6, type: "Corsair", name: "Eventunit", role: "melee", fightType: "0", allowedToTravel: "22+8#27+8#28+8", allowedToAttack: "22+7", ...recruitCost },
    { wodID: 7, type: "SamuraiAttackerMelee", name: "Eventunit", role: "melee", fightType: "0", costC1: "200" },
    { wodID: 8, type: "Pirateraider", name: "Kingdomunit", role: "melee", fightType: "0" },
    { wodID: 20, type: "Ladder", name: "Workshop", typ: "Attack", fightType: "0", slotTypes: "1,2,9", wallBonus: "10", level: "1", ...recruitCost },
    { wodID: 21, type: "Ladder", name: "Workshop", typ: "Attack", fightType: "0", slotTypes: "1,2,9", wallBonus: "15", level: "2", ...recruitCost },
    { wodID: 22, type: "Ram", name: "Workshop", typ: "Attack", fightType: "0", slotTypes: "1,9", gateBonus: "10", ...recruitCost },
    { wodID: 23, type: "Mantlet", name: "Eventtool", typ: "Attack", fightType: "0", slotTypes: "2,9", defRangeBonus: "20" },
    { wodID: 24, type: "RoyalLadder", name: "Elitetool", typ: "Attack", fightType: "0", slotTypes: "1,2", wallBonus: "30", canBeUsedToAttackNPC: "0" },
    { wodID: 25, type: "Horn", name: "Eventtool", typ: "Attack", fightType: "0", slotTypes: "9,10", offMeleeBonus: "5" },
    { wodID: 26, type: "Moatbridge", name: "Workshop", typ: "Attack", fightType: "0", slotTypes: "1,2", moatBonus: "10", ...recruitCost },
    { wodID: 27, type: "Palisade", name: "Dworkshop", typ: "Defence", fightType: "1", slotTypes: "1", wallBonus: "10", ...recruitCost },
    { wodID: 28, type: "BerimondRam", name: "Workshop", typ: "Attack", fightType: "0", slotTypes: "1", gateBonus: "20", allowedToAttack: "10+15", ...recruitCost },
]

describe("where a unit may go", () => {
    test("no list means anywhere, and a list allows only its space+area pairs", () => {
        expect(canTravelTo(units[0], { kingdom: 22, areaType: 8 })).toBe(true)
        expect(canTravelTo(units[4], { kingdom: 22, areaType: 8 })).toBe(false)
        expect(canTravelTo(units[4], { kingdom: 1, areaType: 4 })).toBe(true)
        expect(canAttackAt(units[5], { kingdom: 22, areaType: 7 })).toBe(true)
        expect(canAttackAt(units[5], { kingdom: 0, areaType: 2 })).toBe(false)
    })

    test("the Blade Coast takes units that may travel to its camp and attack its islands", () => {
        expect(fitsBladeCoast(units[0])).toBe(true)
        expect(fitsBladeCoast(units[5])).toBe(true)
        expect(fitsBladeCoast(units[4])).toBe(false)
        expect(fitsBladeCoast(units.find(u => u.type == "BerimondRam"))).toBe(false)
    })

    test("tools read their slots, roles and whether they work against the game's own targets", () => {
        expect(slotsOf(units.find(u => u.type == "Ram"))).toEqual(["front"])
        expect(slotsOf(units.find(u => u.type == "Mantlet"))).toEqual(["flank"])
        expect(slotsOf(units.find(u => u.type == "Horn"))).toEqual([])
        expect(toolRolesOf(units.find(u => u.type == "Mantlet"))).toEqual(["ranged"])
        expect(toolRolesOf(units.find(u => u.type == "Moatbridge"))).toEqual([])
        expect(usableAgainstNpc(units.find(u => u.type == "RoyalLadder"))).toBe(false)
        expect(usableAgainstNpc(units[0])).toBe(true)
    })
})

describe("catalogs", () => {
    test("the recruit catalog lists recruitable types by group with their levels", () => {
        const catalog = recruitCatalog(units)
        expect(catalog.find(e => e.type == "Bowman")).toEqual({ type: "Bowman", recruitGroup: "attackTroops", role: "ranged", levels: [1, 2] })
        expect(catalog.find(e => e.type == "Spearguard")?.recruitGroup).toBe("defenceTroops")
        expect(catalog.find(e => e.type == "Corsair")?.recruitGroup).toBe("eventTroops")
        expect(catalog.find(e => e.type == "Palisade")?.recruitGroup).toBe("defenceTools")
        expect(catalog.find(e => e.type == "Ladder")).toEqual({ type: "Ladder", recruitGroup: "attackTools", levels: [1, 2] })
        expect(catalog.map(e => e.type)).not.toContain("SamuraiAttackerMelee")
        expect(catalog.map(e => e.type)).not.toContain("Pirateraider")
    })

    test("Blade Coast troops are recruitable ones that fit, plus the extra event troops", () => {
        const { troops } = bladeCoastCatalog(units)
        expect(troops.map(t => t.type).sort()).toEqual(["Bowman", "Corsair", "SamuraiAttackerMelee", "Spearguard", "Swordsman"])
        expect(troops.find(t => t.type == "SamuraiAttackerMelee")).toEqual({ type: "SamuraiAttackerMelee", recruitGroup: "eventTroops", role: "melee", levels: [0] })
    })

    test("Blade Coast tools are attack tools the islands accept, with a slot and a wall, gate or ranged role", () => {
        const { tools } = bladeCoastCatalog(units)
        expect(tools).toEqual([
            { type: "Ladder", recruitGroup: "attackTools", roles: ["wall"], slots: ["front", "flank"], levels: [1, 2] },
            { type: "Mantlet", recruitGroup: "attackTools", roles: ["ranged"], slots: ["flank"], levels: [0] },
            { type: "Ram", recruitGroup: "attackTools", roles: ["gate"], slots: ["front"], levels: [0] },
        ])
    })

    test("a picked type, with or without a level, stands for the wodIDs that may go to the Blade Coast", () => {
        expect(bladeCoastWods(units, "Ladder")).toEqual([20, 21])
        expect(bladeCoastWods(units, "Ladder#2")).toEqual([21])
        expect(bladeCoastWods(units, "Homeguard")).toEqual([])
        expect(bladeCoastWods(units, undefined)).toEqual([])
    })
})
