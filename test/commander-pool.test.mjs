import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test, expect } from "vitest"

// The fast layer of verification/commander-pool/check.sh. The TLC layer runs
// under `pnpm test:formal`.
const conformance = fileURLToPath(new URL("../verification/commander-pool/conformance.js", import.meta.url))
const observed = JSON.parse(execFileSync(process.execPath, [conformance]).toString())

const facts = [
    "fastPathMarksUsed",
    "waitsWhenAllUsed",
    "freeWakesFirstWaiterOnly",
    "freeUnusedIsNoop",
    "returnFrees",
    "laterReacquireWaits",
]

for (const fact of facts)
    test(`commander.js: ${fact}`, () => expect(observed[fact]).toBe(true))

test.fails("known bug: a same-run re-acquire never takes the commander just handed to a waiter (commander.js:81-96)", () => {
    expect(observed.sameRunReacquireGetsWokenCommander).toBe(false)
})
