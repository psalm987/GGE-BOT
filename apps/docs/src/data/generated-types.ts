/** The small, typed shapes `scripts/generate.ts` writes to src/generated/*.json. */

export type ErrorEntry = {
    code: string
    /** "app" codes come from the API's errors.json. "bot" codes come from bot-core's own catalog. */
    source: "app" | "bot"
    /** What the app says, one text per variant (a plan limit has one for each situation). */
    messages: string[]
}

export type AlertEntry = {
    /** The notification kind, such as `crash_loop` or `station_result.stationed`. */
    id: string
    title: string
    body: string[]
}

export type OptionKind = "text" | "number" | "toggle" | "choice" | "list" | "table" | "castle" | "channel"

export type OptionDoc = {
    key: string
    kind: OptionKind
    default?: string | number | boolean
    min?: number
    max?: number
    step?: number
    unit?: string
    choices?: string[]
    /** What a list picks from, such as troops or tools. */
    catalog?: string
}

export type PluginDoc = {
    key: string
    force: boolean
    hidden: boolean
    attack: boolean
    options: OptionDoc[]
}

/** Option label by locale, then option key. Only the keys that plugin options use. */
export type OptionLabels = Record<string, Record<string, string>>

/** App labels by locale, then `namespace:key`. */
export type UiLabels = Record<string, Record<string, string>>

/** `{{count}}` and `{{until, when}}` read as [count] and [until] on a docs page. */
export const plainPlaceholders = (text: string) => text.replace(/\{\{-?\s*([\w.]+)[^}]*\}\}/g, "[$1]")

/** An error code or notification kind as a URL fragment: `TOO_MANY_ATTACK_PLUGINS` becomes `too-many-attack-plugins`. */
export const anchorOf = (code: string) => code.toLowerCase().replace(/[^a-z0-9]+/g, "-")
