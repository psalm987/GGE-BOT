import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { startApi, type Api } from "./harness.ts"

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const newAccount = (name: string) => ({ name, serverId: 26, password: "pw", externalEvent: false, plugins: {} })

describe("without Centrifugo", () => {
    let api: Api
    beforeAll(async () => { api = await startApi() })
    afterAll(() => api.close())

    test("both token calls say live updates aren't available, so the app can fall back to polling", async () => {
        const alice = await api.player()
        const mine = await alice.api.accounts.create(newAccount("rt-none"))
        expect(await codeOf(alice.api.realtime.connectionToken())).toBe("NOT_IMPLEMENTED")
        expect(await codeOf(alice.api.realtime.subscriptionToken({ accountId: mine.id }))).toBe("NOT_IMPLEMENTED")
    })

    test("an unset secret doesn't reveal whether another player's account exists", async () => {
        const alice = await api.player()
        const bob = await api.player()
        const theirs = await bob.api.accounts.create(newAccount("rt-hidden"))
        expect(await codeOf(alice.api.realtime.subscriptionToken({ accountId: theirs.id }))).toBe("NOT_FOUND")
    })
})
