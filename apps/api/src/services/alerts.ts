import { ORPCError } from "@orpc/server"
import { and, count, desc, eq, gt, isNull, lte, max, notExists, or, sql } from "drizzle-orm"
import {
    POINTS_NUDGE, announcementState, countedAccounts,
    type AdminAnnouncement, type Alerts, type CreateAnnouncement, type PlayerAnnouncement, type UpdateAnnouncement,
} from "@gge/contracts"
import { announcementDismissals, announcements, isBillingLive, loadPlanOwners, planOwnerColumns, planPeriods, pointsLedger, users, type Db } from "@gge/db"
import { ownerAccounts } from "./accounts.ts"
import { audit } from "./audit.ts"
import { billingSettings, pointsBalance } from "./points.ts"

type Reader = Pick<Db, "select">

const DAY_MS = 24 * 60 * 60 * 1000
/** The plan banner shows from this many days before the end. */
const PLAN_BANNER_DAYS = 14

const playerColumns = {
    id: announcements.id, severity: announcements.severity, title: announcements.title, body: announcements.body,
    linkUrl: announcements.linkUrl, dismissible: announcements.dismissible, startsAt: announcements.startsAt,
}
const liveAt = (now: Date) => and(lte(announcements.startsAt, now), or(isNull(announcements.endsAt), gt(announcements.endsAt, now)))
const SEVERITY_RANK = sql`case ${announcements.severity} when 'critical' then 0 when 'warning' then 1 else 2 end`

function liveAnnouncements(db: Reader, userId: string, now: Date): Promise<PlayerAnnouncement[]> {
    const closed = db.select({ one: sql`1` }).from(announcementDismissals)
        .where(and(eq(announcementDismissals.announcementId, announcements.id), eq(announcementDismissals.userId, userId)))
    return db.select(playerColumns).from(announcements).where(and(liveAt(now), notExists(closed)))
        .orderBy(SEVERITY_RANK, desc(announcements.startsAt))
}

/** The points banner: enough to redeem, and nothing earned since the player last closed it. */
async function pointsNudge(db: Reader, userId: string, dismissedAt: Date | null): Promise<Alerts["points"]> {
    const [balance, settings] = await Promise.all([pointsBalance(db, userId), billingSettings(db)])
    if (balance < settings.pointsRedeemCost)
        return null
    if (dismissedAt) {
        const [earned] = await db.select({ at: max(pointsLedger.createdAt) }).from(pointsLedger)
            .where(and(eq(pointsLedger.userId, userId), gt(pointsLedger.delta, 0)))
        if (!earned?.at || earned.at <= dismissedAt)
            return null
    }
    return { balance, cost: settings.pointsRedeemCost, days: settings.pointsRedeemDays, planId: settings.pointsRedeemPlan }
}

export async function alertsFor(db: Reader, userId: string, now = new Date()): Promise<Alerts> {
    const [[row], accounts, billingLive, live] = await Promise.all([
        db.select({ ...planOwnerColumns, pointsNudgeDismissedAt: users.pointsNudgeDismissedAt }).from(users).where(eq(users.id, userId)),
        ownerAccounts(db, userId),
        isBillingLive(db),
        liveAnnouncements(db, userId, now),
    ])
    const owner = (await loadPlanOwners(db, [row!], now)).get(userId)!
    const counted = countedAccounts(accounts)
    const overLimit = owner.role !== "admin" && !owner.noPlan && counted > owner.maxBots ? { limit: owner.maxBots, counted } : null
    if (!billingLive || owner.role === "admin")
        return { plan: null, noPlan: false, overLimit, points: null, announcements: live }

    // Periods queue without gaps, so the latest one ends the player's cover, whether that is still to come or has passed.
    const [[last], points] = await Promise.all([
        db.select({ planId: planPeriods.planId, source: planPeriods.source, endsAt: planPeriods.endsAt }).from(planPeriods)
            .where(eq(planPeriods.userId, userId)).orderBy(desc(planPeriods.endsAt)).limit(1),
        pointsNudge(db, userId, row!.pointsNudgeDismissedAt),
    ])
    const daysLeft = last && !owner.noPlan ? Math.ceil((last.endsAt.getTime() - now.getTime()) / DAY_MS) : 0
    const plan = last && daysLeft <= PLAN_BANNER_DAYS ? { planId: last.planId, isTrial: last.source === "trial", endsAt: last.endsAt, daysLeft } : null
    return { plan, noPlan: owner.noPlan, overLimit, points, announcements: live }
}

/** Closes a banner for the player. The points banner comes back when they earn more; an announcement never does. */
export async function dismissAlert(db: Db, userId: string, id: string, now = new Date()) {
    if (id === POINTS_NUDGE) {
        await db.update(users).set({ pointsNudgeDismissedAt: now }).where(eq(users.id, userId))
        return
    }
    const [found] = await db.select({ dismissible: announcements.dismissible }).from(announcements).where(eq(announcements.id, id))
    if (!found)
        throw new ORPCError("NOT_FOUND", { message: "No such message" })
    if (!found.dismissible)
        throw new ORPCError("FORBIDDEN", { message: "This message can't be closed." })
    await db.insert(announcementDismissals).values({ userId, announcementId: id }).onConflictDoNothing()
}

async function adminAnnouncements(db: Reader, id?: string, now = new Date()): Promise<AdminAnnouncement[]> {
    const dismissals = db.select({ announcementId: announcementDismissals.announcementId, n: count().as("n") })
        .from(announcementDismissals).groupBy(announcementDismissals.announcementId).as("dismissals")
    const rows = await db.select({
        ...playerColumns, endsAt: announcements.endsAt, createdBy: users.username, createdAt: announcements.createdAt,
        updatedAt: announcements.updatedAt, dismissals: sql<number>`coalesce(${dismissals.n}, 0)::int`,
    }).from(announcements)
        .leftJoin(users, eq(users.id, announcements.createdBy))
        .leftJoin(dismissals, eq(dismissals.announcementId, announcements.id))
        .where(id ? eq(announcements.id, id) : undefined)
        .orderBy(desc(announcements.startsAt), desc(announcements.createdAt))
    return rows.map(row => ({ ...row, state: announcementState(row, now) }))
}

export const listAnnouncements = (db: Reader) => adminAnnouncements(db)

async function oneAnnouncement(db: Reader, id: string) {
    const [found] = await adminAnnouncements(db, id)
    if (!found)
        throw new ORPCError("NOT_FOUND", { message: "No such announcement" })
    return found
}

export async function createAnnouncement(db: Db, actorId: string, input: CreateAnnouncement) {
    const id = await db.transaction(async tx => {
        const [created] = await tx.insert(announcements).values({ ...input, createdBy: actorId }).returning({ id: announcements.id })
        await audit(tx, { actorId, action: "admin.announcement.create", targetType: "announcement", targetId: created!.id, meta: { severity: input.severity, title: input.title } })
        return created!.id
    })
    return oneAnnouncement(db, id)
}

export async function updateAnnouncement(db: Db, actorId: string, { id, ...changes }: UpdateAnnouncement) {
    await db.transaction(async tx => {
        const [from] = await tx.select().from(announcements).where(eq(announcements.id, id)).for("update")
        if (!from)
            throw new ORPCError("NOT_FOUND", { message: "No such announcement" })
        const startsAt = changes.startsAt ?? from.startsAt
        const endsAt = changes.endsAt === undefined ? from.endsAt : changes.endsAt
        if (endsAt && endsAt <= startsAt)
            throw new ORPCError("BAD_REQUEST", { message: "The end must be after the start." })
        await tx.update(announcements).set({ ...changes, updatedAt: new Date() }).where(eq(announcements.id, id))
        await audit(tx, { actorId, action: "admin.announcement.update", targetType: "announcement", targetId: id, meta: { fields: Object.keys(changes) } })
    })
    return oneAnnouncement(db, id)
}

/** Ends it now. One that hasn't started yet is ended before it starts, so no player ever sees it. */
export async function endAnnouncement(db: Db, actorId: string, id: string, now = new Date()) {
    await db.transaction(async tx => {
        const [from] = await tx.select({ startsAt: announcements.startsAt, endsAt: announcements.endsAt }).from(announcements)
            .where(eq(announcements.id, id)).for("update")
        if (!from)
            throw new ORPCError("NOT_FOUND", { message: "No such announcement" })
        if (from.endsAt && from.endsAt <= now)
            return
        const startsAt = from.startsAt < now ? from.startsAt : new Date(now.getTime() - 1000)
        await tx.update(announcements).set({ startsAt, endsAt: now, updatedAt: now }).where(eq(announcements.id, id))
        await audit(tx, { actorId, action: "admin.announcement.end", targetType: "announcement", targetId: id })
    })
    return oneAnnouncement(db, id)
}
