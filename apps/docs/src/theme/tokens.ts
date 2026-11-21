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

/** Night ink: the app's former war room, for readers who pick the dark theme. */
const dark: Tokens = {
    ground: "#15110E",
    sidebar: "#1B1511",
    surface: "#211A15",
    code: "#18130F",
    text: "#F3E7C9",
    heading: "#F3E7C9",
    muted: "#BFAE8A",
    accent: "#E0A526",
    accentFill: "#E0A526",
    onAccentFill: "#1A130D",
    accentTint: "#2B221B",
    rule: "#4A3B26",
    control: "#B9821A",
    focus: "#E0A526",
    noteAccent: "#6FA3F0",
    noteGround: "#29282B",
    tipAccent: "#6FA3F0",
    tipGround: "#29282B",
    cautionAccent: "#F08C2E",
    cautionGround: "#362518",
    dangerAccent: "#FF7B8A",
    dangerGround: "#372421",
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
