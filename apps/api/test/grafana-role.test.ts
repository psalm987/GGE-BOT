import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { sql } from "drizzle-orm"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest"
import { GRAFANA_ROLE, auditLog, createDb, gameAccounts, proxies, servers, users, type Db } from "@gge/db"

const apiDir = fileURLToPath(new URL("..", import.meta.url))
const migrate = (password: string) => promisify(execFile)(process.execPath, ["src/cli/migrate.ts"], {
    cwd: apiDir, env: { ...process.env, DATABASE_URL: inject("databaseUrl"), GRAFANA_DB_PASSWORD: password },
})

/** Runs one statement as Grafana would, signed in as the read-only role. */
async function asGrafana(statement: string, password: string) {
    const url = new URL(inject("databaseUrl"))
    url.username = GRAFANA_ROLE
    url.password = password
    const client = new pg.Client({ connectionString: url.toString() })
    await client.connect()
    try {
        return (await client.query(statement)).rows
    } finally {
        await client.end()
    }
}
const refusal = (statement: string, password: string) => asGrafana(statement, password).then(() => "allowed", (e: { code: string }) => e.code)

let db: Db
const storedPassword = async () =>
    (await db.execute<{ hash: string }>(sql`select rolpassword as hash from pg_authid where rolname = ${GRAFANA_ROLE}`)).rows[0]?.hash
beforeAll(async () => {
    db = createDb(inject("databaseUrl"))
    await db.execute(sql`truncate ${users}, ${servers}, ${proxies} restart identity cascade`)
    await db.insert(servers).values({ id: 26, label: "India 1", wsHost: "ws.test", zone: "EmpireEx_26" })
    const [owner] = await db.insert(users).values({ username: "alice", email: "alice@example.com", passwordHash: "argon2-hash" }).returning()
    const [proxy] = await db.insert(proxies).values({ label: "p1", urlSealed: Buffer.from("sealed"), hostHint: "http://proxy.test:8080" }).returning()
    await db.insert(gameAccounts).values({ ownerId: owner!.id, name: "castle", serverId: 26, passwordSealed: Buffer.from("sealed"), proxyId: proxy!.id })
    await db.insert(auditLog).values({ actorId: owner!.id, action: "auth.signup", meta: { ip: "10.0.0.1" } })
    await migrate("first password")
})
afterAll(() => db.$pool.end())

describe("Grafana's read-only role", () => {
    test("reads the columns dashboards use", async () => {
        const password = "first password"
        expect(await asGrafana("select username, role, max_bots, email_verified_at, created_at from users", password)).toMatchObject([{ username: "alice" }])
        expect(await asGrafana("select g.name, s.label from game_accounts g join servers s on s.id = g.server_id", password)).toEqual([{ name: "castle", label: "India 1" }])
        expect(await asGrafana("select label, host_hint, enabled from proxies", password)).toEqual([{ label: "p1", host_hint: "http://proxy.test:8080", enabled: true }])
        expect(await asGrafana("select action from audit_log", password)).toEqual([{ action: "auth.signup" }])
        expect(await asGrafana("select count(*)::int as n from bot_runs", password)).toEqual([{ n: 0 }])
    })

    test.each([
        "select password_hash from users",
        "select password_salt from users",
        "select email from users",
        "select * from users",
        "select password_sealed from game_accounts",
        "select url_sealed from proxies",
        "select meta from audit_log",
        "select * from sessions",
        "select * from email_tokens",
        "select * from login_challenges",
        "select * from user_totp",
        "select * from recovery_codes",
    ])("is refused %s", async statement => {
        expect(await refusal(statement, "first password")).toBe("42501")
    })

    test("can't write", async () => {
        expect(await refusal("update proxies set enabled = false", "first password")).toMatch(/^(42501|25006)$/)
    })

    test("a second run converges, dropping a grant an earlier state left, and a third changes the password", async () => {
        await db.execute(sql.raw(`grant select (password_hash) on users to ${GRAFANA_ROLE}`))
        expect(await refusal("select password_hash from users", "first password")).toBe("allowed")

        await migrate("first password")
        expect(await refusal("select password_hash from users", "first password")).toBe("42501")

        const before = await storedPassword()
        await migrate("second password")
        expect(await storedPassword()).not.toBe(before)
        expect(await asGrafana("select username from users", "second password")).toEqual([{ username: "alice" }])
    })
})
