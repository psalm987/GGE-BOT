import { createHmac, timingSafeEqual } from "node:crypto"
import * as z from "zod"

const TIMEOUT_MS = 10_000

/** Paystack answers every call in this envelope; `data` is only there when `status` is true. */
const Envelope = z.object({ status: z.boolean(), message: z.string().optional(), data: z.unknown() })
const Initialized = z.object({ authorization_url: z.url() })
const Verified = z.object({ status: z.string(), amount: z.number().int(), currency: z.string(), reference: z.string() })

/** What Paystack says happened to a transaction. `amount` is in the currency's smallest unit. */
export type PaystackTransaction = z.infer<typeof Verified>

export type Paystack = ReturnType<typeof createPaystack>

/** The two Paystack calls a purchase takes, with the secret key. */
export function createPaystack({ secretKey, baseUrl = "https://api.paystack.co" }: { secretKey: string; baseUrl?: string }) {
    async function call(path: string, init: { method: "GET" } | { method: "POST"; body: unknown }) {
        const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
            method: init.method,
            headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/json" },
            body: init.method === "POST" ? JSON.stringify(init.body) : undefined,
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        const envelope = Envelope.safeParse(await response.json().catch(() => null))
        if (!response.ok || !envelope.success || !envelope.data.status)
            throw new Error(`Paystack ${init.method} ${path} answered ${response.status}: ${envelope.data?.message ?? "no message"}`)
        return envelope.data.data
    }

    return {
        /** Opens a transaction and returns the checkout page to send the buyer to. */
        async initialize({ email, amount, currency, reference, callbackUrl, metadata }: {
            email: string
            amount: number
            currency: string
            reference: string
            callbackUrl: string
            metadata: Record<string, unknown>
        }) {
            const data = await call("/transaction/initialize", { method: "POST", body: { email, amount, currency, reference, callback_url: callbackUrl, metadata } })
            return Initialized.parse(data).authorization_url
        },
        async verify(reference: string): Promise<PaystackTransaction> {
            return Verified.parse(await call(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" }))
        },
    }
}

/** Whether `header` is Paystack's signature of this exact body: the hex HMAC-SHA512 of it under the secret key. */
export function validWebhookSignature(rawBody: Buffer, header: string | undefined, secret: string) {
    if (!header)
        return false
    const expected = createHmac("sha512", secret).update(rawBody).digest()
    const given = Buffer.from(header, "hex")
    return given.length === expected.length && timingSafeEqual(given, expected)
}
