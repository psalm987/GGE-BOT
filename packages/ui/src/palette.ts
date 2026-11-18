/** Night-ink war room: gold carries primary actions, crimson is banners and danger. */
export const palette = {
    ink: "#15110E",
    surface: "#211A15",
    raised: "#2B221B",
    sider: "#1B1511",
    parchment: "#F3E7C9",
    muted: "#BFAE8A",
    gold: "#E0A526",
    goldDeep: "#B9821A",
    crimson: "#D7263D",
    azure: "#3D7FE0",
    emerald: "#2E9A5B",
    // Lighter twins for text: the brand colours pass 3:1 for icons and borders, not 4.5:1 for words.
    crimsonText: "#FF7B8A",
    azureText: "#6FA3F0",
    emeraldText: "#4CC07F",
    amber: "#F08C2E",
    /** Resting, not failing: light enough to pass 4.5:1 as text on every ground. */
    dusk: "#A99BEA",
    rule: "#4A3B26",
    /** The log terminal's inset ground, a step darker than `surface`. */
    terminal: "#18130F",
    // Log levels: info recedes, warnings and errors stand out. Each also shows an icon and a word.
    levelInfo: "#BFAE8A",
    levelWarn: "#F08C2E",
    levelError: "#FF7B8A",
    /** The game said "not now": calm, since it passes by itself. */
    levelNotNow: "#A99BEA",
    /** Banner severities: the accent draws the inline-start rule and the icon on its ground. Each also shows an icon shape and a word. */
    banner: {
        info: { accent: "#6FA3F0", ground: "#29282B" },
        warning: { accent: "#F08C2E", ground: "#362518" },
        critical: { accent: "#FF7B8A", ground: "#372421" },
    },
    /** Plugin tags in the log, picked by a hash of the key. No reds or ambers, so a tag never reads as a level. */
    tags: ["#6CB6F5", "#4FD1C5", "#7DD87A", "#C5D86D", "#8FA2FF", "#B794F6", "#E38AE8", "#F49AC1"],
} as const
