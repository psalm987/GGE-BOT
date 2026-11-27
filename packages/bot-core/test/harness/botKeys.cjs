const fs = require("node:fs")
const path = require("node:path")
const acorn = require("acorn")

const botCore = path.resolve(__dirname, "..", "..")
const repoRoot = path.resolve(botCore, "..", "..")
const OPTION_TYPES = new Set(["Label", "Text", "Checkbox", "Select", "Channel", "Number", "OrderedList", "Rows", "CastlePicker"])

/** Console methods whose arguments reach the dashboard's log, each part through the bot catalog. */
const LOGGING = new Set(["log", "info", "warn", "error", "notNow"])

/** Source files of the bot, without tests, vendored code or the catalogs themselves. */
function sourceFiles(dir = botCore) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory())
            return ["node_modules", "test", "locales", "verification", "assets"].includes(entry.name) ? [] : sourceFiles(full)
        return entry.name.endsWith(".js") ? [full] : []
    })
}

/** Visits every node; a visitor that returns false keeps the walk out of that node's children. */
function walk(node, visit) {
    if (!node || typeof node.type !== "string")
        return
    if (visit(node) === false)
        return
    for (const value of Object.values(node))
        if (Array.isArray(value))
            value.forEach(child => walk(child, visit))
        else if (value && typeof value === "object")
            walk(value, visit)
}

function parse(file) {
    return acorn.parse(fs.readFileSync(file, "utf8"), { ecmaVersion: "latest", allowReturnOutsideFunction: true, locations: true, allowHashBang: true })
}

const text = node => node?.type === "Literal" && typeof node.value === "string" ? node.value : null
const where = (file, node) => `${path.relative(botCore, file)}:${node.loc.start.line}`
/** A literal that is only punctuation or spacing joins numbers and names in a log line and is not a key. */
const isFiller = value => !/[A-Za-z]/.test(value) || value === "C" || value === "TIMED_OUT"

/** An option definition written as an object literal: its key, and the strings of a Select's `selection`. */
function optionObject(node, add, options, choices) {
    const field = name => node.properties.find(p => p.type === "Property" && (p.key.name ?? p.key.value) === name)?.value
    const type = text(field("type"))
    const key = text(field("key"))
    if (!OPTION_TYPES.has(type) || key === null)
        return
    add(options, key, "option")
    for (const choice of field("selection")?.elements ?? [])
        if (text(choice) !== null)
            add(choices, text(choice), `${key} choice`)
}

/** String tokens of the runner and contracts sources, which name refusals such as TOO_MANY_ATTACK_PLUGINS, and of the dev stack's Settings preview plugin. */
function externalLiterals() {
    const files = [path.join(repoRoot, "tools/dev/dev.ts")]
    for (const dir of ["apps/runner/src", "packages/contracts/src"]) {
        const root = path.join(repoRoot, dir)
        const stack = [root]
        while (stack.length)
            for (const entry of fs.readdirSync(stack.pop(), { withFileTypes: true, recursive: false }))
                entry.isDirectory() ? stack.push(path.join(entry.parentPath, entry.name)) : /\.(ts|tsx|js)$/.test(entry.name) && files.push(path.join(entry.parentPath, entry.name))
    }
    return new Set(files.flatMap(file => [...fs.readFileSync(file, "utf8").matchAll(/["'`]([A-Za-z_]\w*)["'`]/g)].map(m => m[1])))
}

/**
 * What the source says it will show a player, each with where it was found:
 * - `logs`: string arguments of console.log/info/warn/error/notNow, and messages of thrown errors, which the logger prints.
 * - `statuses`: a status reason, by a reportStatus call or by the `status…` naming of its table.
 * - `literals`: every string in the source, for finding keys that are only built dynamically.
 */
function collectSourceKeys() {
    const logs = new Map()
    const statuses = new Map()
    const literals = new Set()
    const raw = []
    const options = new Map()
    const choices = new Map()
    const add = (map, key, spot) => map.set(key, [...(map.get(key) ?? []), spot])
    /** The legacy host writes its own console lines, so only the keys it looks up count. */
    const host = path.join(repoRoot, "main.js")
    for (const file of [...sourceFiles(), host]) {
        walk(parse(file), node => {
            if (file === host) {
                if (node.type === "CallExpression" && node.callee.property?.name === "__" && text(node.arguments[0]) !== null)
                    add(logs, text(node.arguments[0]), where(file, node))
                return
            }
            if (node.type === "CallExpression" && node.callee.type === "MemberExpression" && node.callee.object.name === "console"
                && ["debug", "trace"].includes(node.callee.property.name))
                return false
            const value = text(node)
            if (value !== null) {
                literals.add(value)
                if (/^status[A-Z]\w*$/.test(value))
                    add(statuses, value, where(file, node))
            }
            if (node.type === "ObjectExpression")
                optionObject(node, add, options, choices)
            if (node.type !== "CallExpression" && node.type !== "NewExpression")
                return
            const callee = node.callee
            if (callee.type === "MemberExpression" && callee.property.name === "__" && text(node.arguments[0]) !== null)
                add(logs, text(node.arguments[0]), where(file, node))
            const logged = callee.type === "MemberExpression" && callee.object.name === "console" && LOGGING.has(callee.property.name)
            const reported = callee.type === "Identifier" && callee.name === "reportStatus"
            const thrown = node.type === "NewExpression" && callee.name === "Error"
            const args = thrown ? node.arguments.slice(0, 1) : reported ? node.arguments.slice(1, 2) : node.arguments
            if (!logged && !reported && !thrown)
                return
            for (const arg of args) {
                const key = text(arg)
                if (key !== null && !isFiller(key))
                    add(reported ? statuses : logs, key, where(file, arg))
                if (arg.type === "TemplateLiteral" && logged && arg.quasis.some(q => /[A-Za-z]/.test(q.value.cooked)))
                    raw.push(where(file, arg))
            }
        })
    }
    return { logs, statuses, options, choices, literals, templateLogs: raw }
}

/** Every option of a plugin as the settings dialog reads it: the keys it translates and the choices of each Select and choice column. */
function optionKeys(options) {
    const keys = new Set()
    const choices = new Set()
    for (const def of options)
        if (def.key) {
            keys.add(def.key)
            for (const column of def.columns ?? []) {
                keys.add(column.key)
                for (const choice of column.selection ?? [])
                    choices.add(choice)
            }
            for (const choice of def.selection ?? [])
                choices.add(choice)
        }
    return { keys, choices }
}

module.exports = { botCore, collectSourceKeys, optionKeys, externalLiterals, sourceFiles }
