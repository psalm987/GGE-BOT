import { expect, test } from "vitest"
import { NO_FILTERS } from "@gge/ui/log-filter"
import { readLogParams, writeLogParams } from "../src/log-params.ts"

test("an empty URL is no filter, and no filter is an empty URL", () => {
    expect(readLogParams(new URLSearchParams())).toEqual(NO_FILTERS)
    expect(writeLogParams(NO_FILTERS).toString()).toBe("")
})

const A1 = "0b2e31bf-be05-4055-a3fb-1fef01e1ff72"
const A2 = "2895f76b-ab1f-4633-8f30-921497e62d37"

test("repeated accounts and tags, a level and text survive a round trip", () => {
    const filters = { q: "Nomad camp", levels: [2 as const], plugins: ["feast", "ggeBot"], accountIds: [A1, A2] }
    const url = writeLogParams(filters).toString()
    expect(url).toBe(`account=${A1}&account=${A2}&level=2&tag=feast&tag=ggeBot&q=Nomad+camp`)
    expect(readLogParams(new URLSearchParams(url))).toEqual(filters)
})

test("the bell's deep link reads as one account's errors", () => {
    expect(readLogParams(new URLSearchParams(`account=${A1}&level=2`))).toEqual({ ...NO_FILTERS, accountIds: [A1], levels: [2] })
})

test("a level that isn't 0, 1 or 2 is ignored, and level 0 is not assumed when absent", () => {
    for (const level of ["3", "-1", "warn", "", " ", "1.5"])
        expect(readLogParams(new URLSearchParams({ level })).levels).toEqual([])
    expect(readLogParams(new URLSearchParams("level=0")).levels).toEqual([0])
})

test("duplicate and empty values are dropped, and lists are cut to what the feed accepts", () => {
    const params = new URLSearchParams(`tag=feast&tag=&tag=feast&account=${A1}&account=${A1}`)
    expect(readLogParams(params)).toMatchObject({ plugins: ["feast"], accountIds: [A1] })
    const many = new URLSearchParams(Array.from({ length: 60 }, (_, i) => ["account", `${String(i).padStart(8, "0")}-be05-4055-a3fb-1fef01e1ff72`]))
    expect(readLogParams(many).accountIds).toHaveLength(50)
})

test("an account that isn't an id is ignored, so a mistyped link still shows the log", () => {
    expect(readLogParams(new URLSearchParams(`account=foo&account=${A1}`)).accountIds).toEqual([A1])
})

test("blank text is left out of the URL", () => {
    expect(writeLogParams({ ...NO_FILTERS, q: "   " }).toString()).toBe("")
})
