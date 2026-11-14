import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"
import { describe, test, expect } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, repo } = require("./harness/load.cjs")

// Each entry is an option a plugin reads under a key it never declares, so the
// panel can't set it and the code always sees undefined. Fixing one flips its
// test.fails to failing; then delete the entry.
const KNOWN_UNDECLARED = {
    "plugins/attack/attackKhan.js": ["nomadsScoreShutoff"],
    "plugins/attack/attackNomads.js": ["nomadsScoreShutoff"],
    "plugins/attack/attackBerimondInvasion.js": ["noeventTools"],
    "plugins/discord/incomingAttacks.js": ["channelAquaAlert"],
}

const plugins = execSync("git ls-files plugins", { cwd: repo })
    .toString().trim().split("\n")
    .filter(f => !f.endsWith("plugins/index.js"))
    // Requires main.js in the main thread, which boots a second server. Deleted in Phase 1.
    .filter(f => !f.endsWith("plugins/intervalTimer.js"))

function optionKeysRead(source) {
    const code = source.split("\n").filter(line => !line.trim().startsWith("//")).join("\n")
    const dotted = [...code.matchAll(/(?<!module\.exports\.)\bpluginOptions\??\.(\w+)/g)].map(m => m[1])
    const indexed = [...code.matchAll(/\bpluginOptions\[["'](\w+)["']\]/g)].map(m => m[1])
    return new Set([...dotted, ...indexed])
}

function optionKeysDeclared(relPath, source) {
    const exported = loadModule(relPath, { mainThread: true }).mod.pluginOptions ?? []
    const conditional = [...source.matchAll(/\bkey:\s*["'](\w+)["']/g)].map(m => m[1])
    return new Set([...exported.map(o => o.key), ...conditional])
}

describe("every option a plugin reads is one it declares", () => {
    for (const relPath of plugins) {
        const source = readFileSync(path.join(repo, relPath), "utf8")
        const known = KNOWN_UNDECLARED[relPath] ?? []
        const check = () => {
            const declared = optionKeysDeclared(relPath, source)
            const undeclared = [...optionKeysRead(source)].filter(key => !declared.has(key))
            expect(undeclared).toEqual([])
        }
        if (known.length)
            test.fails(`${relPath} (known bug: reads ${known.join(", ")})`, check)
        else
            test(relPath, check)
    }
})
