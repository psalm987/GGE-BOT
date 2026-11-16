import { randomUUID } from "node:crypto"
import { asc, eq, inArray, like, sql } from "drizzle-orm"
import { afterAll, afterEach, beforeAll, beforeEach, expect, inject, test, vi } from "vitest"
import {
    auditLog, botLogs, botRuns, centrifugoOutbox, createDb, emailTokens, gameAccounts, loginChallenges, notifications, publish, servers, sessions, users, type Db,
} from "@gge/db"
import { prunes, runPrunes } from "../src/maintenance.ts"

let db: Db
let ownerId: string
let accountId: string
let tag: string

beforeAll(async () => {
    db = createDb(inject("databaseUrl"))
    await db.insert(servers).values({ id: 26, label: "India 1", wsHost: "in1.test", zone: "EmpireEx_26" }).onConflictDoNothing()
})
afterAll(() => db.$pool.end())

beforeEach(async () => {
    tag = `maint-${randomUUID()}`
    const [owner] = await db.insert(users).values({ username: tag, passwordHash: "x" }).returning()
    ownerId = owner!.id
    const [account] = await db.insert(gameAccounts).values({ ownerId, name: tag, serverId: 26, passwordSealed: Buffer.from("x") }).returning()
    accountId = account!.id
})
afterEach(async () => {
    await db.delete(auditLog).where(like(auditLog.action, `${tag}%`))
    await db.delete(users).where(eq(users.id, ownerId))
})

const run = async (options?: Parameters<typeof prunes>[1]) => runPrunes(prunes(db, options), { log() {}, error() {} })
const mine = () => db.select().from(notifications).where(eq(notifications.userId, ownerId)).orderBy(asc(notifications.id))
const ago = (unit: "days" | "hours" | "mins", n: number) => sql`now() - make_interval(${sql.raw(unit)} => ${n})`
const ahead = (unit: "mins", n: number) => sql`now() + make_interval(${sql.raw(unit)} => ${n})`

test("sessions are removed once expired", async () => {
    await db.insert(sessions).values([
        { id: `${tag}-live`, userId: ownerId, audience: "client", expiresAt: ahead("mins", 1) },
        { id: `${tag}-dead`, userId: ownerId, audience: "client", expiresAt: ago("mins", 1) },
    ])
    await run()
    expect((await db.select().from(sessions).where(eq(sessions.userId, ownerId))).map(s => s.id)).toEqual([`${tag}-live`])
})

test("email tokens are kept for a day after they expire", async () => {
    const add = (name: string, hours: number) => ({ userId: ownerId, purpose: "verify_email" as const, tokenHash: `${tag}-${name}`, email: "a@b.test", expiresAt: ago("hours", hours) })
    await db.insert(emailTokens).values([add("23h", 23), add("25h", 25), { ...add("future", 0), expiresAt: ahead("mins", 5) }])
    await run()
    expect((await db.select().from(emailTokens).where(eq(emailTokens.userId, ownerId))).map(t => t.tokenHash).sort()).toEqual([`${tag}-23h`, `${tag}-future`])
})

test("login challenges are removed once expired", async () => {
    await db.insert(loginChallenges).values([
        { id: `${tag}-live`, userId: ownerId, expiresAt: ahead("mins", 1) },
        { id: `${tag}-dead`, userId: ownerId, expiresAt: ago("mins", 1) },
    ])
    await run()
    expect((await db.select().from(loginChallenges).where(eq(loginChallenges.userId, ownerId))).map(c => c.id)).toEqual([`${tag}-live`])
})

test("audit entries are kept for the configured number of days, 365 by default", async () => {
    const add = (name: string, days: number) => ({ action: `${tag}-${name}`, ts: ago("days", days) })
    await db.insert(auditLog).values([add("29d", 29), add("31d", 31), add("364d", 364), add("366d", 366)])
    const left = async () => (await db.select().from(auditLog).where(like(auditLog.action, `${tag}%`))).map(e => e.action.slice(tag.length + 1)).sort()

    await run()
    expect(await left()).toEqual(["29d", "31d", "364d"])

    await run({ auditDays: 30 })
    expect(await left()).toEqual(["29d"])
})

test("runs are kept 90 days by start, and a run still open is never removed", async () => {
    const add = (error: string, days: number, ended: boolean) => ({ accountId, error, startedAt: ago("days", days), endedAt: ended ? ago("days", days) : null })
    await db.insert(botRuns).values([add("89d", 89, true), add("91d", 91, true), add("open 200d", 200, false)])
    await run()
    expect((await db.select().from(botRuns).where(eq(botRuns.accountId, accountId))).map(r => r.error).sort()).toEqual(["89d", "open 200d"])
})

test("logs go after 7 days, and an account keeps only its newest 500 lines", async () => {
    await db.insert(botLogs).values([
        { accountId, level: 1, message: "old", ts: ago("days", 8) },
        { accountId, level: 1, message: "recent", ts: ago("days", 6) },
    ])
    await db.execute(sql`insert into ${botLogs} (account_id, level, message) select ${accountId}, 1, 'bulk ' || n from generate_series(1, 500) n`)
    await run()
    const rows = await db.select().from(botLogs).where(eq(botLogs.accountId, accountId)).orderBy(asc(botLogs.id))
    expect(rows).toHaveLength(500)
    expect(rows.map(r => r.message)).not.toContain("old")
    expect(rows.map(r => r.message)).not.toContain("recent")
    expect(rows.at(-1)!.message).toBe("bulk 500")
})

test("pruning removes read notifications after 30 days and unread ones after 180", async () => {
    const add = async (label: string, days: number, read: boolean) => {
        await db.insert(notifications).values({
            userId: ownerId, accountId, kind: "shutoff", data: { accountName: label, serverLabel: "India 1" }, dedupKey: label,
            createdAt: sql`now() - make_interval(days => ${days})`, readAt: read ? new Date() : null,
        })
    }
    await add("read, 29 days", 29, true)
    await add("read, 31 days", 31, true)
    await add("unread, 31 days", 31, false)
    await add("unread, 179 days", 179, false)
    await add("unread, 181 days", 181, false)

    await run()

    expect((await mine()).map(row => row.dedupKey)).toEqual(["read, 29 days", "unread, 31 days", "unread, 179 days"])
})

test("pruning removes only messages nobody collected for over an hour", async () => {
    const channel = `test:${randomUUID()}`
    await publish(db, channel, "fresh")
    await publish(db, channel, "almost")
    await publish(db, channel, "stale")
    const age = (data: string, minutes: number) => db.update(centrifugoOutbox)
        .set({ createdAt: sql`now() - make_interval(mins => ${minutes})` })
        .where(sql`${centrifugoOutbox.payload} = ${JSON.stringify({ channel, data })}::jsonb`)
    await age("almost", 59)
    await age("stale", 61)

    await run()

    const rows = await db.select().from(centrifugoOutbox).where(sql`${centrifugoOutbox.payload}->>'channel' = ${channel}`).orderBy(asc(centrifugoOutbox.id))
    expect(rows.map(r => (r.payload as { data: string }).data)).toEqual(["fresh", "almost"])
})


test("a prune that fails is logged and the others still run", async () => {
    const error = vi.fn()
    const deleted = await runPrunes([
        { name: "first", run: async () => 2 },
        { name: "broken", run: async () => { throw new Error("locked") } },
        { name: "last", run: async () => 3 },
    ], { log() {}, error })
    expect(deleted).toEqual({ first: 2, last: 3 })
    expect(error).toHaveBeenCalledWith("prune broken failed", expect.objectContaining({ message: "locked" }))
})

test("a prune deletes more rows than one batch holds", async () => {
    await db.insert(sessions).values(Array.from({ length: 5 }, (_, i) => ({ id: `${tag}-${i}`, userId: ownerId, audience: "client" as const, expiresAt: ago("mins", 1) })))
    await db.insert(auditLog).values(Array.from({ length: 5 }, (_, i) => ({ action: `${tag}-${i}`, ts: ago("days", 400) })))
    const deleted = await run({ batch: 2 })
    expect(deleted).toMatchObject({ sessions: 5, audit_log: 5 })
    expect(await db.select().from(sessions).where(inArray(sessions.id, [0, 1, 2, 3, 4].map(i => `${tag}-${i}`)))).toEqual([])
})
