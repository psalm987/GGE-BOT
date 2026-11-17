import type { AlertSeverity } from "@gge/ui"
import type { Alerts, PlanId, PlayerAnnouncement } from "@gge/contracts"

const HOUR_MS = 60 * 60 * 1000

/** What is left of a plan, in the unit a person would say it in: hours on its last day, else days. */
export type TimeLeft = { unit: "days" | "hours"; count: number }

/** One banner's meaning, before it is put into words. */
export type BannerModel = { id: string; severity: AlertSeverity } & (
    | { kind: "trialEnding"; endsAt: Date; left: TimeLeft }
    | { kind: "planEnding"; planId: PlanId; endsAt: Date; left: TimeLeft }
    | { kind: "planEnded"; planId: PlanId; isTrial: boolean; endedAt: Date }
    | { kind: "noPlan" }
    | { kind: "overLimit"; stopped: number; limit: number }
    | { kind: "attention"; accounts: { id: string; name: string }[] }
    | { kind: "points"; balance: number; days: number; planId: PlanId }
    | { kind: "announcement"; announcement: PlayerAnnouncement }
)

const RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 }

/** Paid time: info, then warning in its last week and critical on its last day. A trial is already a warning. */
export function endingSeverity(daysLeft: number, isTrial: boolean): AlertSeverity {
    if (daysLeft <= 1)
        return "critical"
    return isTrial || daysLeft <= 7 ? "warning" : "info"
}

export function timeLeft(endsAt: Date, daysLeft: number, now: Date): TimeLeft {
    if (daysLeft > 1)
        return { unit: "days", count: daysLeft }
    return { unit: "hours", count: Math.max(1, Math.ceil((endsAt.getTime() - now.getTime()) / HOUR_MS)) }
}

function planBanner(alerts: Alerts, now: Date): BannerModel | undefined {
    const { plan, noPlan } = alerts
    if (plan && noPlan)
        return { id: "plan", severity: "critical", kind: "planEnded", planId: plan.planId, isTrial: plan.isTrial, endedAt: plan.endsAt }
    if (noPlan)
        return { id: "plan", severity: "critical", kind: "noPlan" }
    if (!plan)
        return undefined
    const severity = endingSeverity(plan.daysLeft, plan.isTrial)
    const left = timeLeft(plan.endsAt, plan.daysLeft, now)
    return plan.isTrial
        ? { id: "plan", severity, kind: "trialEnding", endsAt: plan.endsAt, left }
        : { id: "plan", severity, kind: "planEnding", planId: plan.planId, endsAt: plan.endsAt, left }
}

/**
 * The banners to show, most urgent first. Within one severity the player's own plan leads, then their accounts,
 * then announcements, and the points nudge comes last. `attention` is the accounts that need their owner now.
 */
export function bannerModels(alerts: Alerts | undefined, attention: { id: string; name: string }[], now: Date): BannerModel[] {
    const banners: BannerModel[] = []
    const plan = alerts && planBanner(alerts, now)
    if (plan)
        banners.push(plan)
    if (alerts?.overLimit)
        banners.push({ id: "over-limit", severity: "warning", kind: "overLimit", stopped: alerts.overLimit.counted - alerts.overLimit.limit, limit: alerts.overLimit.limit })
    if (attention.length)
        banners.push({ id: "attention", severity: "warning", kind: "attention", accounts: attention })
    for (const announcement of alerts?.announcements ?? [])
        banners.push({ id: announcement.id, severity: announcement.severity, kind: "announcement", announcement })
    if (alerts?.points)
        banners.push({ id: "points", severity: "info", kind: "points", balance: alerts.points.balance, days: alerts.points.days, planId: alerts.points.planId })
    return banners.toSorted((a, b) => RANK[a.severity] - RANK[b.severity])
}

/** A day and time in the viewer's language and time zone; the year only when it isn't this year's. */
export function formatWhen(date: Date, locale: string, now: Date, { time = true, timeZone }: { time?: boolean; timeZone?: string } = {}) {
    const year = (d: Date) => new Intl.DateTimeFormat("en", { year: "numeric", timeZone }).format(d)
    return new Intl.DateTimeFormat(locale, {
        day: "numeric", month: "short", timeZone,
        ...(year(date) !== year(now) && { year: "numeric" }),
        ...(time && { hour: "2-digit", minute: "2-digit" }),
    }).format(date)
}
