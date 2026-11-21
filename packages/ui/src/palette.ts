/** Light field camp: cream ground, white cards, an emerald sidebar and green actions. */
export const palette = {
    ground: "#F6F1E4",
    surface: "#FFFFFF",
    /** Table heads, progress rails and tiles inside a card: a step off white. */
    raised: "#F3EDDF",
    text: "#1F2A24",
    heading: "#0D5C44",
    muted: "#56605A",
    /** Filled actions. White words on it pass 4.5:1. */
    primary: "#0F7A5A",
    primaryDeep: "#0B6148",
    /** Links, selected tabs and the focus ring: the action green, a shade darker so it passes 4.5:1 on every ground. */
    accent: "#0D6E51",
    /** The brand's fresh green: icons, highlights and large shapes only, never small words. */
    fresh: "#16A477",
    /** The sidebar is a deep emerald band with light words. */
    nav: "#0E4F3C",
    navText: "#F4FBF7",
    navMuted: "#BFE3D2",
    navAccent: "#7FE0B5",
    // Status colours carry both the icon and the words, so each passes 4.5:1 on every ground.
    emerald: "#0F7A5A",
    azure: "#1F5FBF",
    crimson: "#B3192E",
    /** Danger under the pointer or pressed: darker, never lighter, so its words keep their contrast. */
    crimsonDeep: "#951426",
    amber: "#9A4A00",
    /** Resting, not failing. */
    dusk: "#5E50B8",
    /** Hairlines between rows and around cards. */
    rule: "#DDD4C0",
    /** The edge of a field or a default button: 3:1 on every ground. */
    control: "#8C8471",
    /** The log terminal's inset ground, a step off the white cards. */
    terminal: "#F7F3EA",
    // Log levels: info recedes, warnings and errors stand out. Each also shows an icon and a word.
    levelInfo: "#56605A",
    levelWarn: "#9A4A00",
    levelError: "#B3192E",
    /** The game said "not now": calm, since it passes by itself. */
    levelNotNow: "#5E50B8",
    /** Banner severities: the accent draws the inline-start rule and the icon on its ground. Each also shows an icon shape and a word. */
    banner: {
        info: { accent: "#1F5FBF", ground: "#E6EEF9" },
        warning: { accent: "#9A4A00", ground: "#FBEAD6" },
        critical: { accent: "#B3192E", ground: "#FAE1E1" },
    },
    /** Plugin tags in the log, picked by a hash of the key. No reds or ambers, so a tag never reads as a level. */
    tags: ["#1A5FA8", "#0B7368", "#2F7A1F", "#5E6A00", "#3F4FB5", "#7A3DB0", "#9C2C98", "#A3245F"],
} as const
