// llms.txt and llms-full.txt, built straight from the Markdoc sources. English only, plain Markdown.
import Markdoc, { type Node } from "@markdoc/markdoc"
import { plainPlaceholders } from "../data/generated-types.ts"
import { INTERNAL_CODES } from "../data/internal-codes.ts"
import { readFixes, readGenerated, readTerms } from "../data/registry-files.ts"
import { uiLabel } from "../data/ui-labels.ts"
import { sidebar } from "../theme/sidebar.ts"
import { APP_NAME, SITE_URL } from "./jsonld.ts"

export const SUMMARY = "Player guides for GGE Command, the bot that plays Goodgame Empire for you while you are away."

const ASIDE_LABEL = { tip: "Pro tip", caution: "Heads up", danger: "Danger zone", note: "Lore" } as const

const absolute = (href: string) => (href.startsWith("/") ? new URL(href, SITE_URL).href : href)
const quote = (text: string) => text.split("\n").map(line => (line ? `> ${line}` : ">")).join("\n")
const asText = (value: unknown) => String(value)

/** What a data-driven tag expands to in plain text. */
function dataBlock(tag: string, attrs: Record<string, unknown>, pageUrl: string): string {
    if (tag === "glossary") {
        return readTerms("en").map(t => `- **${t.term}**${t.aliases.length ? ` (also: ${t.aliases.join(", ")})` : ""}: ${t.short} ${t.long}`).join("\n")
    }
    if (tag === "errors") {
        const fixes = readFixes("errors", "en")
        return readGenerated.errors()
            .filter(e => !INTERNAL_CODES.has(e.code) && (!attrs.source || e.source === attrs.source))
            .map(e => `- \`${e.code}\`: ${e.messages.map(m => plainPlaceholders(m).replace(/\.$/, "")).join(" / ")}. Fix: ${fixes[e.code]?.fix ?? ""}`)
            .join("\n")
    }
    if (tag === "alerts") {
        const fixes = readFixes("alerts", "en")
        return readGenerated.alerts().map(a => `- ${a.title} (\`${a.id}\`): ${a.body.join(" ")} Fix: ${fixes[a.id]?.fix ?? ""}`).join("\n")
    }
    if (tag === "settings") return `The settings table for this plugin is at ${pageUrl}`
    return ""
}

function inline(node: Node, url: string): string {
    return node.children.map(child => render(child, url)).join("")
}

function render(node: Node, url: string): string {
    const kids = () => node.children.map(child => render(child, url))
    switch (node.type) {
        case "document":
            return kids().filter(Boolean).join("\n\n")
        case "heading":
            return `${"#".repeat(Math.min(6, Number(node.attributes.level) + 1))} ${inline(node, url).trim()}`
        case "paragraph":
        case "inline":
            return inline(node, url)
        case "text":
            return asText(node.attributes.content)
        case "softbreak":
            return " "
        case "hardbreak":
            return "\n"
        case "strong":
            return `**${inline(node, url)}**`
        case "em":
            return `*${inline(node, url)}*`
        case "code":
            return `\`${asText(node.attributes.content)}\``
        case "fence":
            return `\`\`\`${asText(node.attributes.language ?? "")}\n${asText(node.attributes.content).trimEnd()}\n\`\`\``
        case "link":
            return `[${inline(node, url)}](${absolute(asText(node.attributes.href))})`
        case "hr":
            return "---"
        case "blockquote":
            return quote(kids().join("\n\n"))
        case "list":
            return node.children.map((item, index) => `${node.attributes.ordered ? `${index + 1}.` : "-"} ${render(item, url).replace(/\n/g, "\n  ")}`).join("\n")
        case "item":
            return kids().join("\n")
        case "tag":
            return renderTag(node, url)
        default:
            return kids().join(" ")
    }
}

function renderTag(node: Node, url: string): string {
    const tag = asText(node.tag)
    const body = () => node.children.map(child => render(child, url)).join(node.inline ? "" : "\n\n")
    switch (tag) {
        case "aside":
            return quote(`**${ASIDE_LABEL[asText(node.attributes.type) as keyof typeof ASIDE_LABEL] ?? "Note"}.** ${body()}`)
        case "sidenote":
            return ` (${body()})`
        case "term":
            return body()
        case "ui": {
            const label = uiLabel("en", asText(node.attributes.key))
            return `**${label === undefined ? asText(node.attributes.key) : plainPlaceholders(label)}**`
        }
        case "status":
            return `(${asText(node.attributes.kind)})`
        case "plan_gate":
            return process.env.BILLING_LIVE === "1" ? body() : "Plans do not limit anything yet."
        case "terms_on_page":
            return ""
        default:
            return dataBlock(tag, node.attributes, url)
    }
}

/** A Markdoc page as plain Markdown. Headings move down one level so the page title can be the H1. */
export function markdocToMarkdown(source: string, pageUrl: string): string {
    return render(Markdoc.parse(source), pageUrl).replace(/\n{3,}/g, "\n\n").trim()
}

export type LlmsPage = { slug: string; title: string; description: string; body: string }

const urlOf = (slug: string) => new URL(slug === "index" ? "/" : `/${slug}/`, SITE_URL).href

/** Pages in sidebar order, the home page first. Pages outside the sidebar follow. */
export function ordered(pages: LlmsPage[]): LlmsPage[] {
    const rank = new Map(sidebar.flatMap(group => group.items).map((item, index) => [item.slug, index + 1]))
    return [...pages].sort((a, b) => (a.slug === "index" ? 0 : (rank.get(a.slug) ?? 99)) - (b.slug === "index" ? 0 : (rank.get(b.slug) ?? 99)))
}

const header = (full: boolean) => `# ${APP_NAME}\n\n> ${SUMMARY}\n\n${full ? "This file holds the full text of every English page." : "Each link is an English page."}`

export function llmsIndex(pages: LlmsPage[]): string {
    const bySlug = new Map(pages.map(page => [page.slug, page]))
    const line = (page: LlmsPage) => `- [${page.title}](${urlOf(page.slug)}): ${page.description}`
    const sections = sidebar.map(group => {
        const items = group.items.map(item => bySlug.get(item.slug)).filter((page): page is LlmsPage => page !== undefined)
        return `## ${group.label}\n\n${items.map(line).join("\n")}`
    })
    const home = bySlug.get("index")
    return `${header(false)}\n\n${home ? `${line(home)}\n\n` : ""}${sections.join("\n\n")}\n`
}

export function llmsFull(pages: LlmsPage[]): string {
    const docs = ordered(pages).map(page => `# ${page.title}\n\nSource: ${urlOf(page.slug)}\n\n${markdocToMarkdown(page.body, urlOf(page.slug))}`)
    return `${header(true)}\n\n${docs.join("\n\n---\n\n")}\n`
}
