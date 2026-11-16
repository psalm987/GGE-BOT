import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { botLogs, botRuns, botStatus, runnerHeartbeat } from "@gge/db"
import { startApi, type Api } from "./harness.ts"

let api: Api
beforeAll(async () => { api = await startApi() })
afterAll(() => api.close())

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const newAccount = (name: string) => ({ name, serverId: 26, password: "pw", externalEvent: false, plugins: {} })

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
