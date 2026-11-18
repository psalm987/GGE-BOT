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

test("the primary button is the palette's gold, and its press edge is darker than its face", () => {
    expect(token("primary-top")).toBe(palette.gold.toUpperCase())
    expect(token("primary-bottom")).toBe(palette.goldDeep.toUpperCase())
    expect(luminance(token("primary-edge"))).toBeLessThan(luminance(token("primary-bottom")))
})

test("the gold focus ring is visible on the ground the buttons sit on", () => {
    for (const ground of [palette.ink, palette.surface, palette.raised])
        expect(contrast(palette.gold, ground)).toBeGreaterThanOrEqual(3)
})

test("no travel under reduced motion, and only the player app's page opts in", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*html\.gge-game[^}]*transform: none/)
    expect(css).not.toMatch(/^\.ant-btn/m)
})
