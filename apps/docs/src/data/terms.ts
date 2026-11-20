import { z } from "astro/zod"
import { isIcon } from "./icons.ts"

export const TERM_CATEGORIES = ["game", "bot", "account", "tech"] as const
export type TermCategory = (typeof TERM_CATEGORIES)[number]

export const SHORT_MAX_WORDS = 25

const kebab = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase words joined by dashes")
const markdocSafe = (text: string) => !/\{%|%\}|\{\{|\}\}/.test(text)
const words = (text: string) => text.trim().split(/\s+/).length

export const TermEntry = z.object({
    id: kebab,
    term: z.string().min(1).refine(markdocSafe, "no tags or placeholders"),
    aliases: z.array(z.string().min(1)).default([]),
    category: z.enum(TERM_CATEGORIES),
    short: z.string().min(1).refine(text => words(text) <= SHORT_MAX_WORDS, `short is at most ${SHORT_MAX_WORDS} words`).refine(markdocSafe, "no tags or placeholders"),
    long: z.string().min(1).refine(markdocSafe, "no tags or placeholders"),
    /** The id of a house icon (packages/ui/src/icons) shown in the popover and the glossary. */
    image: z.string().refine(isIcon, "not an icon id in packages/ui/src/icons/credits.json").optional(),
    seeAlso: z.array(kebab).default([]),
    /** The key in the game's own language file, so each locale shows the name the game shows. */
    gameKey: z.string().optional(),
})
export type TermEntry = z.infer<typeof TermEntry>

/** One locale's terms. `src/content/terms/<locale>.yaml`. */
export const TermFile = z.object({ terms: z.array(TermEntry) }).refine(
    file => new Set(file.terms.map(t => t.id)).size === file.terms.length,
    "term ids must be unique",
)
export type TermFile = z.infer<typeof TermFile>

/** A locale's own entries, then English for every term it does not translate yet. */
export function mergeTerms(english: TermEntry[], local: TermEntry[]): TermEntry[] {
    const own = new Map(local.map(t => [t.id, t]))
    return english.map(t => own.get(t.id) ?? t)
}

/** Every way a term can appear in text: its name and its aliases. */
export const termForms = (term: Pick<TermEntry, "term" | "aliases">) => [term.term, ...term.aliases]
