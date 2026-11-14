import { pbkdf2Sync, randomBytes } from "node:crypto"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, expect, test } from "vitest"
import type { PluginCatalogEntry } from "@gge/contracts"
import { createDb, discordLinks, gameAccounts, pluginSettings, runMigrations, servers, users, type Db } from "@gge/db"
import { startTestPostgres } from "@gge/db/testing"
import { generateSealKeyPair, openSealed } from "@gge/crypto"
import { verifyPassword } from "@gge/api/src/auth/passwords.ts"
import { importLegacy } from "../import.ts"

const keys = generateSealKeyPair()
const catalog: PluginCatalogEntry[] = [
    { key: "attack", force: true, hidden: false, options: [{ type: "Text", key: "attackDelaySeconds", default: "4.5" }] },
    { key: "attackNomads", force: false, hidden: false, options: [
        { type: "Select", key: "eventDifficulty", selection: ["Classic", "Easy", "Hard"], default: "1" },
        { type: "Checkbox", key: "lowValueChests", default: false },
    ] },
]

let pg: Awaited<ReturnType<typeof startTestPostgres>>
let db: Db
let sqlitePath: string

beforeAll(async () => {
    pg = await startTestPostgres()
    db = createDb(pg.url)
    await runMigrations(db)
    await db.insert(servers).values([
        { id: 2, label: "Germany 1", wsHost: "de1.test", zone: "EmpireEx_2" },
        { id: 26, label: "India 1", wsHost: "in1.test", zone: "EmpireEx_26" },
    ])

    sqlitePath = path.join(mkdtempSync(path.join(tmpdir(), "gge-legacy-")), "user.db")
    const legacy = new DatabaseSync(sqlitePath)
    // The schema legacy main.js creates.
    legacy.exec(`CREATE TABLE "Users" ("username" TEXT NOT NULL UNIQUE, "passwordHash" BLOB NOT NULL, "passwordSalt" INTEGER NOT NULL,
        "uuid" TEXT UNIQUE, "privilege" INTEGER, "discordUserId" TEXT, "discordGuildId" TEXT)`)
    legacy.exec(`CREATE TABLE "SubUsers" ("id" INTEGER, "uuid" TEXT NOT NULL, "name" TEXT NOT NULL, "pass" TEXT NOT NULL, "plugins" TEXT,
        "state" INTEGER, "externalEvent" INTEGER, "server" INTEGER, PRIMARY KEY("id" AUTOINCREMENT))`)
    const addUser = legacy.prepare("INSERT INTO Users (username, passwordHash, passwordSalt, uuid, discordUserId, discordGuildId) VALUES (?,?,?,?,?,?)")
    for (const [name, password, uuid, discord] of [["alice", "alice-pass", "uuid-a", ["111", "999"]], ["bob", "bob-pass", "uuid-b", [null, null]]] as const) {
        const salt = randomBytes(256)
        addUser.run(name, pbkdf2Sync(password, salt, 600_000, 64, "sha256"), salt, uuid, discord[0], discord[1])
    }
    const addAccount = legacy.prepare("INSERT INTO SubUsers (uuid, name, pass, plugins, state, externalEvent, server) VALUES (?,?,?,?,?,?,?)")
    addAccount.run("uuid-a", "Ironhold", "game-pw-1", JSON.stringify({
        attack: { state: true, attackDelaySeconds: "6", filename: "plugins/attack/attack" },
        attackNomads: { state: true, eventDifficulty: "2", lowValueChests: true, notAnOption: 1 },
        gonePlugin: { state: true },
    }), 1, 0, 2)
    addAccount.run("uuid-a", "Ironhold", "game-pw-2", "{}", 0, 1, 2)
    addAccount.run("uuid-b", "ironhold", "dupe", "{}", 1, 0, 2)
    addAccount.run("uuid-b", "Faraway", "pw", "{}", 0, 0, 77)
    addAccount.run("uuid-missing", "Orphan", "pw", "{}", 0, 0, 2)
    legacy.close()
})

afterAll(async () => {
    await db.$pool.end()
    await pg.stop()
})

test("imports users, accounts and settings, skips what can't be imported, and reports it", async () => {
    const report = await importLegacy({ sqlitePath, db, sealPublicKey: keys.publicKey, catalog, log: () => {} })

    expect(report.users).toEqual({ imported: 2, existing: 0, skipped: [] })
    expect(report.accounts.imported).toBe(2)
    expect(report.accounts.skipped.map(s => s.reason).sort()).toEqual([
        "duplicate of an imported account",
        "owner not found",
        "unknown server 77",
    ])
    expect(report.droppedSettings.sort()).toEqual(["Ironhold: plugin gonePlugin", "Ironhold: attackNomads.notAnOption"].sort())

    const [alice] = await db.select().from(users).where(eq(users.username, "alice"))
    expect(alice).toMatchObject({ role: "user", passwordAlgo: "pbkdf2-legacy", legacyUuid: "uuid-a" })
    expect(await verifyPassword(alice!, "alice-pass")).toBe(true)
    expect(await verifyPassword(alice!, "wrong")).toBe(false)
    expect(await db.select().from(discordLinks)).toEqual([{ userId: alice!.id, discordUserId: "111", guildId: "999" }])

    const accounts = await db.select().from(gameAccounts)
    expect(accounts.every(a => a.desiredState === "stopped")).toBe(true)
    const main = accounts.find(a => !a.externalEvent)!
    expect(openSealed(keys.privateKey, main.passwordSealed)).toBe("game-pw-1")
    expect(accounts.find(a => a.externalEvent)?.name).toBe("Ironhold")

    const settings = await db.select().from(pluginSettings).where(eq(pluginSettings.accountId, main.id))
    expect(Object.fromEntries(settings.map(s => [s.pluginKey, { enabled: s.enabled, options: s.options }]))).toEqual({
        attack: { enabled: true, options: { attackDelaySeconds: "6" } },
        attackNomads: { enabled: true, options: { eventDifficulty: 2, lowValueChests: true } },
    })
})

test("running it again changes nothing", async () => {
    const before = { users: (await db.select().from(users)).length, accounts: (await db.select().from(gameAccounts)).length }
    const report = await importLegacy({ sqlitePath, db, sealPublicKey: keys.publicKey, catalog, log: () => {} })
    expect(report.users).toMatchObject({ imported: 0, existing: 2 })
    expect(report.accounts).toMatchObject({ imported: 0, existing: 2 })
    expect({ users: (await db.select().from(users)).length, accounts: (await db.select().from(gameAccounts)).length }).toEqual(before)
})
