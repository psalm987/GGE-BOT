// Local stack: Postgres (throwaway unless DATABASE_URL is set), migrations,
// demo data, the API and the web apps. Usage: pnpm dev [--runner]
// --runner also starts the bot runner. Without it nothing contacts the game.
// Centrifugo (live updates) starts too when CENTRIFUGO_BIN names its binary or `centrifugo` is on PATH.
// GGE_DEV_PORT_SHIFT=10 moves every port up by 10, for when the usual ones are taken.
import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { sql } from "drizzle-orm"
import { botLogs, botRuns, botStatus, createDb, gameAccounts, pluginSettings, runMigrations, servers, users } from "@gge/db"
import { startTestPostgres } from "@gge/db/testing"
import { generateEncryptionKey, generateSealKeyPair, sealFor } from "@gge/crypto"
import { hashPassword } from "@gge/api/src/auth/passwords.ts"
import { storeConfirmedSecret } from "@gge/api/src/auth/second-factor.ts"
import { base32Decode } from "@gge/api/src/auth/totp.ts"
import { publishCatalog, readPluginRegistry } from "@gge/runner/src/catalog.ts"
import { readServers } from "@gge/runner/src/game-data.ts"
import { publishGameItems, readGameItems } from "@gge/runner/src/game-items.ts"
import { demoLogLines } from "./seed-logs.ts"

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..")
const withRunner = process.argv.includes("--runner")
const portShift = Number(process.env.GGE_DEV_PORT_SHIFT ?? 0)
const API_PORT = 3000 + portShift
const CLIENT_PORT = 5173 + portShift
const ADMIN_PORT = 5174 + portShift
const CENTRIFUGO_PORT = 8000 + portShift
const CLIENT_ORIGIN = `http://localhost:${CLIENT_PORT}`
const ADMIN_ORIGIN = `http://localhost:${ADMIN_PORT}`
const centrifugoBin = process.env.CENTRIFUGO_BIN
    ?? process.env.PATH?.split(path.delimiter).map(dir => path.join(dir, "centrifugo")).find(existsSync)
// The seeded admin's authenticator secret, so a person or a script can sign in without enrolling.
// .claude/skills/verify/scripts/dev-totp.cjs holds the same value.
const DEV_ADMIN_TOTP_SECRET = "GGEBOTDEVADMINTOTPSECRET23456767"

const pg = process.env.DATABASE_URL ? { url: process.env.DATABASE_URL, stop: async () => {} } : await startTestPostgres()
const db = createDb(pg.url)
await runMigrations(db)
const keys = process.env.SEAL_PRIVATE_KEY && process.env.SEAL_PUBLIC_KEY
    ? { publicKey: process.env.SEAL_PUBLIC_KEY, privateKey: process.env.SEAL_PRIVATE_KEY }
    : generateSealKeyPair()
const totpKey = process.env.TOTP_ENCRYPTION_KEY ?? generateEncryptionKey()

const dataDir = [process.env.GGE_DATA_DIR, path.join(root, "data"), path.join(homedir(), ".cache/gge-bot-verify/seed")]
    .find(d => d && existsSync(path.join(d, "1.xml")))

/** Exercises every settings control. Only the dev database has it; a runner started with --runner drops it again. */
const DEV_SETTINGS_PREVIEW: Parameters<typeof publishCatalog>[1][number] = {
    key: "devSettingsPreview", force: false, hidden: false, category: null, breaksPeace: true,
    checks: [{ type: "commanders", option: "commanderWhiteList" }, { type: "dailyAttacks" }],
    options: [
        { type: "Text", key: "commanderWhiteList", default: "1-99" },
        { type: "Number", key: "stopMinutesBefore", min: 0, max: 240, step: 5, unit: "minutes", default: 30 },
        { type: "CastlePicker", key: "sourceCastle" },
        { type: "OrderedList", key: "bannerOrder", catalog: "banners", default: [660, 661, 77], advanced: true },
        {
            type: "Rows", key: "toolTargets", advanced: true, default: [],
            columns: [{ key: "castle", type: "castle" }, { key: "tool", type: "tool" }, { key: "target", type: "number", min: 0, max: 100000 }],
        },
        { type: "Checkbox", key: "dryRun", default: false, advanced: true },
    ],
}

const IRONHOLD_CASTLES = [
    { kingdom: 0, id: 1001, name: "Ironhold", x: 412, y: 288, type: 1 },
    { kingdom: 0, id: 1002, name: "Ironhold Watch", x: 430, y: 301, type: 4 },
    { kingdom: 2, id: 2001, name: "Frostgate", x: 120, y: 77, type: 12 },
]
const IRONHOLD_PLUGIN_STATES = {
    attackNomads: { state: "waiting", reasonKey: "statusEventClosed", params: {} },
    attack: { state: "running", reasonKey: "statusAttacksToday", params: { used: 1240, limit: 3500 } },
}

async function seed() {
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from ${users}`)).rows as [{ n: number }]
    if (n > 0)
        return false
    const serverRows = dataDir ? await readServers(dataDir) : [
        { id: 2, label: "Germany 1", wsHost: "ep-live-de1-game.goodgamestudios.com", zone: "EmpireEx_2" },
        { id: 26, label: "India 1", wsHost: "ep-live-in1-game.goodgamestudios.com", zone: "EmpireEx_26" },
    ]
    await db.insert(servers).values(serverRows)
    await publishCatalog(db, [...readPluginRegistry({}).catalog, DEV_SETTINGS_PREVIEW])
    if (dataDir)
        await publishGameItems(db, await readGameItems(dataDir))

    const passwordHash = await hashPassword("demo-password")
    const verified = new Date()
    const [admin] = await db.insert(users).values({ username: "admin", email: "admin@example.test", emailVerifiedAt: verified, passwordHash, role: "admin" }).returning()
    await storeConfirmedSecret(db, totpKey, admin!.id, base32Decode(DEV_ADMIN_TOTP_SECRET))
    const [player] = await db.insert(users).values({ username: "demo", email: "demo@example.test", emailVerifiedAt: verified, passwordHash }).returning()

    const serverId = serverRows.find(s => s.label.includes("Germany"))?.id ?? serverRows[0]!.id
    const demo: [string, "running" | "stopped", "running" | "stopped" | "banned" | "auth_failed" | "error" | "crash_loop" | null, string | null][] = [
        ["Ironhold", "running", "running", null],
        ["Ravenmoor", "running", "running", null],
        ["Brightwater", "stopped", "stopped", null],
        ["Thornwick", "stopped", "auth_failed", "INVALID_PASSWORD"],
        ["Ashenfell", "stopped", "banned", "IS_BANNED"],
        ["Duskmere", "running", "error", "The bot stopped unexpectedly; retrying in 20s"],
        ["Emberfall", "stopped", "crash_loop", "Stopped after 8 failed starts in a row: The bot stopped responding"],
        ["Newkeep", "stopped", null, null],
    ]
    const withHistory: string[] = []
    for (const [name, desiredState, state, lastError] of demo) {
        const [account] = await db.insert(gameAccounts).values({ ownerId: player!.id, name, serverId, desiredState, passwordSealed: sealFor(keys.publicKey, "demo") }).returning()
        await db.insert(pluginSettings).values([
            { accountId: account!.id, pluginKey: "feast", enabled: true, options: {} },
            { accountId: account!.id, pluginKey: "attackNomads", enabled: name !== "Newkeep", options: { eventDifficulty: 6 } },
            ...name === "Ironhold" ? [{ accountId: account!.id, pluginKey: "devSettingsPreview", enabled: true, options: {} }] : [],
        ])
        if (!state)
            continue
        await db.insert(botStatus).values({
            accountId: account!.id, actualState: state, lastError,
            ...name === "Ironhold" && { pluginStates: IRONHOLD_PLUGIN_STATES, resources: {
                castles: IRONHOLD_CASTLES, cash: 48_250_310, gold: 1_284, food: 3_912_450, mead: 126_800, aquamarin_name: 5_240, attackDailyCount: 37,
                reportedAt: new Date(Date.now() - 40_000).toISOString(),
            } },
            heartbeatAt: state === "running" ? new Date(Date.now() - 40_000) : new Date(Date.now() - 6 * 3600_000),
            bannedUntil: state === "banned" ? new Date(Date.now() + 3 * 86400_000) : null,
        })
        await db.insert(botRuns).values([
            { accountId: account!.id, startedAt: new Date(Date.now() - 30 * 3600_000), endedAt: new Date(Date.now() - 20 * 3600_000), endReason: "deploy" },
            { accountId: account!.id, startedAt: new Date(Date.now() - 20 * 3600_000), ...(state === "running" ? {} : { endedAt: new Date(Date.now() - 6 * 3600_000), endReason: state === "stopped" ? "stopped" : state === "crash_loop" ? "stale" : state }) },
        ])
        withHistory.push(account!.id)
    }
    await db.insert(botLogs).values(demoLogLines(withHistory))
    return true
}

const seeded = await seed()
const env = {
    ...process.env,
    DATABASE_URL: pg.url,
    SEAL_PUBLIC_KEY: keys.publicKey,
    SEAL_PRIVATE_KEY: keys.privateKey,
    TOTP_ENCRYPTION_KEY: totpKey,
    CLIENT_ORIGINS: CLIENT_ORIGIN,
    ADMIN_ORIGINS: ADMIN_ORIGIN,
    PORT: String(API_PORT),
    HOST: "127.0.0.1",
    COOKIE_SECURE: "false",
    // The Vite configs read these three.
    GGE_DEV_API_URL: `http://localhost:${API_PORT}`,
    GGE_DEV_CENTRIFUGO_URL: `http://localhost:${CENTRIFUGO_PORT}`,
    VITE_CLIENT_URL: CLIENT_ORIGIN,
    // Without Centrifugo the API has no secret, so it tells the apps live updates are off.
    ...(centrifugoBin && { CENTRIFUGO_TOKEN_SECRET: process.env.CENTRIFUGO_TOKEN_SECRET ?? randomBytes(32).toString("hex") }),
    ...(dataDir && { GGE_DATA_DIR: dataDir, REFRESH_GAME_DATA: "false" }),
}

const children: ChildProcess[] = []
let stopping = false
const stop = async (exitCode = 0) => {
    if (stopping)
        return
    stopping = true
    children.forEach(c => c.kill("SIGTERM"))
    await new Promise(r => setTimeout(r, 1500))
    await db.$pool.end()
    await pg.stop()
    process.exit(exitCode)
}
process.once("SIGINT", () => void stop())
process.once("SIGTERM", () => void stop())

let alive = 0
const run = (name: string, cmd: string, args: string[], cwd: string, extraEnv: Record<string, string> = {}) => {
    const child = spawn(cmd, args, { cwd, env: { ...env, ...extraEnv }, stdio: ["ignore", "inherit", "inherit"] })
    alive++
    // "error" (the command couldn't start) and "exit" never both fire for one child.
    const ended = (why: string) => {
        if (!stopping)
            console.error(`${name} ${why}`)
        // With nothing left to serve, stop Postgres too instead of leaving it running.
        if (--alive === 0)
            void stop(1)
    }
    child.on("error", error => ended(`could not start: ${error.message}`))
    child.on("exit", (code, signal) => ended(`exited with ${code ?? signal}`))
    children.push(child)
}
run("api", "node", ["--import", "./src/instrument.ts", "src/main.ts"], path.join(root, "apps/api"))
run("client", "pnpm", ["exec", "vite", "--port", String(CLIENT_PORT), "--strictPort"], path.join(root, "apps/client"))
if (existsSync(path.join(root, "apps/admin/package.json")))
    run("admin", "pnpm", ["exec", "vite", "--port", String(ADMIN_PORT), "--strictPort"], path.join(root, "apps/admin"))
if (withRunner)
    run("runner", "node", ["--import", "./src/instrument.ts", "src/main.ts"], path.join(root, "apps/runner"))
if (centrifugoBin)
    run("centrifugo", centrifugoBin, ["--config", path.join(root, "infra/centrifugo/config.json")], root, {
        CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY: env.CENTRIFUGO_TOKEN_SECRET!,
        CENTRIFUGO_CLIENT_ALLOWED_ORIGINS: `${CLIENT_ORIGIN} ${ADMIN_ORIGIN}`,
        CENTRIFUGO_CONSUMERS_OUTBOX_POSTGRESQL_DSN: pg.url,
        CENTRIFUGO_HTTP_SERVER_ADDRESS: "127.0.0.1",
        CENTRIFUGO_HTTP_SERVER_PORT: String(CENTRIFUGO_PORT),
    })

console.log(`
  Player app   ${CLIENT_ORIGIN}   demo / demo-password
  Admin app    ${ADMIN_ORIGIN}   admin / demo-password
               authenticator key ${DEV_ADMIN_TOTP_SECRET} (add it to an authenticator app for the 6-digit code)
  Postgres     ${pg.url}
  API          http://localhost:${API_PORT}${seeded ? "\n  (seeded demo data)" : ""}${withRunner ? "" : "\n  Runner off: pass --runner to run bots."}
  ${centrifugoBin ? `Centrifugo   http://localhost:${CENTRIFUGO_PORT}` : "Centrifugo not found (set CENTRIFUGO_BIN or put it on PATH): live updates fall back."}
`)
