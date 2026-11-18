import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { MODULES } from "@gge/contracts"
import { palette } from "@gge/ui/palette"

/**
 * Draws every icon a module uses into the house badge and credits its author. Each glyph comes from game-icons.net (npm
 * @iconify-json/game-icons, CC BY 3.0). The badge is ours: an ink ground in a gold rim with a light bevel.
 *
 * Usage: `pnpm --filter @gge/icons build`. Output is a pure function of the module list, the set and `authors.json`, so a rerun
 * changes no bytes. `node build.ts --authors` rereads the set's GitHub tree to refresh `authors.json`, which the npm package lacks.
 */
const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(resolve(here, "..", ".."), "packages", "ui", "src", "icons")
const AUTHORS = join(here, "authors.json")
const SET = join(here, "node_modules", "@iconify-json", "game-icons")

const LICENCE = { name: "CC BY 3.0", url: "https://creativecommons.org/licenses/by/3.0/" }
const NAMES: Record<string, string> = {
    lorc: "Lorc",
    delapouite: "Delapouite",
    skoll: "Skoll",
    "caro-asercion": "Caro Asercion",
    cathelineau: "Cathelineau",
}

const ids: string[] = [...new Set(MODULES.map(module => module.icon))]

async function refreshAuthors(): Promise<void> {
    const res = await fetch("https://api.github.com/repos/game-icons/icons/git/trees/master?recursive=1")
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const tree = (await res.json() as { tree: { path: string }[] }).tree
    const authorOf = new Map<string, string>()
    for (const { path } of tree) {
        const match = path.match(/^([^/]+)\/([^/]+)\.svg$/)
        if (match) authorOf.set(match[2]!, match[1]!)
    }
    const missing = ids.filter(id => !authorOf.has(id))
    if (missing.length) throw new Error(`not in the upstream repository: ${missing.join(", ")}`)
    writeFileSync(AUTHORS, JSON.stringify(Object.fromEntries(ids.sort().map(id => [id, authorOf.get(id)])), null, 2) + "\n")
}

/** The badge is 64 units square, drawn for 28 px and up. The glyph sits in the middle 40. */
function badge(glyph: string): string {
    const { ink, raised, gold, goldDeep, parchment } = palette
    const cx = 32
    const studs = [0, 90, 180, 270].map(deg => `<path transform="rotate(${deg} ${cx} ${cx})" d="M32 1.5l2.6 2.6l-2.6 2.6l-2.6-2.6z" fill="${goldDeep}"/>`).join("")
    const scale = 40 / 512
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">`,
        `<defs>`,
        `<linearGradient id="rim" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="${gold}"/><stop offset="1" stop-color="${goldDeep}"/></linearGradient>`,
        `<linearGradient id="bevel" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${parchment}" stop-opacity="0.85"/><stop offset="0.45" stop-color="${parchment}" stop-opacity="0"/></linearGradient>`,
        `<radialGradient id="ground" cx="0.5" cy="0.38" r="0.7"><stop offset="0" stop-color="${raised}"/><stop offset="1" stop-color="${ink}"/></radialGradient>`,
        `<g id="glyph" transform="translate(12 12.5) scale(${scale.toFixed(5)})">${glyph}</g>`,
        `</defs>`,
        `<circle cx="${cx}" cy="${cx + 1}" r="30.5" fill="${ink}" opacity="0.55"/>`,
        `<circle cx="${cx}" cy="${cx}" r="30.5" fill="url(#rim)"/>`,
        `<circle cx="${cx}" cy="${cx}" r="29.5" fill="none" stroke="url(#bevel)" stroke-width="2"/>`,
        `<circle cx="${cx}" cy="${cx}" r="26.5" fill="${goldDeep}"/>`,
        `<circle cx="${cx}" cy="${cx}" r="25.2" fill="url(#ground)"/>`,
        `<circle cx="${cx}" cy="${cx}" r="23.8" fill="none" stroke="${gold}" stroke-opacity="0.3" stroke-width="0.75"/>`,
        studs,
        `<use href="#glyph" transform="translate(0 1)" fill="${ink}" opacity="0.8"/>`,
        `<use href="#glyph" fill="${parchment}"/>`,
        `</svg>`,
        ``,
    ].join("\n")
}

function build(): void {
    const set = JSON.parse(readFileSync(join(SET, "icons.json"), "utf8")) as { icons: Record<string, { body: string }> }
    const info = JSON.parse(readFileSync(join(SET, "info.json"), "utf8")) as { name: string; author: { name: string; url: string } }
    const authors = JSON.parse(readFileSync(AUTHORS, "utf8")) as Record<string, string>
    const credits = ids.map(id => {
        const glyph = set.icons[id]
        if (!glyph) throw new Error(`${id} is not in the game-icons set`)
        const folder = authors[id]
        if (!folder) throw new Error(`${id} has no author in authors.json: run \`node build.ts --authors\``)
        const author = NAMES[folder]
        if (!author) throw new Error(`${folder} (author of ${id}) has no display name in NAMES`)
        writeFileSync(join(OUT, `${id}.svg`), badge(glyph.body.replaceAll("currentColor", "inherit")))
        return { id, author, source: `https://game-icons.net/1x1/${folder}/${id}.html`, licence: LICENCE.name, licenceUrl: LICENCE.url }
    })
    for (const file of readdirSync(OUT)) if (file.endsWith(".svg") && !ids.includes(file.slice(0, -4))) rmSync(join(OUT, file))
    const credit = { set: info.name, setUrl: "https://game-icons.net", setAuthors: info.author.name, licence: LICENCE.name, licenceUrl: LICENCE.url, icons: credits }
    writeFileSync(join(OUT, "credits.json"), JSON.stringify(credit, null, 2) + "\n")
    console.log(`${ids.length} icons in ${OUT}`)
}

if (!existsSync(OUT)) throw new Error(`${OUT} is missing`)
if (process.argv.includes("--authors")) await refreshAuthors()
else build()
