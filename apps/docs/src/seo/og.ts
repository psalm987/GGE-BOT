import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import sharp from "sharp"
import type { OGImageOptions } from "astro-og-canvas"
import { palette } from "@gge/ui/palette"
import { LOCALES, type Locale } from "@gge/i18n/locales"
import { sectionOf } from "../theme/sidebar.ts"
import { APP_NAME } from "./jsonld.ts"
import { OG_FORMAT } from "./og-path.ts"

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

const font = (pkg: string, file: string) => `./node_modules/@fontsource/${pkg}/files/${file}.woff`
const FONTS = [
    font("alegreya", "alegreya-latin-700-normal"),
    font("cinzel", "cinzel-latin-700-normal"),
    font("ibm-plex-sans-arabic", "ibm-plex-sans-arabic-arabic-700-normal"),
    font("ibm-plex-sans-arabic", "ibm-plex-sans-arabic-arabic-400-normal"),
]

const CACHE = "./node_modules/.cache/gge-docs"

/** The crest as a PNG, because the image library takes no SVG. Redrawn from `crest.svg` on every build. */
async function crestPng(): Promise<string> {
    mkdirSync(CACHE, { recursive: true })
    const file = path.join(CACHE, "crest.png")
    writeFileSync(file, await sharp("./src/assets/crest.svg", { density: 600 }).resize({ height: 132 }).png().toBuffer())
    return file
}

const logoPath = await crestPng()

/** The image options for one page: crest, title and section on the ink ground, in the page's own language. */
export function ogOptions(page: { title: string; slug: string; lang: string }): OGImageOptions {
    const rtl = (LOCALES[page.lang as Locale]?.dir ?? "ltr") === "rtl"
    const section = sectionOf(page.slug, page.lang)?.label
    return {
        title: page.title,
        description: section ? `${APP_NAME}  ·  ${section}` : APP_NAME,
        dir: rtl ? "rtl" : "ltr",
        logo: { path: logoPath },
        bgGradient: [rgb(palette.ink)],
        border: { color: rgb(palette.gold), width: 10, side: "inline-start" },
        padding: 84,
        font: {
            title: { color: rgb(palette.parchment), size: 82, weight: "Bold", lineHeight: 1.12, families: ["Alegreya", "IBM Plex Sans Arabic"] },
            description: { color: rgb(palette.gold), size: 34, weight: "Bold", lineHeight: 1.3, families: ["Cinzel", "IBM Plex Sans Arabic"] },
        },
        fonts: FONTS,
        cacheDir: CACHE,
        format: OG_FORMAT.toUpperCase() as "JPEG",
        quality: 82,
    }
}
