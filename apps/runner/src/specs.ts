import { createHash } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import {
    NO_PROXY_FREE, TOO_MANY_ATTACK_PLUGINS, attackPluginLimit, effectivePluginConfig, enabledAttackPlugins, scheduleState, storedSchedule,
    type OptionValue, type PluginSettings,
} from "@gge/contracts"
import { appSettings, botStatus, gameAccounts, loadPlanOwners, planOwnerColumns, pluginSettings, servers, users, type Db } from "@gge/db"
import type { PluginRegistry } from "./catalog.ts"
import { planStanding } from "./plan.ts"
import { enabledProxiesOf, type SpecProxy } from "./proxies.ts"

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
    /** The proxy the bot connects through; null connects directly. An event twin has its main's. */
    proxy: SpecProxy | null
    /** Changes here need a fresh login: credentials, server, event mode, the set of plugins, the proxy. */
    restartKey: string
    /** Changes here are pushed into the running worker. */
    optionsKey: string
    /** Set when the account must not run, with the reason shown to the player. */
    refusal?: string
}

/** What the database wants at one moment. */
export type Wanted = {
    /** The accounts to run. */
    specs: Map<string, BotSpec>
    /** The wanted accounts that are outside their schedule. */
    sleeping: Set<string>
    /** The sleeping accounts whose status still shows an error from before they slept. */
    staleErrors: Set<string>
    /**
     * The next time a wanted account's schedule starts or stops it, or its owner's plan period starts or ends.
     * Null when no schedule does within scheduleState's horizon and no period does at all.
     */
    nextChange: Date | null
}

/**
 * How long to wait before a reconcile for the schedule edge at `nextChange`, a second late so the edge has passed.
 * Undefined when there is no edge within `withinMs`, which the periodic reconcile covers.
 */
export function edgeDelayMs(nextChange: Date | null, now: number, withinMs: number) {
    if (!nextChange)
        return undefined
    const delay = Math.max(0, nextChange.getTime() - now) + 1000
    return delay < withinMs ? delay : undefined
}

/** `proxyRequired` refuses to run an account that has no proxy instead of connecting it directly. */
export async function loadSpecs(db: Db, registry: PluginRegistry, now = new Date(), { proxyRequired = false } = {}): Promise<Wanted> {
    const wanted = await db
        .select({ account: gameAccounts, server: servers, attackPluginCap: users.attackPluginCap, owner: planOwnerColumns, actualState: botStatus.actualState })
        .from(gameAccounts)
        .innerJoin(users, eq(users.id, gameAccounts.ownerId))
        .innerJoin(servers, eq(servers.id, gameAccounts.serverId))
        .leftJoin(botStatus, eq(botStatus.accountId, gameAccounts.id))
        .where(and(eq(gameAccounts.desiredState, "running"), eq(users.status, "active")))
    const owners = await loadPlanOwners(db, [...new Map(wanted.map(r => [r.owner.id, r.owner])).values()], now)
    const { entitled, mainOf } = await planStanding(db, owners)
    // The plan was applied first, so a sleeping account keeps its place in it.
    const allowed = wanted.filter(r => entitled.has(r.account.id))
        .map(r => ({ ...r, ...scheduleState(storedSchedule(r.account.schedule), now, r.account.id) }))
    const asleep = allowed.filter(r => !r.active)
    const sleeping = new Set(asleep.map(r => r.account.id))
    const staleErrors = new Set(asleep.filter(r => r.actualState === "error").map(r => r.account.id))
    const edges = [...allowed, ...owners.values()].flatMap(r => r.nextChange ? [r.nextChange.getTime()] : [])
    const nextChange = edges.length ? new Date(Math.min(...edges)) : null
    const rows = allowed.filter(r => r.active)
    const ids = rows.map(r => r.account.id)
    const settings = ids.length ? await db.select().from(pluginSettings).where(inArray(pluginSettings.accountId, ids)) : []

    const [defaults] = await db.select({ attackPluginCap: appSettings.attackPluginCap }).from(appSettings)
    const proxyHolder = (accountId: string) => mainOf.get(accountId) ?? accountId
    const proxyOf = await enabledProxiesOf(db, ids.map(proxyHolder))

    const specs = new Map<string, BotSpec>()
    for (const { account, server, attackPluginCap } of rows) {
        const saved: PluginSettings = Object.fromEntries(settings
            .filter(s => s.accountId === account.id)
            .map(s => [s.pluginKey, { enabled: s.enabled, options: s.options as Record<string, OptionValue> }]))
        const plugins: WorkerPlugins = {}
        for (const [key, config] of Object.entries(effectivePluginConfig(registry.catalog, saved))) {
            const filename = registry.filenames.get(key)
            if (filename)
                plugins[key] = { ...config, filename }
        }
        const proxy = proxyOf.get(proxyHolder(account.id)) ?? null
        specs.set(account.id, {
            accountId: account.id,
            name: account.name,
            serverId: server.id,
            host: server.wsHost,
            zone: server.zone,
            externalEvent: account.externalEvent,
            passwordSealed: account.passwordSealed,
            plugins,
            proxy,
            restartKey: JSON.stringify([
                account.name, server.id, server.wsHost, server.zone, account.externalEvent, sha256(account.passwordSealed), Object.keys(plugins).sort(),
                proxy && [proxy.id, sha256(proxy.urlSealed)],
            ]),
            optionsKey: JSON.stringify(plugins),
            ...(proxyRequired && !proxy && { refusal: NO_PROXY_FREE }),
            ...overCap(registry, saved, attackPluginLimit(attackPluginCap ?? defaults?.attackPluginCap ?? "4")),
        })
    }
    return { specs, sleeping, staleErrors, nextChange }
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")

function overCap(registry: PluginRegistry, saved: PluginSettings, limit: number | null) {
    const enabled = enabledAttackPlugins(registry.catalog, saved)
    return limit !== null && enabled > limit ? { refusal: TOO_MANY_ATTACK_PLUGINS } : {}
}
