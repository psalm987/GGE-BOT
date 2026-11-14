import { randomBytes } from "node:crypto"
import { and, eq, isNull, lt, or, sql } from "drizzle-orm"
import { emailTokenPurpose, emailTokens, type Db } from "@gge/db"
import { hashToken } from "./sessions.ts"

export type EmailTokenPurpose = (typeof emailTokenPurpose.enumValues)[number]

const TTL_MS: Record<EmailTokenPurpose, number> = {
    verify_email: 24 * 3600_000,
    reset_password: 3600_000,
}

/** Stores a fresh token and returns the raw value to email. Older unused tokens of the same purpose, and expired rows, are removed. */
export async function issueToken(db: Db, input: { userId: string; purpose: EmailTokenPurpose; email: string }) {
    const token = randomBytes(32).toString("base64url")
    await db.transaction(async tx => {
        await tx.delete(emailTokens).where(or(
            and(eq(emailTokens.userId, input.userId), eq(emailTokens.purpose, input.purpose), isNull(emailTokens.usedAt)),
            lt(emailTokens.expiresAt, sql`now()`),
        ))
        await tx.insert(emailTokens).values({
            userId: input.userId,
            purpose: input.purpose,
            tokenHash: hashToken(token),
            email: input.email,
            expiresAt: new Date(Date.now() + TTL_MS[input.purpose]),
        })
    })
    return token
}

type Tx = Pick<Db, "update">

/** Atomically spends a token. Undefined when it is unknown, used, expired or for another purpose. */
export async function claimToken(tx: Tx, purpose: EmailTokenPurpose, rawToken: string) {
    const [claimed] = await tx.update(emailTokens)
        .set({ usedAt: new Date() })
        .where(and(
            eq(emailTokens.tokenHash, hashToken(rawToken)),
            eq(emailTokens.purpose, purpose),
            isNull(emailTokens.usedAt),
            sql`${emailTokens.expiresAt} > now()`,
        ))
        .returning({ userId: emailTokens.userId, email: emailTokens.email })
    return claimed
}
