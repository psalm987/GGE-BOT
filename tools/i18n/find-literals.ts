import { readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { API } from "typescript/unstable/sync"
import { SyntaxKind } from "typescript/unstable/ast"
import type { Node } from "typescript/unstable/ast"

export type Literal = { file: string, line: number, text: string }

export const PROJECTS = [
    { tsconfig: "apps/client/tsconfig.json", scope: "apps/client/src" },
    { tsconfig: "apps/admin/tsconfig.json", scope: "apps/admin/src" },
    { tsconfig: "packages/ui/tsconfig.json", scope: "packages/ui/src" },
]

const TEXT_PROPS = new Set([
    "title", "label", "placeholder", "aria-label", "alt", "description", "message", "okText", "cancelText", "tooltip", "extra", "help", "emptyText",
])
const CALL_ROOTS = new Set(["message", "notification", "Modal", "modal"])
const CALL_TEXT_PROPS = new Set([...TEXT_PROPS, "content"])
const HAS_LETTER = /\p{L}/u

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const ALLOWLIST_FILE = join(root, "tools", "i18n", "literals-allowlist.txt")

/** One entry per line: a JSON string allowed everywhere, or `path: "text"` allowed in that file. */
export function parseAllowlist(source: string): { global: Set<string>, perFile: Set<string> } {
    const global = new Set<string>()
    const perFile = new Set<string>()
    for (const raw of source.split("\n")) {
        const line = raw.trim()
        if (line === "" || line.startsWith("#")) continue
        const at = line.indexOf(": \"")
        if (line.startsWith("\"")) global.add(JSON.parse(line))
        else if (at > 0) perFile.add(`${line.slice(0, at)}\0${JSON.parse(line.slice(at + 2))}`)
        else throw new Error(`Bad allowlist line: ${line}`)
    }
    return { global, perFile }
}

function stringsOf(node: Node | undefined, out: Node[]): void {
    if (!node) return
    switch (node.kind) {
        case SyntaxKind.StringLiteral:
        case SyntaxKind.NoSubstitutionTemplateLiteral:
        case SyntaxKind.TemplateHead:
        case SyntaxKind.TemplateMiddle:
        case SyntaxKind.TemplateTail:
            out.push(node)
            return
        case SyntaxKind.TemplateExpression: {
            const t = node as unknown as { head: Node, templateSpans: { literal: Node }[] }
            out.push(t.head)
            for (const span of t.templateSpans) out.push(span.literal)
            return
        }
        case SyntaxKind.ConditionalExpression: {
            const c = node as unknown as { whenTrue: Node, whenFalse: Node }
            stringsOf(c.whenTrue, out)
            stringsOf(c.whenFalse, out)
            return
        }
        case SyntaxKind.BinaryExpression: {
            const b = node as unknown as { left: Node, right: Node, operatorToken: { kind: number } }
            const k = b.operatorToken.kind
            if (k === SyntaxKind.AmpersandAmpersandToken || k === SyntaxKind.BarBarToken || k === SyntaxKind.QuestionQuestionToken || k === SyntaxKind.PlusToken) {
                if (k !== SyntaxKind.AmpersandAmpersandToken) stringsOf(b.left, out)
                stringsOf(b.right, out)
            }
            return
        }
        case SyntaxKind.ParenthesizedExpression:
        case SyntaxKind.AsExpression:
        case SyntaxKind.NonNullExpression:
        case SyntaxKind.SatisfiesExpression:
            stringsOf((node as unknown as { expression: Node }).expression, out)
            return
        case SyntaxKind.JsxExpression:
            stringsOf((node as unknown as { expression?: Node }).expression, out)
            return
    }
}

function nameText(name: Node | undefined): string | undefined {
    if (!name) return undefined
    const text = (name as unknown as { text?: string }).text
    return typeof text === "string" ? text : undefined
}

function calleeRoot(expression: Node): string | undefined {
    let node = expression
    while (node.kind === SyntaxKind.PropertyAccessExpression) node = (node as unknown as { expression: Node }).expression
    return node.kind === SyntaxKind.Identifier ? nameText(node) : undefined
}

function visit(node: Node, out: Node[]): void {
    switch (node.kind) {
        case SyntaxKind.JsxText:
            out.push(node)
            break
        case SyntaxKind.JsxAttribute: {
            const a = node as unknown as { name: Node, initializer?: Node }
            const name = a.name.kind === SyntaxKind.JsxNamespacedName ? undefined : nameText(a.name)
            if (name !== undefined && TEXT_PROPS.has(name)) stringsOf(a.initializer, out)
            break
        }
        case SyntaxKind.JsxExpression:
            if (node.parent && (node.parent.kind === SyntaxKind.JsxElement || node.parent.kind === SyntaxKind.JsxFragment)) stringsOf(node, out)
            break
        case SyntaxKind.PropertyAssignment: {
            const p = node as unknown as { name: Node, initializer: Node }
            const name = nameText(p.name)
            if (name !== undefined && TEXT_PROPS.has(name)) stringsOf(p.initializer, out)
            break
        }
        case SyntaxKind.CallExpression: {
            const c = node as unknown as { expression: Node, arguments: Node[] }
            const rootName = calleeRoot(c.expression)
            if (c.expression.kind !== SyntaxKind.PropertyAccessExpression || rootName === undefined || !CALL_ROOTS.has(rootName)) break
            for (const arg of c.arguments) {
                if (arg.kind === SyntaxKind.ObjectLiteralExpression) {
                    for (const prop of (arg as unknown as { properties: Node[] }).properties) {
                        if (prop.kind !== SyntaxKind.PropertyAssignment) continue
                        const p = prop as unknown as { name: Node, initializer: Node }
                        const name = nameText(p.name)
                        if (name !== undefined && CALL_TEXT_PROPS.has(name)) stringsOf(p.initializer, out)
                    }
                } else stringsOf(arg, out)
            }
            break
        }
    }
    node.forEachChild(child => visit(child, out))
}

function textOf(node: Node): string {
    if (node.kind === SyntaxKind.JsxText) return ((node as unknown as { text: string }).text).replace(/\s+/g, " ").trim()
    return (node as unknown as { text: string }).text
}

function lineOf(source: string, pos: number): number {
    let line = 1
    for (let i = 0; i < pos; i++) if (source.charCodeAt(i) === 10) line++
    return line
}

export type ScanOptions = {
    projects?: readonly { tsconfig: string, scope: string }[]
    root?: string
    allowlist?: string
}

/** Every user-visible string literal in the scoped files that is not allowlisted, in file and line order. */
export function findLiterals(options: ScanOptions = {}): Literal[] {
    const base = options.root ?? root
    const projects = options.projects ?? PROJECTS
    const allow = parseAllowlist(readFileSync(options.allowlist ?? ALLOWLIST_FILE, "utf8"))
    const found: Literal[] = []
    const api = new API({ cwd: base })
    try {
        for (const { tsconfig, scope } of projects) {
            const snapshot = api.updateSnapshot({ openProject: join(base, tsconfig) })
            const project = snapshot.getProjects()[0]
            if (!project) throw new Error(`No project for ${tsconfig}`)
            const scopeDir = join(base, scope) + "/"
            const files = project.program.getSourceFileNames()
                .filter(f => f.startsWith(scopeDir) && /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
                .sort()
            for (const file of files) {
                const sourceFile = project.program.getSourceFile(file)
                if (!sourceFile) continue
                const source = readFileSync(file, "utf8")
                const nodes: Node[] = []
                visit(sourceFile as unknown as Node, nodes)
                const rel = relative(base, file)
                const seen = new Set<number>()
                for (const node of nodes) {
                    if (seen.has(node.pos)) continue
                    seen.add(node.pos)
                    const text = textOf(node)
                    if (!HAS_LETTER.test(text) || allow.global.has(text) || allow.perFile.has(`${rel}\0${text}`)) continue
                    const start = node.kind === SyntaxKind.JsxText ? node.pos + (source.slice(node.pos).search(/\S/) || 0) : node.pos
                    found.push({ file: rel, line: lineOf(source, Math.max(start, node.pos)), text })
                }
            }
        }
    } finally {
        api.close()
    }
    return found
}

export function format(literal: Literal): string {
    return `${literal.file}:${literal.line}: ${JSON.stringify(literal.text)}`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const found = findLiterals()
    for (const literal of found) console.log(format(literal))
    if (found.length > 0) {
        console.error(`${found.length} hard-coded user-visible string(s). Move them into packages/i18n/catalogs/en and use t(), or allowlist brand names in tools/i18n/literals-allowlist.txt.`)
        process.exit(1)
    }
    console.log("No hard-coded user-visible strings.")
}
