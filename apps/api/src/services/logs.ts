import { and, count, desc, eq, inArray, isNotNull, lt, min, sql } from "drizzle-orm"
import { botLogs, gameAccounts, servers, type Db } from "@gge/db"
import { ACTIVITY_WINDOW, LOG_RETENTION, type FeedFacets, type FeedInput, type FeedLine, type LogActivity } from "@gge/contracts"

type Filters = Omit<typeof FeedInput._output, "limit" | "before">

const ownerRows = (ownerId: string, { accountIds, levels, plugins }: Filters = {}) => and(
    eq(gameAccounts.ownerId, ownerId),
    accountIds && inArray(botLogs.accountId, accountIds),
    levels && inArray(botLogs.level, levels),
    plugins && inArray(botLogs.plugin, plugins),
)

/** One page of the owner's lines across their accounts, newest first. An account id that isn't theirs matches nothing. */
export async function logFeed(db: Pick<Db, "select">, ownerId: string, { before, limit, ...filters }: typeof FeedInput._output): Promise<FeedLine[]> {
    const rows = await db.select({ line: botLogs }).from(botLogs)
        .innerJoin(gameAccounts, eq(gameAccounts.id, botLogs.accountId))
        .where(and(ownerRows(ownerId, filters), before ? lt(botLogs.id, before) : undefined))
        .orderBy(desc(botLogs.id)).limit(limit)
    return rows.map(({ line }) => ({
        id: line.id, accountId: line.accountId, ts: line.ts, level: line.level, message: line.message,
        parts: Array.isArray(line.parts) ? line.parts : null, plugin: line.plugin,
    }))
}

/** What the owner's retained lines hold, ignoring every filter. */
export async function logFacets(db: Pick<Db, "select">, ownerId: string): Promise<typeof FeedFacets._output> {
    const owned = eq(gameAccounts.ownerId, ownerId)
    const [accounts, plugins, levels] = await Promise.all([
        db.select({ id: gameAccounts.id, name: gameAccounts.name, serverLabel: servers.label, count: count() }).from(botLogs)
            .innerJoin(gameAccounts, eq(gameAccounts.id, botLogs.accountId))
            .innerJoin(servers, eq(servers.id, gameAccounts.serverId))
            .where(owned).groupBy(gameAccounts.id, servers.label).orderBy(gameAccounts.name),
        db.select({ key: botLogs.plugin, count: count() }).from(botLogs)
            .innerJoin(gameAccounts, eq(gameAccounts.id, botLogs.accountId))
            .where(and(owned, isNotNull(botLogs.plugin))).groupBy(botLogs.plugin).orderBy(botLogs.plugin),
        db.select({ level: botLogs.level, count: count() }).from(botLogs)
            .innerJoin(gameAccounts, eq(gameAccounts.id, botLogs.accountId))
            .where(owned).groupBy(botLogs.level).orderBy(botLogs.level),
    ])
    return {
        total: levels.reduce((sum, l) => sum + l.count, 0),
        accounts,
        plugins: plugins.map(p => ({ key: p.key!, count: p.count })),
        levels,
    }
}

/** The part of a worker's line that names what happened, after `[time] [plugin] `. The engine writes this key when it sends an attack. */
const ATTACK_KEY = "hittingTargetAttack"
const HOUR_MS = 3600_000

/** Attacks in the last 24 hours and errors in the last 7 days for each of the owner's accounts that has kept lines. */
export async function logActivity(db: Pick<Db, "select">, ownerId: string, now = new Date()): Promise<typeof LogActivity._output> {
    const attacksFrom = new Date(now.getTime() - ACTIVITY_WINDOW.attackHours * HOUR_MS)
    const errorsFrom = new Date(now.getTime() - ACTIVITY_WINDOW.errorDays * 24 * HOUR_MS)
    const rows = await db.select({
        accountId: botLogs.accountId,
        kept: count(),
        oldest: min(botLogs.ts),
        attacks: sql<number>`count(*) filter (where ${botLogs.parts}->>4 = ${ATTACK_KEY} and ${botLogs.ts} > ${attacksFrom})`.mapWith(Number),
        errors: sql<number>`count(*) filter (where ${botLogs.level} = 2 and ${botLogs.ts} > ${errorsFrom})`.mapWith(Number),
    }).from(botLogs)
        .innerJoin(gameAccounts, eq(gameAccounts.id, botLogs.accountId))
        .where(eq(gameAccounts.ownerId, ownerId))
        .groupBy(botLogs.accountId)
    // Lines are dropped from the oldest, only once an account holds more than the cap. Below it, nothing inside any window is missing.
    const reaches = (row: { kept: number; oldest: Date | null }, from: Date) => row.kept < LOG_RETENTION.perAccount || (row.oldest !== null && row.oldest <= from)
    return {
        accounts: rows.map(row => ({
            accountId: row.accountId, attacks: row.attacks, attacksComplete: reaches(row, attacksFrom), errors: row.errors, errorsComplete: reaches(row, errorsFrom),
        })),
    }
}
