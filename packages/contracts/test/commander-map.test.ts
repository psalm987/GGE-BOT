import { describe, expect, test } from "vitest"
import { ACCOUNT_SETTINGS_PLUGINS, PluginCatalogEntry, PluginSettingsError, effectivePluginConfig, normalizePluginSettings } from "../src/index.ts"

const sender = (key: string): PluginCatalogEntry =>
    ({ key, force: false, hidden: false, options: [{ type: "Text", key: "commanderWhiteList", default: "1-50" }], checks: [{ type: "commanders", option: "commanderWhiteList" }] })
const catalog: PluginCatalogEntry[] = [
    {
        key: "commander", force: true, hidden: false, options: [
            { type: "CommanderMap", key: "commanderMap", default: [], buckets: [{ key: "commanderBucketKhanNomads", members: ["attackKhan", "attackNomads"] }] },
        ],
    },
    sender("attackKhan"),
    sender("attackNomads"),
    { key: "feast", force: false, hidden: false, options: [] },
]

const save = (commanderMap: unknown) =>
    normalizePluginSettings(catalog, { commander: { enabled: true, options: { commanderMap: commanderMap as string[] } } }).commander!.options.commanderMap
const problemOf = (run: () => unknown) => {
    try { run() } catch (error) { return (error as PluginSettingsError).problem }
    return undefined
}

describe("an account's commander map", () => {
    test("is one of the account's own settings", () => {
        expect(ACCOUNT_SETTINGS_PLUGINS).toContain("commander")
    })

    test("is stored as the owner of each commander by number, without unowned commanders at its end", () => {
        expect(save(["attackKhan", "", "commanderBucketKhanNomads", "", ""])).toEqual(["attackKhan", "", "commanderBucketKhanNomads"])
        expect(save(["", ""])).toEqual([])
    })

    test("gives commanders only to a plugin that sends commanders, or to a bucket", () => {
        expect(problemOf(() => save(["feast"]))).toEqual({ code: "PLUGIN_UNKNOWN", params: { plugin: "feast" } })
        expect(problemOf(() => save(["noSuchBucket"]))).toEqual({ code: "PLUGIN_UNKNOWN", params: { plugin: "noSuchBucket" } })
    })

    test("has an owner for at most the 50 commanders an account can have, each a name", () => {
        expect(save(Array(50).fill("attackKhan"))).toHaveLength(50)
        expect(problemOf(() => save(Array(51).fill("attackKhan")))).toEqual({ code: "PLUGIN_OPTION_LIST", params: { where: "commander.commanderMap", max: 50 } })
        expect(problemOf(() => save({ 1: "attackKhan" }))).toMatchObject({ code: "PLUGIN_OPTION_LIST" })
        expect(problemOf(() => save([1, 2]))).toMatchObject({ code: "PLUGIN_OPTION_LIST" })
    })

    test("reaches the bot as it was saved, and as no map for an account that never set one", () => {
        expect(effectivePluginConfig(catalog, {}).commander).toEqual({ state: true, commanderMap: [] })
        const saved = { commander: { enabled: true, options: { commanderMap: ["", "attackNomads"] } } }
        expect(effectivePluginConfig(catalog, saved).commander).toEqual({ state: true, commanderMap: ["", "attackNomads"] })
    })
})
