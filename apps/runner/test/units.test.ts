import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest"
import { createDb, gameAccounts, servers, users, type Db } from "@gge/db"
import { resolveEventServer } from "../src/event-server.ts"
import { readServers } from "../src/game-data.ts"
import { acquireRunnerLock } from "../src/lock.ts"

describe("resolveEventServer", () => {
    test.each([
        ["temp-server login data wins", { glt: { TSIP: "x.test", TSZ: "EmpireEx_7" }, sei: { E: [{ EID: 113 }] } }, { host: "x.test", zone: "EmpireEx_7" }],
        ["temp server 24", { sei: { E: [{ EID: 106, TSID: 24 }] } }, { host: "ep-live-temp1-game.goodgamestudios.com", zone: "EmpireEx_42" }],
        ["temp server 21", { sei: { E: [{ EID: 106, TSID: 21 }] } }, { host: "ep-live-temp1-game.goodgamestudios.com", zone: "EmpireEx_42" }],
        ["battle event", { sei: { E: [{ EID: 113 }] } }, { host: "ep-live-battle1-game.goodgamestudios.com", zone: "EmpireEx_45" }],
        ["no event running", { sei: { E: [] }, glt: {} }, null],
    ])("%s", (_, data, expected) => expect(resolveEventServer(data)).toEqual(expected))
})

test("servers are read from 1.xml with the game's labels, skipping unlabelled instances", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gge-data-"))
    await mkdir(path.join(dir, "lang"))
    await writeFile(path.join(dir, "lang", "en.json"), JSON.stringify({ generic_country_DE: "Germany" }))
    await writeFile(path.join(dir, "1.xml"), `<network><instances>
        <instance value="2"><server>de1.test</server><zone>EmpireEx_2</zone><instanceName>1</instanceName><instanceLocaId>generic_country_DE</instanceLocaId></instance>
        <instance value="9"><server>hidden.test</server><zone>EmpireEx_9</zone><instanceName>1</instanceName></instance>
    </instances></network>`)
    expect(await readServers(dir)).toEqual([
        { id: 2, label: "Germany 1", wsHost: "de1.test", zone: "EmpireEx_2" },
        { id: 103, label: "SP 3", wsHost: "ep-live-mz-nw2-game.goodgamestudios.com", zone: "EmpireExSP_3" },
    ])
})

describe("against the database", () => {
    let db: Db
    beforeAll(() => { db = createDb(inject("databaseUrl")) })
    afterAll(() => db.$pool.end())

    test("only one runner can hold the lock, and it frees on release", async () => {
        const other = new pg.Pool({ connectionString: inject("databaseUrl") })
        const first = await acquireRunnerLock(db.$pool)
        expect(first).not.toBeNull()
        expect(await acquireRunnerLock(other)).toBeNull()
        await first!.release()
        const second = await acquireRunnerLock(other)
        expect(second).not.toBeNull()
        await second!.release()
        await other.end()
    })

    test("changing an account, its settings or its owner's status notifies the runner", async () => {
        const listener = new pg.Client({ connectionString: inject("databaseUrl") })
        await listener.connect()
        let notifications = 0
        listener.on("notification", n => { if (n.channel === "gge_desired") notifications++ })
        await listener.query("listen gge_desired")
        const settle = () => new Promise(r => setTimeout(r, 100))

        await db.insert(servers).values({ id: 26, label: "India 1", wsHost: "in1.test", zone: "EmpireEx_26" }).onConflictDoNothing()
        const [owner] = await db.insert(users).values({ username: `notify-${Date.now()}`, passwordHash: "x" }).returning()
        await settle()
        const afterUserInsert = notifications
        await db.insert(gameAccounts).values({ ownerId: owner!.id, name: "n", serverId: 26, passwordSealed: Buffer.from("x") })
        await settle()
        expect(notifications).toBeGreaterThan(afterUserInsert)

        const beforeStatus = notifications
        const { eq } = await import("drizzle-orm")
        await db.update(users).set({ status: "disabled" }).where(eq(users.id, owner!.id))
        await settle()
        expect(notifications).toBeGreaterThan(beforeStatus)
        expect(afterUserInsert).toBe(0)

        await db.delete(users).where(eq(users.id, owner!.id))
        await listener.end()
    })
})
