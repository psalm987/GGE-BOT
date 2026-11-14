import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { PASSWORD, startApi, type Api } from "./harness.ts"

let api: Api
beforeAll(async () => { api = await startApi() })
afterAll(() => api.close())

const refusal = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string; message: string }) => `${e.code}: ${e.message}`)

describe("throwaway email providers", () => {
    test("signup with a disposable domain, or a subdomain of one, is refused", async () => {
        const client = api.client().api.auth
        const signup = (username: string, email: string) => refusal(client.signup({ username, email, password: PASSWORD }))
        expect(await signup("mailin", "someone@mailinator.com")).toBe("BAD_REQUEST: Please use a permanent email address")
        expect(await signup("mailin2", "someone@box.Mailinator.com")).toBe("BAD_REQUEST: Please use a permanent email address")
        expect(await signup("realperson", "someone@example.org")).toBe("ok")
    })

    test("adding a disposable email to an account is refused", async () => {
        const p = await api.signup("adder1")
        await api.db.execute(sql`update users set email = null where username = 'adder1'`)
        expect(await refusal(p.api.account.addEmail({ email: "x@mailinator.com" }))).toBe("BAD_REQUEST: Please use a permanent email address")
        expect(await refusal(p.api.account.addEmail({ email: "x@example.org" }))).toBe("ok")
    })
})
