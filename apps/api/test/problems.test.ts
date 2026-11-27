import { afterAll, beforeAll, expect, test } from "vitest"
import { botProblems } from "@gge/db"
import { startApi, type Api } from "./harness.ts"

let api: Api
beforeAll(async () => { api = await startApi() })
afterAll(() => api.close())

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const newAccount = (name: string) => ({ name, serverId: 26, password: "pw", externalEvent: false, plugins: {} })

test("an account's problems come back the latest first, only to the account's owner", async () => {
    const owner = await api.player()
    const other = await api.player()
    const { id } = await owner.api.accounts.create(newAccount("problems-bot"))
    const now = Date.now()
    const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000)
    await api.db.insert(botProblems).values([
        { accountId: id, plugin: "feast", command: "bfs", error: "ALREADY_PURCHASED", count: 1, firstAt: at(30), lastAt: at(30) },
        { accountId: id, plugin: "attackKhan", command: "cra", error: "LORD_IS_USED", count: 50, firstAt: at(90), lastAt: at(2) },
    ])

    const problems = await owner.api.accounts.problems({ id })
    expect(problems.map(p => [p.plugin, p.count])).toEqual([["attackKhan", 50], ["feast", 1]])
    expect(problems[0]).toEqual({ plugin: "attackKhan", command: "cra", error: "LORD_IS_USED", count: 50, firstAt: at(90), lastAt: at(2) })
    expect(await codeOf(other.api.accounts.problems({ id }))).toBe("NOT_FOUND")
})
