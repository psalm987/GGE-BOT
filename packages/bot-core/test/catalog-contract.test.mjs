import { createRequire } from "node:module"
import { execSync } from "node:child_process"
import path from "node:path"
import { test, expect } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, repo } = require("./harness/load.cjs")

const plugins = execSync("git ls-files plugins", { cwd: repo }).toString().trim().split("\n")
    .filter(f => !f.endsWith("plugins/index.js"))

test.each(plugins)("%s publishes a catalog entry the API accepts", relPath => {
    const mod = loadModule(relPath, { mainThread: true }).mod
    const entry = {
        key: path.basename(relPath, ".js"),
        force: Boolean(mod.force),
        hidden: Boolean(mod.hidden),
        options: mod.pluginOptions ?? [],
    }
    expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
})
