import err from "@gge/bot-core/err.json"
import classes from "@gge/bot-core/err-classes.json"
import type { TerminalLine } from "@gge/ui/log-filter"

export type ErrorClass = "severe" | "notNow"

const classOf = new Map<string, ErrorClass>([
    ...classes.severe.map(name => [name, "severe"] as const),
    ...classes.notNow.map(name => [name, "notNow"] as const),
])
const known = new Set(Object.values(err))

export type TopError = { code: string; errorClass: ErrorClass | null; count: number; lastAt: Date }

/** The game error code a log line reports: the bot writes the code's name as a part of the line. */
export const errorCodeOf = (line: Pick<TerminalLine, "parts">) => line.parts?.find((part): part is string => typeof part === "string" && known.has(part) && part !== "ALL_OK")

/** The codes the lines report most, most often first, and the newest first among equals. */
export function topErrors(lines: readonly Pick<TerminalLine, "parts" | "ts">[], limit: number): TopError[] {
    const found = new Map<string, TopError>()
    for (const line of lines) {
        const code = errorCodeOf(line)
        if (!code)
            continue
        const entry = found.get(code)
        if (entry) {
            entry.count++
            if (line.ts > entry.lastAt)
                entry.lastAt = line.ts
        } else
            found.set(code, { code, errorClass: classOf.get(code) ?? null, count: 1, lastAt: line.ts })
    }
    return [...found.values()].sort((a, b) => b.count - a.count || b.lastAt.getTime() - a.lastAt.getTime() || a.code.localeCompare(b.code)).slice(0, limit)
}
