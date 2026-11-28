import { readFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { sql } from "drizzle-orm"
import { pluginSettings, users } from "@gge/db"
import { startApi, type Api } from "./harness.ts"

const MIGRATION = new URL("../../../packages/db/drizzle/0033_attack_delay_defaults.sql", import.meta.url)
const newAccount = (name: string) => ({ name: `${name}-${Math.random().toString(36).slice(2, 8)}`, serverId: 26, password: "pw", externalEvent: false, plugins: {} })

let api: Api
beforeAll(async () => { api = await startApi() })
afterAll(() => api.close())

describe("migration 0033 moves untouched attack delays to the 4.5 + 2.5 s defaults", () => {
    test("rewrites only the pair saved as the old 20 + 15 defaults and keeps every other key", async () => {
        const p = await api.player()
        await api.db.update(users).set({ maxBots: 6 }).where(sql`lower(${users.email}) = ${p.email.toLowerCase()}`)
        const ids = []
        for (const name of ["old-text", "old-number", "custom-delay", "custom-extra", "new", "other-plugin"])
            ids.push((await p.api.accounts.create(newAccount(name))).id)
        const [oldText, oldNumber, customDelay, customExtra, fresh, otherPlugin] = ids as [string, string, string, string, string, string]
        await api.db.insert(pluginSettings).values([
            { accountId: oldText, pluginKey: "attack", enabled: true, options: { attackDelaySeconds: "20", attackDelayRandomizationSeconds: "15", attackLimit: "1500" } },
            { accountId: oldNumber, pluginKey: "attack", enabled: true, options: { attackDelaySeconds: 20, attackDelayRandomizationSeconds: 15 } },
            { accountId: customDelay, pluginKey: "attack", enabled: true, options: { attackDelaySeconds: "30", attackDelayRandomizationSeconds: "15" } },
            { accountId: customExtra, pluginKey: "attack", enabled: true, options: { attackDelaySeconds: "20", attackDelayRandomizationSeconds: "40" } },
            { accountId: fresh, pluginKey: "attack", enabled: true, options: { attackDelaySeconds: "4.5", attackDelayRandomizationSeconds: "2.5" } },
            { accountId: otherPlugin, pluginKey: "attackNomads", enabled: true, options: { attackDelaySeconds: "20", attackDelayRandomizationSeconds: "15" } },
        ])

        for (const statement of readFileSync(MIGRATION, "utf8").split("--> statement-breakpoint"))
            if (statement.trim())
                await api.db.execute(sql.raw(statement))

        const rows = await api.db.select().from(pluginSettings).where(sql`${pluginSettings.accountId} IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)})`)
        const options = (accountId: string, pluginKey = "attack") => rows.find(r => r.accountId === accountId && r.pluginKey === pluginKey)?.options
        expect(options(oldText)).toEqual({ attackDelaySeconds: "4.5", attackDelayRandomizationSeconds: "2.5", attackLimit: "1500" })
        expect(options(oldNumber)).toEqual({ attackDelaySeconds: "4.5", attackDelayRandomizationSeconds: "2.5" })
        expect(options(customDelay)).toEqual({ attackDelaySeconds: "30", attackDelayRandomizationSeconds: "15" })
        expect(options(customExtra)).toEqual({ attackDelaySeconds: "20", attackDelayRandomizationSeconds: "40" })
        expect(options(fresh)).toEqual({ attackDelaySeconds: "4.5", attackDelayRandomizationSeconds: "2.5" })
        expect(options(otherPlugin, "attackNomads")).toEqual({ attackDelaySeconds: "20", attackDelayRandomizationSeconds: "15" })
    })
})
