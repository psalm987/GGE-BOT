import type { FastifyInstance } from "fastify"
import * as z from "zod"
import type { Db } from "@gge/db"
import { settleReference } from "../services/payments.ts"
import { validWebhookSignature, type Paystack } from "../services/paystack.ts"

const ChargeSuccess = z.object({ event: z.literal("charge.success"), data: z.object({ reference: z.string() }) })

function json(body: Buffer): unknown {
    try {
        return JSON.parse(body.toString("utf8"))
    } catch {
        return null
    }
}

/**
 * POST /webhooks/paystack. An event without Paystack's signature over its exact bytes gets 401. A charge.success is
 * checked with Paystack again before anything is delivered, so nothing in the event body is trusted beyond its reference.
 * It answers once the purchase is settled: an error answers 500, and Paystack sends the event again later.
 */
export function paystackWebhook({ db, secretKey, paystack }: { db: Db; secretKey: string | undefined; paystack: Paystack | undefined }) {
    return async (scope: FastifyInstance) => {
        scope.removeAllContentTypeParsers()
        scope.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body))
        scope.post("/webhooks/paystack", async (req, reply) => {
            const signature = req.headers["x-paystack-signature"]
            if (!secretKey || !paystack || !Buffer.isBuffer(req.body) || !validWebhookSignature(req.body, typeof signature === "string" ? signature : undefined, secretKey))
                return reply.status(401).send({ message: "Bad signature" })
            const event = ChargeSuccess.safeParse(json(req.body))
            if (event.success)
                await settleReference(db, paystack, event.data.data.reference)
            return reply.status(200).send({ ok: true })
        })
    }
}
