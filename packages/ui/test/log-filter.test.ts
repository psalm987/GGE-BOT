import { describe, expect, test } from "vitest"
import { renderParts } from "../src/i18n/boot.ts"
import { NO_FILTERS, activeFilters, facetsOf, filterLines, formatForDownload, messageParts, tagHue, type TerminalLine } from "../src/log-filter.ts"

const at = (h: number, m: number, s: number) => new Date(2026, 10, 17, h, m, s)
const mngLog = (plugin: string, ...rest: (string | number)[]) => ["[08:17] ", "[", plugin, "] ", ...rest]

const lines: TerminalLine[] = [
    { id: 5, ts: at(8, 20, 15), level: 2, message: "", parts: mngLog("ggeBot", "closedReason", "timedOut"), plugin: "ggeBot", accountId: "b" },
    { id: 4, ts: at(8, 19, 10), level: 0, message: "", parts: mngLog("feast", "consumed", 120), plugin: "feast", accountId: "a" },
    { id: 3, ts: at(8, 18, 4), level: 1, message: "", parts: mngLog("loginBonus", "loginBonusNoReply"), plugin: "loginBonus", accountId: "a" },
    { id: 2, ts: at(8, 17, 33), level: 0, message: "Max attacks reached", parts: ["Max attacks reached"], plugin: null, accountId: "b" },
    { id: 1, ts: at(8, 17, 32), level: 0, message: "Logged in", parts: null, plugin: null, accountId: "a" },
]

const polish: Record<string, string> = {
    closedReason: "Zamknięto z powodu: ",
    timedOut: " przekroczono czas",
    consumed: "Zużyto ",
    loginBonusNoReply: "Gra nie odpowiedziała na bonus",
}
const inPolish = (line: TerminalLine) => renderParts((key, { defaultValue }) => polish[key] ?? defaultValue, messageParts(line))
const ids = (found: TerminalLine[]) => found.map(line => line.id)

describe("filterLines", () => {
    test("no filters keeps every line in order", () => {
        expect(ids(filterLines(lines, NO_FILTERS, inPolish))).toEqual([5, 4, 3, 2, 1])
    })

    test("text matches the translated text the viewer reads, ignoring case, and not the English it was stored in", () => {
        expect(ids(filterLines(lines, { ...NO_FILTERS, q: "ZUŻYTO" }, inPolish))).toEqual([4])
        expect(ids(filterLines(lines, { ...NO_FILTERS, q: "consumed" }, inPolish))).toEqual([])
        expect(ids(filterLines(lines, { ...NO_FILTERS, q: "  max attacks " }, inPolish))).toEqual([2])
    })

    test("text also matches the tag, which the message itself leaves out", () => {
        expect(ids(filterLines(lines, { ...NO_FILTERS, q: "loginbonus" }, inPolish))).toEqual([3])
        expect(ids(filterLines(lines, { ...NO_FILTERS, q: "ggebot" }, inPolish))).toEqual([5])
    })

    test("levels, tags and accounts each narrow the list, and together they all apply", () => {
        expect(ids(filterLines(lines, { ...NO_FILTERS, levels: [1, 2] }, inPolish))).toEqual([5, 3])
        expect(ids(filterLines(lines, { ...NO_FILTERS, plugins: ["feast", "loginBonus"] }, inPolish))).toEqual([4, 3])
        expect(ids(filterLines(lines, { ...NO_FILTERS, accountIds: ["b"] }, inPolish))).toEqual([5, 2])
        expect(ids(filterLines(lines, { q: "gra", levels: [1], plugins: ["loginBonus"], accountIds: ["a"] }, inPolish))).toEqual([3])
        expect(ids(filterLines(lines, { ...NO_FILTERS, levels: [0], accountIds: ["b"], plugins: ["feast"] }, inPolish))).toEqual([])
    })

    test("a tag filter never matches an untagged line", () => {
        expect(filterLines(lines, { ...NO_FILTERS, plugins: ["null"] }, inPolish)).toEqual([])
    })
})

test("activeFilters counts every value, and blank text is no filter", () => {
    expect(activeFilters(NO_FILTERS)).toBe(0)
    expect(activeFilters({ ...NO_FILTERS, q: "   " })).toBe(0)
    expect(activeFilters({ q: "x", levels: [2], plugins: ["feast", "ggeBot"], accountIds: ["a"] })).toBe(5)
})

describe("messageParts", () => {
    test("drops the time and the tag from a line in the bot's shape", () => {
        expect(messageParts(lines[1]!)).toEqual(["consumed", 120])
    })
    test("keeps every part of a line in another shape", () => {
        expect(messageParts(lines[3]!)).toEqual(["Max attacks reached"])
        expect(messageParts({ parts: ["[08:17] ", "(", "x"], message: "" })).toEqual(["[08:17] ", "(", "x"])
    })
    test("falls back to the stored message when there are no parts", () => {
        expect(messageParts(lines[4]!)).toEqual(["Logged in"])
    })
})

test("facetsOf counts tags and levels in the API's facet shape", () => {
    expect(facetsOf(lines)).toEqual({
        total: 5,
        plugins: [{ key: "feast", count: 1 }, { key: "ggeBot", count: 1 }, { key: "loginBonus", count: 1 }],
        levels: [{ level: 0, count: 3 }, { level: 1, count: 1 }, { level: 2, count: 1 }],
    })
})

test("tagHue is stable and spreads tags over the eight colours", () => {
    expect(tagHue("attackNomads")).toBe(tagHue("attackNomads"))
    const keys = ["attackNomads", "attackBarronsGreatEmpire", "feast", "loginBonus", "taxCollector", "helpRequests", "ggeBot", "barracks", "toolsmith"]
    const hues = keys.map(tagHue)
    expect(hues.every(hue => Number.isInteger(hue) && hue >= 0 && hue < 8)).toBe(true)
    expect(new Set(hues).size).toBeGreaterThanOrEqual(5)
})

describe("formatForDownload", () => {
    const names: Record<string, string> = { a: "Ironhold" }

    test("writes the lines oldest first, with date, time, level, tag, account and the translated text", () => {
        const text = formatForDownload(lines.slice(0, 3), { renderText: inPolish, accountName: id => names[id] })
        expect(text.split("\n")).toEqual([
            "2026-11-17 08:18:04 WARN  [loginBonus] Ironhold: Gra nie odpowiedziała na bonus",
            "2026-11-17 08:19:10 INFO  [feast] Ironhold: Zużyto 120",
            "2026-11-17 08:20:15 ERROR [ggeBot] b: Zamknięto z powodu:  przekroczono czas",
            "",
        ])
    })

    test("leaves out the tag of an untagged line, and the account when no names are given", () => {
        expect(formatForDownload([lines[4]!], { renderText: inPolish })).toBe("2026-11-17 08:17:32 INFO  Logged in\n")
    })

    test("only the lines it is given end up in the file", () => {
        const filtered = filterLines(lines, { ...NO_FILTERS, levels: [2] }, inPolish)
        expect(formatForDownload(filtered, { renderText: inPolish }).trim().split("\n")).toHaveLength(1)
    })
})
