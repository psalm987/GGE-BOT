import type { AccountProblem } from "@gge/contracts"
import classes from "@gge/bot-core/err-classes.json"

export type ErrorClass = "severe" | "notNow"

const classOf = new Map<string, ErrorClass>([
    ...classes.severe.map(name => [name, "severe"] as const),
    ...classes.notNow.map(name => [name, "notNow"] as const),
])

/** A problem as the account page lists it: how serious its error is, and the translation keys that say what was asked and why it was refused. */
export type ProblemRow = AccountProblem & { errorClass: ErrorClass | null; action: string; reason: string }

/** `has` tells whether the catalog has a key. A command or error without words of its own takes the general phrase. */
export function problemRows(problems: readonly AccountProblem[], has: (key: string) => boolean): ProblemRow[] {
    const or = (key: string, fallback: string) => has(key) ? key : fallback
    return problems.map(problem => ({
        ...problem,
        errorClass: classOf.get(problem.error) ?? null,
        action: or(`problems.action.${problem.command}`, "problems.action.other"),
        reason: or(`problems.reason.${problem.error}`, "problems.reason.other"),
    }))
}
