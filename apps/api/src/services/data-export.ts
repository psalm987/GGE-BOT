import { asc, eq, inArray } from "drizzle-orm"
import { notificationPrefs, type DataExport } from "@gge/contracts"
import {
    auditLog, botLogs, botRuns, botStatus, gameAccounts, licenseCodes, notifications, packages, planPeriods, pluginMemory, pluginSettings, pointsLedger, publicStatus, purchases, servers,
    toNotification, users, virtualPresets,
} from "@gge/db"
import type { Ctx } from "../context.ts"
import { myCodes } from "./codes.ts"
import { toVirtualPreset } from "./virtual-presets.ts"
import { periodColumns } from "./plans.ts"
import { purchaseColumns } from "./purchases.ts"
import { fail } from "../errors.ts"

/** Everything stored about the user. Each query names its columns, so a sealed password or a password hash is never read. */
export async function exportData(ctx: Pick<Ctx, "db" | "limits">, userId: string): Promise<DataExport> {
    if (!ctx.limits.dataExport.hit(userId))
        throw fail("TOO_MANY_REQUESTS", "EXPORT_RATE_LIMITED")
    const { db } = ctx
    const [profile] = await db.select({
        username: users.username, email: users.email, emailVerifiedAt: users.emailVerifiedAt, role: users.role,
        maxBots: users.maxBots, createdAt: users.createdAt, notificationPrefs: users.notificationPrefs,
        locale: users.locale, detectedLocale: users.detectedLocale,
    }).from(users).where(eq(users.id, userId))
    if (!profile)
        throw fail("UNAUTHORIZED", "SIGN_IN_REQUIRED")

    const accounts = await db.select({
        id: gameAccounts.id, name: gameAccounts.name, server: servers.label, externalEvent: gameAccounts.externalEvent,
        desiredState: gameAccounts.desiredState, schedule: gameAccounts.schedule, createdAt: gameAccounts.createdAt,
        status: botStatus,
    }).from(gameAccounts)
        .innerJoin(servers, eq(servers.id, gameAccounts.serverId))
        .leftJoin(botStatus, eq(botStatus.accountId, gameAccounts.id))
        .where(eq(gameAccounts.ownerId, userId)).orderBy(asc(gameAccounts.createdAt))
    const ids = accounts.map(account => account.id)
    const ofAccounts = <T>(query: () => Promise<T[]>) => ids.length ? query() : Promise.resolve([])

    const [settings, memory, presets, runs, logs, notified, audit, periods, bought, codesBought, codesRedeemed, points] = await Promise.all([
        ofAccounts(() => db.select().from(pluginSettings).where(inArray(pluginSettings.accountId, ids)).orderBy(asc(pluginSettings.accountId), asc(pluginSettings.pluginKey))),
        ofAccounts(() => db.select().from(pluginMemory).where(inArray(pluginMemory.accountId, ids)).orderBy(asc(pluginMemory.accountId), asc(pluginMemory.plugin))),
        ofAccounts(() => db.select().from(virtualPresets).where(inArray(virtualPresets.accountId, ids)).orderBy(asc(virtualPresets.accountId), asc(virtualPresets.createdAt), asc(virtualPresets.id))),
        ofAccounts(() => db.select({ id: botRuns.id, accountId: botRuns.accountId, startedAt: botRuns.startedAt, endedAt: botRuns.endedAt, endReason: botRuns.endReason, error: botRuns.error })
            .from(botRuns).where(inArray(botRuns.accountId, ids)).orderBy(asc(botRuns.id))),
        ofAccounts(() => db.select({ accountId: botLogs.accountId, ts: botLogs.ts, level: botLogs.level, message: botLogs.message })
            .from(botLogs).where(inArray(botLogs.accountId, ids)).orderBy(asc(botLogs.id))),
        db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(asc(notifications.id)),
        db.select({ action: auditLog.action, targetType: auditLog.targetType, targetId: auditLog.targetId, meta: auditLog.meta, ts: auditLog.ts })
            .from(auditLog).where(eq(auditLog.actorId, userId)).orderBy(asc(auditLog.id)),
        db.select(periodColumns).from(planPeriods).where(eq(planPeriods.userId, userId)).orderBy(asc(planPeriods.startsAt)),
        db.select(purchaseColumns).from(purchases).innerJoin(packages, eq(packages.id, purchases.packageId))
            .where(eq(purchases.buyerId, userId)).orderBy(asc(purchases.createdAt), asc(purchases.id)),
        myCodes(db, userId),
        db.select({ code: licenseCodes.code, planId: licenseCodes.planId, days: licenseCodes.days, redeemedAt: licenseCodes.redeemedAt })
            .from(licenseCodes).where(eq(licenseCodes.redeemedBy, userId)).orderBy(asc(licenseCodes.redeemedAt)),
        db.select({ id: pointsLedger.id, delta: pointsLedger.delta, reason: pointsLedger.reason, createdAt: pointsLedger.createdAt })
            .from(pointsLedger).where(eq(pointsLedger.userId, userId)).orderBy(asc(pointsLedger.id)),
    ])
    return {
        exportedAt: new Date(),
        profile: { ...profile, emailVerified: profile.emailVerifiedAt !== null, notificationPrefs: notificationPrefs(profile.notificationPrefs) },
        accounts: accounts.map(({ status, ...account }) => ({ ...account, status: status ? publicStatus(status) : null })),
        pluginSettings: settings,
        pluginMemory: memory,
        virtualPresets: presets.map(toVirtualPreset),
        runs,
        logs,
        notifications: notified.map(toNotification),
        audit,
        planPeriods: periods,
        purchases: bought,
        codesBought,
        // Every code this player redeemed has a redemption time.
        codesRedeemed: codesRedeemed.map(code => ({ ...code, redeemedAt: code.redeemedAt! })),
        points,
    }
}
