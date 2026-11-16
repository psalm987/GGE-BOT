import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { startApi, type Api } from "./harness.ts"

let api: Api
let admin: Awaited<ReturnType<Api["signedInAdmin"]>>
const players: Record<string, Awaited<ReturnType<Api["player"]>>> = {}
const ids: Record<string, string> = {}
const accountIds: Record<string, string> = {}

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const newAccount = (owner: string, name: string) =>
    players[owner]!.api.accounts.create({ name, serverId: 26, password: "pw", externalEvent: false, plugins: {} }).then(a => { accountIds[name] = a.id; return a })

beforeAll(async () => {
    api = await startApi()
    admin = await api.signedInAdmin()
    for (const name of ["page_a", "pageXa", "page-b", "page-c", "page-d", "page-e", "page-f"]) {
        players[name] = await api.player(name)
        ids[name] = (await admin.api.users.list({ search: name })).items.find(u => u.username === name)!.id
    }
    await admin.api.users.setMaxBots({ id: ids["page-b"]!, maxBots: 3 })
    for (const name of ["b one", "b two", "b three"])
        await newAccount("page-b", name)
    await newAccount("page_a", "50% off")
    await newAccount("pageXa", "50 off")
    await newAccount("page-c", "c bot")
    await admin.api.users.setStatus({ id: ids["page-f"]!, status: "disabled" })
})
afterAll(() => api.close())

describe("users.list", () => {
    test("pages are disjoint, ordered newest first, and together cover everyone", async () => {
        const first = await admin.api.users.list({ limit: 3, offset: 0 })
        const second = await admin.api.users.list({ limit: 3, offset: 3 })
        const third = await admin.api.users.list({ limit: 3, offset: 6 })
        const everyone = await admin.api.users.list({ limit: 200 })

        const paged = [...first.items, ...second.items, ...third.items].map(u => u.id)
        expect(new Set(paged).size).toBe(paged.length)
        expect(paged).toEqual(everyone.items.map(u => u.id))
        expect(everyone.total).toBe(everyone.items.length)
        expect(first.total).toBe(everyone.total)
        expect(first.items.map(u => u.createdAt.getTime())).toEqual(first.items.map(u => u.createdAt.getTime()).sort((a, b) => b - a))
    })

    test("the total counts users, not the game accounts joined onto them", async () => {
        const result = await admin.api.users.list({ search: "page-b" })
        expect(result.items).toHaveLength(1)
        expect(result.items[0]).toMatchObject({ username: "page-b", accountCount: 3 })
        expect(result.total).toBe(1)
    })

    test("search matches inside a username, regardless of case", async () => {
        const result = await admin.api.users.list({ search: "AGE-" })
        expect(result.items.map(u => u.username).sort()).toEqual(["page-b", "page-c", "page-d", "page-e", "page-f"])
        expect(result.total).toBe(5)
    })

    test("underscore in the search is a literal underscore, not a wildcard", async () => {
        expect((await admin.api.users.list({ search: "page_a" })).items.map(u => u.username)).toEqual(["page_a"])
        expect((await admin.api.users.list({ search: "_" })).items.map(u => u.username)).toEqual(["page_a"])
    })

    test("a percent sign or backslash matches nothing instead of everything", async () => {
        expect(await admin.api.users.list({ search: "%" })).toMatchObject({ items: [], total: 0 })
        expect(await admin.api.users.list({ search: "\\" })).toMatchObject({ items: [], total: 0 })
    })

    test("role and status filters narrow the list and the total, and combine with search", async () => {
        expect((await admin.api.users.list({ status: "disabled" })).items.map(u => u.username)).toEqual(["page-f"])
        const admins = await admin.api.users.list({ role: "admin" })
        expect(admins.items.every(u => u.role === "admin")).toBe(true)
        expect(admins.total).toBe(admins.items.length)
        expect(await admin.api.users.list({ status: "active", search: "page-f" })).toMatchObject({ items: [], total: 0 })
    })

    test("a page past the end is empty but still reports the total", async () => {
        const result = await admin.api.users.list({ limit: 5, offset: 500 })
        expect(result.items).toEqual([])
        expect(result.total).toBeGreaterThanOrEqual(8)
    })

    test("a limit above 200, below 1, or an offset below 0 is refused", async () => {
        expect(await codeOf(admin.api.users.list({ limit: 201 }))).toBe("BAD_REQUEST")
        expect(await codeOf(admin.api.users.list({ limit: 0 }))).toBe("BAD_REQUEST")
        expect(await codeOf(admin.api.users.list({ offset: -1 }))).toBe("BAD_REQUEST")
        expect(await codeOf(admin.api.users.list({ limit: 200 }))).toBe("ok")
    })
})

describe("accounts.list", () => {
    test("pages are disjoint and cover every account, with the owner's name", async () => {
        const all = await admin.api.accounts.list({ limit: 200 })
        const paged = [
            ...(await admin.api.accounts.list({ limit: 2, offset: 0 })).items,
            ...(await admin.api.accounts.list({ limit: 2, offset: 2 })).items,
            ...(await admin.api.accounts.list({ limit: 2, offset: 4 })).items,
        ]
        expect(all.total).toBe(6)
        expect(paged.map(a => a.id)).toEqual(all.items.map(a => a.id))
        expect(all.items.find(a => a.name === "b two")).toMatchObject({ owner: "page-b" })
    })

    test("search matches the account name or the owner's username", async () => {
        expect((await admin.api.accounts.list({ search: "b t" })).items.map(a => a.name).sort()).toEqual(["b three", "b two"])
        const byOwner = await admin.api.accounts.list({ search: "page-b" })
        expect(byOwner.items).toHaveLength(3)
        expect(byOwner.total).toBe(3)
    })

    test("a percent sign or underscore in the search is literal", async () => {
        expect((await admin.api.accounts.list({ search: "0%" })).items.map(a => a.name)).toEqual(["50% off"])
        expect((await admin.api.accounts.list({ search: "_" })).items.map(a => a.name)).toEqual(["50% off"])
    })

    test("owner and state filters narrow the list and the total", async () => {
        expect((await admin.api.accounts.list({ ownerId: ids["page-c"]! })).items.map(a => a.name)).toEqual(["c bot"])
        await api.db.execute(`insert into bot_status (account_id, actual_state) values ('${accountIds["c bot"]}', 'banned') on conflict (account_id) do update set actual_state = 'banned'`)
        expect(await admin.api.accounts.list({ state: "banned" })).toMatchObject({ items: [{ name: "c bot" }], total: 1 })
        expect(await admin.api.accounts.list({ state: "banned", ownerId: ids["page-b"]! })).toMatchObject({ items: [], total: 0 })
    })

    test("a limit above 200 is refused", async () => {
        expect(await codeOf(admin.api.accounts.list({ limit: 201 }))).toBe("BAD_REQUEST")
    })
})
