import { createRequire } from "node:module"
import { I18n } from "i18n"

const require = createRequire(import.meta.url)
const { locales } = require("@gge/bot-core/paths.js") as { locales: string }

/** Renders a worker's log parts in English, the way ggeBot.js prints them. */
export function createLogRenderer() {
    const i18n = new I18n({ locales: ["en"], defaultLocale: "en", directory: locales, updateFiles: false })
    return (parts: unknown) => Array.isArray(parts)
        ? parts.map(part => typeof part === "string" ? i18n.__(part) : String(part)).join("")
        : String(parts)
}

/** The plugin key or core script name a worker's log line came from: ggeBot.js sends `[time] [name] ...`. */
export function logTag(parts: unknown): string | null {
    if (!Array.isArray(parts) || parts[1] !== "[")
        return null
    const tag = parts[2]
    return typeof tag === "string" && tag ? tag : null
}
