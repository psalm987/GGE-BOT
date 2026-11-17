import { readFileSync } from "node:fs"
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

// WCAG AA: 4.5:1 for text (status labels and error messages are small text),
// 3:1 for icons and borders.
test.each([
    ["body text", palette.parchment, 4.5],
    ["secondary text", palette.muted, 4.5],
    ["gold links and selected nav", palette.gold, 4.5],
    ["running label", palette.emeraldText, 4.5],
    ["starting label", palette.azureText, 4.5],
    ["wrong-password label", palette.amber, 4.5],
    ["error, banned and danger text", palette.crimsonText, 4.5],
    ["status icons and borders: emerald", palette.emerald, 3],
    ["status icons and borders: azure", palette.azure, 3],
    ["status icons and borders: crimson", palette.crimson, 3],
])("%s is readable on every ground", (_, color, minimum) => {
    for (const [name, ground] of Object.entries(grounds))
        expect(contrast(color, ground), `${color} on ${name}`).toBeGreaterThanOrEqual(minimum)
})

test("text on filled buttons is readable: primary on gold, danger on crimson", () => {
    expect(contrast("#1A130D", palette.gold)).toBeGreaterThanOrEqual(4.5)
    expect(contrast("#1A130D", palette.crimsonText)).toBeGreaterThanOrEqual(4.5)
})

// Tags show in the terminal and in the tag filter's list, which opens on `raised`.
const logGrounds = { terminal: palette.terminal, raised: palette.raised, surface: palette.surface }
test.each([
    ...palette.tags.map((hue, i) => [`tag hue ${i}`, hue] as const),
    ["info level", palette.levelInfo],
    ["warning level", palette.levelWarn],
    ["error level", palette.levelError],
    ["not-now level", palette.levelNotNow],
    ["log time and day dividers", palette.muted],
])("%s is readable as log text", (_, color) => {
    for (const [name, ground] of Object.entries(logGrounds))
        expect(contrast(color, ground), `${color} on ${name}`).toBeGreaterThanOrEqual(4.5)
})

test("the terminal ground is a step darker than the cards it sits among", () => {
    expect(luminance(palette.terminal)).toBeLessThan(luminance(palette.surface))
})

test("the stylesheet's log colours are the palette's", () => {
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8")
    const cssVar = (name: string) => css.match(new RegExp(`--gge-${name}:\\s*(#[0-9A-Fa-f]{6});`))?.[1]?.toUpperCase()
    expect(cssVar("terminal")).toBe(palette.terminal)
    expect(cssVar("muted")).toBe(palette.muted)
    expect([cssVar("level-info"), cssVar("level-warn"), cssVar("level-error"), cssVar("level-notnow")]).toEqual([palette.levelInfo, palette.levelWarn, palette.levelError, palette.levelNotNow])
    expect(palette.tags.map((_, i) => cssVar(`tag-${i}`))).toEqual([...palette.tags])
})

test.each(Object.entries(palette.banner))("the %s banner reads clearly on its ground", (_, { accent, ground }) => {
    expect(contrast(palette.parchment, ground)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(palette.gold, ground), "the action button").toBeGreaterThanOrEqual(4.5)
    expect(contrast(accent, ground), "the rule and icon").toBeGreaterThanOrEqual(3)
})

test("the stylesheet's banner colours are the palette's", () => {
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8")
    const cssVar = (name: string) => css.match(new RegExp(`--gge-${name}:\\s*(#[0-9A-Fa-f]{6});`))?.[1]?.toUpperCase()
    for (const [severity, { accent, ground }] of Object.entries(palette.banner))
        expect([cssVar(`banner-${severity}`), cssVar(`banner-${severity}-ground`)]).toEqual([accent, ground])
})
