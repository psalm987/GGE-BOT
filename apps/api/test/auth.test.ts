import { pbkdf2Sync, randomBytes } from "node:crypto"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { auditLog, users } from "@gge/db"
import { PASSWORD, startApi, type Api } from "./harness.ts"

let api: Api
beforeAll(async () => { api = await startApi() })
afterAll(() => api.close())

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)

describe("signup", () => {
    test("anyone can sign up: a player, signed in, with the email still to confirm", async () => {
        const first = api.client()
        const me = await first.api.auth.signup({ username: "alice", email: "Alice@Example.test", password: PASSWORD })
        expect(me).toMatchObject({ username: "alice", role: "user", email: "alice@example.test", emailVerified: false })
        expect(await first.api.auth.me()).toMatchObject({ username: "alice" })
    })

    test("signup can't pick a role", async () => {
        const signup = api.client().api.auth.signup as (input: object) => Promise<{ role: string }>
        expect((await signup({ username: "sneaky", email: "sneaky@example.test", password: PASSWORD, role: "admin" })).role).toBe("user")
    })

    test("a taken username or email (any case) is a conflict", async () => {
        await api.player("dave")
        expect(await codeOf(api.client().api.auth.signup({ username: "DAVE", email: "other-dave@example.test", password: PASSWORD }))).toBe("CONFLICT")
        expect(await codeOf(api.client().api.auth.signup({ username: "dave2", email: "DAVE@example.test", password: PASSWORD }))).toBe("CONFLICT")
        expect(await codeOf(api.client().api.auth.signup({ username: "dave2", email: "dave2@example.test", password: PASSWORD }))).toBe("ok")
    })

    test("short passwords and bad usernames are rejected before anything is written", async () => {
        expect(await codeOf(api.client().api.auth.signup({ username: "erin", email: "erin@example.test", password: "short" }))).toBe("BAD_REQUEST")
        expect(await codeOf(api.client().api.auth.signup({ username: "no spaces", email: "nospaces@example.test", password: PASSWORD }))).toBe("BAD_REQUEST")
        expect(await codeOf(api.client().api.auth.signup({ username: "erin", email: "erin@example.test", password: PASSWORD }))).toBe("ok")
    })
})

describe("email gate", () => {
    test("an unverified player can manage their email but not their bots, until they verify", async () => {
        const p = await api.signup("newbie")
        expect(await codeOf(p.api.accounts.list())).toBe("FORBIDDEN")
        expect(await codeOf(p.api.servers.list())).toBe("FORBIDDEN")
        expect(await codeOf(p.api.plugins.catalog())).toBe("FORBIDDEN")
        expect(await codeOf(p.api.accounts.create({ name: "Early", serverId: 26, password: "game-password" }))).toBe("FORBIDDEN")
        expect(await codeOf(p.api.auth.me())).toBe("ok")
        expect(await codeOf(p.api.account.resendVerification({}))).toBe("ok")

        await api.client().api.auth.verifyEmail({ token: api.lastToken(p.email)! })
        expect(await codeOf(p.api.accounts.list())).toBe("ok")
        expect(await codeOf(p.api.servers.list())).toBe("ok")
    })
})

describe("login and sessions", () => {
    test("a wrong password and an unknown user give the same answer", async () => {
        await api.player("frank")
        const wrong = await api.client().api.auth.login({ login: "frank", password: "wrong password!" }).catch(e => e)
        const nobody = await api.client().api.auth.login({ login: "nobody-here", password: "wrong password!" }).catch(e => e)
        expect([wrong.code, wrong.message]).toEqual(["UNAUTHORIZED", "Wrong username or password"])
        expect([nobody.code, nobody.message]).toEqual([wrong.code, wrong.message])
    })

    test("the session cookie is HttpOnly and SameSite=Lax, and stores no token in the database", async () => {
        await api.player("gina")
        const response = await fetch(`${api.baseUrl}/rpc/auth/login`, {
            method: "POST",
            headers: { origin: "https://app.test", "content-type": "application/json" },
            body: JSON.stringify({ json: { login: "gina", password: PASSWORD } }),
        })
        const cookie = response.headers.getSetCookie().find(c => c.startsWith("gge_session="))!
        expect(cookie).toMatch(/HttpOnly/i)
        expect(cookie).toMatch(/SameSite=Lax/i)
        const token = cookie.split(";")[0]!.split("=")[1]!
        const rows = await api.db.execute<{ id: string }>("select id from sessions")
        expect(rows.rows.map(r => r.id)).not.toContain(token)
    })

    test("logout ends the session on the server, not just in the browser", async () => {
        const player = await api.player()
        const stolen = [...player.jar.entries()]
        await player.api.auth.logout()
        expect(await player.api.auth.me()).toBeNull()

        const thief = api.client()
        for (const [k, v] of stolen) thief.jar.set(k, v)
        expect(await thief.api.auth.me()).toBeNull()
    })

    test("a disabled user can't log in and their open session stops working", async () => {
        const player = await api.player("hank")
        await api.db.update(users).set({ status: "disabled" }).where(eq(users.username, "hank"))
        expect(await player.api.auth.me()).toBeNull()
        expect(await codeOf(api.client().api.auth.login({ login: "hank", password: PASSWORD }))).toBe("FORBIDDEN")
    })

    test("repeated failures for one username are throttled", async () => {
        await api.player("ivan")
        const attacker = api.client()
        const codes = []
        for (let i = 0; i < 11; i++)
            codes.push(await codeOf(attacker.api.auth.login({ login: "ivan", password: `guess ${i} wrong` })))
        expect(codes.slice(0, 10).every(c => c === "UNAUTHORIZED")).toBe(true)
        expect(codes[10]).toBe("TOO_MANY_REQUESTS")
    })

    test("an imported PBKDF2 password logs in once and is upgraded to argon2id", async () => {
        const salt = randomBytes(256)
        await api.db.insert(users).values({
            username: "legacy",
            passwordAlgo: "pbkdf2-legacy",
            passwordSalt: salt,
            passwordHash: pbkdf2Sync("old secret pw", salt, 600_000, 64, "sha256").toString("hex"),
        })
        expect(await api.client().api.auth.login({ login: "legacy", password: "old secret pw" })).toMatchObject({ username: "legacy" })

        const [row] = await api.db.select().from(users).where(eq(users.username, "legacy"))
        expect(row).toMatchObject({ passwordAlgo: "argon2id", passwordSalt: null })
        expect(row!.passwordHash).toMatch(/^\$argon2id\$/)
        expect(await codeOf(api.client().api.auth.login({ login: "legacy", password: "old secret pw" }))).toBe("ok")
    })
})

describe("boundaries between the apps", () => {
    test("a player can't sign in to the admin app", async () => {
        await api.player("jill")
        expect(await codeOf(api.admin().api.auth.login({ login: "jill", password: PASSWORD }))).toBe("FORBIDDEN")
    })

    test("a client session cookie does not authenticate admin calls", async () => {
        const admin = await api.signedInAdmin()
        const asPlayer = api.client()
        await asPlayer.api.auth.login({ login: "boss", password: PASSWORD })
        const adminApp = api.admin()
        for (const [k, v] of asPlayer.jar) adminApp.jar.set(k, v)
        expect(await codeOf(adminApp.api.overview())).toBe("UNAUTHORIZED")
        expect(await codeOf(admin.api.overview())).toBe("ok")
    })

    test("calls from an origin that isn't ours are refused before they run", async () => {
        const evil = api.client("https://evil.test")
        expect(await codeOf(evil.api.auth.me())).not.toBe("ok")
        const response = await fetch(`${api.baseUrl}/rpc/auth/me`, { method: "POST", headers: { origin: "https://evil.test" } })
        expect(response.status).toBe(403)
    })

    test("malformed input is a 400 and the server keeps serving", async () => {
        const response = await fetch(`${api.baseUrl}/rpc/auth/login`, {
            method: "POST",
            headers: { origin: "https://app.test", "content-type": "application/json" },
            body: "{not json",
        })
        expect(response.status).toBe(400)
        expect((await fetch(`${api.baseUrl}/healthz`)).status).toBe(200)
    })
})

describe("signup rate limit", () => {
    const from = (ip: string) => api.client(undefined, ip).api.auth
    const attempt = (ip: string, name: string) => codeOf(from(ip).signup({ username: name, email: `${name}@example.test`, password: PASSWORD }))

    test("the 6th signup from one IP within the hour is refused, while other IPs are unaffected", async () => {
        const codes = []
        for (let i = 0; i < 6; i++)
            codes.push(await attempt("203.0.113.7", `flood${i}`))
        expect(codes).toEqual(["ok", "ok", "ok", "ok", "ok", "TOO_MANY_REQUESTS"])
        expect(await attempt("203.0.113.8", "bystander")).toBe("ok")
    })
})

describe("signup forensics", () => {
    test("the audit entry records the client IP and the canonical email", async () => {
        await api.client(undefined, "198.51.100.23").api.auth.signup({ username: "traced", email: "T.raced+1@googlemail.com", password: PASSWORD })
        const entries = await api.db.select().from(auditLog).where(eq(auditLog.action, "auth.signup"))
        expect(entries.map(e => e.meta)).toContainEqual({ ip: "198.51.100.23", emailCanonical: "traced@gmail.com" })
    })
})
