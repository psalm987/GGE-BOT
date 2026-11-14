import { eq } from "drizzle-orm"
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { users } from "@gge/db"
import { verifyTurnstile } from "../src/services/turnstile.ts"
import { PASSWORD, startApi, type Api } from "./harness.ts"

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const siteverify: { body: URLSearchParams; success: boolean }[] = []
let verdict = true

/** Answers Cloudflare's siteverify endpoint; every other request goes through untouched. */
const realFetch = globalThis.fetch
function stubSiteverify() {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input)
        if (!url.startsWith("https://challenges.cloudflare.com/"))
            return realFetch(input, init)
        siteverify.push({ body: init!.body as URLSearchParams, success: verdict })
        return Response.json({ success: verdict })
    })
}
afterEach(() => { siteverify.length = 0; verdict = true })

describe("with a Turnstile secret", () => {
    let api: Api
    beforeAll(async () => { api = await startApi({ TURNSTILE_SECRET_KEY: "secret" }); stubSiteverify() })
    afterAll(async () => { vi.unstubAllGlobals(); await api.close() })

    const signup = (name: string, turnstileToken?: string) =>
        codeOf(api.client().api.auth.signup({ username: name, email: `${name}@example.test`, password: PASSWORD, turnstileToken }))

    test("a token Cloudflare rejects refuses the signup and creates no user", async () => {
        verdict = false
        expect(await signup("bot1", "bad-token")).toBe("BAD_REQUEST")
        expect(await api.db.select().from(users).where(eq(users.username, "bot1"))).toEqual([])
    })

    test("a missing token is refused without asking Cloudflare", async () => {
        expect(await signup("bot2")).toBe("BAD_REQUEST")
        expect(siteverify).toHaveLength(0)
    })

    test("a token Cloudflare accepts lets the signup through, sent with the secret", async () => {
        expect(await signup("human", "good-token")).toBe("ok")
        expect(Object.fromEntries(siteverify[0]!.body)).toMatchObject({ secret: "secret", response: "good-token" })
    })
})

describe("without a Turnstile secret", () => {
    test("nothing is checked and Cloudflare is never called, so signup needs no token (every other suite signs up that way)", async () => {
        stubSiteverify()
        try {
            expect(await verifyTurnstile(undefined, undefined, "203.0.113.1")).toBe(true)
            expect(siteverify).toHaveLength(0)
        } finally {
            vi.unstubAllGlobals()
        }
    })
})
