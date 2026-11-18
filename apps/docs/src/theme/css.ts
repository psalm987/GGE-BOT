import { tokens, type Role, type ThemeName, type Tokens } from "./tokens.ts"

/** Starlight's `--sl-color-*` properties, each fed by one role. */
const STARLIGHT: Record<string, Role> = {
    "--sl-color-white": "heading",
    "--sl-color-gray-1": "text",
    "--sl-color-gray-2": "text",
    "--sl-color-gray-3": "muted",
    "--sl-color-gray-4": "control",
    "--sl-color-gray-5": "rule",
    "--sl-color-gray-6": "sidebar",
    "--sl-color-gray-7": "sidebar",
    "--sl-color-black": "ground",
    "--sl-color-text": "text",
    "--sl-color-text-accent": "accent",
    "--sl-color-text-invert": "onAccentFill",
    "--sl-color-bg": "ground",
    "--sl-color-bg-nav": "sidebar",
    "--sl-color-bg-sidebar": "sidebar",
    "--sl-color-bg-inline-code": "code",
    "--sl-color-bg-accent": "accentFill",
    "--sl-color-hairline": "rule",
    "--sl-color-hairline-light": "rule",
    "--sl-color-hairline-shade": "rule",
    "--sl-color-accent": "accentFill",
    "--sl-color-accent-high": "accent",
    "--sl-color-accent-low": "accentTint",
    // Starlight's blue, purple, orange and red feed its badges and cards; no hue may stay violet.
    "--sl-color-blue": "noteAccent",
    "--sl-color-blue-high": "noteAccent",
    "--sl-color-blue-low": "noteGround",
    "--sl-color-purple": "accent",
    "--sl-color-purple-high": "accent",
    "--sl-color-purple-low": "accentTint",
    "--sl-color-orange": "cautionAccent",
    "--sl-color-orange-high": "cautionAccent",
    "--sl-color-orange-low": "cautionGround",
    "--sl-color-red": "dangerAccent",
    "--sl-color-red-high": "dangerAccent",
    "--sl-color-red-low": "dangerGround",
    "--sl-color-green": "accent",
    "--sl-color-green-high": "accent",
    "--sl-color-green-low": "accentTint",
}

const kebab = (role: string) => role.replace(/[A-Z]/g, c => "-" + c.toLowerCase())

function block(theme: ThemeName, t: Tokens): string {
    const lines = [`color-scheme: ${theme};`]
    for (const [prop, role] of Object.entries(STARLIGHT)) lines.push(`${prop}: ${t[role]};`)
    for (const role of Object.keys(t)) lines.push(`--gge-${kebab(role)}: ${t[role as Role]};`)
    return `:root[data-theme='${theme}'] {\n  ${lines.join("\n  ")}\n}`
}

export const themeCss = (): string => `${block("dark", tokens.dark)}\n${block("light", tokens.light)}\n`
