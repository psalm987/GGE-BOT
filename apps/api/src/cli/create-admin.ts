import { parseArgs } from "node:util"
import { eq, sql } from "drizzle-orm"
import { createDb, users } from "@gge/db"
import { NewPassword, Username } from "@gge/contracts"
import { hashPassword } from "../auth/passwords.ts"

// Usage: GGE_ADMIN_PASSWORD=... node src/cli/create-admin.ts --username alice
// Creates the user as an admin, or makes an existing user an admin and resets its password.
const { values } = parseArgs({ options: { username: { type: "string" } } })
const username = Username.parse(values.username)
const password = NewPassword.parse(process.env.GGE_ADMIN_PASSWORD)
const url = process.env.DATABASE_URL
if (!url)
    throw new Error("DATABASE_URL is required")

const db = createDb(url)
const passwordHash = await hashPassword(password)
const [existing] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.username})`, username.toLowerCase()))
if (existing)
    await db.update(users)
        .set({ role: "admin", status: "active", passwordHash, passwordAlgo: "argon2id", passwordSalt: null, updatedAt: new Date() })
        .where(eq(users.id, existing.id))
else
    await db.insert(users).values({ username, passwordHash, role: "admin" })
await db.$pool.end()
console.log(`${username} is an admin`)
