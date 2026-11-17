export type Level = 0 | 1 | 2 | 3
/** Each level's word, as a key in the `ui` catalog, and as it is written in a downloaded file. */
export const LEVELS = [
    { level: 0, word: "level.info", file: "INFO " },
    { level: 1, word: "level.warn", file: "WARN " },
    { level: 2, word: "level.error", file: "ERROR" },
    { level: 3, word: "level.notNow", file: "LATER" },
] as const satisfies readonly { level: Level; word: string; file: string }[]
export const levelOf = (level: number) => LEVELS[level] ?? LEVELS[0]
export const isLevel = (value: unknown): value is Level => value === 0 || value === 1 || value === 2 || value === 3

/** A log line as the terminal shows it. The feed API and the live channel both send this shape. */
export type TerminalLine = {
    id: number
    ts: Date
    level: number
    message: string
    parts: readonly (string | number)[] | null
    plugin: string | null
    accountId: string
}

export type LogFilters = {
    /** Matched case-insensitively against the rendered text and the tag. */
    q: string
    /** An empty list allows everything; the same goes for the other lists. */
    levels: readonly Level[]
    plugins: readonly string[]
    accountIds: readonly string[]
}

export const NO_FILTERS: LogFilters = { q: "", levels: [], plugins: [], accountIds: [] }

/** How many filter values are set, text included. */
export const activeFilters = (filters: LogFilters) =>
    (filters.q.trim() ? 1 : 0) + filters.levels.length + filters.plugins.length + filters.accountIds.length

/** What a line says, without the time and the tag that the bot writes first: the terminal shows those in their own columns. */
export function messageParts(line: Pick<TerminalLine, "parts" | "message">): readonly (string | number)[] {
    if (!line.parts)
        return [line.message]
    return line.parts[1] === "[" ? line.parts.slice(4) : line.parts
}

export function filterLines<L extends TerminalLine>(lines: readonly L[], filters: LogFilters, renderText: (line: L) => string): L[] {
    const q = filters.q.trim().toLocaleLowerCase()
    const levels = new Set<number>(filters.levels)
    const plugins = new Set(filters.plugins)
    const accounts = new Set(filters.accountIds)
    return lines.filter(line =>
        (!levels.size || levels.has(line.level))
        && (!plugins.size || (line.plugin !== null && plugins.has(line.plugin)))
        && (!accounts.size || accounts.has(line.accountId))
        && (!q || renderText(line).toLocaleLowerCase().includes(q) || Boolean(line.plugin?.toLocaleLowerCase().includes(q))))
}

/** Counts per tag and per level, in the API's facet shape, for a view that holds every line it filters. */
export function facetsOf(lines: readonly TerminalLine[]) {
    const plugins = new Map<string, number>()
    const levels = new Map<number, number>()
    for (const line of lines) {
        if (line.plugin)
            plugins.set(line.plugin, (plugins.get(line.plugin) ?? 0) + 1)
        levels.set(line.level, (levels.get(line.level) ?? 0) + 1)
    }
    return {
        total: lines.length,
        plugins: [...plugins].map(([key, count]) => ({ key, count })).sort((a, b) => a.key.localeCompare(b.key)),
        levels: [...levels].map(([level, count]) => ({ level, count })).sort((a, b) => a.level - b.level),
    }
}

const TAG_HUES = 8
/** A tag's colour slot, 0 to 7. FNV-1a, so a tag keeps its colour across reloads and between the apps. */
export function tagHue(tag: string) {
    let hash = 0x811c9dc5
    for (let i = 0; i < tag.length; i++)
        hash = Math.imul(hash ^ tag.charCodeAt(i), 0x01000193)
    return (hash >>> 0) % TAG_HUES
}

const pad = (n: number) => String(n).padStart(2, "0")
/** Local `HH:mm:ss`, always in Latin digits so the column lines up in every language. */
export const clock = (ts: Date) => `${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`
/** The local calendar day, `YYYY-MM-DD`. */
export const calendarDay = (ts: Date) => `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())}`

/**
 * The lines as a text file, oldest first, one per row: `YYYY-MM-DD HH:mm:ss LEVEL [tag] account: text`.
 * The tag is left out for an untagged line, and the account when `accountName` is not given.
 */
export function formatForDownload<L extends TerminalLine>(lines: readonly L[], { renderText, accountName }: {
    renderText: (line: L) => string
    accountName?: (accountId: string) => string | undefined
}) {
    return [...lines].sort((a, b) => a.id - b.id).map(line => {
        const tag = line.plugin ? `[${line.plugin}] ` : ""
        const account = accountName ? `${accountName(line.accountId) ?? line.accountId}: ` : ""
        return `${calendarDay(line.ts)} ${clock(line.ts)} ${levelOf(line.level).file} ${tag}${account}${renderText(line)}\n`
    }).join("")
}
