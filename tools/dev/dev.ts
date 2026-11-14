// Local stack: Postgres (throwaway unless DATABASE_URL is set), migrations,
// demo data, the API and the web apps. Usage: pnpm dev [--runner]
// --runner also starts the bot runner. Without it nothing contacts the game.
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { sql } from "drizzle-orm"
import { botLogs, botRuns, botStatus, createDb, gameAccounts, pluginSettings, runMigrations, servers, users } from "@gge/db"
import { startTestPostgres } from "@gge/db/testing"
import { generateSealKeyPair, sealFor } from "@gge/crypto"
import { hashPassword } from "@gge/api/src/auth/passwords.ts"
import { publishCatalog, readPluginRegistry } from "@gge/runner/src/catalog.ts"
import { readServers } from "@gge/runner/src/game-data.ts"

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..")
const withRunner = process.argv.includes("--runner")
const API_PORT = 3000

const pg = process.env.DATABASE_URL ? { url: process.env.DATABASE_URL, stop: async () => {} } : await startTestPostgres()
const db = createDb(pg.url)
await runMigrations(db)
const keys = process.env.SEAL_PRIVATE_KEY && process.env.SEAL_PUBLIC_KEY
    ? { publicKey: process.env.SEAL_PUBLIC_KEY, privateKey: process.env.SEAL_PRIVATE_KEY }
    : generateSealKeyPair()

const dataDir = [process.env.GGE_DATA_DIR, path.join(root, "data"), path.join(homedir(), ".cache/gge-bot-verify/seed")]
    .find(d => d && existsSync(path.join(d, "1.xml")))

async function seed() {
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from ${users}`)).rows as [{ n: number }]
    if (n > 0)
        return false
    const serverRows = dataDir ? await readServers(dataDir) : [
        { id: 2, label: "Germany 1", wsHost: "ep-live-de1-game.goodgamestudios.com", zone: "EmpireEx_2" },
        { id: 26, label: "India 1", wsHost: "ep-live-in1-game.goodgamestudios.com", zone: "EmpireEx_26" },
    ]
    await db.insert(servers).values(serverRows)
    await publishCatalog(db, readPluginRegistry({}).catalog)

    const passwordHash = await hashPassword("demo-password")
    const verified = new Date()
    await db.insert(users).values({ username: "admin", email: "admin@example.test", emailVerifiedAt: verified, passwordHash, role: "admin" })
    const [player] = await db.insert(users).values({ username: "demo", email: "demo@example.test", emailVerifiedAt: verified, passwordHash }).returning()

    const serverId = serverRows.find(s => s.label.includes("Germany"))?.id ?? serverRows[0]!.id
    const demo: [string, "running" | "stopped", "running" | "stopped" | "banned" | "auth_failed" | "error" | null, string | null][] = [
        ["Ironhold", "running", "running", null],
        ["Ravenmoor", "running", "running", null],
        ["Brightwater", "stopped", "stopped", null],
        ["Thornwick", "stopped", "auth_failed", "INVALID_PASSWORD"],
        ["Ashenfell", "stopped", "banned", "IS_BANNED"],
        ["Duskmere", "running", "error", "The bot stopped unexpectedly; retrying in 20s"],
        ["Newkeep", "stopped", null, null],
    ]
    for (const [name, desiredState, state, lastError] of demo) {
        const [account] = await db.insert(gameAccounts).values({ ownerId: player!.id, name, serverId, desiredState, passwordSealed: sealFor(keys.publicKey, "demo") }).returning()
        await db.insert(pluginSettings).values([
            { accountId: account!.id, pluginKey: "feast", enabled: true, options: {} },
            { accountId: account!.id, pluginKey: "attackNomads", enabled: name !== "Newkeep", options: { eventDifficulty: 6 } },
        ])
        if (!state)
            continue
        await db.insert(botStatus).values({
            accountId: account!.id, actualState: state, lastError,
            heartbeatAt: state === "running" ? new Date(Date.now() - 40_000) : new Date(Date.now() - 6 * 3600_000),
            bannedUntil: state === "banned" ? new Date(Date.now() + 3 * 86400_000) : null,
        })
        await db.insert(botRuns).values([
            { accountId: account!.id, startedAt: new Date(Date.now() - 30 * 3600_000), endedAt: new Date(Date.now() - 20 * 3600_000), endReason: "deploy" },
            { accountId: account!.id, startedAt: new Date(Date.now() - 20 * 3600_000), ...(state === "running" ? {} : { endedAt: new Date(Date.now() - 6 * 3600_000), endReason: state === "stopped" ? "stopped" : state }) },
        ])
        await db.insert(botLogs).values([
            { accountId: account!.id, level: 0, message: "Logged in", parts: ["loggedIn"] },
            { accountId: account!.id, level: 0, message: "Attack Nomads started", parts: ["attackNomads", " started"] },
            { accountId: account!.id, level: 1, message: "Max attacks reached", parts: ["Max attacks reached"] },
        ])
    }
    return true
}

const seeded = await seed()
const env = {
    ...process.env,
    DATABASE_URL: pg.url,
    SEAL_PUBLIC_KEY: keys.publicKey,
    SEAL_PRIVATE_KEY: keys.privateKey,
    CLIENT_ORIGINS: "http://localhost:5173",
    ADMIN_ORIGINS: "http://localhost:5174",
    PORT: String(API_PORT),
    HOST: "127.0.0.1",
    COOKIE_SECURE: "false",
    ...(dataDir && { GGE_DATA_DIR: dataDir, REFRESH_GAME_DATA: "false" }),
}

const children: ChildProcess[] = []
const run = (name: string, cmd: string, args: string[], cwd: string) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "inherit", "inherit"] })
    child.on("exit", code => code && console.error(`${name} exited with ${code}`))
    children.push(child)
}
run("api", "node", ["src/main.ts"], path.join(root, "apps/api"))
run("client", "pnpm", ["exec", "vite", "--port", "5173", "--strictPort"], path.join(root, "apps/client"))
if (existsSync(path.join(root, "apps/admin/package.json")))
    run("admin", "pnpm", ["exec", "vite", "--port", "5174", "--strictPort"], path.join(root, "apps/admin"))
if (withRunner)
    run("runner", "node", ["src/main.ts"], path.join(root, "apps/runner"))

console.log(`
  Player app   http://localhost:5173   demo / demo-password
  Admin app    http://localhost:5174   admin / demo-password
  API          http://localhost:${API_PORT}${seeded ? "\n  (seeded demo data)" : ""}${withRunner ? "" : "\n  Runner off: pass --runner to run bots."}
`)

const stop = async () => {
    children.forEach(c => c.kill("SIGTERM"))
    await new Promise(r => setTimeout(r, 1500))
    await db.$pool.end()
    await pg.stop()
    process.exit(0)
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
