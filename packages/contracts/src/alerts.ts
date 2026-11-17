import * as z from "zod"
import { PLAN_IDS } from "./plans.ts"

export const ANNOUNCEMENT_SEVERITIES = ["info", "warning", "critical"] as const
export const AnnouncementSeverity = z.enum(ANNOUNCEMENT_SEVERITIES)
export type AnnouncementSeverity = z.infer<typeof AnnouncementSeverity>

/** The id `alerts.dismiss` takes for the "redeem your points" banner. */
export const POINTS_NUDGE = "points"

/** An announcement as players see it. */
export const PlayerAnnouncement = z.object({
    id: z.uuid(),
    severity: AnnouncementSeverity,
    title: z.string(),
    body: z.string(),
    linkUrl: z.string().nullable(),
    dismissible: z.boolean(),
    startsAt: z.date(),
})
export type PlayerAnnouncement = z.infer<typeof PlayerAnnouncement>

/**
 * What the banners above every player page show. While billing is off `plan`, `noPlan` and `points` are always
 * null or false, so nobody sees anything about plans before they restrict anyone.
 */
export const Alerts = z.object({
    /**
     * The plan ending within 14 days, or the last one, which has ended (`daysLeft` 0). `daysLeft` counts days left,
     * rounded up, so 1 is the last 24 hours. null for admins, and while the plan has longer to run.
     */
    plan: z.object({ planId: z.enum(PLAN_IDS), isTrial: z.boolean(), endsAt: z.date(), daysLeft: z.number().int() }).nullable(),
    /** No plan covers now, so none of the player's bots may run. */
    noPlan: z.boolean(),
    /** More accounts than the limit allows, so `counted - limit` of them are stopped. */
    overLimit: z.object({ limit: z.number().int(), counted: z.number().int() }).nullable(),
    /** Enough points to redeem `days` days of `planId`, until the player closes it; it shows again when they earn more. */
    points: z.object({ balance: z.number().int(), cost: z.number().int(), days: z.number().int(), planId: z.enum(PLAN_IDS) }).nullable(),
    /** Live now, not closed by this player; critical first, then newest. */
    announcements: z.array(PlayerAnnouncement),
})
export type Alerts = z.infer<typeof Alerts>

/** Only http and https, so a link can never run script. */
const LinkUrl = z.url({ protocol: /^https?$/ }).max(500)

const announcementFields = {
    severity: AnnouncementSeverity,
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(600),
    linkUrl: LinkUrl.nullable(),
    startsAt: z.date(),
    /** null runs it until an admin ends it. */
    endsAt: z.date().nullable(),
    dismissible: z.boolean(),
}
const endsAfterStart = (a: { startsAt?: Date; endsAt?: Date | null }) => !a.startsAt || !a.endsAt || a.endsAt > a.startsAt

export const CreateAnnouncement = z.object(announcementFields).refine(endsAfterStart, { path: ["endsAt"], message: "must be after the start" })
export type CreateAnnouncement = z.infer<typeof CreateAnnouncement>

export const UpdateAnnouncement = z.object({ id: z.uuid(), ...announcementFields }).partial().required({ id: true })
    .refine(endsAfterStart, { path: ["endsAt"], message: "must be after the start" })
export type UpdateAnnouncement = z.infer<typeof UpdateAnnouncement>

/** Whether players see it now, will later, or no longer do. */
export const AnnouncementState = z.enum(["scheduled", "live", "ended"])
export type AnnouncementState = z.infer<typeof AnnouncementState>

export const AdminAnnouncement = PlayerAnnouncement.extend({
    endsAt: z.date().nullable(),
    state: AnnouncementState,
    /** null once that admin's account is gone. */
    createdBy: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
    /** How many players closed it. */
    dismissals: z.number().int(),
})
export type AdminAnnouncement = z.infer<typeof AdminAnnouncement>

export function announcementState({ startsAt, endsAt }: { startsAt: Date; endsAt: Date | null }, now: Date): AnnouncementState {
    if (endsAt && endsAt <= now)
        return "ended"
    return startsAt > now ? "scheduled" : "live"
}
