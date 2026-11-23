import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { holdingsOf, gained, rewardNames, rewardLine } = require("../khanRewards.js")
const capture = require("./fixtures/protocol/khan-rewards-20261122.json")

/** The holdings after a landing's pushes, each command's last push standing. */
const after = (pushes, start = {}) => pushes.reduce((held, [command, reply]) => command == "sne" ? held : { ...held, [command]: holdingsOf(command, reply) }, start)
const rewardsOf = (before, now) => Object.keys(now).flatMap(command => gained(before[command], now[command]))

describe("what a defended taunt paid", () => {
    test("gls lists boxes and keys, and gii construction items, as running totals", () => {
        const [, gls] = capture.landings.second.at(-1)
        expect([...holdingsOf("gls", gls)]).toEqual([["box:4", 2], ["box:8", 1], ["key:1", 5]])
        expect(holdingsOf("gii", capture.landings.second[1][1]).get("item:30482")).toBe(8)
    })

    test("the second taunt paid a silver box, a woodcutter and a tavern, read from how far the totals rose", () => {
        const first = after(capture.landings.first)
        const second = after(capture.landings.second, first)
        expect(rewardsOf(first, second)).toEqual([["item:30482", 1], ["item:30472", 1], ["box:8", 1]])
    })

    test("with no totals from before the landing, nothing is reported as paid", () => {
        expect(rewardsOf({}, after(capture.landings.first))).toEqual([])
        expect(gained(undefined, new Map([["box:4", 1]]))).toEqual([])
    })

    test("a total that held or fell is no reward", () => {
        expect(gained(new Map([["box:4", 2], ["key:1", 5]]), new Map([["box:4", 1], ["key:1", 5]]))).toEqual([])
    })

    test("rewards read in the game's English names, and by kind and id without them", () => {
        const names = rewardNames(capture)
        expect(rewardLine([["box:8", 1], ["item:30482", 1], ["box:4", 2], ["key:1", 5]], names))
            .toBe("Legendary silver mystery box +1, Pirates' woodcutter 3 +1, Legendary bronze mystery box +2, Common mystery key +5")
        expect(rewardLine([["box:99", 1], ["item:1", 2], ["key:9", 1]], rewardNames({}))).toBe("mystery box 99 +1, construction item 1 +2, mystery key 9 +1")
    })
})
