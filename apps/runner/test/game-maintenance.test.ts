import { describe, expect, test } from "vitest"
import { MAINTENANCE_URL, gameMaintenance } from "../src/gameMaintenance.ts"

const NOW = Date.parse("2026-11-26T12:00:00Z")
const inAnHour = NOW / 1000 + 3600

function fakeFile(...bodies: (unknown | Error)[]) {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetch = (async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        const body = bodies[Math.min(calls.length, bodies.length) - 1]
        if (body instanceof Error)
            throw body
        return new Response(JSON.stringify(body), { status: 200 })
    }) as typeof globalThis.fetch
    return { fetch, calls }
}

const quiet = { warn() {} }

describe("game maintenance", () => {
    test("a listed zone is in maintenance until its end, and an unlisted one is not", async () => {
        const { fetch } = fakeFile({ 163: inAnHour })
        const endsAt = gameMaintenance({ fetch, now: () => NOW, log: quiet })

        expect(await endsAt("163")).toBe(inAnHour * 1000)
        expect(await endsAt("121")).toBeUndefined()
        expect(await endsAt(undefined)).toBeUndefined()
    })

    test("an empty list means no zone is in maintenance", async () => {
        const { fetch } = fakeFile([])
        expect(await gameMaintenance({ fetch, now: () => NOW, log: quiet })("163")).toBeUndefined()
    })

    test("an end that has passed is not maintenance", async () => {
        const { fetch } = fakeFile({ 163: NOW / 1000 - 1 })
        expect(await gameMaintenance({ fetch, now: () => NOW, log: quiet })("163")).toBeUndefined()
    })

    test("the file is read at most once a minute, and calls at the same time share one read", async () => {
        let now = NOW
        const { fetch, calls } = fakeFile({ 163: inAnHour })
        const endsAt = gameMaintenance({ fetch, now: () => now, log: quiet })

        await Promise.all([endsAt("163"), endsAt("163"), endsAt("121")])
        now += 59_000
        await endsAt("163")
        expect(calls).toHaveLength(1)

        now += 1_000
        await endsAt("163")
        expect(calls).toHaveLength(2)
    })

    test("the public file is asked for with a generic browser agent and a 10 s timeout", async () => {
        const { fetch, calls } = fakeFile([])
        await gameMaintenance({ fetch, now: () => NOW, log: quiet })("163")

        const [{ url, init }] = calls as [typeof calls[number]]
        expect(url).toBe(MAINTENANCE_URL)
        expect(new Headers(init?.headers).get("user-agent")).toMatch(/^Mozilla\/5\.0/)
        expect(init?.signal).toBeInstanceOf(AbortSignal)
    })

    test("a file that can't be read lets logins go ahead, and is tried again a minute later", async () => {
        let now = NOW
        const warnings: unknown[] = []
        const { fetch, calls } = fakeFile(new Error("offline"), { 163: inAnHour })
        const endsAt = gameMaintenance({ fetch, now: () => now, log: { warn: (...args: unknown[]) => void warnings.push(args) } })

        expect(await endsAt("163")).toBeUndefined()
        expect(warnings).toHaveLength(1)
        now += 60_000
        expect(await endsAt("163")).toBe(inAnHour * 1000)
        expect(calls).toHaveLength(2)
    })
})
