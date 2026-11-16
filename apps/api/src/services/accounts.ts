import { ORPCError } from "@orpc/server"
import { and, asc, desc, eq, inArray, lt, type SQL } from "drizzle-orm"
import { appSettings, botLogs, botRuns, botStatus, gameAccounts, pluginCatalog, pluginSettings, publishMany, servers, users, type Db } from "@gge/db"
import { sealFor } from "@gge/crypto"
import {
    PluginSettingsError, attackPluginLimit, countedAccounts, entitledAccountIds, normalizePluginSettings, planRunsMessage, scheduleState, storedSchedule,
    twinMainIds, userChannel,
    type PlanOwner, type PluginCatalogEntry, type PluginSettings, type PublicAccount, type Schedule, type UserEvent,
} from "@gge/contracts"
import { isUniqueViolation } from "../context.ts"

export async function loadCatalog(db: Db): Promise<PluginCatalogEntry[]> {
    const rows = await db.select().from(pluginCatalog).orderBy(asc(pluginCatalog.key))
    return rows.map(r => ({
        key: r.key, force: r.force, hidden: r.hidden, options: r.options as PluginCatalogEntry["options"],
        category: r.category === "attack" ? "attack" as const : null,
    }))
}

/** The user's attack plugin cap as a number, or null for no limit: their override, else the global default. */
export async function attackLimitFor(db: Pick<Db, "select">, userId: string): Promise<number | null> {
    const [[user], [settings]] = await Promise.all([
        db.select({ cap: users.attackPluginCap }).from(users).where(eq(users.id, userId)),
        db.select({ cap: appSettings.attackPluginCap }).from(appSettings),
    ])
    return attackPluginLimit(user?.cap ?? settings?.cap ?? "4")
}

async function validSettings(db: Db, ownerId: string, settings: PluginSettings) {
    try {
        return normalizePluginSettings(await loadCatalog(db), settings, await attackLimitFor(db, ownerId))
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

const planColumns = {
    ownerId: gameAccounts.ownerId, id: gameAccounts.id, serverId: gameAccounts.serverId,
    name: gameAccounts.name, externalEvent: gameAccounts.externalEvent, createdAt: gameAccounts.createdAt,
}

type Reader = Pick<Db, "select">
const ownerAccounts = (db: Reader, ownerId: string) => db.select(planColumns).from(gameAccounts).where(eq(gameAccounts.ownerId, ownerId))

/** Which of these owners' accounts are twins and which their plans let run. */
async function planStanding(db: Reader, ownerIds: string[]) {
    const twins = new Set<string>()
    const entitled = new Set<string>()
    if (!ownerIds.length)
        return { twins, entitled }
    const [owners, accounts] = await Promise.all([
        db.select({ id: users.id, role: users.role, maxBots: users.maxBots }).from(users).where(inArray(users.id, ownerIds)),
        db.select(planColumns).from(gameAccounts).where(inArray(gameAccounts.ownerId, ownerIds)),
    ])
    const byOwner = Map.groupBy(accounts, a => a.ownerId)
    for (const owner of owners) {
        const mine = byOwner.get(owner.id) ?? []
        for (const id of twinMainIds(mine).keys())
            twins.add(id)
        for (const id of entitledAccountIds(owner, mine))
            entitled.add(id)
    }
    return { twins, entitled }
}

/** Locks the owner's row, so plan checks and the writes they guard take turns with each other and with admin plan changes. */
async function lockPlan(tx: Reader, ownerId: string): Promise<PlanOwner> {
    const [owner] = await tx.select({ role: users.role, maxBots: users.maxBots }).from(users).where(eq(users.id, ownerId)).for("update")
    if (!owner)
        throw new ORPCError("NOT_FOUND", { message: "No such user" })
    return owner
}

/** Runs a write that may change which accounts count, and refuses it if it grows the counted total past the plan. */
async function keepWithinPlan<T>(tx: Reader, ownerId: string, change: () => Promise<T>, refusal: (maxBots: number) => string) {
    const owner = await lockPlan(tx, ownerId)
    const before = countedAccounts(await ownerAccounts(tx, ownerId))
    const result = await change()
    if (owner.role !== "admin") {
        // Growth is what's refused, so a player already over a lowered limit can still edit what they have.
        const after = countedAccounts(await ownerAccounts(tx, ownerId))
        if (after > owner.maxBots && after > before)
            throw new ORPCError("FORBIDDEN", { message: refusal(owner.maxBots) })
    }
    return result
}

const bots = (n: number) => `${n} bot${n === 1 ? "" : "s"}`

/** The account's schedule, and when it next starts if it is wanted but outside its windows right now. Sleeping is worked out here, never stored. */
function scheduleOf(account: { id: string; desiredState: "running" | "stopped"; schedule: unknown }, now: Date) {
    const schedule = storedSchedule(account.schedule)
    const { active, nextChange } = scheduleState(schedule, now, account.id)
    return { schedule, sleepingUntil: account.desiredState === "running" && !active ? nextChange : null }
}

/** The only way an account leaves the API: no password, sealed or not. */
export async function listAccounts(db: Db, where: SQL | undefined, page?: { limit: number; offset: number }): Promise<(PublicAccount & { ownerId: string })[]> {
    const query = db
        .select({ account: gameAccounts, status: botStatus })
        .from(gameAccounts)
        .leftJoin(botStatus, eq(botStatus.accountId, gameAccounts.id))
        .where(where)
    const rows = await (page
        ? query.orderBy(desc(gameAccounts.createdAt), gameAccounts.id).limit(page.limit).offset(page.offset)
        : query.orderBy(asc(gameAccounts.createdAt)))
    const ids = rows.map(r => r.account.id)
    const [settings, standing] = await Promise.all([
        ids.length ? db.select().from(pluginSettings).where(inArray(pluginSettings.accountId, ids)) : [],
        planStanding(db, [...new Set(rows.map(r => r.account.ownerId))]),
    ])
    const now = new Date()
    return rows.map(({ account, status }) => ({
        id: account.id,
        ownerId: account.ownerId,
        name: account.name,
        serverId: account.serverId,
        desiredState: account.desiredState,
        externalEvent: account.externalEvent,
        createdAt: account.createdAt,
        isTwin: standing.twins.has(account.id),
        entitled: standing.entitled.has(account.id),
        ...scheduleOf(account, now),
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
    input: { name: string; serverId: number; password: string; externalEvent: boolean; plugins: PluginSettings; schedule: Schedule | null }) {
    await assertServer(db, input.serverId)
    const settings = await validSettings(db, ownerId, input.plugins)
    const id = await db.transaction(tx => keepWithinPlan(tx, ownerId, async () => {
        const [account] = await tx.insert(gameAccounts).values({
            ownerId,
            name: input.name,
            serverId: input.serverId,
            passwordSealed: sealFor(sealKey, input.password),
            externalEvent: input.externalEvent,
            schedule: input.schedule,
        }).returning({ id: gameAccounts.id })
        await replaceSettings(tx, account!.id, settings)
        return account!.id
    }, maxBots => `Your plan allows ${bots(maxBots)}. Remove one to add another.`)).catch(duplicate)
    return getOwnedAccount(db, ownerId, id)
}

export async function updateAccount(db: Db, sealKey: string, ownerId: string,
    input: { id: string; name?: string; serverId?: number; password?: string; externalEvent?: boolean; plugins?: PluginSettings; schedule?: Schedule | null }) {
    await getOwnedAccount(db, ownerId, input.id)
    if (input.serverId !== undefined)
        await assertServer(db, input.serverId)
    const settings = input.plugins && await validSettings(db, ownerId, input.plugins)
    await db.transaction(tx => keepWithinPlan(tx, ownerId, async () => {
        await tx.update(gameAccounts).set({
            ...(input.name !== undefined && { name: input.name }),
            ...(input.serverId !== undefined && { serverId: input.serverId }),
            ...(input.externalEvent !== undefined && { externalEvent: input.externalEvent }),
            ...(input.password !== undefined && { passwordSealed: sealFor(sealKey, input.password) }),
            ...(input.schedule !== undefined && { schedule: input.schedule }),
            updatedAt: new Date(),
        }).where(ownedBy(ownerId, [input.id]))
        if (settings)
            await replaceSettings(tx, input.id, settings)
    }, maxBots => `Your plan allows ${bots(maxBots)}, and this change would make this account count as one more. Remove a bot first.`)).catch(duplicate)
    return getOwnedAccount(db, ownerId, input.id)
}

export async function removeAccounts(db: Db, ownerId: string, ids: string[]) {
    return db.delete(gameAccounts).where(ownedBy(ownerId, ids)).returning({ id: gameAccounts.id })
}

/** Starts or stops the matching accounts and tells each owner's open tabs, both or neither. */
export async function setDesiredState(db: Pick<Db, "transaction">, where: SQL | undefined, state: "running" | "stopped") {
    return db.transaction(async tx => {
        const changed = await tx.update(gameAccounts).set({ desiredState: state, updatedAt: new Date() }).where(where)
            .returning({ id: gameAccounts.id, ownerId: gameAccounts.ownerId })
        await publishMany(tx, changed.map(account => ({
            channel: userChannel(account.ownerId),
            data: { v: 1, kind: "account", accountId: account.id, desiredState: state } satisfies UserEvent,
        })))
        return changed
    })
}

/** Starts the owner's listed accounts, all or none: refused if any of them is beyond what the plan runs. */
export async function startAccounts(db: Db, ownerId: string, ids: string[]) {
    return db.transaction(async tx => {
        const owner = await lockPlan(tx, ownerId)
        const accounts = await ownerAccounts(tx, ownerId)
        const entitled = entitledAccountIds(owner, accounts)
        if (accounts.some(a => ids.includes(a.id) && !entitled.has(a.id)))
            throw new ORPCError("FORBIDDEN", { message: planRunsMessage(owner.maxBots) })
        return setDesiredState(tx, ownedBy(ownerId, ids), "running")
    })
}

/** Stops the owner's running accounts their plan no longer covers. Call it in the transaction that changed the plan. */
export async function stopUnentitled(tx: Pick<Db, "select" | "transaction">, ownerId: string): Promise<string[]> {
    const owner = await lockPlan(tx, ownerId)
    const accounts = await ownerAccounts(tx, ownerId)
    const entitled = entitledAccountIds(owner, accounts)
    const over = accounts.filter(a => !entitled.has(a.id)).map(a => a.id)
    if (!over.length)
        return []
    const stopped = await setDesiredState(tx, and(inArray(gameAccounts.id, over), eq(gameAccounts.desiredState, "running")), "stopped")
    return stopped.map(r => r.id)
}

export { ownedBy }

/** One page of an account's log, newest first; `before` is the id of the oldest line already shown. */
export async function accountLogs(db: Pick<Db, "select">, accountId: string, { before, limit }: { before?: number; limit: number }) {
    const rows = await db.select().from(botLogs)
        .where(and(eq(botLogs.accountId, accountId), before ? lt(botLogs.id, before) : undefined))
        .orderBy(desc(botLogs.id)).limit(limit)
    return rows.map(r => ({ id: r.id, ts: r.ts, level: r.level, message: r.message, parts: Array.isArray(r.parts) ? r.parts : null }))
}

/** An account's latest runs, newest first. */
export const accountRuns = (db: Pick<Db, "select">, accountId: string, limit: number) =>
    db.select({ id: botRuns.id, startedAt: botRuns.startedAt, endedAt: botRuns.endedAt, endReason: botRuns.endReason, error: botRuns.error })
        .from(botRuns).where(eq(botRuns.accountId, accountId)).orderBy(desc(botRuns.id)).limit(limit)
