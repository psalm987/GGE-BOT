/**
 * Reads options stored before a plugin's Selects existed, the way @gge/contracts' `readLegacy` does: a Select with a
 * `legacy` rule gets its choice from the options it replaced, unless a choice is stored already, and a Number that was
 * a Text reads its stored string as a number, and a Rows castle column with `legacyKingdom` reads a row's old kingdom
 * as that kingdom's main castle. The runner hands a bot
 * options read this way; a config that reaches a plugin as it was stored is read here.
 * test/legacy-options-contract.test.mjs holds the two to the same answers.
 */
/** A castle ref with this id stands for the kingdom's main castle (MAIN_CASTLE in @gge/contracts). */
const MAIN_CASTLE = -1

function readLegacy(defs, stored) {
    const out = { ...stored }
    const current = new Set(defs.map(def => def.key))
    for (const def of defs) {
        if (def.type == "Rows" && Array.isArray(stored[def.key])) {
            const column = def.columns.find(c => c.type == "castle" && c.legacyKingdom)
            if (column)
                out[def.key] = stored[def.key].map(row => {
                    if (row[column.key] !== undefined || typeof row[column.legacyKingdom] != "number")
                        return row
                    const { [column.legacyKingdom]: kingdom, ...rest } = row
                    return { ...rest, [column.key]: { kingdom, id: MAIN_CASTLE } }
                })
            continue
        }
        if (def.type == "Number" && def.legacy == "text" && typeof stored[def.key] == "string") {
            const text = stored[def.key].trim()
            if (text === "" || !Number.isFinite(Number(text)))
                delete out[def.key]
            else
                out[def.key] = Math.min(Math.max(Number(text), def.min), def.max)
            continue
        }
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

module.exports = { readLegacy, MAIN_CASTLE }
