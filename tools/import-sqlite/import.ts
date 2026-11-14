import { DatabaseSync } from "node:sqlite"
import { eq, sql } from "drizzle-orm"
import { PluginSettingsError, normalizePluginSettings, type OptionValue, type PluginCatalogEntry, type PluginSettings } from "@gge/contracts"
import { discordLinks, gameAccounts, pluginSettings, servers, users, type Db } from "@gge/db"
import { sealFor } from "@gge/crypto"

type LegacyUser = { username: string; passwordHash: Uint8Array; passwordSalt: Uint8Array; uuid: string | null; discordUserId: string | null; discordGuildId: string | null }
type LegacyAccount = { id: number; uuid: string; name: string; pass: string; plugins: string | null; externalEvent: number | null; server: number }

export type ImportReport = {
    users: { imported: number; existing: number; skipped: { username: string; reason: string }[] }
    accounts: { imported: number; existing: number; skipped: { id: number; name: string; reason: string }[] }
    droppedSettings: string[]
}

/**
 * Keeps each legacy setting the catalog still accepts and names every one it
 * drops. Legacy rows store {key: {state, ...options, filename}}.
 */
function convertSettings(raw: string | null, catalog: PluginCatalogEntry[], accountName: string, dropped: string[]): PluginSettings {
    let parsed: Record<string, Record<string, unknown>> = {}
    try { parsed = JSON.parse(raw ?? "{}") ?? {} } catch { dropped.push(`${accountName}: unreadable plugin settings`) }
    const known = new Map(catalog.map(e => [e.key, e]))
    const out: PluginSettings = {}
    for (const [pluginKey, value] of Object.entries(parsed)) {
        const entry = known.get(pluginKey)
        if (!entry || entry.hidden) {
            dropped.push(`${accountName}: plugin ${pluginKey}`)
            continue
        }
        const options: Record<string, OptionValue> = {}
        for (const [optionKey, optionValue] of Object.entries(value ?? {})) {
            if (optionKey === "state" || optionKey === "filename" || optionValue === "" || optionValue === null || optionValue === undefined)
                continue
            try {
                const normalized = normalizePluginSettings(catalog, { [pluginKey]: { enabled: true, options: { [optionKey]: optionValue as OptionValue } } })
                options[optionKey] = normalized[pluginKey]!.options[optionKey]!
            } catch (error) {
                if (!(error instanceof PluginSettingsError)) throw error
                dropped.push(`${accountName}: ${pluginKey}.${optionKey}`)
            }
        }
        out[pluginKey] = { enabled: entry.force || Boolean(value?.state), options }
    }
    return out
}

export async function importLegacy({ sqlitePath, db, sealPublicKey, catalog, log = console.log }: {
    sqlitePath: string
    db: Db
    sealPublicKey: string
    catalog: PluginCatalogEntry[]
    log?: (line: string) => void
}): Promise<ImportReport> {
    const legacy = new DatabaseSync(sqlitePath, { readOnly: true })
    const report: ImportReport = { users: { imported: 0, existing: 0, skipped: [] }, accounts: { imported: 0, existing: 0, skipped: [] }, droppedSettings: [] }
    try {
        const ownerByUuid = new Map<string, string>()
        for (const row of legacy.prepare("SELECT * FROM Users").all() as LegacyUser[]) {
            if (!row.uuid) {
                report.users.skipped.push({ username: row.username, reason: "no uuid" })
                continue
            }
            const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.legacyUuid, row.uuid))
            if (existing) {
                ownerByUuid.set(row.uuid, existing.id)
                report.users.existing++
                continue
            }
            const [taken] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.username})`, row.username.toLowerCase()))
            if (taken) {
                report.users.skipped.push({ username: row.username, reason: "username already used by another account" })
                continue
            }
            const [created] = await db.insert(users).values({
                username: row.username,
                passwordHash: Buffer.from(row.passwordHash).toString("hex"),
                passwordSalt: Buffer.from(row.passwordSalt),
                passwordAlgo: "pbkdf2-legacy",
                legacyUuid: row.uuid,
            }).returning({ id: users.id })
            ownerByUuid.set(row.uuid, created!.id)
            if (row.discordUserId)
                await db.insert(discordLinks).values({ userId: created!.id, discordUserId: row.discordUserId, guildId: row.discordGuildId }).onConflictDoNothing()
            report.users.imported++
        }

        const serverIds = new Set((await db.select({ id: servers.id }).from(servers)).map(s => s.id))
        for (const row of legacy.prepare("SELECT * FROM SubUsers ORDER BY id").all() as LegacyAccount[]) {
            const skip = (reason: string) => report.accounts.skipped.push({ id: row.id, name: row.name, reason })
            const [existing] = await db.select({ id: gameAccounts.id }).from(gameAccounts).where(eq(gameAccounts.legacyId, row.id))
            if (existing) {
                report.accounts.existing++
                continue
            }
            const ownerId = ownerByUuid.get(row.uuid)
            if (!ownerId) { skip("owner not found"); continue }
            if (!serverIds.has(row.server)) { skip(`unknown server ${row.server}`); continue }
            const settings = convertSettings(row.plugins, catalog, row.name, report.droppedSettings)
            try {
                await db.transaction(async tx => {
                    const [account] = await tx.insert(gameAccounts).values({
                        ownerId,
                        name: row.name,
                        serverId: row.server,
                        passwordSealed: sealFor(sealPublicKey, row.pass),
                        externalEvent: Boolean(row.externalEvent),
                        // Nothing logs in at cutover; owners start their bots from the new app.
                        desiredState: "stopped",
                        legacyId: row.id,
                    }).returning({ id: gameAccounts.id })
                    const rows = Object.entries(settings).map(([pluginKey, s]) => ({ accountId: account!.id, pluginKey, enabled: s.enabled, options: s.options }))
                    if (rows.length)
                        await tx.insert(pluginSettings).values(rows)
                })
                report.accounts.imported++
            } catch (error) {
                const code = (error as { cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code
                if (code !== "23505") throw error
                skip("duplicate of an imported account")
            }
        }
    } finally {
        legacy.close()
    }
    log(`users: ${report.users.imported} imported, ${report.users.existing} already there, ${report.users.skipped.length} skipped`)
    for (const s of report.users.skipped) log(`  skipped user ${s.username}: ${s.reason}`)
    log(`game accounts: ${report.accounts.imported} imported, ${report.accounts.existing} already there, ${report.accounts.skipped.length} skipped`)
    for (const s of report.accounts.skipped) log(`  skipped account #${s.id} ${s.name}: ${s.reason}`)
    for (const d of report.droppedSettings) log(`  dropped setting ${d}`)
    return report
}
