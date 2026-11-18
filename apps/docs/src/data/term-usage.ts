// Reads Markdoc source with a real parse to find where terms are tagged and where a registered term is used without a tag.
import Markdoc, { type Node } from "@markdoc/markdoc"
import { termForms, type TermEntry } from "./terms.ts"

export type Untagged = { id: string; found: string; line: number }

/** Text in these is a heading, a link label, code, or a UI name the page shows in bold, so no popover belongs there. */
const SKIPPED = new Set(["heading", "link", "code", "fence", "strong"])

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** A term or alias as a whole word, with an optional plural ending. */
const formPattern = (term: TermEntry) =>
    new RegExp(`(?<![\\p{L}\\p{N}])(?:${termForms(term).map(escape).join("|")})(?:es|s)?(?![\\p{L}\\p{N}])`, "iu")

export const parseDoc = (source: string) => Markdoc.parse(source)

/** Each `term` tag in the document, in order. */
export function termTags(source: string): string[] {
    const ids: string[] = []
    for (const node of parseDoc(source).walk())
        if (node.type === "tag" && node.tag === "term" && typeof node.attributes.id === "string") ids.push(node.attributes.id)
    return ids
}

/** The first use of each registered term in body text must sit inside a `term` tag for that term. This lists the ones that do not. */
export function untaggedFirstUses(source: string, terms: TermEntry[]): Untagged[] {
    const patterns = terms.map(term => ({ id: term.id, pattern: formPattern(term) }))
    const seen = new Set<string>()
    const found: Untagged[] = []

    const visit = (node: Node, skipped: boolean, taggedAs: string | null) => {
        if (node.type === "text") {
            const content = String(node.attributes.content ?? "")
            for (const { id, pattern } of patterns) {
                if (seen.has(id)) continue
                if (taggedAs === id) seen.add(id)
                else if (!skipped && taggedAs === null) {
                    const match = pattern.exec(content)
                    if (match) {
                        seen.add(id)
                        found.push({ id, found: match[0], line: (node.lines[0] ?? 0) + 1 })
                    }
                }
            }
            return
        }
        const tagged = node.type === "tag" && node.tag === "term" ? String(node.attributes.id ?? "") : taggedAs
        const skip = skipped || SKIPPED.has(node.type)
        for (const child of node.children) visit(child, skip, tagged)
    }
    visit(parseDoc(source), false, null)
    return found
}
