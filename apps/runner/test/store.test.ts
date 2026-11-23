import { randomUUID } from "node:crypto"
import { asc, eq, sql } from "drizzle-orm"
import { afterAll, afterEach, beforeAll, beforeEach, expect, inject, test } from "vitest"
import { BotChannelEvent, Notification, UserEvent, botChannel, userChannel } from "@gge/contracts"
import { botLogs, botStatus, centrifugoOutbox, createDb, gameAccounts, notifications, servers, users, type Db } from "@gge/db"
import { createStore, type Store } from "../src/store.ts"

let db: Db
let store: Store
let ownerId: string
let accountId: string

beforeAll(async () => {
    db = createDb(inject("databaseUrl"))
    await db.insert(servers).values({ id: 26, label: "India 1", wsHost: "in1.test", zone: "EmpireEx_26" }).onConflictDoNothing()
})
afterAll(() => db.$pool.end())

beforeEach(async () => {
    const name = `store-${randomUUID()}`
    const [owner] = await db.insert(users).values({ username: name, passwordHash: "x" }).returning()
    ownerId = owner!.id
    const [account] = await db.insert(gameAccounts).values({ ownerId, name, serverId: 26, passwordSealed: Buffer.from("x") }).returning()
    accountId = account!.id
    store = createStore(db, { flushMs: 5 })
})
// Other test files reconcile every wanted account in this database, so leave none behind.
afterEach(() => db.delete(users).where(eq(users.id, ownerId)))

type Message = { channel: string; data: unknown }
/** What Centrifugo would deliver on a channel, oldest first. */
async function published(channel: string) {
    const rows = await db.select().from(centrifugoOutbox)
        .where(sql`${centrifugoOutbox.payload}->>'channel' = ${channel}`).orderBy(asc(centrifugoOutbox.id))
    expect(rows.every(r => r.method === "publish" && r.partition === 0)).toBe(true)
    return rows.map(r => (r.payload as Message).data)
}
const mentions = async (id: string) =>
    (await db.select().from(centrifugoOutbox).where(sql`${centrifugoOutbox.payload}::text like ${`%${id}%`}`)).length

test("a status change is published to the owner with the whole status", async () => {
    const bannedUntil = new Date("2031-02-03T04:05:06.000Z")
    await store.setStatus(accountId, { actualState: "banned", lastError: "IS_BANNED", bannedUntil, heartbeat: true })

    const events = (await published(userChannel(ownerId))).map(data => UserEvent.parse(data))
    const [saved] = await db.select().from(botStatus).where(eq(botStatus.accountId, accountId))
    expect(events).toEqual([{
        v: 1, kind: "status", accountId,
        status: { actualState: "banned", lastError: "IS_BANNED", bannedUntil, heartbeatAt: saved!.heartbeatAt, pluginStates: {}, castles: [], commanders: null, gamePresets: [], resources: null },
    }])
    expect(saved!.heartbeatAt).toBeInstanceOf(Date)
})

test("a later partial change still publishes every status field", async () => {
    await store.setStatus(accountId, { actualState: "error", lastError: "boom" })
    await store.setStatus(accountId, { heartbeat: true })

    const [, second] = (await published(userChannel(ownerId))).map(data => UserEvent.parse(data))
    expect(second).toMatchObject({ kind: "status", status: { actualState: "error", lastError: "boom", bannedUntil: null } })
})

test("flushed log lines are published to the account's channel with their parts", async () => {
    store.log(accountId, 0, ["[12:00] ", "[", "attackNomads", "] ", "started ", 3], "[12:00] [attackNomads] started 3")
    store.log(accountId, 2, "not a list", "plain")
    await store.flushLogs()

    const saved = await db.select().from(botLogs).where(eq(botLogs.accountId, accountId)).orderBy(asc(botLogs.id))
    const events = (await published(botChannel(accountId))).map(data => BotChannelEvent.parse(data))
    expect(events).toEqual([
        { v: 1, kind: "log", accountId, line: { id: saved[0]!.id, ts: saved[0]!.ts, level: 0, message: "[12:00] [attackNomads] started 3", parts: ["[12:00] ", "[", "attackNomads", "] ", "started ", 3], plugin: "attackNomads" } },
        { v: 1, kind: "log", accountId, line: { id: saved[1]!.id, ts: saved[1]!.ts, level: 2, message: "plain", parts: null, plugin: null } },
    ])
    expect(saved.map(row => row.plugin)).toEqual(["attackNomads", null])
    expect(await published(userChannel(ownerId))).toEqual([])
})

test("nothing is published for a deleted account, and its lines don't cost other accounts theirs", async () => {
    const gone = randomUUID()
    await store.setStatus(gone, { actualState: "running" })
    await store.endAccount(gone, { actualState: "banned", notification: { kind: "shutoff", runId: 1 } })
    store.log(gone, 0, ["x"], "from a deleted account")
    store.log(accountId, 0, ["y"], "from a live account")
    await store.flushLogs()

    expect(await mentions(gone)).toBe(0)
    expect(await published(botChannel(accountId))).toHaveLength(1)
})

const mine = () => db.select().from(notifications).where(eq(notifications.userId, ownerId)).orderBy(asc(notifications.id))

test("ending an account saves why, stops it and notifies its owner, in that order on their channel", async () => {
    const bannedUntil = new Date("2031-02-03T04:05:06.000Z")
    await store.endAccount(accountId, {
        actualState: "banned", lastError: "IS_BANNED", bannedUntil,
        notification: { kind: "banned", bannedUntil: bannedUntil.toISOString(), runId: 7 },
    })

    const [account] = await db.select().from(gameAccounts).where(eq(gameAccounts.id, accountId))
    expect(account!.desiredState).toBe("stopped")
    const [row] = await mine()
    expect(row).toMatchObject({
        accountId, kind: "banned", readAt: null, emailState: "pending",
        data: { accountName: account!.name, serverLabel: "India 1", bannedUntil: "2031-02-03T04:05:06.000Z" },
    })
    const events = (await published(userChannel(ownerId))).map(data => UserEvent.parse(data))
    expect(events).toEqual([
        { v: 1, kind: "status", accountId, status: { actualState: "banned", lastError: "IS_BANNED", bannedUntil, heartbeatAt: null, pluginStates: {}, castles: [], commanders: null, gamePresets: [], resources: null } },
        { v: 1, kind: "account", accountId, desiredState: "stopped" },
        { v: 1, kind: "notification", notification: Notification.parse({ id: row!.id, kind: "banned", data: row!.data, accountId, createdAt: row!.createdAt, readAt: null }) },
    ])
})

test("an ending without a status leaves the status alone", async () => {
    await store.setStatus(accountId, { actualState: "running" })
    await store.endAccount(accountId, { notification: { kind: "shutoff", runId: 7 } })

    expect((await db.select().from(botStatus).where(eq(botStatus.accountId, accountId)))[0]!.actualState).toBe("running")
    expect((await published(userChannel(ownerId))).map(data => UserEvent.parse(data).kind)).toEqual(["status", "account", "notification"])
    expect(await mine()).toMatchObject([{ kind: "shutoff" }])
})

test("the same run's ending reported twice notifies once, and another run's notifies again", async () => {
    const ending = (runId: number) => ({ actualState: "auth_failed" as const, lastError: "INVALID_PASSWORD", notification: { kind: "auth_failed" as const, lastError: "INVALID_PASSWORD", runId } })
    await store.endAccount(accountId, ending(7))
    await store.endAccount(accountId, ending(7))
    const notified = async () => (await published(userChannel(ownerId))).filter(data => UserEvent.parse(data).kind === "notification").length
    expect(await mine()).toHaveLength(1)
    expect(await notified()).toBe(1)

    await store.endAccount(accountId, ending(8))
    expect(await mine()).toHaveLength(2)
    expect(await notified()).toBe(2)
})

test("a notification outlives its account and keeps the account's name", async () => {
    await store.endAccount(accountId, { actualState: "crash_loop", lastError: "x", notification: { kind: "crash_loop", failures: 8, lastError: "boom", runId: 7 } })
    const [account] = await db.select().from(gameAccounts).where(eq(gameAccounts.id, accountId))
    await db.delete(gameAccounts).where(eq(gameAccounts.id, accountId))

    expect(await mine()).toMatchObject([{ accountId: null, kind: "crash_loop", data: { accountName: account!.name, failures: 8, lastError: "boom" } }])
})

test("a bot's notice reaches its owner with the account's name and server, once per key", async () => {
    const notice = { kind: "station_result", key: "0:1001:1", data: { castle: "Keep", outcome: "stationed", destination: "Ally (3:4)", rubies: null } } as const
    await store.notifyOwner(accountId, notice)
    await store.notifyOwner(accountId, notice)
    await store.notifyOwner(accountId, { ...notice, key: "0:1001:2" })

    const [account] = await db.select().from(gameAccounts).where(eq(gameAccounts.id, accountId))
    const rows = await mine()
    expect(rows).toMatchObject([
        { accountId, kind: "station_result", data: { accountName: account!.name, serverLabel: "India 1", castle: "Keep", outcome: "stationed", destination: "Ally (3:4)" } },
        { kind: "station_result" },
    ])
    const events = (await published(userChannel(ownerId))).map(data => UserEvent.parse(data))
    expect(events.map(e => e.kind), "nothing about the account's state changes").toEqual(["notification", "notification"])
})

test("a notice for a deleted account is dropped", async () => {
    await db.delete(gameAccounts).where(eq(gameAccounts.id, accountId))
    await store.notifyOwner(accountId, { kind: "incoming_attack", key: "k", data: { attacker: "Raider", castle: "Keep", arrival: "2031-02-03T04:05:06.000Z" } })
    expect(await mine()).toEqual([])
})

test("each new message wakes Centrifugo's consumer on its partition", async () => {
    const listener = await db.$pool.connect()
    try {
        const woken: string[] = []
        listener.on("notification", n => { if (n.channel === "centrifugo_partition_change") woken.push(n.payload!) })
        await listener.query("listen centrifugo_partition_change")
        await store.endAccount(accountId, { notification: { kind: "shutoff", runId: 1 } })
        await expect.poll(() => woken).toContain("0")
    } finally {
        listener.release(true)
    }
})

const attackState = { state: "running", reasonKey: "statusAttacksToday", params: { used: 1, limit: 10 } } as const
const nomadState = { state: "waiting", reasonKey: "statusEventClosed", params: {} } as const

test("plugin reports merge by plugin and each one is published with the status", async () => {
    await store.setPluginState(accountId, "attack", attackState)
    await store.setPluginState(accountId, "attackNomads", nomadState)
    const next = { ...attackState, params: { used: 2, limit: 10 } }
    await store.setPluginState(accountId, "attack", next)

    const [saved] = await db.select().from(botStatus).where(eq(botStatus.accountId, accountId))
    expect(saved!.pluginStates).toEqual({ attack: next, attackNomads: nomadState })
    const events = (await published(userChannel(ownerId))).map(data => UserEvent.parse(data))
    expect(events).toHaveLength(3)
    expect(events[1]).toMatchObject({ kind: "status", accountId, status: { pluginStates: { attack: attackState, attackNomads: nomadState } } })
    expect(events[2]).toMatchObject({ status: { pluginStates: { attack: next, attackNomads: nomadState } } })
})

test("a status carries the castles of the worker's last report", async () => {
    const castle = { kingdom: 0, id: 1001, name: "Ironhold", x: 4, y: 5, type: 1 }
    await store.setStatus(accountId, { resources: { castles: [castle] } })
    const [event] = (await published(userChannel(ownerId))).map(data => UserEvent.parse(data))
    expect(event).toMatchObject({ status: { castles: [castle] } })
})

test("starting a worker clears the plugin states, and so does recovering from a crash", async () => {
    await store.setPluginState(accountId, "attack", attackState)
    await store.setStatus(accountId, { actualState: "starting", pluginStates: {} })
    let [saved] = await db.select().from(botStatus).where(eq(botStatus.accountId, accountId))
    expect(saved!.pluginStates).toEqual({})

    await store.setPluginState(accountId, "attack", attackState)
    await store.recoverFromLastRun()
    ;[saved] = await db.select().from(botStatus).where(eq(botStatus.accountId, accountId))
    expect(saved).toMatchObject({ actualState: "stopped", pluginStates: {} })
})

test("a report for an account that was deleted is dropped", async () => {
    await db.delete(gameAccounts).where(eq(gameAccounts.id, accountId))
    await expect(store.setPluginState(accountId, "attack", attackState)).resolves.toBeUndefined()
})

test("a status carries the figures of the worker's last report, and when they arrived", async () => {
    const before = Date.now()
    await store.setStatus(accountId, { resources: { cash: 1200, gold: 7, food: 3000, aquamarin_name: 55, attackDailyCount: 14, level: 40 } })
    const [event] = (await published(userChannel(ownerId))).map(data => UserEvent.parse(data))
    expect(event).toMatchObject({ status: { resources: { cash: 1200, gold: 7, food: 3000, mead: null, aquamarine: 55, attackDailyCount: 14 } } })
    const reportedAt = event?.kind === "status" ? event.status.resources?.reportedAt : undefined
    expect(new Date(reportedAt!).getTime()).toBeGreaterThanOrEqual(before)
})

test("a starting bot gets each tower plugin's attacks of the last 24 hours, with their tools, and nothing older or of another kind", async () => {
    const line = (kingdom: string, ...tail: (string | number)[]) =>
        ["[12:00] ", "[", "sharedBarronAttackLogic", "] ", "hittingTargetAttack", kingdom, " ", "C", 3, " ", 610, ":", 600, " ", "4m", "tillImpactAttack", ...tail]
    const now = Date.now()
    const ago = (minutes: number) => new Date(now - minutes * 60_000)
    await db.insert(botLogs).values([
        { accountId, ts: ago(25 * 60), level: 0, message: "", parts: line("greatEmpire", " ", 30, "toolsInAttack"), plugin: "sharedBarronAttackLogic" },
        { accountId, ts: ago(23 * 60), level: 0, message: "", parts: line("greatEmpire", " ", 30, "toolsInAttack"), plugin: "sharedBarronAttackLogic" },
        { accountId, ts: ago(60), level: 0, message: "", parts: line("firePeaks", " ", 0, "toolsInAttack"), plugin: "sharedBarronAttackLogic" },
        { accountId, ts: ago(30), level: 0, message: "", parts: ["[12:00] ", "[", "sharedBarronAttackLogic", "] ", "waitingForMoreTroops"], plugin: "sharedBarronAttackLogic" },
        { accountId, ts: ago(20), level: 0, message: "", parts: ["[12:00] ", "[", "sharedFortressAttackLogic", "] ", "hittingTargetAttack", "firePeaks"], plugin: "sharedFortressAttackLogic" },
    ])
    // A line the bot has only just logged is still in the store's buffer, and counts.
    store.log(accountId, 0, line("greatEmpire", " ", 20, "toolsInAttack"), "")

    const history = await store.recentAttacks(accountId, now)
    expect(Object.keys(history).sort()).toEqual(["attackBarronsFirePeaks", "attackBarronsGreatEmpire"])
    expect(history.attackBarronsFirePeaks).toEqual([{ at: ago(60).getTime(), tools: 0 }])
    expect(history.attackBarronsGreatEmpire!.map(attack => attack.tools)).toEqual([30, 20])
    expect(history.attackBarronsGreatEmpire![0]!.at).toBe(ago(23 * 60).getTime())
    expect(now - history.attackBarronsGreatEmpire![1]!.at).toBeLessThan(5000)
})
