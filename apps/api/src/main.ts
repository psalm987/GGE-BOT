import { createDb } from "@gge/db"
import { parseEnv } from "./env.ts"
import { resendMailer } from "./services/mailer.ts"
import { buildServer } from "./server.ts"

const env = parseEnv()
const db = createDb(env.DATABASE_URL)
const mailer = env.RESEND_API_KEY ? resendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM! }) : undefined
const app = await buildServer({ db, env, mailer })

for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, async () => {
        await app.close()
        await db.$pool.end()
        process.exit(0)
    })

await app.listen({ host: env.HOST, port: env.PORT })
