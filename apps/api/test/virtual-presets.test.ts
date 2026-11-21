import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { MAX_VIRTUAL_PRESETS, MAX_WAVES, emptyPlan, type ManualPlan } from "@gge/contracts"
import { gameAccounts, pluginCatalog, users, virtualPresets } from "@gge/db"
import { PASSWORD, startApi, type Api } from "./harness.ts"

let api: Api
type Player = Awaited<ReturnType<Api["player"]>>
beforeAll(async () => {
    api = await startApi()
    await api.db.insert(pluginCatalog).values({ key: "attackWaves", force: false, hidden: false, category: "attack", options: [{ type: "Waves", key: "waves" }, { type: "Checkbox", key: "loud", default: false }] })
})
afterAll(() => api.close())

const errorOf = (promise: Promise<unknown>) => promise.then(() => null, (e: { code: string; message: string; data?: { code: string; params: unknown } }) => e)
const codeOf = async (promise: Promise<unknown>) => (await errorOf(promise))?.data?.code ?? (await errorOf(promise))?.code ?? "ok"
const newAccount = (name: string) => ({ name, serverId: 26, password: "pw", externalEvent: false, plugins: {} })
const planWith = (preset: number): ManualPlan => ({ ...emptyPlan(), waves: emptyPlan().waves.map((wave, i) => i === 0 ? { kind: "preset" as const, preset } : wave) })
const wavesFor = (presetId: string) => ({ attackWaves: { enabled: true, options: { waves: { kind: "virtual" as const, presetId } } } })

async function playerWithAccount(username: string) {
    const player = await api.player(username)
    await api.db.update(users).set({ maxBots: 5 }).where(eq(users.username, username))
    const account = await player.api.accounts.create(newAccount(`${username}-keep`))
    return { player, account }
}

describe("virtual presets", () => {
    test("a player lists, creates, renames and removes the presets of their own account", async () => {
        const { player, account } = await playerWithAccount("ada")
        expect(await player.api.virtualPresets.list({ accountId: account.id })).toEqual([])

        const made = await player.api.virtualPresets.create({ accountId: account.id, name: "  Main push ", plan: planWith(3) })
        expect(made).toMatchObject({ accountId: account.id, name: "Main push", plan: planWith(3) })
        expect(await player.api.virtualPresets.list({ accountId: account.id })).toEqual([made])

        const edited = await player.api.virtualPresets.update({ id: made.id, name: "Main PUSH", plan: planWith(4) })
        expect(edited).toMatchObject({ id: made.id, name: "Main PUSH", plan: planWith(4) })
        expect(edited.updatedAt.getTime()).toBeGreaterThan(made.updatedAt.getTime())

        await player.api.virtualPresets.remove({ id: made.id })
        expect(await player.api.virtualPresets.list({ accountId: account.id })).toEqual([])
    })

    test("another player's account and preset answer exactly like ones that do not exist, on all four routes", async () => {
        const owner = await playerWithAccount("bea")
        const stranger = await api.player("cyril")
        const preset = await owner.player.api.virtualPresets.create({ accountId: owner.account.id, name: "Mine", plan: planWith(1) })
        const nowhere = crypto.randomUUID()

        const refused = async (call: (target: string) => Promise<unknown>, real: string) => {
            const [real_, none] = [await errorOf(call(real)), await errorOf(call(nowhere))]
            expect(real_).not.toBeNull()
            expect({ ...real_, stack: undefined }).toEqual({ ...none, stack: undefined })
            return real_!.data!.code
        }
        expect(await refused(accountId => stranger.api.virtualPresets.list({ accountId }), owner.account.id)).toBe("ACCOUNT_NOT_FOUND")
        expect(await refused(accountId => stranger.api.virtualPresets.create({ accountId, name: "Stolen", plan: planWith(2) }), owner.account.id)).toBe("ACCOUNT_NOT_FOUND")
        expect(await refused(id => stranger.api.virtualPresets.update({ id, name: "Stolen", plan: planWith(2) }), preset.id)).toBe("VIRTUAL_PRESET_NOT_FOUND")
        expect(await refused(id => stranger.api.virtualPresets.remove({ id }), preset.id)).toBe("VIRTUAL_PRESET_NOT_FOUND")

        expect(await owner.player.api.virtualPresets.list({ accountId: owner.account.id })).toEqual([preset])
    })

    test("an account keeps at most MAX_VIRTUAL_PRESETS, and a delete makes room", async () => {
        const { player, account } = await playerWithAccount("dina")
        const made = []
        for (let i = 0; i < MAX_VIRTUAL_PRESETS; i++)
            made.push(await player.api.virtualPresets.create({ accountId: account.id, name: `plan ${i}`, plan: emptyPlan() }))
        const refused = await errorOf(player.api.virtualPresets.create({ accountId: account.id, name: "one too many", plan: emptyPlan() }))
        expect(refused).toMatchObject({ code: "FORBIDDEN", data: { code: "VIRTUAL_PRESET_LIMIT", params: { max: MAX_VIRTUAL_PRESETS } } })
        expect(refused!.message).toBe(`An account can keep up to ${MAX_VIRTUAL_PRESETS} presets. Delete one to add another.`)

        const other = await player.api.accounts.create(newAccount("dina-second"))
        await player.api.virtualPresets.create({ accountId: other.id, name: "plan 0", plan: emptyPlan() })

        await player.api.virtualPresets.remove({ id: made[0]!.id })
        expect(await codeOf(player.api.virtualPresets.create({ accountId: account.id, name: "one too many", plan: emptyPlan() }))).toBe("ok")
    })

    test("two creates racing at the limit let only one through", async () => {
        const { player, account } = await playerWithAccount("ezra")
        for (let i = 0; i < MAX_VIRTUAL_PRESETS - 1; i++)
            await player.api.virtualPresets.create({ accountId: account.id, name: `plan ${i}`, plan: emptyPlan() })
        const results = await Promise.all(["a", "b", "c"].map(name => codeOf(player.api.virtualPresets.create({ accountId: account.id, name, plan: emptyPlan() }))))
        expect(results.filter(r => r === "ok")).toHaveLength(1)
        expect((await player.api.virtualPresets.list({ accountId: account.id }))).toHaveLength(MAX_VIRTUAL_PRESETS)
    })

    test("a name is unique per account whatever its case, on create and on rename", async () => {
        const { player, account } = await playerWithAccount("fay")
        const other = await player.api.accounts.create(newAccount("fay-second"))
        const first = await player.api.virtualPresets.create({ accountId: account.id, name: "Wall", plan: emptyPlan() })
        const second = await player.api.virtualPresets.create({ accountId: account.id, name: "Gate", plan: emptyPlan() })

        expect(await errorOf(player.api.virtualPresets.create({ accountId: account.id, name: "wALL", plan: emptyPlan() })))
            .toMatchObject({ code: "CONFLICT", data: { code: "VIRTUAL_PRESET_DUPLICATE" } })
        expect(await errorOf(player.api.virtualPresets.update({ id: second.id, name: "WALL", plan: emptyPlan() })))
            .toMatchObject({ code: "CONFLICT", data: { code: "VIRTUAL_PRESET_DUPLICATE" } })
        expect(await codeOf(player.api.virtualPresets.update({ id: first.id, name: "WALL", plan: planWith(5) }))).toBe("ok")
        expect(await codeOf(player.api.virtualPresets.create({ accountId: other.id, name: "Wall", plan: emptyPlan() }))).toBe("ok")
    })

    test("a plan that is not a plan, and a name that is not a name, are refused", async () => {
        const { player, account } = await playerWithAccount("gus")
        const good = emptyPlan()
        const bad: unknown[] = [
            { ...good, waves: [] },
            { ...good, waves: Array.from({ length: MAX_WAVES + 1 }, () => good.waves[0]) },
            { ...good, waves: [{ kind: "preset", preset: 31 }, ...good.waves.slice(1)] },
            { ...good, rw: [] },
            { kind: "virtual", presetId: crypto.randomUUID() },
        ]
        for (const plan of bad)
            expect(await codeOf(player.api.virtualPresets.create({ accountId: account.id, name: "x", plan: plan as ManualPlan })), JSON.stringify(plan).slice(0, 60)).toBe("BAD_REQUEST")
        expect(await codeOf(player.api.virtualPresets.create({ accountId: account.id, name: "   ", plan: good }))).toBe("BAD_REQUEST")
        expect(await codeOf(player.api.virtualPresets.create({ accountId: account.id, name: "x".repeat(61), plan: good }))).toBe("BAD_REQUEST")
        expect(await player.api.virtualPresets.list({ accountId: account.id })).toEqual([])
    })

    test("a stored plan that no longer parses is never handed out", async () => {
        const { player, account } = await playerWithAccount("hal")
        await api.db.insert(virtualPresets).values({ accountId: account.id, name: "rotten", plan: { kind: "manual", waves: "nope" } })
        expect(await errorOf(player.api.virtualPresets.list({ accountId: account.id }))).not.toBeNull()
    })

    test("the routes need a verified player", async () => {
        const unverified = await api.signup()
        expect(await codeOf(unverified.api.virtualPresets.list({ accountId: crypto.randomUUID() }))).toBe("EMAIL_VERIFY_REQUIRED")
        expect(await codeOf(api.client().api.virtualPresets.list({ accountId: crypto.randomUUID() }))).toBe("SIGN_IN_REQUIRED")
    })
})

describe("a Waves option that names a virtual preset", () => {
    const savedWaves = async (player: Player, accountId: string) =>
        (await player.api.accounts.list()).find(a => a.id === accountId)!.plugins.attackWaves?.options.waves

    test("is saved when the preset belongs to the same account", async () => {
        const { player, account } = await playerWithAccount("ivy")
        const preset = await player.api.virtualPresets.create({ accountId: account.id, name: "Mine", plan: planWith(2) })
        await player.api.accounts.update({ id: account.id, plugins: wavesFor(preset.id) })
        expect(await savedWaves(player, account.id)).toEqual({ kind: "virtual", presetId: preset.id })
    })

    test("keeps the preset from being deleted until no plugin of the account sends it", async () => {
        const { player, account } = await playerWithAccount("nell")
        const preset = await player.api.virtualPresets.create({ accountId: account.id, name: "Sent", plan: planWith(2) })
        await player.api.accounts.update({ id: account.id, plugins: wavesFor(preset.id) })
        expect(await codeOf(player.api.virtualPresets.remove({ id: preset.id }))).toBe("VIRTUAL_PRESET_IN_USE")
        expect(await player.api.virtualPresets.list({ accountId: account.id })).toHaveLength(1)

        await player.api.accounts.update({ id: account.id, plugins: { attackWaves: { enabled: true, options: { waves: planWith(1) } } } })
        await player.api.virtualPresets.remove({ id: preset.id })
        expect(await player.api.virtualPresets.list({ accountId: account.id })).toEqual([])
    })

    test("is refused for another player's preset, another account's preset, a preset that does not exist, and an account being created", async () => {
        const mine = await playerWithAccount("joan")
        const sibling = await mine.player.api.accounts.create(newAccount("joan-second"))
        const theirs = await playerWithAccount("kit")
        const strangers = await theirs.player.api.virtualPresets.create({ accountId: theirs.account.id, name: "Theirs", plan: planWith(2) })
        const siblings = await mine.player.api.virtualPresets.create({ accountId: sibling.id, name: "Sibling", plan: planWith(2) })

        for (const presetId of [strangers.id, siblings.id, crypto.randomUUID()])
            expect(await errorOf(mine.player.api.accounts.update({ id: mine.account.id, plugins: wavesFor(presetId) })), presetId)
                .toMatchObject({ code: "BAD_REQUEST", data: { code: "PLUGIN_OPTION_ARMY", params: { where: "attackWaves.waves" } } })
        expect(await errorOf(mine.player.api.accounts.create({ ...newAccount("joan-third"), plugins: wavesFor(siblings.id) })))
            .toMatchObject({ data: { code: "PLUGIN_OPTION_ARMY", params: { where: "attackWaves.waves" } } })
        expect(await savedWaves(mine.player, mine.account.id)).toBeUndefined()
    })

    test("a written plan is saved without any preset", async () => {
        const { player, account } = await playerWithAccount("lou")
        await player.api.accounts.update({ id: account.id, plugins: { attackWaves: { enabled: true, options: { waves: planWith(6) } } } })
        expect(await savedWaves(player, account.id)).toEqual(planWith(6))
    })
})

describe("what a player's data takes with it", () => {
    test("the export lists the presets by account", async () => {
        const { player, account } = await playerWithAccount("moe")
        const preset = await player.api.virtualPresets.create({ accountId: account.id, name: "Exported", plan: planWith(7) })
        const other = await playerWithAccount("nia")
        await other.player.api.virtualPresets.create({ accountId: other.account.id, name: "Not moe's", plan: emptyPlan() })
        const data = await player.api.account.exportData()
        expect(data.virtualPresets).toEqual([preset])
    })

    test("removing an account deletes its presets and no one else's", async () => {
        const { player, account } = await playerWithAccount("ozzy")
        const keep = await player.api.accounts.create(newAccount("ozzy-second"))
        await player.api.virtualPresets.create({ accountId: account.id, name: "Gone", plan: emptyPlan() })
        await player.api.virtualPresets.create({ accountId: keep.id, name: "Stays", plan: emptyPlan() })
        await player.api.accounts.remove({ ids: [account.id] })
        expect((await api.db.select().from(virtualPresets).where(eq(virtualPresets.accountId, account.id)))).toEqual([])
        expect(await player.api.virtualPresets.list({ accountId: keep.id })).toHaveLength(1)
    })

    test("deleting a player deletes the presets of all their accounts", async () => {
        const { player, account } = await playerWithAccount("prue")
        await player.api.virtualPresets.create({ accountId: account.id, name: "Gone", plan: emptyPlan() })
        await player.api.account.deleteMe({ password: PASSWORD, confirmUsername: "prue" })
        expect(await api.db.select().from(gameAccounts).where(eq(gameAccounts.id, account.id))).toEqual([])
        expect(await api.db.select().from(virtualPresets).where(eq(virtualPresets.accountId, account.id))).toEqual([])
    })
})
