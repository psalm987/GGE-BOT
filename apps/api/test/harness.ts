import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import { sql } from "drizzle-orm"
import { inject } from "vitest"
import type { AdminApi, ClientApi } from "@gge/contracts"
import { createDb, gameAccounts, invites, pluginCatalog, servers, users, type Db } from "@gge/db"
import { generateSealKeyPair } from "@gge/crypto"
import { hashPassword } from "../src/auth/passwords.ts"
import { hashInviteCode } from "../src/routers/auth.ts"
import type { Mailer, MailMessage } from "../src/services/mailer.ts"
import { buildServer } from "../src/server.ts"

export const CLIENT_ORIGIN = "https://app.test"
export const ADMIN_ORIGIN = "https://admin.test"
export const PASSWORD = "correct horse battery"

export const catalog = [
    { key: "attack", force: true, hidden: false, options: [{ type: "Text", key: "attackDelaySeconds", default: "4.5" }] },
    { key: "attackNomads", force: false, hidden: false, options: [
        { type: "Checkbox", key: "lowValueChests", default: false },
        { type: "Select", key: "eventDifficulty", selection: ["Classic", "Easy", "Hard"], default: "1" },
    ] },
    { key: "commander", force: false, hidden: true, options: [] },
]

/** A browser stand-in: keeps cookies, sends the app's Origin. */
function browser(baseUrl: string, path: string, origin: string) {
    const jar = new Map<string, string>()
    const link = new RPCLink({
        url: `${baseUrl}${path}`,
        headers: () => ({ origin, ...(jar.size && { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }) }),
        fetch: async (request, init) => {
            const response = await fetch(request, init)
            for (const header of response.headers.getSetCookie()) {
                const [name, value] = header.split(";")[0]!.split("=") as [string, string]
                if (value) jar.set(name, value)
                else jar.delete(name)
            }
            return response
        },
    })
    return { jar, link }
}

export async function startApi() {
    const db: Db = createDb(inject("databaseUrl"))
    await db.execute(sql`truncate ${users}, ${servers}, ${pluginCatalog}, ${invites} restart identity cascade`)
    await db.insert(servers).values([
        { id: 26, label: "India 1", wsHost: "ep-live-in1-game.goodgamestudios.com", zone: "EmpireEx_26" },
        { id: 27, label: "Germany 1", wsHost: "ep-live-de1-game.goodgamestudios.com", zone: "EmpireEx_27" },
    ])
    await db.insert(pluginCatalog).values(catalog)
    const keys = generateSealKeyPair()
    const sent: MailMessage[] = []
    let mailFailing = false
    const mailer: Mailer = {
        send: async message => {
            if (mailFailing)
                throw new Error("mail provider down")
            sent.push(message)
        },
    }
    const app = await buildServer({
        db, logger: false, mailer,
        env: { DATABASE_URL: inject("databaseUrl"), SEAL_PUBLIC_KEY: keys.publicKey, CLIENT_ORIGINS: [CLIENT_ORIGIN], ADMIN_ORIGINS: [ADMIN_ORIGIN], HOST: "127.0.0.1", PORT: 0, COOKIE_SECURE: false },
    })
    await app.listen({ host: "127.0.0.1", port: 0 })
    const baseUrl = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`

    const client = (origin = CLIENT_ORIGIN) => {
        const { jar, link } = browser(baseUrl, "/rpc", origin)
        return { api: createORPCClient<ClientApi>(link), jar }
    }
    const admin = (origin = ADMIN_ORIGIN) => {
        const { jar, link } = browser(baseUrl, "/admin/rpc", origin)
        return { api: createORPCClient<AdminApi>(link), jar }
    }

    async function invite(role: "user" | "admin" = "user", code = `code-${Math.random()}`, expiresAt = new Date(Date.now() + 3600_000)) {
        await db.insert(invites).values({ codeHash: hashInviteCode(code), role, expiresAt })
        return code
    }

    /** A signed-in player with a fresh account. */
    async function player(username = `p${Math.random().toString(36).slice(2, 10)}`, email = `${username.toLowerCase()}@example.test`) {
        const c = client()
        await c.api.auth.signup({ inviteCode: await invite(), username, email, password: PASSWORD })
        return { ...c, email }
    }

    /** The link in the latest email sent to an address. */
    const lastLink = (to: string) => {
        const message = sent.findLast(m => m.to === to)
        const url = message?.text.match(/https?:\/\/\S+/)?.[0]
        return url ? new URL(url) : undefined
    }
    const lastToken = (to: string) => lastLink(to)?.searchParams.get("token") ?? undefined

    async function signedInAdmin() {
        await db.insert(users).values({ username: "boss", passwordHash: await hashPassword(PASSWORD), role: "admin" })
        const a = admin()
        await a.api.auth.login({ login: "boss", password: PASSWORD })
        return a
    }

    return {
        db, keys, baseUrl, app, client, admin, invite, player, signedInAdmin, sent, lastLink, lastToken, failMail: (failing: boolean) => { mailFailing = failing },
        close: async () => { await app.close(); await db.$pool.end() },
        accountRows: () => db.select().from(gameAccounts),
    }
}

export type Api = Awaited<ReturnType<typeof startApi>>

/** Every string anywhere inside a value, for leak checks. */
export function allStrings(value: unknown): string[] {
    if (typeof value === "string") return [value]
    if (Array.isArray(value)) return value.flatMap(allStrings)
    if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [k, ...allStrings(v)])
    return []
}
