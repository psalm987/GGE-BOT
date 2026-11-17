import { and, gt, inArray } from "drizzle-orm"
import { accountLimit, currentPlan, nextPlanChange, type CurrentPlan, type PlanId, type PlanOwner } from "@gge/contracts"
import { appSettings, planPeriods, plans, users } from "./schema.ts"
import type { Db } from "./index.ts"

type Reader = Pick<Db, "select">

/** The go-live switch. While it is off, plans and periods restrict nobody. */
export async function isBillingLive(db: Reader) {
    const [settings] = await db.select({ billingLive: appSettings.billingLive }).from(appSettings)
    return settings?.billingLive ?? false
}

export type PlanState = {
    plan: CurrentPlan | null
    /** The next time one of the user's periods starts or ends. */
    nextChange: Date | null
}

/** Where each of these users stands at `now`, from their periods. A user with no period still to end is left out. */
export async function loadPlanStates(db: Reader, userIds: string[], now: Date): Promise<Map<string, PlanState>> {
    if (!userIds.length)
        return new Map()
    const maxAccountsOf: Record<PlanId, number> = { basic: 0, team: 0 }
    for (const plan of await db.select({ id: plans.id, maxAccounts: plans.maxAccounts }).from(plans))
        maxAccountsOf[plan.id] = plan.maxAccounts
    const periods = await db
        .select({ userId: planPeriods.userId, planId: planPeriods.planId, startsAt: planPeriods.startsAt, endsAt: planPeriods.endsAt, source: planPeriods.source })
        .from(planPeriods)
        .where(and(inArray(planPeriods.userId, userIds), gt(planPeriods.endsAt, now)))
    return new Map([...Map.groupBy(periods, p => p.userId)]
        .map(([userId, mine]) => [userId, { plan: currentPlan(mine, maxAccountsOf, now), nextChange: nextPlanChange(mine, now) }]))
}

/** The users columns a plan check reads. */
export const planOwnerColumns = { id: users.id, role: users.role, maxBots: users.maxBots, maxBotsOverride: users.maxBotsOverride }
type OwnerRow = { id: string; role: "user" | "admin"; maxBots: number; maxBotsOverride: number | null }

export type OwnerPlan = PlanOwner & {
    /** Billing is live and this player has no plan right now, so nothing of theirs may run. */
    noPlan: boolean
    nextChange: Date | null
}

/**
 * Each owner as entitledAccountIds takes them, with `maxBots` already the limit that applies at `now`.
 * While billing is off that is users.max_bots and no period is read.
 */
export async function loadPlanOwners(db: Reader, owners: OwnerRow[], now: Date): Promise<Map<string, OwnerPlan>> {
    const billingLive = await isBillingLive(db)
    const states = billingLive ? await loadPlanStates(db, owners.map(o => o.id), now) : new Map<string, PlanState>()
    return new Map(owners.map(owner => {
        const { plan = null, nextChange = null } = states.get(owner.id) ?? {}
        return [owner.id, {
            role: owner.role,
            maxBots: accountLimit({ ...owner, plan }, billingLive),
            noPlan: billingLive && owner.role !== "admin" && !plan,
            nextChange,
        }]
    }))
}
