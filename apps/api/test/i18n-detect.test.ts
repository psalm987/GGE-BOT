import { createServer, type Server } from "node:http"
import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import { eq, sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest"
import type { AdminApi, ClientApi } from "@gge/contracts"
import { users } from "@gge/db"
import { startApi, type Api } from "./harness.ts"

const ITALY = "93.58.1.10"
const BELGIUM = "81.164.1.10"
const LAGGY = "203.0.113.50"
const BROKEN = "198.51.100.20"

const countries: Record<string, string> = { [ITALY]: "IT", [BELGIUM]: "BE" }
const asked: string[] = []
let stub: Server
let api: Api

beforeAll(async () => {
    stub = createServer((req, res) => {
        const ip = decodeURIComponent(req.url!.split("/").pop()!)
        asked.push(ip)
        if (ip === LAGGY) return
        if (ip === BROKEN) {
            res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "SPECIAL_IP" }))
            return
        }
        res.writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify({ results: { [ip]: { country: { iso_code: countries[ip] } } }, database_build_epoch: 0 }))
    })
    await new Promise<void>(resolve => stub.listen(0, "127.0.0.1", resolve))
    api = await startApi({ GEOIP_URL: `http://127.0.0.1:${(stub.address() as { port: number }).port}` })
})
afterAll(async () => {
    await api.close()
    stub.closeAllConnections()
    stub.close()
})
beforeEach(() => { asked.length = 0 })

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)

/** Calls i18n.detect from `ip`, the way a browser with that Accept-Language would. */
function detect(ip: string, acceptLanguage?: string, origin = "https://app.test") {
    const link = new RPCLink({
        url: `${api.baseUrl}/rpc`,
        headers: { origin, "x-forwarded-for": ip, ...(acceptLanguage && { "accept-language": acceptLanguage }) },
    })
    return createORPCClient<ClientApi>(link).i18n.detect()
}

describe("i18n.detect", () => {
    test("an Italian IP gives Italian", async () => {
        expect(await detect(ITALY)).toEqual({ locale: "it", country: "IT", source: "ip" })
    })

    test("a Belgian IP follows Accept-Language between the country's languages", async () => {
        expect(await detect(BELGIUM, "fr-BE,fr;q=0.9")).toEqual({ locale: "fr", country: "BE", source: "ip" })
    })

    test("a private IP never reaches atlas and falls back to the header", async () => {
        expect(await detect("10.1.2.3", "de-DE")).toEqual({ locale: "de", country: null, source: "header" })
        expect(asked).toEqual([])
    })

    test("atlas refusing an address falls back to the header", async () => {
        expect(await detect(BROKEN, "pl")).toEqual({ locale: "pl", country: null, source: "header" })
    })

    test("a service that never answers costs about 300 ms", async () => {
        const started = Date.now()
        expect(await detect(LAGGY, "sv")).toEqual({ locale: "sv", country: null, source: "header" })
        expect(Date.now() - started).toBeLessThan(1500)
    })

    test("with no header and no country the answer is English", async () => {
        expect(await detect("10.9.9.9")).toEqual({ locale: "en", country: null, source: "default" })
    })

    test("a second lookup of the same IP is answered from the cache", async () => {
        const ip = "93.58.2.20"
        countries[ip] = "IT"
        await detect(ip)
        await detect(ip)
        expect(asked).toEqual([ip])
    })

    test("the admin app has the same endpoint", async () => {
        const link = new RPCLink({ url: `${api.baseUrl}/admin/rpc`, headers: { origin: "https://admin.test", "x-forwarded-for": ITALY } })
        expect(await createORPCClient<AdminApi>(link).i18n.detect()).toMatchObject({ locale: "it", source: "ip" })
    })

    test("a signed-in call keeps the result on the user and the IP in no table", async () => {
        const ip = "93.58.3.30"
        countries[ip] = "IT"
        const player = await api.player("lucia")
        const elsewhere = api.client(undefined, ip)
        for (const [name, value] of player.jar) elsewhere.jar.set(name, value)

        expect(await elsewhere.api.i18n.detect()).toMatchObject({ locale: "it" })

        const [row] = await api.db.select({ detected: users.detectedLocale }).from(users).where(eq(users.username, "lucia"))
        expect(row!.detected).toBe("it")
        const tables = await api.db.execute<{ t: string }>(sql`select table_name as t from information_schema.tables where table_schema = 'public'`)
        for (const { t } of tables.rows) {
            const { rows } = await api.db.execute<{ hit: boolean }>(sql`select exists (select 1 from ${sql.identifier(t)} x where x::text like ${`%${ip}%`}) as hit`)
            expect(rows[0]!.hit, `table ${t} holds the IP`).toBe(false)
        }
    })

    test("a stranger can't make one IP flood the endpoint", async () => {
        const results = []
        for (let i = 0; i < 61; i++) results.push(await codeOf(detect("10.77.77.77")))
        expect(results.slice(0, 60).every(r => r === "ok")).toBe(true)
        expect(results[60]).toBe("TOO_MANY_REQUESTS")
    })
})

describe("account.setLocale", () => {
    test("is the locale auth.me returns, and null goes back to Automatic", async () => {
        const player = await api.player("marta")
        expect((await player.api.auth.me())!.locale).toBeNull()
        await player.api.account.setLocale({ locale: "pl" })
        expect((await player.api.auth.me())!.locale).toBe("pl")
        await player.api.account.setLocale({ locale: null })
        expect((await player.api.auth.me())!.locale).toBeNull()
    })

    test("needs a signed-in user and a known code", async () => {
        expect(await codeOf(api.client().api.account.setLocale({ locale: "pl" }))).toBe("UNAUTHORIZED")
        const player = await api.player("nils")
        expect(await codeOf(player.api.account.setLocale({ locale: "xx" as "pl" }))).toBe("BAD_REQUEST")
    })

    test("the data export carries both locales", async () => {
        const player = await api.player("olga")
        await player.api.account.setLocale({ locale: "cs" })
        expect((await player.api.account.exportData()).profile).toMatchObject({ locale: "cs", detectedLocale: null })
    })
})

describe("signup", () => {
    test("keeps a valid X-GGE-Locale as the detected locale and ignores a bad one", async () => {
        for (const [name, header, expected] of [["pia", "fi", "fi"], ["quin", "zz", null]] as const) {
            const link = new RPCLink({ url: `${api.baseUrl}/rpc`, headers: { origin: "https://app.test", "x-forwarded-for": "10.5.5.5", "x-gge-locale": header } })
            await createORPCClient<ClientApi>(link).auth.signup({ username: name, email: `${name}@example.test`, password: "correct horse battery" })
            const [row] = await api.db.select({ detected: users.detectedLocale }).from(users).where(eq(users.username, name))
            expect(row!.detected).toBe(expected)
        }
    })
})

describe("the users table", () => {
    test("refuses a locale that is not one of ours", async () => {
        await api.player("rosa")
        await expect(api.db.execute(sql`update users set locale = 'xx' where username = 'rosa'`)).rejects.toMatchObject({ cause: { constraint: "users_locale_valid" } })
        await expect(api.db.execute(sql`update users set detected_locale = 'xx' where username = 'rosa'`)).rejects.toMatchObject({ cause: { constraint: "users_detected_locale_valid" } })
    })
})
