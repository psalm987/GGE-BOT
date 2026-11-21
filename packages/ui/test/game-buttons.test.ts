import { readFileSync } from "node:fs"
import { expect, test } from "vitest"
import { palette } from "../src/index.ts"

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8")
const token = (name: string) => {
    const hex = css.match(new RegExp(`--gge-btn-${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1]
    if (!hex) throw new Error(`--gge-btn-${name} is not defined`)
    return hex.toUpperCase()
}

const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi! + 0.05) / (lo! + 0.05)
}

test.each(["primary", "default", "danger"])("the %s game button's text is readable on both ends of its gradient", variant => {
    for (const end of ["top", "bottom"])
        expect(contrast(token(`${variant}-text`), token(`${variant}-${end}`)), `${variant} ${end}`).toBeGreaterThanOrEqual(4.5)
})

test.each(["primary", "default", "danger"])("the %s game button's press edge is darker than its face", variant => {
    expect(luminance(token(`${variant}-edge`))).toBeLessThan(luminance(token(`${variant}-bottom`)))
})

test("the primary button ends on the palette's deep green, and danger on its crimson", () => {
    expect(token("primary-bottom")).toBe(palette.primaryDeep)
    expect(token("danger-bottom")).toBe(palette.crimson)
})

test("a white default button stands out from the white card by its edge", () => {
    expect(contrast(token("default-edge"), palette.surface)).toBeGreaterThanOrEqual(2)
    expect(contrast(palette.control, palette.surface)).toBeGreaterThanOrEqual(3)
})

test("the green focus ring is visible on the grounds the buttons sit on", () => {
    for (const ground of [palette.ground, palette.surface, palette.raised])
        expect(contrast(palette.accent, ground)).toBeGreaterThanOrEqual(3)
})

test("no travel under reduced motion, and only the player app's page opts in", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*html\.gge-game[^}]*transform: none/)
    expect(css).not.toMatch(/^\.ant-btn/m)
})
