import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { XMLParser } from "fast-xml-parser"

const BASE = "https://empire-html5.goodgamestudios.com"
const exists = (p: string) => access(p).then(() => true, () => false)

/**
 * Brings items/, lang/en.json and 1.xml in dataDir up to date with the game's
 * CDN. When the CDN is unreachable it keeps the cached copy, and only fails if
 * there is none.
 */
export async function refreshGameData(dataDir: string, { fetch = globalThis.fetch, locale = "en", log = console } = {}) {
    const itemsDir = path.join(dataDir, "items")
    const langFile = path.join(dataDir, "lang", `${locale}.json`)
    const serversFile = path.join(dataDir, "1.xml")
    try {
        await mkdir(itemsDir, { recursive: true })
        await mkdir(path.dirname(langFile), { recursive: true })
        const version = await (await fetch(`${BASE}/default/items/ItemsVersion.properties`)).text()
        const versionFile = path.join(dataDir, "ItemsVersion.properties")
        const cached = await readFile(versionFile, "utf8").catch(() => undefined)
        const changed = version !== cached || !await exists(path.join(itemsDir, "units.json"))
        if (changed) {
            const number = version.match(/(?!.*=).*/)?.[0]
            const items = await (await fetch(`${BASE}/default/items/items_v${number}.json`)).json() as Record<string, unknown>
            for (const [key, value] of Object.entries(items))
                if (/^[A-Za-z_]+$/.test(key))
                    await writeFile(path.join(itemsDir, `${key}.json`), JSON.stringify(value))
            await writeFile(versionFile, version)
        }
        if (changed || !await exists(langFile)) {
            const versions = await (await fetch(`${BASE}/config/languages/version.json`)).json() as { languages: Record<string, string> }
            await writeFile(langFile, await (await fetch(`${BASE}/config/languages/${versions.languages[locale]}/${locale}.json`)).text())
        }
        if (changed || !await exists(serversFile))
            await writeFile(serversFile, await (await fetch(`${BASE}/config/network/1.xml`)).text())
    } catch (error) {
        if (!await exists(serversFile) || !await exists(path.join(itemsDir, "units.json")))
            throw error
        log.warn("Game CDN unreachable; using cached game data", error)
    }
}

/**
 * The build number the live HTML5 client sends in `login` and `vck`, read from
 * its CacheBreaker bundle. The server drops the socket after `vck` when the
 * build is out of date, so this has to follow the game's releases. The client
 * pads minor and patch to three digits: "1.173.9" is 1173009. Undefined when
 * the page or the bundle can't be read.
 */
export async function fetchClientBuild({ fetch = globalThis.fetch } = {}) {
    try {
        const page = await (await fetch(`${BASE}/default/index.html`)).text()
        const bundle = page.match(/CacheBreaker\.bundle\.\w+\.js/)?.[0]
        if (!bundle)
            return undefined
        const source = await (await fetch(`${BASE}/default/${bundle}`)).text()
        const [, major, minor, patch] = source.match(/name:"TranspilationEmpire",version:"(\d+)\.(\d+)\.(\d+)/) ?? []
        if (!major || !minor || !patch)
            return undefined
        return Number(major + minor.padStart(3, "0") + patch.padStart(3, "0"))
    } catch {
        return undefined
    }
}

/** `zoneId` names the server in the game's maintenance file (./gameMaintenance.ts). */
export type ServerRow = { id: number; label: string; wsHost: string; zone: string; zoneId?: string }

/** Servers players can pick, labelled the way the game names them ("Germany 1"). */
export async function readServers(dataDir: string, locale = "en"): Promise<ServerRow[]> {
    const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" })
        .parse(await readFile(path.join(dataDir, "1.xml"), "utf8"))
    const lang = JSON.parse(await readFile(path.join(dataDir, "lang", `${locale}.json`), "utf8").catch(() => "{}")) as Record<string, string>
    const instances = [xml?.network?.instances?.instance ?? []].flat() as Record<string, string | number>[]
    const servers = instances
        .filter(i => i.instanceLocaId)
        .map(i => ({
            id: Number(i.value),
            label: `${lang[String(i.instanceLocaId)] ?? i.instanceLocaId} ${i.instanceName}`,
            wsHost: String(i.server),
            zone: String(i.zone),
            ...(i.zoneId !== undefined && { zoneId: String(i.zoneId) }),
        }))
    // Not in 1.xml; the legacy panel always offered it.
    servers.push({ id: 103, label: "SP 3", wsHost: "ep-live-mz-nw2-game.goodgamestudios.com", zone: "EmpireExSP_3" })
    return servers
}
