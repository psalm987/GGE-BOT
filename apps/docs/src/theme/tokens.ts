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

/** Night ink for readers who pick the dark theme, with the app's green as its accent. */
const dark: Tokens = {
    ground: "#15110E",
    sidebar: "#1B1511",
    surface: "#211A15",
    code: "#18130F",
    text: "#F3E7C9",
    heading: "#F3E7C9",
    muted: "#BFAE8A",
    accent: "#5CCB94",
    accentFill: "#5CCB94",
    onAccentFill: "#0B1A13",
    accentTint: "#22302A",
    rule: "#4A3B26",
    control: "#3E9E6E",
    focus: "#5CCB94",
    noteAccent: "#6FA3F0",
    noteGround: "#29282B",
    tipAccent: "#5CCB94",
    tipGround: "#1E2A24",
    cautionAccent: "#F08C2E",
    cautionGround: "#362518",
    dangerAccent: "#FF7B8A",
    dangerGround: "#372421",
}

/** The app's light field camp: cream ground, white cards, emerald headings and green links. */
const light: Tokens = {
    ground: "#F6F1E4",
    sidebar: "#EDF2EA",
    surface: "#FFFFFF",
    code: "#F3EDDF",
    text: "#1F2A24",
    heading: "#0D5C44",
    muted: "#56605A",
    accent: "#0D6E51",
    accentFill: "#0F7A5A",
    onAccentFill: "#FFFFFF",
    accentTint: "#E0EFE6",
    rule: "#DDD4C0",
    control: "#8C8471",
    focus: "#0D6E51",
    noteAccent: "#1F5FBF",
    noteGround: "#E6EEF9",
    tipAccent: "#0D6E51",
    tipGround: "#E3F1EA",
    cautionAccent: "#9A4A00",
    cautionGround: "#FBEAD6",
    dangerAccent: "#B3192E",
    dangerGround: "#FAE1E1",
}

export const tokens: Record<ThemeName, Tokens> = { dark, light }
