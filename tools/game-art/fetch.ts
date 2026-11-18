import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import { MODULES } from "../../packages/contracts/src/modules.ts"

/**
 * Builds the game art the player app shows: every key the module registry names, fetched from the game's CDN, resized to 48 and 96
 * pixels and saved as WebP in packages/ui/src/game-art with a manifest crediting Goodgame Studios. Builds never touch the CDN, because
 * the result is committed. Originals are cached under ~/.cache/gge-bot-art, so a rerun downloads nothing and changes no bytes.
 * Usage: `node tools/game-art/fetch.ts`.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const OUT = join(root, "packages", "ui", "src", "game-art")
const CACHE = join(process.env.GGE_ART_CACHE ?? join(homedir(), ".cache", "gge-bot-art"), "raw")
const CDN = "https://empire-html5.goodgamestudios.com/default/assets"
export const SIZES = [48, 96] as const
const CREDIT = "© Goodgame Studios"
const GAP_MS = 1100
const ATTEMPTS = 4

export type ManifestEntry = { key: string; source: string; fetched: string }
export type Manifest = { credit: string; sizes: readonly number[]; icons: ManifestEntry[] }

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))
let lastRequest = 0

/** One request a second at most, retried with a growing wait. */
async function download(url: string): Promise<Buffer> {
    for (let attempt = 1; ; attempt++) {
        await sleep(Math.max(0, lastRequest + GAP_MS - Date.now()))
        lastRequest = Date.now()
        try {
            const response = await fetch(url)
            if (response.ok) return Buffer.from(await response.arrayBuffer())
            if (response.status === 404 || attempt === ATTEMPTS) throw new Error(`${url}: HTTP ${response.status}`)
        }
        catch (error) {
            if (attempt === ATTEMPTS || (error instanceof Error && error.message.includes("HTTP 404"))) throw error
        }
        await sleep(attempt * 2000)
    }
}

export const iconKeys = () => [...new Set(MODULES.map(module => module.icon))].sort()

export async function buildGameArt(): Promise<void> {
    const assets = JSON.parse(readFileSync(join(root, "packages", "bot-core", "assets.json"), "utf8")) as Record<string, string>
    const today = new Date().toISOString().slice(0, 10)
    const manifestPath = join(OUT, "manifest.json")
    const previous = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest).icons : []
    const fetched = new Map(previous.map(entry => [entry.key, entry.fetched]))
    mkdirSync(OUT, { recursive: true })
    const icons: ManifestEntry[] = []
    for (const key of iconKeys()) {
        const source = assets[key]
        if (!source) throw new Error(`${key} is not in assets.json`)
        const original = join(CACHE, `${source}.webp`)
        if (!existsSync(original)) {
            mkdirSync(dirname(original), { recursive: true })
            writeFileSync(original, await download(`${CDN}/${source}.webp`))
            console.log(`downloaded ${key}`)
        }
        for (const size of SIZES) {
            const webp = await sharp(original).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .webp({ quality: 82, effort: 6, alphaQuality: 90 }).toBuffer()
            writeFileSync(join(OUT, `${key}-${size}.webp`), webp)
        }
        icons.push({ key, source, fetched: fetched.get(key) ?? today })
    }
    writeFileSync(manifestPath, JSON.stringify({ credit: CREDIT, sizes: SIZES, icons } satisfies Manifest, null, 2) + "\n")
    console.log(`${icons.length} icons in ${OUT}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildGameArt()
