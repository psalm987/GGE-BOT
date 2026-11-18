import { palette } from "@gge/ui/palette"

export const ROLES = [
    "ground", "sidebar", "surface", "code",
    "text", "heading", "muted",
    "accent", "accentFill", "onAccentFill", "accentTint",
    "rule", "control", "focus",
    "noteAccent", "noteGround", "tipAccent", "tipGround",
    "cautionAccent", "cautionGround", "dangerAccent", "dangerGround",
] as const

export type Role = (typeof ROLES)[number]
export type Tokens = Record<Role, string>
export type ThemeName = "dark" | "light"

const { banner } = palette

/** Dark is the app's war room, straight from the palette. */
const dark: Tokens = {
    ground: palette.ink,
    sidebar: palette.sider,
    surface: palette.surface,
    code: palette.terminal,
    text: palette.parchment,
    heading: palette.parchment,
    muted: palette.muted,
    accent: palette.gold,
    accentFill: palette.gold,
    onAccentFill: "#1A130D",
    accentTint: palette.raised,
    rule: palette.rule,
    control: palette.goldDeep,
    focus: palette.gold,
    noteAccent: banner.info.accent,
    noteGround: banner.info.ground,
    tipAccent: banner.info.accent,
    tipGround: banner.info.ground,
    cautionAccent: banner.warning.accent,
    cautionGround: banner.warning.ground,
    dangerAccent: banner.critical.accent,
    dangerGround: banner.critical.ground,
}

/** Parchment: cream ground and ink text. Gold is too pale for words here, so links use a darkened gold. */
const light: Tokens = {
    ground: "#F6EEDA",
    sidebar: "#EFE5C9",
    surface: "#FBF6E8",
    code: "#EDE2C4",
    text: "#2A2017",
    heading: "#1A130D",
    muted: "#5B4C33",
    accent: "#7A520A",
    accentFill: "#7A520A",
    onAccentFill: "#FFF8E6",
    accentTint: "#EFE0B8",
    rule: "#D3C294",
    control: "#7A6A47",
    focus: "#7A4F00",
    noteAccent: "#1F5AAE",
    noteGround: "#E4ECF8",
    tipAccent: "#1F5AAE",
    tipGround: "#E4ECF8",
    cautionAccent: "#8F4300",
    cautionGround: "#F9E6CE",
    dangerAccent: "#A8142A",
    dangerGround: "#F8DCD8",
}

export const tokens: Record<ThemeName, Tokens> = { dark, light }
