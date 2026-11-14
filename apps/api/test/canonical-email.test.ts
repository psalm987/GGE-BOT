import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { PASSWORD, startApi, type Api } from "./harness.ts"

let api: Api
beforeAll(async () => { api = await startApi() })
afterAll(() => api.close())

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const canonical = async (address: string | null) => (await api.db.execute<{ c: string | null }>(sql`select canonical_email(${address}) as c`)).rows[0]!.c

describe("canonical_email()", () => {
    test.each([
        ["Alice@Example.COM", "alice@example.com"],
        ["  padded@example.com ", "padded@example.com"],
        ["A.B+tag@Gmail.com", "ab@gmail.com"],
        ["a.b+x@googlemail.com", "ab@gmail.com"],
        ["a.b@outlook.com", "a.b@outlook.com"],
        ["a+x@outlook.com", "a@outlook.com"],
        ["a+x@hotmail.com", "a@hotmail.com"],
        ["a+x@live.com", "a@live.com"],
        ["a+x@icloud.com", "a@icloud.com"],
        ["a+x@me.com", "a@me.com"],
        ["a+x@proton.me", "a@proton.me"],
        ["a+x@protonmail.com", "a@protonmail.com"],
        ["a+x@fastmail.com", "a@fastmail.com"],
        ["a-x@yahoo.com", "a@yahoo.com"],
        ["a+x@yahoo.com", "a+x@yahoo.com"],
        ["a.b-x@yahoo.com", "a.b@yahoo.com"],
        ["a+1@example.org", "a+1@example.org"],
        ["a.b@example.org", "a.b@example.org"],
        ["a-1@example.org", "a-1@example.org"],
        ["+only@gmail.com", "+only@gmail.com"],
        ["no-at-sign", "no-at-sign"],
    ])("%s -> %s", async (input, expected) => {
        expect(await canonical(input)).toBe(expected)
    })

    test("null stays null, so users without an email never collide", async () => {
        expect(await canonical(null)).toBeNull()
    })
})

describe("one mailbox, one account", () => {
    test("a Gmail variant of an existing address is a conflict", async () => {
        await api.signup("gmail1", "ab@gmail.com")
        expect(await codeOf(api.client().api.auth.signup({ username: "gmail2", email: "a.b+x@googlemail.com", password: PASSWORD }))).toBe("CONFLICT")
    })

    test("unknown domains keep + and . as part of the address", async () => {
        const client = api.client().api.auth
        expect(await codeOf(client.signup({ username: "plus1", email: "a+1@example.org", password: PASSWORD }))).toBe("ok")
        expect(await codeOf(client.signup({ username: "plus0", email: "a@example.org", password: PASSWORD }))).toBe("ok")
    })

    test("adding an email that is a variant of another account's is a conflict", async () => {
        await api.player("holder", "holder@outlook.com")
        const adder = await api.signup("adder")
        await api.db.execute(sql`update users set email = null where username = 'adder'`)
        expect(await codeOf(adder.api.account.addEmail({ email: "holder+spam@outlook.com" }))).toBe("CONFLICT")
    })

    test("a reset requested with a variant address goes to the stored address only", async () => {
        await api.player("resetme", "reset.me@gmail.com")
        await api.client().api.auth.requestPasswordReset({ email: "resetme+junk@gmail.com" })
        await vi.waitFor(() => { if (!api.sent.some(m => m.tag === "reset_password")) throw new Error("no mail yet") })
        const mails = api.sent.filter(m => m.tag === "reset_password")
        expect(mails.map(m => m.to)).toEqual(["reset.me@gmail.com"])

        const token = new URL(mails[0]!.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!
        expect(await codeOf(api.client().api.auth.resetPassword({ token, password: "a brand new password" }))).toBe("ok")
    })
})
