import { expect, test } from "vitest"
import type { FeedLine } from "@gge/contracts"
import { mergeFeed } from "../src/log-merge.ts"

const line = (id: number, accountId = "a"): FeedLine => ({
    id, accountId, ts: new Date(id * 1000), level: 0, message: `line ${id}`, parts: null, plugin: null,
})
const ids = (lines: FeedLine[]) => lines.map(l => l.id)

test("lines from different accounts interleave newest first", () => {
    const merged = mergeFeed([line(5, "a"), line(2, "a")], [line(4, "b"), line(1, "b"), line(6, "b")])
    expect(ids(merged)).toEqual([6, 5, 4, 2, 1])
})

test("a line that arrives twice is kept once", () => {
    const merged = mergeFeed([line(3), line(2)], [line(3), line(4)])
    expect(ids(merged)).toEqual([4, 3, 2])
})

test("only the newest lines are kept when the list is over its cap", () => {
    const current = Array.from({ length: 5 }, (_, i) => line(10 - i))
    expect(ids(mergeFeed(current, [line(11)], 3))).toEqual([11, 10, 9])
})

test("a page of older lines slots in below the live ones", () => {
    expect(ids(mergeFeed([line(9), line(8)], [line(7), line(6)]))).toEqual([9, 8, 7, 6])
})

test("the lists given are left alone", () => {
    const current = [line(2)]
    mergeFeed(current, [line(3)])
    expect(ids(current)).toEqual([2])
})
