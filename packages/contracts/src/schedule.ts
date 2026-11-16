import * as z from "zod"

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
/** How far ahead scheduleState looks. Every window starts at least once a week, so 8 days always holds the next start. */
const HORIZON_DAYS = 8

export function isTimeZone(tz: string) {
    // Intl also takes offsets such as "+01:00" on newer engines; only named zones are stored, so every reader agrees.
    if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(tz))
        return false
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz })
        return true
    } catch {
        return false
    }
}

const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time such as 08:30")

/**
 * One stretch of the day an account may run in.
 * `days` are the weekdays it starts on, in the schedule's zone: 0 is Sunday, 6 is Saturday.
 * An `end` at or before `start` is on the next day.
 */
export const ScheduleWindow = z.object({
    days: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one day").refine(days => new Set(days).size === days.length, "A day can only be listed once"),
    start: TimeOfDay,
    end: TimeOfDay,
}).refine(w => w.start !== w.end, { path: ["end"], message: "A window can't start and end at the same time" })
export type ScheduleWindow = z.infer<typeof ScheduleWindow>

/** When an account may run. An account without one runs whenever it is wanted. */
export const Schedule = z.object({
    tz: z.string().max(64).refine(isTimeZone, "Unknown time zone"),
    windows: z.array(ScheduleWindow).min(1, "Add at least one window").max(14),
    /** Each day, every start and every end moves by up to this many minutes either way. */
    jitterMinutes: z.number().int().min(0).max(30),
})
export type Schedule = z.infer<typeof Schedule>

/** The schedule in a stored value, or null when there is none or it isn't one this build understands. */
export const storedSchedule = (value: unknown): Schedule | null => Schedule.safeParse(value).data ?? null

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatterFor(tz: string) {
    let formatter = formatters.get(tz)
    if (!formatter) {
        formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
        })
        formatters.set(tz, formatter)
    }
    return formatter
}

/** How far the zone's clocks are ahead of UTC at `instant`, in ms. */
function offsetAt(tz: string, instant: number) {
    const part: Record<string, number> = {}
    for (const { type, value } of formatterFor(tz).formatToParts(instant))
        part[type] = Number(value)
    const wall = Date.UTC(part.year!, part.month! - 1, part.day, part.hour, part.minute, part.second)
    return wall - Math.floor(instant / 1000) * 1000
}

/**
 * The instant the zone's clocks show `wall`, which is that reading written as if it were UTC.
 * A reading the clocks skip maps to the first instant after the skip, and one they show twice to the first time.
 */
function wallToInstant(tz: string, wall: number) {
    const before = offsetAt(tz, wall - DAY)
    const after = offsetAt(tz, wall + DAY)
    const matches = [wall - before, wall - after].filter(instant => instant + offsetAt(tz, instant) === wall)
    if (matches.length)
        return Math.min(...matches)
    let low = (wall - Math.max(before, after)) / MINUTE
    let high = (wall - Math.min(before, after)) / MINUTE
    while (high - low > 1) {
        const middle = Math.floor((low + high) / 2)
        if (offsetAt(tz, middle * MINUTE) === after)
            high = middle
        else
            low = middle
    }
    return high * MINUTE
}

/** A whole number of minutes in [-minutes, +minutes], fixed by the key. */
function jitter(key: string, minutes: number) {
    if (!minutes)
        return 0
    // FNV-1a, then MurmurHash3's final mix, so keys that differ in one character land far apart.
    let hash = 0x811c9dc5
    for (let i = 0; i < key.length; i++)
        hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193)
    hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
    hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
    hash ^= hash >>> 16
    return ((hash >>> 0) % (2 * minutes + 1) - minutes) * MINUTE
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))

/** Every stretch that starts on one of `days` local dates from `firstDate` on, merged where they touch or overlap, in order. */
function activeStretches(schedule: Schedule, seed: string, firstDate: number, days: number) {
    const stretches: { start: number; end: number }[] = []
    for (let date = firstDate; date < firstDate + days * DAY; date += DAY) {
        const weekday = new Date(date).getUTCDay()
        const dateKey = new Date(date).toISOString().slice(0, 10)
        schedule.windows.forEach((window, index) => {
            if (!window.days.includes(weekday))
                return
            const startWall = date + minutesOf(window.start) * MINUTE
            const endWall = date + minutesOf(window.end) * MINUTE + (window.end <= window.start ? DAY : 0)
            const shift = (edge: "start" | "end") => jitter(`${seed}|${dateKey}|${index}|${edge}`, schedule.jitterMinutes)
            const start = wallToInstant(schedule.tz, startWall) + shift("start")
            const end = Math.max(wallToInstant(schedule.tz, endWall) + shift("end"), start + MINUTE)
            stretches.push({ start, end })
        })
    }
    stretches.sort((a, b) => a.start - b.start)
    const merged: typeof stretches = []
    for (const stretch of stretches) {
        const last = merged.at(-1)
        if (last && stretch.start <= last.end)
            last.end = Math.max(last.end, stretch.end)
        else
            merged.push(stretch)
    }
    return merged
}

/**
 * Whether an account with this schedule may run at `now`, and when that next changes.
 * `seed` is the account's id. A null schedule is always active.
 *
 * Jitter: each time a window comes round, its start and its end each move by a whole number of minutes in
 * [-jitterMinutes, +jitterMinutes]. The amount is a hash of the seed, the local date that window starts on, the
 * window's place in the list and which edge it is, so it differs from day to day and never changes within one.
 * A window always lasts at least a minute, whatever the jitter. Windows that touch or overlap, by design or
 * through jitter, count as one stretch: the account stays active across them and `nextChange` is where the
 * joined stretch ends.
 *
 * Daylight saving: a time the clocks skip (02:30 in Europe/Berlin on the last Sunday of March) means the first
 * instant after the skip, 03:00. A time the clocks show twice (02:30 on the last Sunday of October) means the
 * first of the two.
 *
 * `nextChange` is null when nothing changes within 8 days: no schedule, or one whose windows cover the whole week.
 */
export function scheduleState(schedule: Schedule | null, now: Date, seed: string): { active: boolean; nextChange: Date | null } {
    if (!schedule)
        return { active: true, nextChange: null }
    const at = now.getTime()
    const today = Math.floor((at + offsetAt(schedule.tz, at)) / DAY) * DAY
    // Yesterday's windows can still be open. One day past the horizon, so a stretch that covers all of it ends beyond it.
    const stretches = activeStretches(schedule, seed, today - DAY, HORIZON_DAYS + 3)
    const current = stretches.find(s => s.start <= at && at < s.end)
    if (current)
        return { active: true, nextChange: current.end - at > HORIZON_DAYS * DAY ? null : new Date(current.end) }
    const next = stretches.find(s => s.start > at)
    return { active: false, nextChange: next ? new Date(next.start) : null }
}
