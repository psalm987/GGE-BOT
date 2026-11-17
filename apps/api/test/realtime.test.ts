import { createHmac } from "node:crypto"
import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { botChannel } from "@gge/contracts"
import { users } from "@gge/db"
import { startApi, type Api } from "./harness.ts"

const SECRET = "test-centrifugo-secret-0123456789abcdef"
const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const newAccount = (name: string) => ({ name, serverId: 26, password: "pw", externalEvent: false, plugins: {} })

/** Checks the token the way Centrifugo does, sharing no code with the API, and returns its claims. */
function verify(token: string, secret = SECRET) {
    const [header, payload, signature] = token.split(".") as [string, string, string]
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" })
    expect(signature).toBe(createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url"))
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as { sub: string; exp: number; iat: number; channel?: string }
}

describe("with Centrifugo set up", () => {
    let api: Api
    beforeAll(async () => { api = await startApi({ CENTRIFUGO_TOKEN_SECRET: SECRET }) })
    afterAll(() => api.close())

    test("a connection token names the caller and lasts about 15 minutes", async () => {
        const alice = await api.player("rt-alice")
        const me = await alice.api.auth.me()

        const claims = verify((await alice.api.realtime.connectionToken()).token)

        expect(claims.sub).toBe(me!.id)
        expect(claims.channel).toBeUndefined()
        const now = Date.now() / 1000
        expect(claims.exp).toBeGreaterThan(now + 14 * 60)
        expect(claims.exp).toBeLessThanOrEqual(now + 15 * 60 + 1)
    })

    test("a subscription token is for the caller's own account's channel", async () => {
        const alice = await api.player()
        const me = await alice.api.auth.me()
        const mine = await alice.api.accounts.create(newAccount("rt-mine"))

        const claims = verify((await alice.api.realtime.subscriptionToken({ accountId: mine.id })).token)

        expect(claims).toMatchObject({ sub: me!.id, channel: botChannel(mine.id) })
        expect(claims.exp).toBeGreaterThan(Date.now() / 1000 + 14 * 60)
    })

    test("another player's account is refused exactly like one that doesn't exist", async () => {
        const alice = await api.player()
        const bob = await api.player()
        const theirs = await bob.api.accounts.create(newAccount("rt-theirs"))

        expect(await codeOf(alice.api.realtime.subscriptionToken({ accountId: theirs.id }))).toBe("NOT_FOUND")
        expect(await codeOf(alice.api.realtime.subscriptionToken({ accountId: crypto.randomUUID() }))).toBe("NOT_FOUND")
    })

    test("a batch gives one token per account, each for its own channel", async () => {
        const alice = await api.player()
        await api.db.update(users).set({ maxBots: 2 }).where(sql`lower(${users.email}) = ${alice.email.toLowerCase()}`)
        const me = await alice.api.auth.me()
        const [one, two] = [await alice.api.accounts.create(newAccount("rt-batch-1")), await alice.api.accounts.create(newAccount("rt-batch-2"))]

        const tokens = await alice.api.realtime.subscriptionTokens({ accountIds: [one.id, two.id, one.id] })

        expect(Object.keys(tokens).sort()).toEqual([one.id, two.id].sort())
        expect(verify(tokens[one.id]!)).toMatchObject({ sub: me!.id, channel: botChannel(one.id) })
        expect(verify(tokens[two.id]!)).toMatchObject({ sub: me!.id, channel: botChannel(two.id) })
    })

    test("one account that isn't the caller's refuses the whole batch", async () => {
        const alice = await api.player()
        const bob = await api.player()
        const mine = await alice.api.accounts.create(newAccount("rt-batch-mine"))
        const theirs = await bob.api.accounts.create(newAccount("rt-batch-theirs"))

        expect(await codeOf(alice.api.realtime.subscriptionTokens({ accountIds: [mine.id, theirs.id] }))).toBe("NOT_FOUND")
        expect(await codeOf(alice.api.realtime.subscriptionTokens({ accountIds: [mine.id, crypto.randomUUID()] }))).toBe("NOT_FOUND")
    })

    test("a player who hasn't confirmed their email gets no tokens", async () => {
        const newcomer = await api.signup()
        expect(await codeOf(newcomer.api.realtime.connectionToken())).toBe("FORBIDDEN")
        expect(await codeOf(newcomer.api.realtime.subscriptionToken({ accountId: crypto.randomUUID() }))).toBe("FORBIDDEN")
    })

    test("a visitor who isn't signed in gets no tokens", async () => {
        expect(await codeOf(api.client().api.realtime.connectionToken())).toBe("UNAUTHORIZED")
    })
})
