import { eq } from "drizzle-orm"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest"
import { openSealed } from "@gge/crypto"
import { auditLog, gameAccounts, proxies } from "@gge/db"
import { allStrings, startApi, type Api } from "./harness.ts"

let api: Api
let admin: Awaited<ReturnType<Api["signedInAdmin"]>>
beforeAll(async () => {
    api = await startApi()
    admin = await api.signedInAdmin()
})
afterAll(() => api.close())
beforeEach(() => api.db.delete(proxies))

const SECRET = "hunter2-proxy-pw"
const URL_WITH_SECRET = `socks5h://bot-user:${SECRET}@10.0.0.5:1080`
const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const messageOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { message: string }) => e.message)
const sealedUrl = async (id: string) => openSealed(api.keys.privateKey, (await api.db.select().from(proxies).where(eq(proxies.id, id)))[0]!.urlSealed)
const audited = async (action: string) => (await api.db.select().from(auditLog).where(eq(auditLog.action, action))).at(-1)
const newAccount = (name: string, externalEvent = false) => ({ name, serverId: 26, password: "pw", externalEvent, plugins: {} })
const proxyOf = async (accountId: string) => (await admin.api.accounts.list({ limit: 200 })).items.find(a => a.id === accountId)

/** A player with room for several accounts. */
async function playerWithRoom() {
    const p = await api.player()
    const me = (await p.api.auth.me())!
    await admin.api.users.setMaxBots({ id: me.id, maxBots: 5 })
    return p
}

describe("managing the pool", () => {
    test("a new proxy is sealed for the runner and comes back as its host hint only", async () => {
        const created = await admin.api.proxies.create({ label: "Paris", url: URL_WITH_SECRET, maxAccounts: 2 })

        expect(created).toMatchObject({
            label: "Paris", hostHint: "socks5h://10.0.0.5:1080", enabled: true, maxAccounts: 2, accountCount: 0,
            consecutiveFailures: 0, lastOkAt: null, lastErrorAt: null, lastError: null, disabledReason: null,
        })
        expect(await sealedUrl(created.id)).toBe(URL_WITH_SECRET)
        expect(await admin.api.proxies.list()).toEqual([created])
    })

    test("no answer, audit entry or stored column carries the URL's credentials", async () => {
        const created = await admin.api.proxies.create({ label: "Leak check", url: URL_WITH_SECRET, maxAccounts: 3 })
        const updated = await admin.api.proxies.update({ id: created.id, url: `http://other:${SECRET}@10.0.0.6:8080`, label: "Leak check 2" })
        const listed = await admin.api.proxies.list()
        const accounts = await admin.api.accounts.list({})
        const audit = await admin.api.audit.list({ limit: 500 })
        const [row] = await api.db.select().from(proxies).where(eq(proxies.id, created.id))
        const { urlSealed, ...readable } = row!

        for (const [where, value] of Object.entries({ created, updated, listed, accounts, audit, readable })) {
            const text = allStrings(value).join(" ")
            expect(text, where).not.toContain(SECRET)
            expect(text, where).not.toContain("bot-user")
        }
        expect(urlSealed.toString("latin1")).not.toContain(SECRET)
        expect(updated.hostHint).toBe("http://10.0.0.6:8080")
    })

    test.each([
        ["an unsupported scheme", "ftp://10.0.0.5:21"],
        ["no port", "socks5h://user:pw@10.0.0.5"],
        ["no host", "http://:8080"],
    ])("a URL with %s is refused and nothing is stored", async (_, url) => {
        expect(await codeOf(admin.api.proxies.create({ label: "Bad", url, maxAccounts: 3 }))).toBe("BAD_REQUEST")
        expect(await admin.api.proxies.list()).toEqual([])
    })

    test("an edit without a URL keeps the stored one", async () => {
        const { id } = await admin.api.proxies.create({ label: "Paris", url: URL_WITH_SECRET, maxAccounts: 3 })

        const updated = await admin.api.proxies.update({ id, label: "Lyon", maxAccounts: 7 })

        expect(updated).toMatchObject({ label: "Lyon", maxAccounts: 7, hostHint: "socks5h://10.0.0.5:1080" })
        expect(await sealedUrl(id)).toBe(URL_WITH_SECRET)
    })

    test("a new URL replaces the sealed one and the hint", async () => {
        const { id } = await admin.api.proxies.create({ label: "Paris", url: URL_WITH_SECRET, maxAccounts: 3 })
        const updated = await admin.api.proxies.update({ id, url: "https://u2:p2@proxy.example.com:8443" })
        expect(updated.hostHint).toBe("https://proxy.example.com:8443")
        expect(await sealedUrl(id)).toBe("https://u2:p2@proxy.example.com:8443")
    })

    test("turning a proxy back on clears why it was turned off and its failure count", async () => {
        const { id } = await admin.api.proxies.create({ label: "Flaky", url: URL_WITH_SECRET, maxAccounts: 3 })
        await api.db.update(proxies).set({ enabled: false, consecutiveFailures: 5, disabledReason: "Turned off after 5 failed connections in a row: PROXY_AUTH", lastError: "PROXY_AUTH" }).where(eq(proxies.id, id))
        expect((await admin.api.proxies.list())[0]).toMatchObject({ enabled: false, consecutiveFailures: 5, disabledReason: expect.stringContaining("PROXY_AUTH") })

        const enabled = await admin.api.proxies.update({ id, enabled: true })

        expect(enabled).toMatchObject({ enabled: true, consecutiveFailures: 0, disabledReason: null, lastError: "PROXY_AUTH" })
    })

    test("an admin turning a proxy off leaves no reason, and its failure count stays", async () => {
        const { id } = await admin.api.proxies.create({ label: "Off", url: URL_WITH_SECRET, maxAccounts: 3 })
        await api.db.update(proxies).set({ consecutiveFailures: 2 }).where(eq(proxies.id, id))
        expect(await admin.api.proxies.update({ id, enabled: false })).toMatchObject({ enabled: false, disabledReason: null, consecutiveFailures: 2 })
    })

    test("a proxy that doesn't exist can't be edited or removed", async () => {
        const id = "00000000-0000-4000-8000-000000000000"
        expect(await codeOf(admin.api.proxies.update({ id, label: "x" }))).toBe("NOT_FOUND")
        expect(await codeOf(admin.api.proxies.remove({ id }))).toBe("NOT_FOUND")
    })

    test("every change is in the audit log under the admin's name, with the host and never the URL", async () => {
        const { id } = await admin.api.proxies.create({ label: "Audited", url: URL_WITH_SECRET, maxAccounts: 4 })
        expect(await audited("admin.proxy.create")).toMatchObject({ targetType: "proxy", targetId: id, meta: { label: "Audited", hostHint: "socks5h://10.0.0.5:1080", maxAccounts: 4 } })

        await admin.api.proxies.update({ id, url: "http://u:p@10.0.0.7:3128", enabled: false })
        expect(await audited("admin.proxy.update")).toMatchObject({ targetId: id, meta: { enabled: false, hostHint: "http://10.0.0.7:3128" } })
        expect((await audited("admin.proxy.update"))!.meta).not.toHaveProperty("url")

        await admin.api.proxies.remove({ id })
        expect(await audited("admin.proxy.remove")).toMatchObject({ targetId: id, meta: { label: "Audited", hostHint: "http://10.0.0.7:3128" } })

        const mine = (await admin.api.audit.list({ limit: 500 })).filter(e => e.targetId === id)
        expect(mine.map(e => `${e.actor}:${e.action}`)).toEqual(["boss:admin.proxy.remove", "boss:admin.proxy.update", "boss:admin.proxy.create"])
    })
})

describe("pinning an account", () => {
    test("a pin shows on the account and in the proxy's count, and is audited", async () => {
        const p = await playerWithRoom()
        const account = await p.api.accounts.create(newAccount("Pinned"))
        const proxy = await admin.api.proxies.create({ label: "Paris", url: URL_WITH_SECRET, maxAccounts: 3 })
        expect(await proxyOf(account.id)).toMatchObject({ proxyId: null, proxyLabel: null })

        await admin.api.accounts.setProxy({ id: account.id, proxyId: proxy.id })

        expect(await proxyOf(account.id)).toMatchObject({ proxyId: proxy.id, proxyLabel: "Paris" })
        expect((await admin.api.proxies.list())[0]!.accountCount).toBe(1)
        expect(await audited("admin.account.set_proxy")).toMatchObject({ targetType: "account", targetId: account.id, meta: { proxyId: proxy.id } })
    })

    test("a pin may put more accounts on a proxy than its limit", async () => {
        const p = await playerWithRoom()
        const first = await p.api.accounts.create(newAccount("Over1"))
        const second = await p.api.accounts.create(newAccount("Over2"))
        const proxy = await admin.api.proxies.create({ label: "Small", url: URL_WITH_SECRET, maxAccounts: 1 })

        await admin.api.accounts.setProxy({ id: first.id, proxyId: proxy.id })
        await admin.api.accounts.setProxy({ id: second.id, proxyId: proxy.id })

        expect((await admin.api.proxies.list())[0]).toMatchObject({ accountCount: 2, maxAccounts: 1 })
    })

    test("unpinning leaves the account without a proxy", async () => {
        const p = await playerWithRoom()
        const account = await p.api.accounts.create(newAccount("Unpinned"))
        const proxy = await admin.api.proxies.create({ label: "Paris", url: URL_WITH_SECRET, maxAccounts: 3 })
        await admin.api.accounts.setProxy({ id: account.id, proxyId: proxy.id })

        await admin.api.accounts.setProxy({ id: account.id, proxyId: null })

        expect(await proxyOf(account.id)).toMatchObject({ proxyId: null, proxyLabel: null })
        expect(await audited("admin.account.set_proxy")).toMatchObject({ targetId: account.id, meta: { proxyId: null } })
    })

    test("an event twin can't be pinned, because it uses its main's proxy", async () => {
        const p = await playerWithRoom()
        await p.api.accounts.create(newAccount("Paired"))
        const twin = await p.api.accounts.create(newAccount("Paired", true))
        const proxy = await admin.api.proxies.create({ label: "Paris", url: URL_WITH_SECRET, maxAccounts: 3 })

        expect(await messageOf(admin.api.accounts.setProxy({ id: twin.id, proxyId: proxy.id }))).toContain("main account's proxy")
        expect(await proxyOf(twin.id)).toMatchObject({ proxyId: null })
    })

    test("a proxy that is off, or doesn't exist, can't be pinned to", async () => {
        const p = await playerWithRoom()
        const account = await p.api.accounts.create(newAccount("Refused"))
        const proxy = await admin.api.proxies.create({ label: "Off", url: URL_WITH_SECRET, maxAccounts: 3 })
        await admin.api.proxies.update({ id: proxy.id, enabled: false })

        expect(await codeOf(admin.api.accounts.setProxy({ id: account.id, proxyId: proxy.id }))).toBe("BAD_REQUEST")
        expect(await codeOf(admin.api.accounts.setProxy({ id: account.id, proxyId: "00000000-0000-4000-8000-000000000000" }))).toBe("NOT_FOUND")
        expect(await codeOf(admin.api.accounts.setProxy({ id: "00000000-0000-4000-8000-000000000000", proxyId: null }))).toBe("NOT_FOUND")
        expect(await proxyOf(account.id)).toMatchObject({ proxyId: null })
    })

    test("removing a proxy unassigns its accounts and tells the runner", async () => {
        const p = await playerWithRoom()
        const account = await p.api.accounts.create(newAccount("Orphaned"))
        const proxy = await admin.api.proxies.create({ label: "Going", url: URL_WITH_SECRET, maxAccounts: 3 })
        await admin.api.accounts.setProxy({ id: account.id, proxyId: proxy.id })
        const listener = new pg.Client({ connectionString: inject("databaseUrl") })
        await listener.connect()
        let reconciles = 0
        listener.on("notification", n => { if (n.channel === "gge_desired") reconciles++ })
        await listener.query("listen gge_desired")
        try {
            await admin.api.proxies.remove({ id: proxy.id })
            await listener.query("select 1")
        } finally {
            await listener.end()
        }

        expect(reconciles).toBeGreaterThan(0)
        expect(await admin.api.proxies.list()).toEqual([])
        expect(await proxyOf(account.id)).toMatchObject({ proxyId: null, proxyLabel: null })
        expect(await api.db.select().from(gameAccounts).where(eq(gameAccounts.id, account.id))).toHaveLength(1)
    })
})

describe("who may use it", () => {
    test("a player can't call any proxy procedure", async () => {
        const proxy = await admin.api.proxies.create({ label: "Mine", url: URL_WITH_SECRET, maxAccounts: 3 })
        const p = await api.player()
        const account = await p.api.accounts.create(newAccount("Sneaky"))
        const asAdminApp = api.admin()
        for (const [k, v] of p.jar) asAdminApp.jar.set(k, v)

        expect(await codeOf(asAdminApp.api.proxies.list())).toBe("UNAUTHORIZED")
        expect(await codeOf(asAdminApp.api.proxies.create({ label: "x", url: URL_WITH_SECRET, maxAccounts: 3 }))).toBe("UNAUTHORIZED")
        expect(await codeOf(asAdminApp.api.proxies.update({ id: proxy.id, enabled: false }))).toBe("UNAUTHORIZED")
        expect(await codeOf(asAdminApp.api.proxies.remove({ id: proxy.id }))).toBe("UNAUTHORIZED")
        expect(await codeOf(asAdminApp.api.accounts.setProxy({ id: account.id, proxyId: proxy.id }))).toBe("UNAUTHORIZED")
        expect(await admin.api.proxies.list()).toMatchObject([{ id: proxy.id, enabled: true, accountCount: 0 }])
    })

    test("someone who isn't signed in can't either", async () => {
        const anonymous = api.admin()
        expect(await codeOf(anonymous.api.proxies.list())).toBe("UNAUTHORIZED")
        expect(await codeOf(anonymous.api.proxies.create({ label: "x", url: URL_WITH_SECRET, maxAccounts: 3 }))).toBe("UNAUTHORIZED")
    })

    test("the player's own account list says nothing about proxies", async () => {
        const p = await api.player()
        const account = await p.api.accounts.create(newAccount("Plain"))
        const proxy = await admin.api.proxies.create({ label: "Hidden label", url: URL_WITH_SECRET, maxAccounts: 3 })
        await admin.api.accounts.setProxy({ id: account.id, proxyId: proxy.id })
        const text = allStrings(await p.api.accounts.list()).join(" ")
        expect(text).not.toContain("proxy")
        expect(text).not.toContain("Hidden label")
    })
})
