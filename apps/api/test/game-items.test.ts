import { afterAll, beforeAll, expect, test } from "vitest"
import { botStatus, gameItems } from "@gge/db"
import { startApi, type Api } from "./harness.ts"

let api: Api
beforeAll(async () => {
    api = await startApi()
    await api.db.delete(gameItems)
    await api.db.insert(gameItems).values([
        { id: 1, kind: "banner", nameKey: "a_name", name: "Beta banner", fameBonus: 5 },
        { id: 2, kind: "banner", nameKey: "b_name", name: "Alpha banner", fameBonus: 15 },
        { id: 3, kind: "banner", nameKey: "c_name", name: "Aardvark banner", fameBonus: 5 },
        { id: 4, kind: "tool", nameKey: "d_name", name: "Ram" },
        { id: 5, kind: "tool", nameKey: "e_name", name: "Ladder", level: 2, image: "itemassets/x", orderList: 1, variant: { kind: "jade", tier: 2 } },
    ])
})
afterAll(() => api.close())

test("banners come strongest first, then by name, and only banners", async () => {
    const p = await api.player()
    expect((await p.api.catalog.gameItems({ kind: "banner" })).map(i => i.id)).toEqual([2, 3, 1])
})

test("other kinds come by name with their details", async () => {
    const p = await api.player()
    expect(await p.api.catalog.gameItems({ kind: "tool" })).toEqual([
        { id: 5, kind: "tool", nameKey: "e_name", name: "Ladder", level: 2, fameBonus: null, orderList: 1, image: "itemassets/x", variant: { kind: "jade", tier: 2 } },
        { id: 4, kind: "tool", nameKey: "d_name", name: "Ram", level: null, fameBonus: null, orderList: null, image: null, variant: null },
    ])
})

test("a signed-out caller is refused, an admin is not", async () => {
    await expect(api.client().api.catalog.gameItems({ kind: "banner" })).rejects.toMatchObject({ code: "UNAUTHORIZED" })
    await expect(api.admin().api.catalog.gameItems({ kind: "banner" })).rejects.toMatchObject({ code: "UNAUTHORIZED" })
    const admin = await api.signedInAdmin()
    expect(await admin.api.catalog.gameItems({ kind: "banner" })).toHaveLength(3)
})

test("accounts list shows the plugin states and castles from bot_status", async () => {
    const p = await api.player()
    const account = await p.api.accounts.create({ name: "castles", serverId: 26, password: "pw", externalEvent: false, plugins: {} })
    const castle = { kingdom: 0, id: 1001, name: "Ironhold", x: 412, y: 288, type: 1 }
    const state = { state: "running", reasonKey: "statusAttacksToday", params: { used: 1, limit: 2 } }
    await api.db.insert(botStatus).values({ accountId: account.id, pluginStates: { attack: state }, resources: { castles: [castle] } })
        .onConflictDoUpdate({ target: botStatus.accountId, set: { pluginStates: { attack: state }, resources: { castles: [castle] } } })

    expect((await p.api.accounts.list())[0]!.status).toMatchObject({ pluginStates: { attack: state }, castles: [castle] })
})

test("a status with nothing reported shows no states and no castles", async () => {
    const p = await api.player()
    const account = await p.api.accounts.create({ name: "bare", serverId: 26, password: "pw", externalEvent: false, plugins: {} })
    await api.db.insert(botStatus).values({ accountId: account.id, resources: { castles: "garbage" } })
    expect((await p.api.accounts.list())[0]!.status).toMatchObject({ pluginStates: {}, castles: [] })
})

test("accounts list shows the figures in bot_status, null where the bot reported none, and no figures before a report", async () => {
    const [p, q] = [await api.player(), await api.player()]
    const reported = await p.api.accounts.create({ name: "figures", serverId: 26, password: "pw", externalEvent: false, plugins: {} })
    const silent = await q.api.accounts.create({ name: "figureless", serverId: 26, password: "pw", externalEvent: false, plugins: {} })
    const at = "2026-03-01T10:00:00.000Z"
    await api.db.insert(botStatus).values({ accountId: reported.id, resources: { cash: 900, food: "lots", aquamarin_name: 12, attackDailyCount: 3, reportedAt: at } })
    await api.db.insert(botStatus).values({ accountId: silent.id })

    expect((await p.api.accounts.list())[0]!.status!.resources).toEqual({
        food: null, mead: null, cash: 900, gold: null, aquamarine: 12, attackDailyCount: 3, reportedAt: new Date(at),
    })
    expect((await q.api.accounts.list())[0]!.status!.resources).toBeNull()
})
