/**
 * The locale to suggest: walk the reader's language list in order and stop at the first one the
 * page can show. Nothing to suggest when that is the page's own language.
 */
export function pickLocale(languages: readonly string[], current: string, available: readonly string[]): string | undefined {
    for (const tag of languages) {
        const base = tag.toLowerCase().split("-")[0]!
        if (base === current) return undefined
        if (available.includes(base)) return base
    }
    return undefined
}
