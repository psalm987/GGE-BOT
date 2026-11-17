import { createLogRenderer, logTag } from "@gge/runner/src/log-render.ts"

type Part = string | number
type Template = { level: 0 | 1 | 2; plugin: string; parts: (n: number) => Part[] }

const hit = (plugin: string, kingdom: Part[]): Template => ({
    level: 0, plugin,
    parts: n => ["hittingTargetAttack", ...kingdom, "C", 2 + n % 5, " ", 400 + n * 7 % 300, ":", 180 + n * 13 % 400, " ", `${3 + n % 8}m ${n * 17 % 60}s`, "tillImpactAttack"],
})
const nomads = hit("attackNomads", [])
const barons = hit("attackBarronsGreatEmpire", ["Great Empire", " "])

/** A session's opening lines, then what a running bot keeps writing: mostly attacks and economy, some warnings, a few errors. */
const OPENING: Template[] = [
    { level: 0, plugin: "ggeBot", parts: () => ["loggedIn"] },
    { level: 0, plugin: "loginBonus", parts: () => ["loginBonusClaimed"] },
    { level: 0, plugin: "taxCollector", parts: () => ["taxesCollected"] },
]
const RUNNING: Template[] = [
    nomads,
    { level: 0, plugin: "feast", parts: n => ["consumed", 120 + n * 15] },
    barons,
    nomads,
    { level: 0, plugin: "attackBarronsGreatEmpire", parts: n => ["waitingForNextPossibleHit", 90 + n * 7, "waitingForNextPossibleHit2"] },
    { level: 0, plugin: "helpRequests", parts: n => ["helpRequests", ": ", 2 + n % 6] },
    { level: 0, plugin: "taxCollector", parts: () => ["taxesCollected"] },
    nomads,
    { level: 1, plugin: "feast", parts: () => ["notEnoughFoodToFeast"] },
    barons,
    { level: 1, plugin: "attackNomads", parts: () => ["noStablesCoinHorse"] },
    nomads,
    { level: 0, plugin: "feast", parts: n => ["consumed", 90 + n * 11] },
    { level: 1, plugin: "taxCollector", parts: () => ["taxCollectorRefused", "CTC", " ", "TIMED_OUT"] },
    barons,
    { level: 2, plugin: "ggeBot", parts: () => ["closedReason", "timedOut"] },
    { level: 0, plugin: "ggeBot", parts: () => ["retryLogin", 30, "retryLoginSeconds"] },
    { level: 1, plugin: "ggeBot", parts: () => ["loggedIn", "loggedInWithoutEventData"] },
    { level: 1, plugin: "ggeBot", parts: () => ["featuresMightNotWork"] },
    nomads,
    { level: 1, plugin: "loginBonus", parts: () => ["loginBonusNoReply"] },
    barons,
    { level: 0, plugin: "helpRequests", parts: n => ["helpRequests", ": ", 1 + n % 4] },
    nomads,
    { level: 0, plugin: "feast", parts: n => ["consumed", 60 + n * 9] },
    barons,
    { level: 0, plugin: "taxCollector", parts: () => ["taxesCollected"] },
    nomads,
    { level: 2, plugin: "attackBarronsGreatEmpire", parts: () => ["attacksHalted", "ATTACK_LIMIT_REACHED"] },
]

const LINES_PER_ACCOUNT = 40
const SPAN_MS = 4 * 3600_000
const pad = (n: number) => String(n).padStart(2, "0")

/**
 * About 40 lines per account over the last four hours, in the shape `mngLog` in ggeBot.js writes and with the
 * message and tag the runner's store derives. Sorted by time across accounts, so ids grow with time as they do live.
 */
export function demoLogLines(accountIds: string[], now = Date.now()) {
    const render = createLogRenderer()
    const rows = accountIds.flatMap((accountId, a) => Array.from({ length: LINES_PER_ACCOUNT }, (_, i) => {
        const template = i < OPENING.length ? OPENING[i]! : RUNNING[(i - OPENING.length + a * 5) % RUNNING.length]!
        const ts = new Date(now - SPAN_MS + (i * SPAN_MS) / LINES_PER_ACCOUNT + ((a * 7919 + i * 104729) % 240_000))
        const parts = [`[${pad(ts.getHours())}:${pad(ts.getMinutes())}] `, "[", template.plugin, "] ", ...template.parts(i + a)]
        return { accountId, ts, level: template.level, parts, message: render(parts), plugin: logTag(parts) }
    }))
    return rows.sort((x, y) => x.ts.getTime() - y.ts.getTime())
}
