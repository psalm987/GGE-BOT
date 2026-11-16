import { describe, expect, test } from "vitest"
import { countedAccounts, entitledAccountIds, planRunsMessage, twinMainIds, type PlanAccount } from "../src/index.ts"

const player = (maxBots: number) => ({ role: "user" as const, maxBots })
let clock = 0
const account = (id: string, over: Partial<PlanAccount> = {}): PlanAccount =>
    ({ id, serverId: 26, name: id, externalEvent: false, createdAt: new Date(Date.UTC(2026, 0, 1) + ++clock * 1000), ...over })
const ids = (set: Set<string>) => [...set].sort()

describe("entitledAccountIds", () => {
    test("the oldest maxBots accounts run, whatever order they arrive in", () => {
        const [a, b, c] = [account("a"), account("b"), account("c")]
        expect(ids(entitledAccountIds(player(2), [c, a, b]))).toEqual(["a", "b"])
    })

    test("an event twin is free and runs with its main", () => {
        const main = account("main", { name: "Knight" })
        const twin = account("twin", { name: "Knight", externalEvent: true })
        expect(ids(entitledAccountIds(player(1), [main, twin]))).toEqual(["main", "twin"])
        expect(countedAccounts([main, twin])).toBe(1)
    })

    test("a twin of a main the plan doesn't cover can't run either", () => {
        const older = account("older")
        const main = account("main", { name: "Knight" })
        const twin = account("twin", { name: "Knight", externalEvent: true })
        expect(ids(entitledAccountIds(player(1), [older, main, twin]))).toEqual(["older"])
    })

    test("a twin older than its main still follows the main's slot", () => {
        const twin = account("twin", { name: "Knight", externalEvent: true })
        const other = account("other")
        const main = account("main", { name: "Knight" })
        expect(ids(entitledAccountIds(player(1), [twin, other, main]))).toEqual(["other"])
        expect(ids(entitledAccountIds(player(2), [twin, other, main]))).toEqual(["main", "other", "twin"])
    })

    test("an event account with no main counts like any account", () => {
        const solo = account("solo", { externalEvent: true })
        const later = account("later")
        expect(ids(entitledAccountIds(player(1), [solo, later]))).toEqual(["solo"])
        expect(countedAccounts([solo, later])).toBe(2)
    })

    test("names match case-insensitively", () => {
        const main = account("main", { name: "Knight" })
        const twin = account("twin", { name: "kNIGHT", externalEvent: true })
        expect(twinMainIds([main, twin])).toEqual(new Map([["twin", "main"]]))
    })

    test("the same name on another server is not a twin", () => {
        const main = account("main", { name: "Knight", serverId: 26 })
        const elsewhere = account("elsewhere", { name: "Knight", serverId: 27, externalEvent: true })
        expect(twinMainIds([main, elsewhere]).size).toBe(0)
        expect(ids(entitledAccountIds(player(1), [main, elsewhere]))).toEqual(["main"])
    })

    test("two non-event accounts with one name are never twins of each other", () => {
        const a = account("a", { name: "Knight", serverId: 26 })
        const b = account("b", { name: "Knight", serverId: 27 })
        expect(countedAccounts([a, b])).toBe(2)
    })

    test("accounts created at the same instant are ordered by id", () => {
        const createdAt = new Date(Date.UTC(2026, 5, 1))
        const accounts = ["c", "a", "b"].map(id => account(id, { createdAt }))
        expect(ids(entitledAccountIds(player(1), accounts))).toEqual(["a"])
        expect(ids(entitledAccountIds(player(2), accounts))).toEqual(["a", "b"])
    })

    test("a limit of zero runs nothing, twins included", () => {
        const main = account("main", { name: "Knight" })
        const twin = account("twin", { name: "Knight", externalEvent: true })
        expect(entitledAccountIds(player(0), [main, twin]).size).toBe(0)
    })

    test("admins run every account regardless of maxBots", () => {
        const accounts = [account("a"), account("b", { externalEvent: true }), account("c")]
        expect(ids(entitledAccountIds({ role: "admin", maxBots: 0 }, accounts))).toEqual(["a", "b", "c"])
    })

    test("no accounts, nothing entitled", () => {
        expect(entitledAccountIds(player(3), []).size).toBe(0)
    })
})

describe("planRunsMessage", () => {
    test("names the limit in words a player reads", () => {
        expect(planRunsMessage(0)).toBe("Your plan doesn't include running bots.")
        expect(planRunsMessage(1)).toMatch(/^Your plan runs your oldest bot and their event twins\./)
        expect(planRunsMessage(3)).toMatch(/^Your plan runs your 3 oldest bots/)
    })
})
