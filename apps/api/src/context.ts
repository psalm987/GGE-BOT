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
    /**
     * `ip` caps every login and signup attempt per IP, generously (shared NATs). Failed password
     * checks are capped strictly per username and IP in `user`, and per username across all IPs in
     * `userTotal`. `user` also caps wrong second-factor codes per admin. `email` caps mail sent to one address; `signup` caps new accounts per IP.
     */
    limits: { ip: RateLimiter; user: RateLimiter; userTotal: RateLimiter; email: RateLimiter; signup: RateLimiter }
    mailer: Mailer
}

/** A Postgres unique violation, optionally on one named constraint. */
export function isUniqueViolation(error: unknown, constraint?: string) {
    const pgError = (error as { cause?: { code?: string; constraint?: string } })?.cause ?? (error as { code?: string; constraint?: string })
    return pgError?.code === "23505" && (!constraint || pgError.constraint === constraint)
}
