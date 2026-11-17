import i18n, { type i18n as I18n } from "i18next"

type Issue = { code?: unknown }
type ErrorData = { code?: unknown; params?: unknown; issues?: unknown }

const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null ? value as Record<string, unknown> : {}

/**
 * What to tell the player about a failed call. A refusal the API coded reads from the `errors` catalog in the active language;
 * an input validation error reads by its first issue's code. Anything else keeps the English message the server wrote.
 */
export function messageOf(error: unknown, instance: I18n = i18n): string {
    const { message, data } = record(error) as { message?: unknown; data?: ErrorData }
    const known = (key: string, params: Record<string, unknown>) => instance.exists(key, { ns: "errors", ...params })
    const say = (key: string, params: Record<string, unknown>) => instance.t(key, { ns: "errors", ...params })

    if (typeof data?.code === "string") {
        const params = record(data.params)
        if (known(data.code, params))
            return say(data.code, params)
    }
    const issue = Array.isArray(data?.issues) ? record(data.issues[0] as Issue) : {}
    if (typeof issue.code === "string") {
        const key = `zod.${issue.code}`
        if (known(key, issue))
            return say(key, issue)
    }
    return typeof message === "string" && message ? message : instance.t("error.generic", { ns: "common" })
}
