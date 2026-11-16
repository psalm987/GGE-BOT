import { parseArgs } from "node:util"
import { eq, sql } from "drizzle-orm"
import { createDb, users } from "@gge/db"
import { Username } from "@gge/contracts"
import { hasConfirmedTotp, resetSecondFactor } from "../auth/second-factor.ts"
import { audit } from "../services/audit.ts"

// Usage: node src/cli/reset-2fa.ts --username alice
// Forgets the user's authenticator and recovery codes and ends their admin sessions,
// so their next admin sign-in sets up a new authenticator. For an admin who lost
// their phone and codes when no other admin can reset them in the admin app.
const { values } = parseArgs({ options: { username: { type: "string" } } })
const username = Username.parse(values.username)
const url = process.env.DATABASE_URL
if (!url)
    throw new Error("DATABASE_URL is required")

const db = createDb(url)
const [user] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.username})`, username.toLowerCase()))
if (!user) {
    await db.$pool.end()
    throw new Error(`No user named ${username}`)
}
const wasEnrolled = await hasConfirmedTotp(db, user.id)
await resetSecondFactor(db, user.id)
await audit(db, { actorId: null, action: "admin.user.totp_reset", targetType: "user", targetId: user.id, meta: { via: "cli" } })
await db.$pool.end()
console.log(wasEnrolled
    ? `Two-factor sign-in reset for ${username}. Their next admin sign-in sets up a new authenticator.`
    : `${username} had no authenticator set up. Their admin sessions were ended.`)
