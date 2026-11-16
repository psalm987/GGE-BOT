import { createRequire } from "node:module"
import { expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { boxMullerRandom } = require("../pacing.js")

test("samples stay inside the range and cover most of it", () => {
    const samples = Array.from({ length: 10_000 }, () => boxMullerRandom(2000, 6000))
    const lo = Math.min(...samples), hi = Math.max(...samples)
    expect(lo).toBeGreaterThanOrEqual(2000)
    expect(hi).toBeLessThanOrEqual(6000)
    expect(hi - lo).toBeGreaterThanOrEqual(0.8 * 4000)
})
