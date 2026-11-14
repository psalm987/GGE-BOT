import { ORPCError } from "@orpc/server"
import { and, asc, eq, inArray, type SQL } from "drizzle-orm"
import { botStatus, gameAccounts, pluginCatalog, pluginSettings, servers, type Db } from "@gge/db"
import { sealFor } from "@gge/crypto"
import {
    PluginSettingsError, normalizePluginSettings,
    type PluginCatalogEntry, type PluginSettings, type PublicAccount,
} from "@gge/contracts"
import { isUniqueViolation } from "../context.ts"

export async function loadCatalog(db: Db): Promise<PluginCatalogEntry[]> {
    const rows = await db.select().from(pluginCatalog).orderBy(asc(pluginCatalog.key))
    return rows.map(r => ({ key: r.key, force: r.force, hidden: r.hidden, options: r.options as PluginCatalogEntry["options"] }))
}

async function validSettings(db: Db, settings: PluginSettings) {
    try {
        return normalizePluginSettings(await loadCatalog(db), settings)
    } catch (error) {
        if (error instanceof PluginSettingsError)
            throw new ORPCError("BAD_REQUEST", { message: error.message })
        throw error
    }
}

async function assertServer(db: Db, serverId: number) {
    const [server] = await db.select({ id: servers.id }).from(servers).where(eq(servers.id, serverId))
    if (!server)
        throw new ORPCError("BAD_REQUEST", { message: "Unknown server" })
}

const duplicate = (error: unknown) => {
    if (isUniqueViolation(error, "game_accounts_server_name"))
        throw new ORPCError("CONFLICT", { message: "This game account is already added" })
    throw error
}

/** The only way an account leaves the API: no password, sealed or not. */
export async function listAccounts(db: Db, where: SQL | undefined): Promise<(PublicAccount & { ownerId: string })[]> {
    const rows = await db
        .select({ account: gameAccounts, status: botStatus })
        .from(gameAccounts)
        .leftJoin(botStatus, eq(botStatus.accountId, gameAccounts.id))
        .where(where)
        .orderBy(asc(gameAccounts.createdAt))
    const ids = rows.map(r => r.account.id)
    const settings = ids.length ? await db.select().from(pluginSettings).where(inArray(pluginSettings.accountId, ids)) : []
    return rows.map(({ account, status }) => ({
        id: account.id,
        ownerId: account.ownerId,
        name: account.name,
        serverId: account.serverId,
        desiredState: account.desiredState,
        externalEvent: account.externalEvent,
        createdAt: account.createdAt,
        plugins: Object.fromEntries(settings
            .filter(s => s.accountId === account.id)
            .map(s => [s.pluginKey, { enabled: s.enabled, options: s.options as PluginSettings[string]["options"] }])),
        status: status && {
            actualState: status.actualState,
            heartbeatAt: status.heartbeatAt,
            lastError: status.lastError,
            bannedUntil: status.bannedUntil,
        },
    }))
}

const ownedBy = (ownerId: string, ids?: string[]) =>
    and(eq(gameAccounts.ownerId, ownerId), ids ? inArray(gameAccounts.id, ids) : undefined)

export async function getOwnedAccount(db: Db, ownerId: string, id: string) {
    const [account] = await listAccounts(db, ownedBy(ownerId, [id]))
    if (!account)
        throw new ORPCError("NOT_FOUND", { message: "No such account" })
    const { ownerId: _, ...rest } = account
    return rest
}

export const listOwnedAccounts = async (db: Db, ownerId: string) =>
    (await listAccounts(db, ownedBy(ownerId))).map(({ ownerId: _, ...rest }) => rest)

async function replaceSettings(db: Pick<Db, "insert" | "delete">, accountId: string, settings: PluginSettings) {
    await db.delete(pluginSettings).where(eq(pluginSettings.accountId, accountId))
    const rows = Object.entries(settings).map(([pluginKey, s]) => ({ accountId, pluginKey, enabled: s.enabled, options: s.options }))
    if (rows.length)
        await db.insert(pluginSettings).values(rows)
}

export async function createAccount(db: Db, sealKey: string, ownerId: string,
    input: { name: string; serverId: number; password: string; externalEvent: boolean; plugins: PluginSettings }) {
    await assertServer(db, input.serverId)
    const settings = await validSettings(db, input.plugins)
    const id = await db.transaction(async tx => {
        const [account] = await tx.insert(gameAccounts).values({
            ownerId,
            name: input.name,
            serverId: input.serverId,
            passwordSealed: sealFor(sealKey, input.password),
            externalEvent: input.externalEvent,
        }).returning({ id: gameAccounts.id })
        await replaceSettings(tx, account!.id, settings)
        return account!.id
    }).catch(duplicate)
    return getOwnedAccount(db, ownerId, id)
}

export async function updateAccount(db: Db, sealKey: string, ownerId: string,
    input: { id: string; name?: string; serverId?: number; password?: string; externalEvent?: boolean; plugins?: PluginSettings }) {
    await getOwnedAccount(db, ownerId, input.id)
    if (input.serverId !== undefined)
        await assertServer(db, input.serverId)
    const settings = input.plugins && await validSettings(db, input.plugins)
    await db.transaction(async tx => {
        await tx.update(gameAccounts).set({
            ...(input.name !== undefined && { name: input.name }),
            ...(input.serverId !== undefined && { serverId: input.serverId }),
            ...(input.externalEvent !== undefined && { externalEvent: input.externalEvent }),
            ...(input.password !== undefined && { passwordSealed: sealFor(sealKey, input.password) }),
            updatedAt: new Date(),
        }).where(ownedBy(ownerId, [input.id]))
        if (settings)
            await replaceSettings(tx, input.id, settings)
    }).catch(duplicate)
    return getOwnedAccount(db, ownerId, input.id)
}

export async function removeAccounts(db: Db, ownerId: string, ids: string[]) {
    return db.delete(gameAccounts).where(ownedBy(ownerId, ids)).returning({ id: gameAccounts.id })
}

export async function setDesiredState(db: Db, where: SQL | undefined, state: "running" | "stopped") {
    return db.update(gameAccounts).set({ desiredState: state, updatedAt: new Date() }).where(where).returning({ id: gameAccounts.id })
}

export { ownedBy }
