import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { CHANNELS, botLogs, botRuns, botStatus, runnerHeartbeat } from "@gge/db"
import { startApi, type Api } from "./harness.ts"

let api: Api
beforeAll(async () => { api = await startApi() })
afterAll(() => api.close())

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const newAccount = (name: string) => ({ name, serverId: 26, password: "pw", externalEvent: false, plugins: {} })
const announce = (payload: object) => api.db.execute(sql`select pg_notify(${CHANNELS.bot}, ${JSON.stringify(payload)})`)

/** Collects events from a stream until `count` arrive or `ms` pass. */
async function collect<T>(stream: AsyncIterator<T>, count: number, ms = 2000) {
    const seen: T[] = []
    const deadline = Date.now() + ms
    while (seen.length < count && Date.now() < deadline) {
        const next = await Promise.race([stream.next(), new Promise<null>(r => setTimeout(() => r(null), deadline - Date.now()))])
        if (!next || next.done) break
        seen.push(next.value)
    }
    return seen
}

describe("live bot events", () => {
    test("a player sees status and log events for their own accounts only", async () => {
        const alice = await api.player()
        const bob = await api.player()
        const mine = await alice.api.accounts.create(newAccount("alice-bot"))
        const theirs = await bob.api.accounts.create(newAccount("bob-bot"))

        const stream = await alice.api.accounts.events()
        await new Promise(r => setTimeout(r, 150))

        await api.db.insert(botStatus).values([
            { accountId: theirs.id, actualState: "running" },
            { accountId: mine.id, actualState: "running", heartbeatAt: new Date() },
        ])
        await announce({ kind: "status", accountId: theirs.id })
        await announce({ kind: "log", accountId: theirs.id, id: 1, ts: new Date().toISOString(), level: 0, message: "bob's secret" })
        await announce({ kind: "status", accountId: mine.id })
        await announce({ kind: "log", accountId: mine.id, id: 2, ts: new Date().toISOString(), level: 1, message: "Logged in" })

        const events = await collect(stream, 3, 1500)
        await stream.return?.()
        expect(events).toEqual([
            { kind: "status", accountId: mine.id, status: expect.objectContaining({ actualState: "running" }) },
            { kind: "log", accountId: mine.id, line: expect.objectContaining({ id: 2, level: 1, message: "Logged in" }) },
        ])
    })

    test("an account added after the stream opened still streams", async () => {
        const carol = await api.player()
        const stream = await carol.api.accounts.events()
        await new Promise(r => setTimeout(r, 150))

        const late = await carol.api.accounts.create(newAccount("carol-late"))
        await announce({ kind: "log", accountId: late.id, id: 3, ts: new Date().toISOString(), level: 0, message: "hello" })

        const [event] = await collect(stream, 1)
        await stream.return?.()
        expect(event).toMatchObject({ kind: "log", accountId: late.id })
    })

    test("signed-out callers can't open the stream", async () => {
        expect(await codeOf(api.client().api.accounts.events())).toBe("UNAUTHORIZED")
    })
})

describe("history", () => {
    test("logs and runs come back newest first, only to the account's owner", async () => {
        const owner = await api.player()
        const other = await api.player()
        const { id } = await owner.api.accounts.create(newAccount("history-bot"))
        await api.db.insert(botLogs).values([1, 2, 3].map(n => ({ accountId: id, level: 0, message: `line ${n}`, parts: [`line ${n}`] })))
        await api.db.insert(botRuns).values([
            { accountId: id, startedAt: new Date(Date.now() - 7200_000), endedAt: new Date(Date.now() - 3600_000), endReason: "crash" },
            { accountId: id, startedAt: new Date(Date.now() - 3600_000) },
        ])

        const logs = await owner.api.accounts.logs({ id, limit: 2 })
        expect(logs.map(l => l.message)).toEqual(["line 3", "line 2"])
        expect(logs[0]!.parts).toEqual(["line 3"])
        expect((await owner.api.accounts.logs({ id, before: logs[1]!.id })).map(l => l.message)).toEqual(["line 1"])

        const runs = await owner.api.accounts.runs({ id })
        expect(runs.map(r => r.endReason)).toEqual([null, "crash"])

        expect(await codeOf(other.api.accounts.logs({ id }))).toBe("NOT_FOUND")
        expect(await codeOf(other.api.accounts.runs({ id }))).toBe("NOT_FOUND")
    })
})

test("the admin overview shows the runner's heartbeat and the last day's runs and crashes", async () => {
    const admin = await api.signedInAdmin()
    expect((await admin.api.overview()).runner).toBeNull()

    await api.db.insert(runnerHeartbeat).values({ id: 1, startedAt: new Date(), beatAt: new Date(), version: "test", running: 3 })
    const owner = await api.player()
    const { id } = await owner.api.accounts.create(newAccount("gave-up-bot"))
    await api.db.insert(botStatus).values({ accountId: id, actualState: "crash_loop", lastError: "Stopped after 8 failed starts in a row: The bot stopped responding" })
    await api.db.insert(botRuns).values({ accountId: id, startedAt: new Date(Date.now() - 60_000), endedAt: new Date(), endReason: "stale" })

    const overview = await admin.api.overview()
    expect(overview.runner).toMatchObject({ version: "test", running: 3 })
    expect(overview.last24h).toEqual({ runs: 3, crashes: 2 })
    expect(overview.bots).toMatchObject({ crash_loop: 1 })
    expect((await owner.api.accounts.list()).find(a => a.id === id)?.status).toMatchObject({ actualState: "crash_loop" })
})

test("/metrics reports request latency by route pattern, never by account", async () => {
    const p = await api.player()
    const { id } = await p.api.accounts.create(newAccount("metrics-bot"))
    await p.api.accounts.logs({ id })
    const text = await (await fetch(`${api.baseUrl}/metrics`)).text()
    expect(text).toMatch(/http_request_duration_seconds_count\{[^}]*route="\/rpc\/\*"[^}]*\}/)
    expect(text).not.toContain(id)
})
