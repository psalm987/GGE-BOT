import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginStatus } = require("../actions.json")

const AreaType = { mainCastle: 1, externalKingdom: 12, stormIsland: 30, stormTower: 31 }
const castleIn = kingdomID => ({ kingdomID, areaInfo: { type: AreaType.externalKingdom, x: 500, y: 500 } })

/** Loads a board plugin on an account holding `castles`, and signs it in. Resolves once its sign-in work is done. */
async function signIn(plugin, castles) {
    const bot = fakeBot()
    bot.botConfig.plugins[plugin] = { channelID: "board" }
    const host = []
    const searched = []
    const protocols = {
        castles, AreaType, KingdomID: { stormIslands: 4 }, unlockInfoList: [{ kingdomID: 4, isUnlocked: true }],
        spiralCoordinates: () => ({ x: 0, y: 0 }),
        ClientCommands: {
            getAreaInfo: async kingdomID => (searched.push(kingdomID), { areaInfo: [] }),
            preSpyInfo: async () => ({ areaInfo: { extraData: [] } }),
        },
    }
    loadModule(`plugins/discord/${plugin}.js`, {
        bot,
        parentPort: { postMessage: message => host.push(message), on() {} },
        extra: { "protocols": protocols, "protocols.js": protocols, "./discord.js": { client: {} } },
    })
    await Promise.all(bot.events.listeners("load").map(listener => listener()))
    const statuses = host.filter(([type]) => type == PluginStatus).map(([, { state, reasonKey }]) => [state, reasonKey])
    return { statuses, searched: [...new Set(searched)] }
}

describe("the Discord boards on an account without a castle where they look", () => {
    test("the fortress board searches only the kingdoms where the account has a castle", async () => {
        const { statuses, searched } = await signIn("fortress", [castleIn(0), castleIn(2)])

        expect(searched).toEqual([2])
        expect(statuses).toEqual([])
    })

    test("the fortress board stops with a reason when the account has no castle in any fortress kingdom", async () => {
        const { statuses, searched } = await signIn("fortress", [castleIn(0)])

        expect(searched).toEqual([])
        expect(statuses).toEqual([["stopped", "statusFortressNoCastle"]])
    })

    test.each(["aquaIsland", "aquaTower"])("%s stops with a reason when the account has no Storm Islands castle", async plugin => {
        const { statuses, searched } = await signIn(plugin, [castleIn(0)])

        expect(searched).toEqual([])
        expect(statuses).toEqual([["stopped", "statusStormNoCastle"]])
    })
})
