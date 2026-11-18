import { describe, expect, test } from "vitest"
import { themeCss } from "../src/theme/css.ts"
import { ROLES, tokens, type Role, type ThemeName, type Tokens } from "../src/theme/tokens.ts"

type Rgb = [number, number, number]

const rgb = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Rgb

const toHex = ([r, g, b]: Rgb) => "#" + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, "0")).join("")

const mix = (top: string, over: string, alpha: number) =>
    toHex(rgb(top).map((c, i) => c * alpha + rgb(over)[i]! * (1 - alpha)) as Rgb)

const luminance = (hex: string) => {
    const [r, g, b] = rgb(hex).map(c => c / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as Rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
    return (hi + 0.05) / (lo + 0.05)
}

const KINDS = ["note", "tip", "caution", "danger"] as const
const PAGE_GROUNDS: Role[] = ["ground", "sidebar", "surface"]
const TINT = 0.14

type Pair = { what: string; fg: Role | ((t: Tokens) => string); bg: Role | ((t: Tokens) => string); min: number }

const pick = (t: Tokens, v: Pair["fg"]) => (typeof v === "function" ? v(t) : t[v])

const pairs: Pair[] = [
    ...PAGE_GROUNDS.flatMap(bg => [
        { what: `body text on ${bg}`, fg: "text", bg, min: 4.5 },
        { what: `headings on ${bg}`, fg: "heading", bg, min: 4.5 },
        { what: `muted text on ${bg}`, fg: "muted", bg, min: 4.5 },
        { what: `links on ${bg}`, fg: "accent", bg, min: 4.5 },
        { what: `focus ring on ${bg}`, fg: "focus", bg, min: 3 },
        { what: `control border on ${bg}`, fg: "control", bg, min: 3 },
    ] satisfies Pair[]),
    { what: "inline code text", fg: "text", bg: "code", min: 4.5 },
    { what: "links in code ground", fg: "accent", bg: "code", min: 4.5 },
    { what: "text on the accent tint", fg: "text", bg: "accentTint", min: 4.5 },
    { what: "links on the accent tint", fg: "accent", bg: "accentTint", min: 4.5 },
    { what: "text on the current sidebar item", fg: "onAccentFill", bg: "accent", min: 4.5 },
    { what: "text on filled buttons", fg: "onAccentFill", bg: "accentFill", min: 4.5 },
    { what: "focus ring on the code ground", fg: "focus", bg: "code", min: 3 },
    ...PAGE_GROUNDS.flatMap(bg => [
        { what: `text on the arrival tint over ${bg}`, fg: "text", bg: (t: Tokens) => mix(t.accent, t[bg], TINT), min: 4.5 },
        { what: `muted text on the arrival tint over ${bg}`, fg: "muted", bg: (t: Tokens) => mix(t.accent, t[bg], TINT), min: 4.5 },
        { what: `links on the arrival tint over ${bg}`, fg: "accent", bg: (t: Tokens) => mix(t.accent, t[bg], TINT), min: 4.5 },
    ] satisfies Pair[]),
    ...KINDS.flatMap(kind => {
        const accent = `${kind}Accent` as Role
        const ground = `${kind}Ground` as Role
        return [
            { what: `${kind} aside body text`, fg: "text", bg: ground, min: 4.5 },
            { what: `${kind} aside label and icon`, fg: accent, bg: ground, min: 4.5 },
            { what: `${kind} aside bar on the page`, fg: accent, bg: "ground", min: 3 },
            { what: `${kind} aside bar on the sidebar`, fg: accent, bg: "sidebar", min: 3 },
            { what: `${kind} aside focus ring`, fg: "focus", bg: ground, min: 3 },
        ] satisfies Pair[]
    }),
]

describe.each(Object.keys(tokens) as ThemeName[])("%s theme", theme => {
    const t = tokens[theme]

    test("every role is a six-digit hex", () => {
        for (const role of ROLES) expect(t[role], role).toMatch(/^#[0-9A-Fa-f]{6}$/)
    })

    test.each(pairs)("$what", ({ fg, bg, min }) => {
        expect(contrast(pick(t, fg), pick(t, bg))).toBeGreaterThanOrEqual(min)
    })
})

test("the generated CSS defines both themes from the same roles", () => {
    const css = themeCss()
    for (const theme of Object.keys(tokens) as ThemeName[]) {
        expect(css).toContain(`:root[data-theme='${theme}']`)
        for (const role of ROLES) expect(css, `${theme} ${role}`).toContain(tokens[theme][role])
    }
})
