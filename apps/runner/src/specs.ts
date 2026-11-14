import { createHash } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import { effectivePluginConfig, type OptionValue, type PluginSettings } from "@gge/contracts"
import { gameAccounts, pluginSettings, servers, users, type Db } from "@gge/db"
import type { PluginRegistry } from "./catalog.ts"

export type WorkerPlugins = Record<string, Record<string, OptionValue> & { state: true; filename: string }>

/** Everything needed to run one account, as the database wants it right now. */
export type BotSpec = {
    accountId: string
    name: string
    serverId: number
    host: string
    zone: string
    externalEvent: boolean
    passwordSealed: Buffer
    plugins: WorkerPlugins
    /** Changes here need a fresh login: credentials, server, event mode, the set of plugins. */
    restartKey: string
    /** Changes here are pushed into the running worker. */
    optionsKey: string
}

export async function loadSpecs(db: Db, registry: PluginRegistry): Promise<Map<string, BotSpec>> {
    const rows = await db
        .select({ account: gameAccounts, server: servers })
        .from(gameAccounts)
        .innerJoin(users, eq(users.id, gameAccounts.ownerId))
        .innerJoin(servers, eq(servers.id, gameAccounts.serverId))
        .where(and(eq(gameAccounts.desiredState, "running"), eq(users.status, "active")))
    const ids = rows.map(r => r.account.id)
    const settings = ids.length ? await db.select().from(pluginSettings).where(inArray(pluginSettings.accountId, ids)) : []

    const specs = new Map<string, BotSpec>()
    for (const { account, server } of rows) {
        const saved: PluginSettings = Object.fromEntries(settings
            .filter(s => s.accountId === account.id)
            .map(s => [s.pluginKey, { enabled: s.enabled, options: s.options as Record<string, OptionValue> }]))
        const plugins: WorkerPlugins = {}
        for (const [key, config] of Object.entries(effectivePluginConfig(registry.catalog, saved))) {
            const filename = registry.filenames.get(key)
            if (filename)
                plugins[key] = { ...config, filename }
        }
        const sealedHash = createHash("sha256").update(account.passwordSealed).digest("hex")
        specs.set(account.id, {
            accountId: account.id,
            name: account.name,
            serverId: server.id,
            host: server.wsHost,
            zone: server.zone,
            externalEvent: account.externalEvent,
            passwordSealed: account.passwordSealed,
            plugins,
            restartKey: JSON.stringify([account.name, server.id, server.wsHost, server.zone, account.externalEvent, sealedHash, Object.keys(plugins).sort()]),
            optionsKey: JSON.stringify(plugins),
        })
    }
    return specs
}
