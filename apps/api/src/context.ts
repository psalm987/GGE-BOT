import type { EventEmitter } from "node:events"
import type { FastifyReply, FastifyRequest } from "fastify"
import type { Db } from "@gge/db"
import type { Env } from "./env.ts"
import type { Mailer } from "./services/mailer.ts"
import type { RateLimiter } from "./services/rate-limit.ts"

export type Ctx = {
    db: Db
    env: Env
    req: FastifyRequest
    reply: FastifyReply
    /** Login and signup attempts: generous per IP (shared NATs), strict per username. `email` caps mail sent to one address. */
    limits: { ip: RateLimiter; user: RateLimiter; email: RateLimiter }
    mailer: Mailer
    /** Emits "event" with each RawBotEvent the runner announces. */
    botEvents: EventEmitter
}

/** A Postgres unique violation, optionally on one named constraint. */
export function isUniqueViolation(error: unknown, constraint?: string) {
    const pgError = (error as { cause?: { code?: string; constraint?: string } })?.cause ?? (error as { code?: string; constraint?: string })
    return pgError?.code === "23505" && (!constraint || pgError.constraint === constraint)
}
