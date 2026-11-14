import { createDb } from "@gge/db"
import { parseEnv } from "./env.ts"
import { buildServer } from "./server.ts"

const env = parseEnv()
const db = createDb(env.DATABASE_URL)
const app = await buildServer({ db, env })

for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, async () => {
        await app.close()
        await db.$pool.end()
        process.exit(0)
    })

await app.listen({ host: env.HOST, port: env.PORT })
