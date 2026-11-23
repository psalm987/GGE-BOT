import { afterAll, beforeAll, expect, test } from "vitest"
import { DOCS_ORIGIN, startApi, type Api } from "./harness.ts"

let api: Api
beforeAll(async () => { api = await startApi() })
afterAll(() => api.close())

test("without SUPPORT_EMAIL, /contact answers 503 with a stable code and sends nothing", async () => {
    const response = await fetch(`${api.baseUrl}/contact`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: DOCS_ORIGIN },
        body: JSON.stringify({ email: "sender@example.test", topic: "bot", message: "My bot stops after the first attack wave." }),
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "CONTACT_UNAVAILABLE" })
    expect(api.sent).toHaveLength(0)
})
