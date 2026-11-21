import { readFileSync } from "node:fs"
import { expect, test } from "vitest"
import { palette } from "../src/palette.ts"

type Rgb = [number, number, number]
const rgb = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Rgb
const luminance = (hex: string) => {
    const [r, g, b] = rgb(hex).map(c => c / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) as Rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
    return (hi + 0.05) / (lo + 0.05)
}
/** `top` drawn at `alpha` over `under`, as the stylesheet's rgba tints are. */
const over = (top: string, under: string, alpha: number) =>
    "#" + rgb(top).map((c, i) => Math.round(c * alpha + rgb(under)[i]! * (1 - alpha)).toString(16).padStart(2, "0")).join("")

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8")
const cssVar = (name: string) => css.match(new RegExp(`--gge-${name}:\\s*(#[0-9A-Fa-f]{6});`))?.[1]?.toUpperCase()
const kebab = (key: string) => key.replace(/[A-Z]/g, c => "-" + c.toLowerCase())

const grounds = { ground: palette.ground, surface: palette.surface, raised: palette.raised }

// WCAG AA: 4.5:1 for text (status labels and error messages are small text), 3:1 for icons, borders and focus rings.
test.each([
    ["body text", palette.text, 4.5],
    ["headings", palette.heading, 4.5],
    ["secondary text", palette.muted, 4.5],
    ["links, selected tabs and the selected option", palette.accent, 4.5],
    ["running label", palette.emerald, 4.5],
    ["starting label", palette.azure, 4.5],
    ["wrong-password and waiting label", palette.amber, 4.5],
    ["error, banned and danger text", palette.crimson, 4.5],
    ["danger words under the pointer", palette.crimsonDeep, 4.5],
    ["links and green words under the pointer", palette.primaryDeep, 4.5],
    ["sleeping label", palette.dusk, 4.5],
    ["field and default button edges", palette.control, 3],
    ["the focus ring", palette.accent, 3],
    ["progress fills", palette.primary, 3],
])("%s is readable on every ground", (_, color, minimum) => {
    for (const [name, ground] of Object.entries(grounds))
        expect(contrast(color, ground), `${color} on ${name}`).toBeGreaterThanOrEqual(minimum)
})

test("the fresh green is only for icons and large shapes on the white cards", () => {
    expect(contrast(palette.fresh, palette.surface)).toBeGreaterThanOrEqual(3)
})

test("text on filled buttons is readable: white on the action green and on danger", () => {
    for (const fill of [palette.primary, palette.primaryDeep, palette.crimson])
        expect(contrast("#FFFFFF", fill), fill).toBeGreaterThanOrEqual(4.5)
})

test.each(Object.entries(grounds))("text and links stay readable on the selected and hovered tint over %s", (_, ground) => {
    for (const alpha of [0.05, 0.06, 0.08, 0.1, 0.12]) {
        const tinted = over(palette.primary, ground, alpha)
        expect(contrast(palette.text, tinted), `text on ${alpha}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(palette.muted, tinted), `muted on ${alpha}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(palette.accent, tinted), `accent on ${alpha}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(palette.crimson, tinted), `danger on ${alpha}`).toBeGreaterThanOrEqual(4.5)
    }
})

test("the emerald sidebar: its words, the current page, hover and focus", () => {
    const current = over("#FFFFFF", palette.nav, 0.14)
    const hover = over("#FFFFFF", palette.nav, 0.08)
    expect(contrast(palette.navText, palette.nav), "product name and links").toBeGreaterThanOrEqual(4.5)
    expect(contrast(palette.navMuted, palette.nav), "resting links and group names").toBeGreaterThanOrEqual(4.5)
    expect(contrast(palette.navText, current), "the current page").toBeGreaterThanOrEqual(4.5)
    expect(contrast(palette.navText, hover), "a hovered link").toBeGreaterThanOrEqual(4.5)
    expect(contrast(palette.navMuted, hover), "a hovered group name").toBeGreaterThanOrEqual(4.5)
    expect(contrast(palette.navAccent, current), "the current page's bar").toBeGreaterThanOrEqual(3)
    expect(contrast(palette.navText, palette.nav), "the focus ring").toBeGreaterThanOrEqual(3)
})

// Tags show in the terminal and in the tag filter's list, which opens on a white popup.
const logGrounds = { terminal: palette.terminal, raised: palette.raised, surface: palette.surface }
test.each([
    ...palette.tags.map((hue, i) => [`tag hue ${i}`, hue] as const),
    ["info level", palette.levelInfo],
    ["warning level", palette.levelWarn],
    ["error level", palette.levelError],
    ["not-now level", palette.levelNotNow],
    ["log time and day dividers", palette.muted],
    ["log message text", palette.text],
])("%s is readable as log text", (_, color) => {
    for (const [name, ground] of Object.entries(logGrounds))
        expect(contrast(color, ground), `${color} on ${name}`).toBeGreaterThanOrEqual(4.5)
})

test("an error row's tint keeps the error words readable", () => {
    const row = over(palette.crimson, palette.terminal, 0.05)
    expect(contrast(palette.levelError, row)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(palette.text, row)).toBeGreaterThanOrEqual(4.5)
})

test("the terminal ground sets itself off from the white cards it sits among", () => {
    expect(luminance(palette.terminal)).toBeLessThan(luminance(palette.surface))
})

test.each(Object.entries(palette.banner))("the %s banner reads clearly on its ground", (_, { accent, ground }) => {
    expect(contrast(palette.text, ground)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(palette.accent, ground), "a link-style action").toBeGreaterThanOrEqual(4.5)
    expect(contrast(accent, ground), "the rule and icon").toBeGreaterThanOrEqual(3)
})

test("every palette colour is a stylesheet variable of the same value", () => {
    for (const [key, value] of Object.entries(palette)) {
        if (typeof value === "string") expect(cssVar(kebab(key)), key).toBe(value)
    }
    expect(palette.tags.map((_, i) => cssVar(`tag-${i}`))).toEqual([...palette.tags])
    for (const [severity, { accent, ground }] of Object.entries(palette.banner))
        expect([cssVar(`banner-${severity}`), cssVar(`banner-${severity}-ground`)]).toEqual([accent, ground])
})

// antd's pale preset tag grounds (its colour-1 shades), under the stylesheet's darker words.
test.each([
    ["green", palette.emerald, "#F6FFED"],
    ["red", palette.crimson, "#FFF1F0"],
    ["gold", palette.amber, "#FFFBE6"],
    ["orange", palette.amber, "#FFF7E6"],
    ["blue", palette.azure, "#E6F4FF"],
])("a %s tag's words are readable on its ground", (preset, color, ground) => {
    expect(contrast(color, ground)).toBeGreaterThanOrEqual(4.5)
    expect(css).toMatch(new RegExp(`\\.ant-tag-${preset}[^{]*\\{ color: var\\(--gge-[a-z]+\\) !important; \\}`))
})
