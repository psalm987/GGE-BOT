import { describe, expect, test } from "vitest"
import { resendMailer } from "../src/services/mailer.ts"

const message = { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi", tag: "verify_email" }

describe("resendMailer", () => {
    test("sends from the configured address and tags the message kind", async () => {
        const payloads: Record<string, unknown>[] = []
        const mailer = resendMailer({ apiKey: "k", from: "GGE Bot <noreply@example.com>", client: { emails: { send: async p => { payloads.push(p); return { error: null } } } } })
        await mailer.send(message)
        expect(payloads).toEqual([{ from: "GGE Bot <noreply@example.com>", to: "a@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi", tags: [{ name: "kind", value: "verify_email" }] }])
    })

    test("an error response becomes a thrown error", async () => {
        const mailer = resendMailer({ apiKey: "k", from: "x", client: { emails: { send: async () => ({ error: { message: "domain not verified" } }) } } })
        await expect(mailer.send(message)).rejects.toThrow("domain not verified")
    })
})
