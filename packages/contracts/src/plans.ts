export const PLAN_IDS = ["basic", "team"] as const
export type PlanId = typeof PLAN_IDS[number]

/** How a period was added. A user gets at most one "trial", ever. */
export const PERIOD_SOURCES = ["trial", "purchase", "code", "points", "admin"] as const
export type PeriodSource = typeof PERIOD_SOURCES[number]

/** Time on a plan, covering startsAt up to but not including endsAt. One user's periods never overlap. */
export type PlanPeriod = { planId: PlanId; startsAt: Date; endsAt: Date; source: PeriodSource }

export type CurrentPlan = {
    planId: PlanId
    maxAccounts: number
    /** When the user's cover runs out: the end of the last period queued behind the current one without a gap. */
    endsAt: Date
    isTrial: boolean
}

export const NO_PLAN = "NO_PLAN"
export const PLAN_LIMIT = "PLAN_LIMIT"

/** The plan the user is on at `now`, or null when no period covers it. */
export function currentPlan(periods: PlanPeriod[], maxAccountsOf: Record<PlanId, number>, now: Date): CurrentPlan | null {
    const at = now.getTime()
    const current = periods.find(p => p.startsAt.getTime() <= at && at < p.endsAt.getTime())
    if (!current)
        return null
    let end = current.endsAt.getTime()
    for (const p of periods.toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime()))
        if (p.startsAt.getTime() <= end && p.endsAt.getTime() > end)
            end = p.endsAt.getTime()
    return { planId: current.planId, maxAccounts: maxAccountsOf[current.planId], endsAt: new Date(end), isTrial: current.source === "trial" }
}

/** The next moment after `now` at which one of these periods starts or ends, so the plan may change; null when none does. */
export function nextPlanChange(periods: PlanPeriod[], now: Date): Date | null {
    const at = now.getTime()
    const edges = periods.flatMap(p => [p.startsAt.getTime(), p.endsAt.getTime()]).filter(t => t > at)
    return edges.length ? new Date(Math.min(...edges)) : null
}

export type PlanLimits = { role: "user" | "admin"; maxBots: number; maxBotsOverride: number | null; plan: CurrentPlan | null }

/**
 * How many accounts the user may run, to pass to entitledAccountIds as maxBots.
 * While billing is off this is users.max_bots, whatever plan the user has. Admins run everything either way.
 */
export function accountLimit({ role, maxBots, maxBotsOverride, plan }: PlanLimits, billingLive: boolean): number {
    if (!billingLive || role === "admin")
        return maxBots
    if (!plan)
        return 0
    return maxBotsOverride ?? plan.maxAccounts
}
