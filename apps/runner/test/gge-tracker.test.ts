import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import type { GgeTrackerReply } from "@gge/contracts"
import { GgeTracker, type TrackerAccount } from "../src/gge-tracker.ts"

const fixture = (name: string) => readFileSync(new URL(`./fixtures/gge-tracker/${name}`, import.meta.url), "utf8")
const CATALOG = fixture("catalog.xml")
const DUNGEONS = fixture("dungeons-in1-k1.json")
const FORTS = fixture("storm-forts-in1.json")
const EMPTY_DUNGEONS = JSON.stringify({ dungeons: [], pagination: { current_page: 1, total_pages: 1, current_items_count: 0, total_items_count: 0 } })

const MINUTE = 60_000
const HOUR = 60 * MINUTE
/** Before the first fortress of the fixture comes free (16:19:31Z) and before the Storm list's last fort (12:11:48Z). */
const T0 = Date.parse("2026-11-27T11:00:00Z")

type Call = { url: string; method: string; headers: Record<string, string>; timeout: boolean }

/**
 * gge-tracker.com as recorded on 2026-11-27 (fixtures/gge-tracker). `unknownName` answers a name filter with an empty
 * list, as the site does for a player it doesn't know; `down` answers every request with a 503.
 */
function site({ unknownName = false } = {}) {
    const calls: Call[] = []
    const state = { down: false }
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        calls.push({ url, method: init?.method ?? "GET", headers: Object.fromEntries(new Headers(init?.headers).entries()), timeout: init?.signal instanceof AbortSignal })
        if (state.down)
            return new Response("down", { status: 503 })
        const path = new URL(url).pathname
        if (path.endsWith("/servers/catalog"))
            return new Response(CATALOG, { headers: { "content-type": "application/xml" } })
        if (path.endsWith("/dungeons"))
            return new Response(unknownName && url.includes("filterByPlayerName") ? EMPTY_DUNGEONS : DUNGEONS)
        if (path.endsWith("/storms/forts"))
            return new Response(FORTS)
        return new Response("not found", { status: 404 })
    }
    return { fetch: fetch as typeof globalThis.fetch, calls, state }
}

const IN1 = { locaId: "generic_country_IN", instanceName: "1" }
const SERVERS: Record<number, { locaId: string; instanceName: string }> = {
    26: IN1,
    30: { locaId: "generic_country_ASIA", instanceName: "1" },
    31: { locaId: "generic_country_international", instanceName: "3" },
    32: { locaId: "generic_country_AE", instanceName: "1" },
    33: { locaId: "generic_country_KR", instanceName: "1" },
}

function tracker(web = site(), clock = { now: T0 }) {
    const gge = new GgeTracker({ fetch: web.fetch, now: () => clock.now, serverNames: id => SERVERS[id], logger: { warn() {} }, pageGapMs: 0 })
    return { gge, web, clock }
}

const account = (name: string, consent: { useTimetables?: boolean; includePlayerName?: boolean } | undefined, serverId = 26): TrackerAccount =>
    ({ name, serverId, plugins: consent ? { ggeTracker: consent } : {} })
const optedIn = (name = "Sir Test", serverId = 26) => account(name, { useTimetables: true }, serverId)
const fortresses = (id = 1, kingdom = 1) => ({ id, kind: "fortresses", kingdom })
const stormForts = (id = 1) => ({ id, kind: "stormForts" })
const fortressList = (reply: GgeTrackerReply | undefined) => reply?.ok && reply.kind == "fortresses" ? reply.fortresses : undefined
const fortList = (reply: GgeTrackerReply | undefined) => reply?.ok && reply.kind == "stormForts" ? reply.forts : undefined
const path = (call: Call) => new URL(call.url).pathname.replace("/api/v1/", "")

describe("which game servers the site has", () => {
    test("the catalog is read once, and a game server is named as the site names it", async () => {
        const { gge, web } = tracker()
        expect(await gge.answer(optedIn("a", 26), stormForts())).toMatchObject({ ok: true, server: "IN1" })
        expect(await gge.answer(optedIn("b", 30), stormForts())).toMatchObject({ ok: true, server: "ASIA" })
        expect(await gge.answer(optedIn("c", 31), stormForts())).toMatchObject({ ok: true, server: "INT3" })
        expect(web.calls.filter(call => path(call) == "servers/catalog")).toHaveLength(1)
    })

    test("a server the site has no fortress or storm data for, or has switched off, gets noServer and nothing else is fetched", async () => {
        const { gge, web } = tracker()
        expect(await gge.answer(optedIn("a", 32), fortresses(1))).toEqual({ id: 1, ok: false, error: "noServer" })
        expect(await gge.answer(optedIn("a", 32), stormForts(2))).toEqual({ id: 2, ok: false, error: "noServer" })
        expect(await gge.answer(optedIn("a", 33), stormForts(3))).toEqual({ id: 3, ok: false, error: "noServer" })
        expect(web.calls.map(path)).toEqual(["servers/catalog"])
    })
})

describe("fortress timetables", () => {
    test("a fortress list gives each fortress's position and when it can be attacked next", async () => {
        const { gge } = tracker()
        const reply = await gge.answer(optedIn(), fortresses(7, 1))
        expect(reply).toMatchObject({ id: 7, ok: true, kind: "fortresses", server: "IN1", fetchedAt: T0, withName: false })
        expect(fortressList(reply)).toEqual([
            { x: 750, y: 594, availableAt: Date.parse("2026-11-27T16:19:31.234Z") },
            { x: 555, y: 711, availableAt: Date.parse("2026-11-27T16:24:20.435Z") },
            { x: 594, y: 750, availableAt: Date.parse("2026-11-27T16:26:05.134Z") },
            { x: 536, y: 653, availableAt: Date.parse("2026-11-27T16:53:36.338Z") },
        ])
    })

    test("a kingdom without fortresses is a bad request, and nothing is fetched", async () => {
        const { gge, web } = tracker()
        expect(await gge.answer(optedIn(), fortresses(1, 4))).toEqual({ id: 1, ok: false, error: "badRequest" })
        expect(web.calls).toEqual([])
    })

    test("a list is fetched once a day per server and kingdom, and every account on that server shares it", async () => {
        const { gge, web, clock } = tracker()
        await gge.answer(optedIn("a"), fortresses(1, 1))
        await gge.answer(optedIn("b"), fortresses(1, 1))
        clock.now += 23 * HOUR
        await gge.answer(optedIn("a"), fortresses(1, 1))
        const dungeonCalls = () => web.calls.filter(call => path(call) == "dungeons")
        expect(dungeonCalls()).toHaveLength(1)
        await gge.answer(optedIn("a"), fortresses(1, 2))
        expect(dungeonCalls(), "another kingdom has its own list").toHaveLength(2)
        clock.now += 1 * HOUR
        await gge.answer(optedIn("a"), fortresses(1, 1))
        expect(dungeonCalls(), "a day later the list is fetched again").toHaveLength(3)
    })

    test("when the site doesn't know the player's name, the list is fetched again without it", async () => {
        const { gge, web } = tracker(site({ unknownName: true }))
        const reply = await gge.answer(account("Newcomer", { useTimetables: true, includePlayerName: true }), fortresses(1, 1))
        expect(reply).toMatchObject({ ok: true, withName: false })
        expect(fortressList(reply)).toHaveLength(4)
        const dungeonUrls = web.calls.filter(call => path(call) == "dungeons").map(call => call.url)
        expect(dungeonUrls).toHaveLength(2)
        expect(dungeonUrls[0]).toContain("filterByPlayerName=Newcomer")
        expect(dungeonUrls[1]).not.toContain("filterByPlayerName")
    })

    test("a list the site gives for the named player says so", async () => {
        const { gge } = tracker()
        expect(await gge.answer(account("Sir Test", { useTimetables: true, includePlayerName: true }), fortresses(1, 1))).toMatchObject({ ok: true, withName: true })
    })

    test("after a failed fetch the site is asked again only 30 minutes later", async () => {
        const { gge, web, clock } = tracker()
        await gge.answer(optedIn(), stormForts())
        web.state.down = true
        expect(await gge.answer(optedIn(), fortresses(4, 1))).toEqual({ id: 4, ok: false, error: "unavailable" })
        const dungeonCalls = () => web.calls.filter(call => path(call) == "dungeons").length
        expect(dungeonCalls()).toBe(1)
        web.state.down = false
        clock.now += 29 * MINUTE
        expect(await gge.answer(optedIn(), fortresses(5, 1))).toEqual({ id: 5, ok: false, error: "unavailable" })
        expect(dungeonCalls()).toBe(1)
        clock.now += 1 * MINUTE
        expect(await gge.answer(optedIn(), fortresses(6, 1))).toMatchObject({ id: 6, ok: true })
        expect(dungeonCalls()).toBe(2)
    })

    test("accounts that ask at the same moment wait for one fetch", async () => {
        const { gge, web } = tracker()
        await Promise.all([gge.answer(optedIn("a"), fortresses(1, 1)), gge.answer(optedIn("b"), fortresses(2, 1))])
        expect(web.calls.filter(call => path(call) == "dungeons")).toHaveLength(1)
    })
})

describe("Storm fort timetables", () => {
    test("a fort list gives each fort's position, type, victories, whether it is shown and its times", async () => {
        const { gge } = tracker()
        const reply = await gge.answer(optedIn(), stormForts(3))
        expect(reply).toMatchObject({ id: 3, ok: true, kind: "stormForts", server: "IN1", fetchedAt: T0 })
        expect(fortList(reply)?.[0]).toEqual({
            x: 629, y: 620, isleID: 10, victories: 9, visible: true,
            availableAt: Date.parse("2026-11-27T11:28:02.856Z"), updatedAt: Date.parse("2026-11-27T15:32:49.448Z"),
        })
        expect(fortList(reply)).toHaveLength(5)
    })

    test("the list is fetched again 30 minutes before it runs out, and at most every 15 minutes", async () => {
        const { gge, web, clock } = tracker()
        const fortCalls = () => web.calls.filter(call => path(call) == "storms/forts").length
        await gge.answer(optedIn(), stormForts())
        // The last fort comes free at 12:11:48Z.
        clock.now = Date.parse("2026-11-27T11:40:00Z")
        await gge.answer(optedIn(), stormForts())
        expect(fortCalls(), "31 minutes before the end the list is still good").toBe(1)
        clock.now = Date.parse("2026-11-27T11:45:00Z")
        await gge.answer(optedIn(), stormForts())
        expect(fortCalls(), "26 minutes before the end it is fetched again").toBe(2)
        clock.now = Date.parse("2026-11-27T11:59:00Z")
        await gge.answer(optedIn(), stormForts())
        expect(fortCalls(), "not again within 15 minutes").toBe(2)
        clock.now = Date.parse("2026-11-27T12:00:00Z")
        await gge.answer(optedIn(), stormForts())
        expect(fortCalls()).toBe(3)
    })

    test("one list serves every account on the server", async () => {
        const { gge, web } = tracker()
        await gge.answer(optedIn("a"), stormForts())
        await gge.answer(optedIn("b"), stormForts())
        expect(web.calls.filter(call => path(call) == "storms/forts")).toHaveLength(1)
    })
})

describe("what the requests carry", () => {
    test("every request is a GET with a 10 s timeout and a generic User-Agent, and the timetables name the game server", async () => {
        const { gge, web } = tracker()
        await gge.answer(account("Sir Test", { useTimetables: true, includePlayerName: true }), fortresses(1, 1))
        await gge.answer(optedIn(), stormForts())
        expect(web.calls.map(path)).toEqual(["servers/catalog", "dungeons", "storms/forts"])
        for (const call of web.calls) {
            expect(call.method).toBe("GET")
            expect(call.timeout).toBe(true)
            expect(call.headers["user-agent"]).toMatch(/^Mozilla\/5\.0/)
            expect(JSON.stringify(call.headers)).not.toContain("Sir Test")
        }
        expect(web.calls.slice(1).map(call => call.headers["gge-server"])).toEqual(["IN1", "IN1"])
        expect(web.calls[1]!.url).toBe("https://api.gge-tracker.com/api/v1/dungeons?page=1&size=100&filterByKid=%5B%221%22%5D&filterByPlayerName=Sir%20Test")
        expect(web.calls[2]!.url).toBe("https://api.gge-tracker.com/api/v1/storms/forts?page=1&size=500")
    })
})

describe("privacy", () => {
    test("with the box off nothing is fetched, for any request", async () => {
        const { gge, web } = tracker()
        for (const consent of [undefined, {}, { useTimetables: false }, { useTimetables: false, includePlayerName: true }]) {
            expect(await gge.answer(account("Sir Test", consent), fortresses(1, 1))).toEqual({ id: 1, ok: false, error: "off" })
            expect(await gge.answer(account("Sir Test", consent), stormForts(2))).toEqual({ id: 2, ok: false, error: "off" })
        }
        expect(web.calls).toEqual([])
    })

    test("the player's name leaves only when the second box is ticked", async () => {
        const { gge, web } = tracker()
        await gge.answer(account("Sir Test", { useTimetables: true }), fortresses(1, 1))
        await gge.answer(account("Sir Test", { useTimetables: true }), fortresses(1, 2))
        await gge.answer(account("Sir Test", { useTimetables: true, includePlayerName: true }), stormForts())
        expect(web.calls.length).toBeGreaterThan(0)
        for (const call of web.calls) {
            expect(call.url).not.toContain("filterByPlayerName")
            expect(call.url).not.toContain("Sir")
        }
        await gge.answer(account("Sir Test", { useTimetables: true, includePlayerName: true }), fortresses(1, 1))
        expect(web.calls.at(-1)!.url).toContain("filterByPlayerName=Sir%20Test")
    })

    test("a request that isn't one the runner knows is answered as bad, and fetches nothing", async () => {
        const { gge, web } = tracker()
        expect(await gge.answer(optedIn(), { id: 9, kind: "players" })).toEqual({ id: 9, ok: false, error: "badRequest" })
        expect(await gge.answer(optedIn(), { kind: "stormForts" })).toBeUndefined()
        expect(web.calls).toEqual([])
    })
})
