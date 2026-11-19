/**
 * Reads options stored before a plugin's Selects existed, the way @gge/contracts' `readLegacy` does: a Select with a
 * `legacy` rule gets its choice from the options it replaced, unless a choice is stored already. The runner hands a bot
 * options read this way; a config that reaches a plugin as it was stored is read here.
 * test/legacy-options-contract.test.mjs holds the two to the same answers.
 */
function readLegacy(defs, stored) {
    const out = { ...stored }
    const current = new Set(defs.map(def => def.key))
    for (const def of defs) {
        if (def.type != "Select" || !def.legacy)
            continue
        const { from, cases, otherwise } = def.legacy
        const old = name => stored[name] ?? from[name]
        if (typeof stored[def.key] != "number" && Object.keys(from).some(name => stored[name] !== undefined))
            out[def.key] = cases.find(([when]) => Object.entries(when).every(([name, value]) => old(name) === value))?.[1] ?? otherwise
        for (const name of Object.keys(from))
            if (!current.has(name))
                delete out[name]
    }
    return out
}

module.exports = { readLegacy }
