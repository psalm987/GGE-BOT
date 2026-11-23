import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { startApi, DOCS_ORIGIN, type Api } from "./harness.ts"

const good = { email: "sender@example.test", name: "Ines", topic: "bot", message: "My bot stops after the first attack wave and I do not know why.", page: "/troubleshooting/", website: "" }

let nextIp = 1
const freshIp = () => `10.9.0.${nextIp++}`

function post(api: Api, body: unknown, { origin = DOCS_ORIGIN, ip = freshIp() }: { origin?: string | null; ip?: string } = {}) {
    return fetch(`${api.baseUrl}/contact`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(origin && { origin }) },
        body: typeof body === "string" ? body : JSON.stringify(body),
    })
}

describe("with SUPPORT_EMAIL set", () => {
    let api: Api
    beforeAll(async () => { api = await startApi({ SUPPORT_EMAIL: "support@example.test" }) })
    afterAll(() => api.close())

    test("sends one plain-text mail to support, replying to the sender", async () => {
        const before = api.sent.length
        const response = await post(api, good)
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        const mails = api.sent.slice(before)
        expect(mails).toHaveLength(1)
        const [mail] = mails
        expect(mail).toMatchObject({ to: "support@example.test", replyTo: "sender@example.test", html: "", tag: "contact" })
        expect(mail!.subject).toBe("[GGE Command] bot: My bot stops after the first attack wave and I do not know w...")
        expect(mail!.text).toContain("Name: Ines")
        expect(mail!.text).toContain("Email: sender@example.test")
        expect(mail!.text).toContain("Page: /troubleshooting/")
        expect(mail!.text).toContain(good.message)
    })

    test("a filled honeypot answers 200 and sends nothing", async () => {
        const before = api.sent.length
        const response = await post(api, { ...good, website: "http://spam.example" })
        expect(response.status).toBe(200)
        expect(api.sent).toHaveLength(before)
    })

    test.each([
        ["no email", { ...good, email: undefined }],
        ["a bad email", { ...good, email: "nope" }],
        ["an unknown topic", { ...good, topic: "sales" }],
        ["a short message", { ...good, message: "too short" }],
        ["a long name", { ...good, name: "x".repeat(81) }],
        ["a page that is not a path", { ...good, page: "https://evil.example/" }],
        ["a body that is not JSON", "{oops"],
    ])("%s is a 400 and sends nothing", async (_label, body) => {
        const before = api.sent.length
        const response = await post(api, body)
        expect(response.status).toBe(400)
        expect(api.sent).toHaveLength(before)
    })

    test("names the fields that failed", async () => {
        const response = await post(api, { ...good, email: "nope", message: "short" })
        expect(await response.json()).toEqual({ error: "INVALID_BODY", fields: ["email", "message"] })
    })

    test("a request from another origin, or with none, is a 403", async () => {
        const before = api.sent.length
        expect((await post(api, good, { origin: "https://app.test" })).status).toBe(403)
        expect((await post(api, good, { origin: null })).status).toBe(403)
        expect(api.sent).toHaveLength(before)
    })

    test("the fourth request from one address in ten minutes is a 429", async () => {
        const ip = "10.9.1.1"
        const statuses = []
        for (let i = 0; i < 4; i++)
            statuses.push((await post(api, good, { ip })).status)
        expect(statuses).toEqual([200, 200, 200, 429])
    })

    test("a mail provider failure is a 502", async () => {
        api.failMail(true)
        try {
            expect((await post(api, good)).status).toBe(502)
        } finally {
            api.failMail(false)
        }
    })
})
