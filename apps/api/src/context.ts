import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify"
import type { Db } from "@gge/db"
import type { Env } from "./env.ts"
import type { Geoip } from "./services/geoip.ts"
import type { Mailer } from "./services/mailer.ts"
import type { Paystack } from "./services/paystack.ts"
import type { RateLimiter } from "./services/rate-limit.ts"

export type Ctx = {
    db: Db
    env: Env
    req: FastifyRequest
    reply: FastifyReply
    /** This request's logger. */
    log: FastifyBaseLogger
    /**
     * `ip` caps every login and signup attempt per IP, generously (shared NATs). Failed password
     * checks are capped strictly per username and IP in `user`, and per username across all IPs in
     * `userTotal`. `user` also caps wrong second-factor codes per admin. `email` caps mail sent to one address; `signup` caps new accounts per IP;
     * `dataExport` caps data downloads per user. `redeemCode` caps wrong license codes, per player and per IP.
     */
    limits: { ip: RateLimiter; user: RateLimiter; userTotal: RateLimiter; email: RateLimiter; signup: RateLimiter; dataExport: RateLimiter; detect: RateLimiter; redeemCode: RateLimiter }
    mailer: Mailer
    /** Country of an IP; null when unknown. */
    lookupCountry: Geoip
    /** Paystack with the secret key; undefined on a deployment without PAYSTACK_SECRET_KEY. */
    paystack: Paystack | undefined
}

/** A Postgres unique violation, optionally on one named constraint. */
export function isUniqueViolation(error: unknown, constraint?: string) {
    const pgError = (error as { cause?: { code?: string; constraint?: string } })?.cause ?? (error as { code?: string; constraint?: string })
    return pgError?.code === "23505" && (!constraint || pgError.constraint === constraint)
}
