import { expect, test } from "vitest"
import { fetchClientBuild } from "../src/game-data.ts"

const BASE = "https://empire-html5.goodgamestudios.com/default"
const page = `<script src="vendor.bundle.f8b9303b.js"></script><script src="CacheBreaker.bundle.169900da63523e1b443c.js"></script><script src="Game.bundle.efded7cc2ea1e1d30527.js"></script>`
const cacheBreaker = (version: string) => `868:function(e){e.exports={name:"TranspilationEmpire",version:"${version}",description:"Transpiled version of the Flash game"}}`

const cdn = (files: Record<string, string>) => (async (url: string) => {
    const body = files[url]
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body)
}) as typeof fetch

test("reads the build number the live client sends, padded the way the client pads it", async () => {
    const files = { [`${BASE}/index.html`]: page, [`${BASE}/CacheBreaker.bundle.169900da63523e1b443c.js`]: cacheBreaker("1.173.9") }
    expect(await fetchClientBuild({ fetch: cdn(files) })).toBe(1173009)
    files[`${BASE}/CacheBreaker.bundle.169900da63523e1b443c.js`] = cacheBreaker("1.172.14")
    expect(await fetchClientBuild({ fetch: cdn(files) })).toBe(1172014)
})

test("gives up quietly when the page no longer has the bundle or the version", async () => {
    expect(await fetchClientBuild({ fetch: cdn({ [`${BASE}/index.html`]: "<html></html>" }) })).toBeUndefined()
    expect(await fetchClientBuild({ fetch: cdn({ [`${BASE}/index.html`]: page, [`${BASE}/CacheBreaker.bundle.169900da63523e1b443c.js`]: "nothing" }) })).toBeUndefined()
    expect(await fetchClientBuild({ fetch: (async () => { throw new Error("offline") }) as typeof fetch })).toBeUndefined()
})
