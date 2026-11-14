import { expect, test } from "vitest"
import { palette } from "../src/theme.ts"

const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi! + 0.05) / (lo! + 0.05)
}

const grounds = { ink: palette.ink, surface: palette.surface, raised: palette.raised, sider: palette.sider }

// WCAG AA: 4.5:1 for body text, 3:1 for large text and UI glyphs such as status sigils.
test.each([
    ["body text", palette.parchment, 4.5],
    ["secondary text", palette.muted, 4.5],
    ["gold links and selected nav", palette.gold, 4.5],
    ["emerald status", palette.emerald, 3],
    ["azure status", palette.azure, 3],
    ["amber status", palette.amber, 3],
    ["crimson status and danger text", palette.crimson, 3],
])("%s is readable on every ground", (_, color, minimum) => {
    for (const [name, ground] of Object.entries(grounds))
        expect(contrast(color, ground), `${color} on ${name}`).toBeGreaterThanOrEqual(minimum)
})

test("primary button text is readable on gold", () => {
    expect(contrast("#1A130D", palette.gold)).toBeGreaterThanOrEqual(4.5)
})
