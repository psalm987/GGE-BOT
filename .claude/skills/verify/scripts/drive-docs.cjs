// Drives the built docs site (apps/docs/dist) in a browser the way a reader does. It serves dist itself.
// Usage: pnpm --filter @gge/docs build && node drive-docs.cjs [out-dir]   (default: .verify-evidence/<time>-docs)
const path = require("node:path")
const fs = require("node:fs")
const http = require("node:http")
const { execFileSync } = require("node:child_process")
const pw = process.env.HOME + "/.cache/gge-bot-verify/pw/node_modules/"
const { chromium } = require(pw + "playwright")
const axeSource = fs.readFileSync(pw + "axe-core/axe.min.js", "utf8")
const DIST = path.join(__dirname, "../../../../apps/docs/dist")
const out = process.argv[2] ?? path.join(__dirname, "../../../../.verify-evidence", `${new Date().toISOString().replace(/[:.]/g, "-")}-docs`)
fs.mkdirSync(out, { recursive: true })
const assert = (ok, what) => { if (!ok) throw new Error("FAILED: " + what); console.log("ok:", what) }

const WIDE = { width: 1440, height: 900 }
const NARROW = { width: 1100, height: 900 }
const PHONE = { width: 390, height: 844 }
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".xml": "application/xml", ".txt": "text/plain", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif" }

function serve() {
    const server = http.createServer((req, res) => {
        let file = path.join(DIST, decodeURIComponent(new URL(req.url, "http://x").pathname))
        if (!file.startsWith(DIST)) return res.writeHead(403).end()
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html")
        if (!fs.existsSync(file)) return res.writeHead(404).end("not found")
        res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(fs.readFileSync(file))
    })
    return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })))
}

async function open(browser, base, url, { theme = "light", viewport = WIDE, reducedMotion = "no-preference", clipboard = false } = {}) {
    const context = await browser.newContext({ viewport, reducedMotion, permissions: clipboard ? ["clipboard-read", "clipboard-write"] : [] })
    await context.addInitScript(t => { try { localStorage.setItem("starlight-theme", t) } catch {} }, theme)
    const page = await context.newPage()
    page.errors = []
    page.on("pageerror", e => page.errors.push(e.message))
    page.on("console", m => { if (m.type() === "error") page.errors.push(m.text()) })
    await page.goto(base + url)
    await page.waitForLoadState("networkidle")
    return page
}

async function axe(page, name) {
    await page.addScriptTag({ content: axeSource })
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations.map(v => `${v.id} (${v.impact}): ${v.nodes.length} node(s): ${v.nodes.map(n => n.html.slice(0, 160)).join(" | ")}`))
    assert(violations.length === 0, `axe WCAG A/AA clean on ${name}${violations.length ? "\n  " + violations.join("\n  ") : ""}`)
}

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)

const barSide = (page, selector) => page.evaluate(sel => {
    const frame = document.querySelector(sel)
    const rect = frame.getBoundingClientRect()
    const bar = getComputedStyle(frame, "::before")
    const x = rect.left + parseFloat(bar.left) + parseFloat(bar.width) / 2
    return x < rect.left ? "start-left" : x > rect.right ? "start-right" : "inside"
}, selector)

/** Colours any element shows that match a Starlight default violet, or sit in the violet hue band. */
const violets = page => page.evaluate(() => {
    const toRgb = (h, s, l) => {
        s /= 100; l /= 100
        const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l)
        return [0, 8, 4].map(n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))))
    }
    const defaults = [[224, 100, 60], [224, 100, 85], [224, 54, 20], [234, 90, 60], [234, 80, 30], [234, 88, 90], [234, 100, 60], [234, 100, 87], [234, 54, 20],
        [281, 82, 63], [281, 82, 89], [281, 39, 22], [281, 90, 60], [281, 90, 30], [281, 80, 90]].map(([h, s, l]) => toRgb(h, s, l).join(","))
    const hue = ([r, g, b]) => {
        r /= 255; g /= 255; b /= 255
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
        if (d < 0.15) return -1
        const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
        return ((h * 60) + 360) % 360
    }
    const found = new Set()
    for (const el of document.querySelectorAll("*")) {
        for (const pseudo of [null, "::before", "::after"]) {
            const cs = getComputedStyle(el, pseudo)
            for (const prop of ["color", "backgroundColor", "borderTopColor", "borderInlineStartColor", "outlineColor", "fill", "stroke", "textDecorationColor", "caretColor"]) {
                const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(cs[prop] ?? "")
                if (!m || (m[4] !== undefined && Number(m[4]) === 0)) continue
                const rgb = [Number(m[1]), Number(m[2]), Number(m[3])]
                const h = hue(rgb)
                if (defaults.includes(rgb.join(",")) || (h >= 240 && h <= 300)) found.add(`${prop} ${cs[prop]} on ${el.outerHTML.slice(0, 90)}`)
            }
        }
    }
    return [...found]
})


const decode = text => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
const SITE = "https://docs.neisesolutions.com"

function htmlFiles(root) {
    return fs.readdirSync(root, { recursive: true }).filter(f => f.endsWith(".html") && !f.startsWith("pagefind") && !f.startsWith("_astro")).map(f => path.join(root, f))
}

const attr = (html, pattern) => { const m = pattern.exec(html); return m ? decode(m[1]) : undefined }

function jsonLd(html) {
    return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]))
}

function jpegSize(buf) {
    let i = 2
    while (i < buf.length) {
        const marker = buf[i + 1]
        if (marker >= 0xc0 && marker <= 0xc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)]
        i += 2 + buf.readUInt16BE(i + 2)
    }
}

const REQUIRED = {
    TechArticle: ["headline", "description", "inLanguage", "url", "mainEntityOfPage", "publisher", "image"],
    BreadcrumbList: ["inLanguage", "itemListElement"],
    DefinedTermSet: ["name", "url", "inLanguage", "hasDefinedTerm"],
    Organization: ["name", "url", "logo"],
    SoftwareApplication: ["name", "applicationCategory", "operatingSystem", "inLanguage", "publisher"],
}

function seoFiles(distRoot) {
    const content = htmlFiles(distRoot).map(file => ({ file, html: fs.readFileSync(file, "utf8") })).filter(page => page.html.includes("data-pagefind-body"))
    assert(content.length > 150, `found ${content.length} content pages in dist`)
    const robots = html => /<meta name="robots" content="noindex"/.test(html)
    let og = 0
    for (const { file, html } of content) {
        const where = path.relative(distRoot, file)
        const canon = html.match(/<link rel="canonical"/g) ?? []
        assert(canon.length === 1, `${where} has exactly one canonical`) 
        const desc = attr(html, /<meta name="description" content="([^"]*)"/)
        assert(desc && desc.length > 0 && desc.length <= 160, `${where} has a description of 160 characters or fewer (${desc?.length})`)
        const docs = jsonLd(html)
        const types = docs.map(d => d["@type"])
        assert(types.includes("TechArticle") && types.includes("BreadcrumbList"), `${where} has TechArticle and BreadcrumbList`)
        if (/^glossary\/|^(ar|de)\/glossary\//.test(where)) assert(types.includes("DefinedTermSet"), `${where} has a DefinedTermSet`)
        if (where === "index.html") assert(types.includes("Organization") && types.includes("SoftwareApplication"), "the home page has Organization and SoftwareApplication")
        for (const doc of docs) {
            assert(doc["@context"] === "https://schema.org", `${where} ${doc["@type"]} has the schema.org context`)
            for (const key of REQUIRED[doc["@type"]] ?? []) assert(doc[key] !== undefined && doc[key] !== "", `${where} ${doc["@type"]} has ${key}`)
            if (doc["@type"] === "BreadcrumbList") assert(doc.itemListElement.length >= 1 && doc.itemListElement.every((it, n) => it.position === n + 1 && it.name && it.item), `${where} breadcrumbs are numbered with a name and a URL`)
            if (doc["@type"] === "DefinedTermSet") assert(doc.hasDefinedTerm.length > 5 && doc.hasDefinedTerm.every(t => t.name && t.description && t.url.includes("#")), `${where} lists its terms`)
        }
        const lang = attr(html, /<html lang="([^"]+)"/)
        const article = docs.find(d => d["@type"] === "TechArticle")
        const fallback = robots(html)
        assert(article.inLanguage === (fallback ? "en" : lang), `${where} TechArticle inLanguage matches the content language`)
        const image = attr(html, /<meta property="og:image" content="([^"]+)"/)
        assert(image && image === attr(html, /<meta name="twitter:image" content="([^"]+)"/) && image === article.image[0], `${where} og:image, twitter:image and TechArticle agree`)
        const file2 = path.join(distRoot, image.replace(SITE, ""))
        assert(fs.existsSync(file2), `${where} og:image exists (${image})`)
        const size = jpegSize(fs.readFileSync(file2))
        assert(size && size[0] === 1200 && size[1] === 630, `${where} og:image is 1200x630`)
        og++
    }
    return { content, og }
}

async function seoLanes(browser, base) {
    const seo = seoFiles(DIST)
    console.log(`checked ${seo.content.length} pages, ${seo.og} social images`)
    const read = rel => fs.readFileSync(path.join(DIST, rel), "utf8")
    const deFallback = read("de/modules/khan/index.html")
    assert(/<meta name="robots" content="noindex"/.test(deFallback), "a German fallback page is noindex")
    assert(attr(deFallback, /<link rel="canonical" href="([^"]+)"/) === `${SITE}/modules/khan/`, "a German fallback page's canonical is the English page")
    assert(attr(deFallback, /<meta property="og:image" content="([^"]+)"/) === `${SITE}/og/en/modules/khan.jpeg`, "a fallback page shares the English social image")
    const deReal = read("de/quick-start/index.html")
    assert(!/name="robots"/.test(deReal), "the German quick start is indexable")
    assert(attr(deReal, /<link rel="canonical" href="([^"]+)"/) === `${SITE}/de/quick-start/`, "the German quick start has a self canonical")
    assert(attr(deReal, /<meta property="og:image" content="([^"]+)"/) === `${SITE}/og/de/quick-start.jpeg`, "the German quick start has a German social image")
    const hreflangs = [...deReal.matchAll(/hreflang="([^"]+)"/g)].map(m => m[1]).sort().join(",")
    assert(hreflangs === "ar,de,en,x-default", `hreflang lists only real translations and x-default (${hreflangs})`)
    const sitemap = read("sitemap-0.xml")
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])
    const noindexLocs = locs.filter(loc => /name="robots" content="noindex"/.test(read(new URL(loc).pathname.slice(1) + "index.html")))
    assert(locs.length > 10 && noindexLocs.length === 0, `the sitemap lists no noindex page (${locs.length} pages)`)
    const alternates = [...sitemap.matchAll(/hreflang="[^"]+" href="([^"]+)"/g)].map(m => m[1])
    assert(alternates.every(href => locs.includes(href)), "every sitemap alternate is itself a sitemap page")
    assert(!locs.some(loc => /\/404/.test(loc)), "the sitemap has no 404 page")

    assert(/Sitemap: https:\/\/docs\.neisesolutions\.com\/sitemap-index\.xml/.test(read("robots.txt")) && /Allow: \//.test(read("robots.txt")), "robots.txt allows all and names the sitemap")
    const llms = read("llms.txt"), full = read("llms-full.txt")
    assert(llms.startsWith("# GGE Command") && llms.includes("(https://docs.neisesolutions.com/quick-start/)"), "llms.txt names the site and links the quick start")
    assert(full.includes("# Quick start") && full.includes("`TOO_MANY_ATTACK_PLUGINS`") && !/\{%|%\}/.test(full), "llms-full.txt has the full text and no Markdoc tags")
    for (const locale of fs.readdirSync(path.join(DIST, "..", "src/content/i18n")).map(f => f.replace(".json", ""))) {
        const file = locale === "en" ? "404.html" : `${locale}/404/index.html`
        assert(fs.existsSync(path.join(DIST, file)), `a 404 page exists for ${locale}`)
    }
    for (const locale of ["bg", "fr"]) assert(fs.existsSync(path.join(DIST, `${locale}/404/index.html`)), `a 404 page exists for the fallback locale ${locale}`)
    const de404 = read("de/404/index.html")
    assert(/<html lang="de"/.test(de404) && /noindex/.test(de404) && /Seite nicht gefunden/.test(de404) && /data-gge-search-form/.test(de404) && /href="\/de\/"/.test(de404), "the German 404 is German, noindex, has a search box and a link home")

    for (const [url, name] of [["/404.html", "404"], ["/de/404/", "de 404"], ["/ar/404/", "ar 404"]]) {
        const page = await open(browser, base, url)
        await axe(page, name)
        assert(page.errors.length === 0 || /404/.test(page.errors[0]) && page.errors.length === 1, `no unexpected console errors on ${name}`)
        await page.screenshot({ path: `${out}/${name.replace(" ", "-")}.png` })
        await page.context().close()
    }
    const notFound = await open(browser, base, "/de/404/")
    await notFound.fill("#gge-notfound-q", "Bot starten")
    await notFound.press("#gge-notfound-q", "Enter")
    await notFound.locator("dialog[open]").waitFor()
    await notFound.waitForFunction(() => document.querySelector("#starlight__search .pagefind-ui__search-input")?.value === "Bot starten")
    assert(true, "the 404 search box opens the search dialog with the query typed in")
    await notFound.context().close()
    const queried = await open(browser, base, "/quick-start/?q=TOTP")
    await queried.locator("dialog[open]").waitFor()
    await queried.waitForFunction(() => document.querySelector("#starlight__search .pagefind-ui__search-input")?.value === "TOTP")
    assert(true, "?q= opens search pre-filled")
    await queried.context().close()

    const lang = async (url, locale, { viewport = WIDE, theme = "light" } = {}) => {
        const context = await browser.newContext({ viewport, locale })
        await context.addInitScript(t => { try { localStorage.setItem("starlight-theme", t) } catch {} }, theme)
        const page = await context.newPage()
        await page.goto(base + url)
        await page.waitForLoadState("networkidle")
        return page
    }
    const bar = page => page.locator("[data-gge-langbar]")
    const shown = async page => (await bar(page).count()) > 0 && (await bar(page).locator("a").count()) > 0
    const quick = await lang("/quick-start/", "de-DE")
    assert(await shown(quick), "the language bar shows for a de browser on a page with a German translation")
    assert((await bar(quick).locator("p").textContent()) === "Diese Seite auf Deutsch lesen?", "the bar speaks the suggested language")
    assert(await bar(quick).getAttribute("role") === "status" && await bar(quick).getAttribute("aria-live") === "polite", "the bar is a polite status region")
    assert(await bar(quick).locator("a").getAttribute("href") === "/de/quick-start/" && quick.url().endsWith("/quick-start/"), "the bar links to the German page and never redirects")
    const box = await bar(quick).locator("button").boundingBox()
    assert(box.width >= 44 && box.height >= 44, `the close button is ${box.width}x${box.height}`)
    assert(await bar(quick).evaluate(el => getComputedStyle(el).position === "fixed"), "the bar overlays the page, so nothing shifts")
    await axe(quick, "quick start with the language bar")
    await quick.screenshot({ path: `${out}/langbar-1440.png` })
    const before = await quick.evaluate(() => [document.documentElement.scrollHeight, document.querySelector("h2").getBoundingClientRect().top])
    await bar(quick).locator("button").focus()
    await quick.keyboard.press("Enter")
    assert(!(await shown(quick)), "the close button removes the bar")
    const after = await quick.evaluate(() => [document.documentElement.scrollHeight, document.querySelector("h2").getBoundingClientRect().top, document.activeElement?.tagName])
    assert(before[0] === after[0] && before[1] === after[1], "dismissing the bar moves nothing")
    assert(after[2] === "MAIN", "focus moves to the main content when the bar goes")
    await quick.reload()
    await quick.waitForLoadState("networkidle")
    assert(!(await shown(quick)), "the bar stays dismissed after a reload")
    assert(await quick.evaluate(() => localStorage.getItem("gge-langbar-dismissed")) === "1", "the dismissal is in localStorage")
    await quick.context().close()
    const phone = await lang("/quick-start/", "de-DE", { viewport: PHONE })
    assert(await shown(phone) && await overflow(phone) <= 0, "the bar fits at 390 with no horizontal scroll")
    await axe(phone, "quick start with the language bar at 390")
    await phone.screenshot({ path: `${out}/langbar-390.png` })
    await phone.context().close()
    const arabic = await lang("/de/quick-start/", "ar")
    assert(await shown(arabic) && (await bar(arabic).locator("a").getAttribute("href")) === "/ar/quick-start/", "the bar offers Arabic on the German page for an ar browser")
    await arabic.context().close()
    const fallbackBar = await lang("/fr/quick-start/", "de-DE")
    assert(!(await shown(fallbackBar)), "the bar does not show on a fallback page")
    await fallbackBar.context().close()
    const untranslated = await lang("/modules/khan/", "de-DE")
    assert(!(await shown(untranslated)), "the bar does not show on a page with no German translation")
    await untranslated.context().close()
    const english = await lang("/quick-start/", "en-US")
    assert(!(await shown(english)), "the bar does not show for an English browser on an English page")
    await english.context().close()
    const blocked = await browser.newContext({ locale: "de-DE" })
    await blocked.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked") } }) })
    const blockedPage = await blocked.newPage()
    const blockedErrors = []
    blockedPage.on("pageerror", e => blockedErrors.push(e.message))
    await blockedPage.goto(base + "/quick-start/")
    await blockedPage.waitForLoadState("networkidle")
    assert(await shown(blockedPage), "the bar shows when localStorage throws")
    const known = blockedErrors.length
    await bar(blockedPage).locator("button").click()
    assert(!(await shown(blockedPage)) && blockedErrors.length === known, "the bar closes without a new error when localStorage throws (Starlight's own theme script still logs its throws)")
    await blocked.close()

    const preview = path.join(out, "noindex-dist")
    execFileSync("pnpm", ["--filter", "@gge/docs", "exec", "astro", "build", "--outDir", preview], { cwd: path.join(__dirname, "../../../.."), env: { ...process.env, DOCS_NOINDEX: "1" }, stdio: "pipe" })
    const previewPages = htmlFiles(preview)
    const missing = previewPages.filter(file => !/<meta name="robots" content="noindex"/.test(fs.readFileSync(file, "utf8")))
    assert(previewPages.length > 150 && missing.length === 0, `a DOCS_NOINDEX=1 build puts the robots meta on all ${previewPages.length} pages${missing.length ? ": " + missing.slice(0, 3).join(", ") : ""}`)
    assert(!/name="robots"/.test(read("quick-start/index.html")), "the normal build has no robots meta on an indexable page")
    fs.rmSync(preview, { recursive: true, force: true })

}

/** Screenshots, hotspots, house icons and the Credits page. */
async function shotLanes(browser, base) {
    const icons = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../../packages/ui/src/icons/credits.json"), "utf8")).icons
    const svgCount = fs.readdirSync(path.join(__dirname, "../../../../packages/ui/src/icons")).filter(f => f.endsWith(".svg")).length

    const quick = await open(browser, base, "/quick-start/")
    const opener = quick.locator(".gge-shot__open").first()
    await opener.scrollIntoViewIfNeeded()
    const label = await opener.getAttribute("aria-label")
    assert(/^Enlarge screenshot: .{10,}/.test(label), `the screenshot opener says what it opens (${label})`)
    const sizes = await quick.locator(".gge-shot__open img").evaluateAll(imgs => imgs.map(i => [i.getAttribute("width"), i.getAttribute("height"), i.getAttribute("alt").length > 0]))
    assert(sizes.length > 0 && sizes.every(([w, h, alt]) => Number(w) > 0 && Number(h) > 0 && alt), "each screenshot image has width, height and alt")
    const sources = await quick.locator(".gge-shot__open picture").first().evaluate(p => [...p.querySelectorAll("source")].map(s => `${s.type} ${s.media || "default"}`))
    assert(sources.length === 3 && sources.some(x => x.startsWith("image/avif (max-width")) && sources.some(x => x.startsWith("image/webp (max-width")), `the picture has AVIF and WebP crops for phones and desktops (${sources.join("; ")})`)
    await opener.focus()
    await quick.keyboard.press("Enter")
    const dialog = quick.locator("dialog.gge-shot__dialog[open]")
    await dialog.waitFor()
    assert(await dialog.evaluate(d => d.matches(":modal")), "Enter on the screenshot opens a modal dialog")
    assert(await dialog.getAttribute("aria-label") !== null, "the lightbox is named by the alt text")
    await quick.waitForTimeout(300)
    await quick.screenshot({ path: `${out}/lightbox-1440.png` })
    await axe(quick, "the open lightbox")
    await quick.keyboard.press("Escape")
    assert(await quick.locator("dialog.gge-shot__dialog[open]").count() === 0, "Esc closes the lightbox")
    assert(await opener.evaluate(el => el === document.activeElement), "focus returns to the screenshot that opened it")
    await opener.click()
    await dialog.waitFor()
    await quick.locator("dialog[open] [data-close]").click()
    assert(await opener.evaluate(el => el === document.activeElement), "the Close button also returns focus")
    await quick.context().close()

    const phone = await open(browser, base, "/quick-start/", { viewport: PHONE })
    const phoneSrc = await phone.locator(".gge-shot__open img").first().evaluate(img => img.currentSrc)
    assert(/-390|390/.test(phoneSrc) || (await phone.locator(".gge-shot__open picture source").first().getAttribute("width")) === "390", `a phone gets the 390 crop (${phoneSrc.split("/").pop()})`)
    await phone.locator(".gge-shot__open").first().click()
    await phone.locator("dialog[open]").waitFor()
    await phone.keyboard.press("Escape")
    assert(await phone.locator("dialog[open]").count() === 0, "Esc closes the lightbox on a phone")
    assert(await overflow(phone) <= 0, "no horizontal scroll with a screenshot on a phone")
    await phone.context().close()

    let englishX
    for (const [url, lang] of [["/quick-start/", "en"], ["/ar/quick-start/", "ar"]]) {
        const page = await open(browser, base, url)
        const group = page.locator("[data-hotspots]").first()
        await group.scrollIntoViewIfNeeded()
        const spots = group.locator(".gge-spot")
        const legend = group.locator(".gge-legend > li")
        const n = await spots.count()
        assert(n >= 3 && n === await legend.count(), `${lang}: ${n} markers match ${await legend.count()} legend items`)
        assert(await spots.evaluateAll(els => els.every(el => el.tagName === "BUTTON" && el.getAttribute("aria-label")?.length > 0 && el.getAttribute("aria-controls") && document.getElementById(el.getAttribute("aria-controls"))?.closest(".gge-legend"))), `${lang}: each marker is a labelled button linked to its legend item`)
        const names = await spots.evaluateAll(els => els.map(el => el.getAttribute("aria-label")))
        assert(lang === "en" ? names[0] === "Marker 1" : names[0] !== "Marker 1" && /\d/.test(names[0]), `${lang}: marker labels come from the page's language (${names[0]})`)
        assert(await spots.evaluateAll(els => els.every(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 })), `${lang}: markers are at least 44px`)
        await page.evaluate(() => document.querySelector(".gge-shot__open").focus())
        let reached = -1
        for (let i = 0; i < 4 && reached < 0; i++) {
            await page.keyboard.press("Tab")
            reached = await spots.evaluateAll(els => els.indexOf(document.activeElement))
        }
        assert(reached === 0, `${lang}: Tab from the screenshot reaches the first marker`)
        await page.keyboard.press("Tab")
        assert(await spots.nth(1).evaluate(el => el === document.activeElement), `${lang}: Tab walks the markers in order`)
        await spots.nth(1).focus()
        await page.keyboard.press("Enter")
        assert(await legend.nth(1).evaluate(el => el === document.activeElement), `${lang}: Enter on a marker moves focus to its legend item`)
        assert(await legend.nth(1).evaluate(el => el.classList.contains("is-target")), `${lang}: the legend item is highlighted`)
        await spots.nth(0).hover()
        assert(await legend.nth(0).evaluate(el => el.classList.contains("is-paired")), `${lang}: hovering a marker tints its legend item`)
        const geometry = await page.evaluate(() => {
            const frame = document.querySelector(".gge-shot__frame").getBoundingClientRect()
            const spot = document.querySelector(".gge-spot").getBoundingClientRect()
            const li = document.querySelector(".gge-legend > li")
            const lr = li.getBoundingClientRect()
            const range = document.createRange()
            range.selectNodeContents(li)
            const text = range.getBoundingClientRect()
            return { x: ((spot.left + spot.width / 2 - frame.left) / frame.width) * 100, dir: getComputedStyle(li).direction, textFromStart: getComputedStyle(li).direction === "rtl" ? lr.right - text.right : text.left - lr.left }
        })
        assert(lang === "en" ? geometry.dir === "ltr" : geometry.dir === "rtl", `${lang}: the legend reads ${geometry.dir}`)
        assert(geometry.textFromStart > 20, `${lang}: the legend number badge sits on the inline-start side (${Math.round(geometry.textFromStart)}px before the text)`)
        if (lang === "en") englishX = geometry.x
        else assert(Math.abs(geometry.x - englishX) < 0.5, `ar: the marker stays on the same spot of the screenshot (${geometry.x.toFixed(1)}% vs ${englishX.toFixed(1)}%), because the capture is the unmirrored English one`)
        await page.screenshot({ path: `${out}/hotspots-${lang}-1440.png`, fullPage: false })
        await page.context().close()
    }

    const still = await open(browser, base, "/quick-start/", { reducedMotion: "reduce" })
    await still.locator("[data-hotspots]").first().scrollIntoViewIfNeeded()
    await still.waitForTimeout(500)
    assert(await still.locator(".gge-spot span").first().evaluate(el => getComputedStyle(el, "::after").animationName === "none"), "under reduced motion the markers do not pulse")
    await still.context().close()
    const moving = await open(browser, base, "/quick-start/")
    await moving.locator("[data-hotspots]").first().scrollIntoViewIfNeeded()
    await moving.waitForFunction(() => document.querySelector(".gge-spots[data-seen]"))
    const pulse = await moving.locator(".gge-spot span").first().evaluate(el => { const a = el.getAnimations({ subtree: true }).find(x => x.animationName === "gge-spot-pulse"); return a && a.effect.getComputedTiming().iterations })
    assert(pulse === 2, `the markers pulse twice on first view (${pulse} iterations)`)
    await moving.context().close()

    const khan = await open(browser, base, "/modules/khan/")
    const icon = khan.locator("img.gge-icon").first()
    assert(await icon.evaluate(img => img.alt === "" && img.complete && img.naturalWidth > 0 && img.width === 32), "the icon tag renders a loaded, decorative image at its size")
    await khan.context().close()
    const term = await open(browser, base, "/quick-start/")
    await term.locator(".gge-term__btn", { hasText: "plugins" }).first().click()
    await term.locator(".gge-term__pop:popover-open .gge-term__image").waitFor()
    assert(await term.locator(".gge-term__pop:popover-open .gge-term__image").evaluate(img => img.alt === "" && img.naturalWidth > 0), "a term popover shows its house icon")
    await term.context().close()
    const gloss = await open(browser, base, "/glossary/")
    assert(await gloss.locator("img.gge-gloss__image").count() >= 10, "the glossary shows a house icon for each term that names one")
    await gloss.context().close()

    const credits = await open(browser, base, "/credits/")
    const items = credits.locator(".gge-credits__item")
    assert(await items.count() === svgCount && svgCount === icons.length, `the Credits page lists all ${svgCount} icons`)
    for (const icon of icons) {
        const row = credits.locator(`.gge-credits__item[data-icon="${icon.id}"]`)
        const text = await row.innerText()
        assert(text.includes(icon.author) && await row.locator(`a[href="${icon.source}"]`).count() === 1 && await row.locator(`a[href="${icon.licenceUrl}"]`).count() === 1 && text.includes(icon.licence), `credits: ${icon.id} names ${icon.author} and links its source and licence`)
    }
    const body = await credits.locator("main").innerText()
    assert(/not affiliated with, endorsed by or sponsored by Goodgame Studios/.test(body), "the Credits page says GGE Command is not affiliated with Goodgame Studios")
    const footer = await credits.locator(".gge-footer-links a[href='/credits/']").count()
    assert(footer === 1, "the footer links to the Credits page")
    await credits.context().close()
    const qs = await open(browser, base, "/quick-start/")
    await qs.locator(".gge-footer-links a", { hasText: "Credits" }).click()
    await qs.waitForURL(/\/credits\/$/)
    assert(true, "the footer link opens the Credits page")
    await qs.context().close()
    for (const [url, lang, dir] of [["/de/credits/", "de", "ltr"], ["/ar/credits/", "ar", "rtl"]]) {
        const page = await open(browser, base, url)
        assert(await page.evaluate(([l, d]) => document.documentElement.lang === l && document.documentElement.dir === d, [lang, dir]), `/${lang}/credits/ is lang=${lang} dir=${dir}`)
        assert(await page.locator(".gge-credits__item").count() === svgCount, `/${lang}/credits/ lists every icon`)
        await page.context().close()
    }

    for (const [url, name] of [["/quick-start/", "quick start"], ["/ar/quick-start/", "ar quick start"], ["/de/quick-start/", "de quick start"], ["/modules/khan/", "attack khan"], ["/credits/", "credits"], ["/ar/credits/", "ar credits"], ["/de/credits/", "de credits"], ["/glossary/", "glossary"]]) {
        for (const theme of ["dark", "light"]) {
            const page = await open(browser, base, url, { theme })
            await axe(page, `${name} ${theme} 1440 (new tags)`)
            assert(await overflow(page) <= 0, `no horizontal scroll on ${name} ${theme} at 1440`)
            if (theme === "light") await page.screenshot({ path: `${out}/${name.replace(/ /g, "-")}-new-1440.png`, fullPage: true })
            await page.setViewportSize(PHONE)
            await page.waitForTimeout(300)
            await axe(page, `${name} ${theme} 390 (new tags)`)
            assert(await overflow(page) <= 0, `no horizontal scroll on ${name} ${theme} at 390`)
            if (theme === "light") await page.screenshot({ path: `${out}/${name.replace(/ /g, "-")}-new-390.png`, fullPage: true })
            assert(page.errors.length === 0, `no console errors on ${name} ${theme}${page.errors.length ? ": " + page.errors.join("; ") : ""}`)
            await page.context().close()
        }
    }
}

;(async () => {
    const { server, base } = await serve()
    const browser = await chromium.launch()
    try {
        assert(fs.existsSync(path.join(DIST, "quick-start/index.html")), "apps/docs/dist is built (pnpm --filter @gge/docs build)")
        if (process.env.DOCS_DRIVE_ONLY === "shots") {
            await shotLanes(browser, base)
            console.log("ALL OK (shot lanes only)")
            return
        }
        if (process.env.DOCS_DRIVE_ONLY === "seo") {
            await seoLanes(browser, base)
            console.log("ALL OK (seo lanes only)")
            return
        }

        for (const [url, name] of [["/quick-start/", "en"], ["/ar/quick-start/", "ar"]]) {
            for (const theme of ["dark", "light"]) {
                const page = await open(browser, base, url, { theme })
                await axe(page, `${name} ${theme} 1440`)
                await page.screenshot({ path: `${out}/${name}-${theme}-1440.png`, fullPage: true })
                assert(page.errors.length === 0, `no console errors on ${name} ${theme}${page.errors.length ? ": " + page.errors.join("; ") : ""}`)
                await page.setViewportSize(PHONE)
                await page.waitForTimeout(300)
                await axe(page, `${name} ${theme} 390`)
                assert(await overflow(page) <= 0, `no horizontal scroll on ${name} ${theme} at 390`)
                await page.screenshot({ path: `${out}/${name}-${theme}-390.png`, fullPage: true })
                const stray = await violets(page)
                assert(stray.length === 0, `no Starlight violet on ${name} ${theme}${stray.length ? ": " + stray.slice(0, 5).join("; ") : ""}`)
                await page.context().close()
            }
        }

        const de = await open(browser, base, "/de/quick-start/", { viewport: PHONE })
        assert(await overflow(de) <= 0, "no horizontal scroll on de at 390")
        assert(await de.evaluate(() => document.documentElement.lang === "de" && document.documentElement.dir === "ltr"), "/de/ is lang=de, dir=ltr")
        assert((await de.locator(".gge-aside--tip .gge-aside__label").textContent()) === "Profi-Tipp", "German aside label comes from the German i18n file")
        await de.context().close()

        const en = await open(browser, base, "/quick-start/")
        const labels = await en.locator(".gge-aside__label").allTextContents()
        assert(["Lore", "Heads up", "Pro tip", "Danger zone"].every(l => labels.includes(l)), `all four aside labels render: ${labels.join(", ")}`)
        const roles = await en.locator("aside.gge-aside").evaluateAll(els => els.map(e => [e.getAttribute("role"), e.querySelector("svg") !== null, e.querySelector(".gge-aside__label")?.textContent.length > 0]))
        assert(roles.length === 4 && roles.every(r => r[0] === "note" && r[1] && r[2]), "each aside is role=note with an icon and a text label")
        const hrefs = await en.locator("a.sl-anchor-link").evaluateAll(els => els.map(e => e.getAttribute("href")))
        assert(hrefs.includes("#start") && hrefs.includes("#watch-logs"), "headings keep their explicit ids")
        const mono = await en.evaluate(() => [getComputedStyle(document.querySelector(".sl-markdown-content")).fontSize, getComputedStyle(document.querySelector(".sl-markdown-content p")).lineHeight, getComputedStyle(document.querySelector(".site-title")).fontFamily, getComputedStyle(document.querySelector("h2")).fontFamily])
        assert(mono[0] === "17px" && mono[1] === "27.2px", `body is 17px with line height 1.6 (${mono[0]}, ${mono[1]})`)
        assert(/Cinzel/.test(mono[2]) && /Alegreya/.test(mono[3]) && !/Cinzel/.test(mono[3]), "the site title wears Cinzel and headings wear Alegreya")
        const fonts = await en.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === "loaded").map(f => f.family.replace(/"/g, "")) })
        assert(["Alegreya", "Alegreya Sans", "Cinzel"].every(f => fonts.includes(f)), `self-hosted fonts load: ${[...new Set(fonts)].join(", ")}`)
        assert(await en.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior === "smooth"), "smooth scroll applies when motion is allowed")

        await en.keyboard.press("Tab")
        assert(await en.evaluate(() => document.activeElement.getAttribute("href") === "#_top" && /skip/i.test(document.activeElement.textContent)), "Tab from page load reaches the skip link first")
        const ring = await en.evaluate(() => { const cs = getComputedStyle(document.activeElement); return [cs.outlineStyle, parseFloat(cs.outlineWidth), cs.outlineColor, getComputedStyle(document.documentElement).getPropertyValue("--gge-focus").trim()] })
        assert(ring[0] === "solid" && ring[1] >= 2, `the focused skip link shows a ${ring[1]}px ring in ${ring[2]}`)
        await en.keyboard.press("Control+k")
        await en.locator("dialog[open]").waitFor()
        assert(true, "Ctrl+K opens search")
        await en.keyboard.press("Escape")
        await en.context().close()

        const tablet = await open(browser, base, "/quick-start/", { viewport: PHONE })
        const small = await tablet.evaluate(() => {
            const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" }
            return [...document.querySelectorAll("button, select, summary, .sidebar-content a, .right-sidebar a")].filter(visible).filter(el => !el.matches(".gge-sidenote__mark, .gge-term__btn"))
                .map(el => [el.localName + "." + el.className, el.getBoundingClientRect()]).filter(([, r]) => r.width < 43.5 || r.height < 43.5).map(([n, r]) => `${n} ${Math.round(r.width)}x${Math.round(r.height)}`)
        })
        assert(small.length === 0, `controls are at least 44px at 390${small.length ? ": " + small.join("; ") : ""}`)
        const hit = await tablet.evaluate(() => { const cs = getComputedStyle(document.querySelector(".gge-sidenote__mark"), "::after"); return [parseFloat(cs.width), parseFloat(cs.height)] })
        assert(hit[0] >= 44 && hit[1] >= 44, `the side-note marker has a ${hit.join("x")} hit area`)
        await tablet.context().close()

        const narrow = await open(browser, base, "/quick-start/", { viewport: NARROW })
        const mark = narrow.locator(".gge-sidenote__mark").first()
        const note = narrow.locator("#server-match")
        assert((await mark.getAttribute("aria-expanded")) === "false" && (await mark.getAttribute("aria-controls")) === "server-match", "below 90rem the marker is a button with aria-expanded=false and aria-controls")
        assert(!(await note.isVisible()), "the note starts collapsed")
        await mark.focus()
        await narrow.keyboard.press("Enter")
        assert((await mark.getAttribute("aria-expanded")) === "true" && await note.isVisible(), "Enter expands the note")
        const under = await narrow.evaluate(() => { const n = document.getElementById("server-match").getBoundingClientRect(); const p = document.querySelector(".gge-sidenote__mark").closest("p").getBoundingClientRect(); return n.top >= p.bottom - 1 })
        assert(under, "the open note sits under its paragraph")
        await narrow.screenshot({ path: `${out}/sidenote-open-1100.png` })
        await narrow.keyboard.press("Enter")
        assert((await mark.getAttribute("aria-expanded")) === "false" && !(await note.isVisible()), "Enter again collapses it")
        await narrow.hover(".gge-sidenote__mark >> nth=0")
        await narrow.waitForTimeout(250)
        const tint = await narrow.evaluate(() => getComputedStyle(document.querySelector(".gge-sidenote__mark"), "::before").opacity)
        assert(Number(tint) > 0.1, `hovering the marker tints it (${tint})`)
        await narrow.context().close()

        const wide = await open(browser, base, "/quick-start/")
        assert(await wide.locator(".gge-sidenote__mark").first().getAttribute("aria-expanded") === null, "at 90rem the marker no longer claims to expand anything")
        const geometry = async page => page.evaluate(() => {
            const n = document.getElementById("plugin-def").getBoundingClientRect()
            const p = document.querySelector(".gge-sidenote__mark").closest("p")
            const longP = document.getElementById("server-match").closest("p").getBoundingClientRect()
            const toc = document.querySelector(".right-sidebar").getBoundingClientRect()
            const note = document.getElementById("server-match").getBoundingClientRect()
            return { note, longP, toc, over: document.documentElement.scrollWidth - innerWidth, visible: getComputedStyle(document.getElementById("server-match")).display !== "none" }
        })
        const g = await geometry(wide)
        assert(g.visible && g.note.left >= g.longP.right && g.note.right <= g.toc.left, "at 1440 the note sits in a margin column between the text and the TOC")
        assert(g.over <= 0, "no horizontal scroll at 1440")
        const numbers = await wide.evaluate(() => [...document.querySelectorAll(".gge-sidenote")].map(w => [w.querySelector(".gge-sidenote__mark").textContent, getComputedStyle(document.querySelector(`#${w.querySelector(".gge-sidenote__mark").getAttribute("aria-controls")} .gge-sidenote__num`), "::before").content]))
        assert(numbers.length > 0 && numbers.every(([mark, note]) => note === `"${mark}"`), `each margin note shows its marker's number (${JSON.stringify(numbers)})`)
        await wide.hover("#server-match")
        await wide.waitForTimeout(250)
        assert(Number(await wide.evaluate(() => getComputedStyle(document.querySelector(".gge-sidenote__mark"), "::before").opacity)) > 0.1, "hovering a note tints its marker")
        await wide.context().close()

        const rtl = await open(browser, base, "/ar/quick-start/")
        assert(await rtl.evaluate(() => document.documentElement.dir === "rtl" && document.documentElement.lang === "ar"), "/ar/ has dir=rtl")
        const r = await geometry(rtl)
        assert(r.note.right <= r.longP.left && r.note.left >= r.toc.right, "in RTL the note flips to the left, between the text and the TOC")
        await rtl.goto(base + "/ar/quick-start/#start")
        await rtl.waitForTimeout(400)
        assert(await barSide(rtl, ".gge-arrival") === "start-right", "in RTL the arrival bar sits on the right, the inline-start side")
        await rtl.screenshot({ path: `${out}/ar-arrival-1440.png` })
        await rtl.context().close()
        const ltr = await open(browser, base, "/quick-start/#start")
        await ltr.waitForTimeout(400)
        assert(await barSide(ltr, ".gge-arrival") === "start-left", "in LTR the arrival bar sits on the left")
        await ltr.context().close()

        for (const reduced of ["no-preference", "reduce"]) {
            for (const hash of ["start", "start-small", "server-match"]) {
                const page = await open(browser, base, `/quick-start/#${hash}`, { reducedMotion: reduced })
                await page.waitForTimeout(300)
                assert(await page.evaluate(h => document.activeElement.id === h, hash), `#${hash} takes focus on load (${reduced})`)
                const state = await page.evaluate(() => {
                    const frame = document.querySelector(".gge-arrival")
                    if (!frame) return null
                    const bar = getComputedStyle(frame, "::before"), tint = getComputedStyle(frame, "::after")
                    const rect = frame.getBoundingClientRect()
                    return { bar: bar.animationDuration, tint: tint.animationDuration, barOpacity: bar.opacity, tintDisplay: tint.display, visible: rect.width > 0 && rect.height > 0, top: rect.top }
                })
                assert(state !== null, `#${hash} shows the arrival highlight (${reduced})`)
                assert(state.top >= 56, `#${hash} is not hidden under the sticky header (top ${Math.round(state.top)}px)`)
                if (reduced === "reduce") assert(state.bar === "0s" && state.tint === "0s" && state.barOpacity === "1" && state.visible && state.tintDisplay === "none", `reduced motion: the bar shows at once, no animation runs, the tint is skipped and nothing is hidden (${hash})`)
                else assert(state.bar === "0.2s" && state.tint === "1.2s", `bar scales over ${state.bar}, tint fades over ${state.tint} (${hash})`)
                if (reduced === "reduce") assert(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior !== "smooth"), "reduced motion turns smooth scroll off")
                if (hash === "start" && reduced === "no-preference") await page.screenshot({ path: `${out}/arrival-start-1440.png` })
                await page.context().close()
            }
        }

        const hash = await open(browser, base, "/quick-start/")
        await hash.evaluate(() => { location.hash = "#watch-logs" })
        await hash.waitForTimeout(300)
        assert(await hash.evaluate(() => document.activeElement.id === "watch-logs" && document.querySelectorAll(".gge-arrival").length === 1), "a hashchange to a heading moves focus and shows the bar")
        await hash.evaluate(() => { location.hash = "#account-risk" })
        await hash.waitForTimeout(300)
        assert(await hash.evaluate(() => document.activeElement.id === "account-risk" && document.querySelector(".gge-arrival") === document.activeElement), "a hashchange to an aside moves the bar to the aside")
        await hash.screenshot({ path: `${out}/arrival-aside-1440.png` })
        await hash.context().close()

        const phone = await open(browser, base, "/quick-start/#plugin-def", { viewport: PHONE })
        await phone.waitForTimeout(300)
        assert(await phone.evaluate(() => document.activeElement.id === "plugin-def" && document.querySelector('[aria-controls="plugin-def"]').getAttribute("aria-expanded") === "true"), "arriving at a collapsed side note opens it and focuses it")
        await phone.context().close()

        const copy = await open(browser, base, "/quick-start/", { clipboard: true })
        await copy.locator(".gge-aside__copy").first().click()
        await copy.locator("[data-gge-live]", { hasText: "Link copied" }).waitFor({ timeout: 3000 })
        assert(true, "the polite live region says Link copied")
        assert(await copy.evaluate(() => document.querySelector("[data-gge-live]").getAttribute("aria-live") === "polite"), "the live region is aria-live=polite")
        assert(await copy.evaluate(() => navigator.clipboard.readText()) === `${base}/quick-start/#why-email`, "the copy button writes the URL with the aside's hash")
        await copy.waitForTimeout(250)
        const icons = await copy.evaluate(() => { const b = document.querySelector(".gge-aside__copy"); return [getComputedStyle(b.querySelector(".gge-aside__copy-check")).opacity, getComputedStyle(b.querySelector(".gge-aside__copy-link")).opacity, getComputedStyle(b.querySelector(".gge-aside__copy-check")).transitionDuration] })
        assert(icons[0] === "1" && icons[1] === "0" && icons[2] === "0.15s", `the icon swaps to a check over ${icons[2]}`)
        await copy.context().close()


        const phoneTerms = await open(browser, base, "/quick-start/", { viewport: PHONE })
        const termHit = await phoneTerms.evaluate(() => { const cs = getComputedStyle(document.querySelector(".gge-term__btn"), "::before"); return [parseFloat(cs.height)] })
        assert(termHit[0] >= 44, `a term button has a ${termHit[0]}px tall hit area at 390`)
        await phoneTerms.context().close()

        const termTests = async (url, name, viewport) => {
            const page = await open(browser, base, url, { viewport })
            const buttons = page.locator(".gge-term__btn")
            const count = await buttons.count()
            const listed = await page.locator(".gge-terms-card__item").count()
            assert(count > 0 && count === listed, `${name}: the page has ${count} term buttons, one per term in its Terms on this page card (${listed})`)
            const wiring = await page.evaluate(() => [...document.querySelectorAll(".gge-term__btn")].every(b => {
                const pop = document.getElementById(b.getAttribute("aria-controls"))
                return b.getAttribute("aria-expanded") === "false" && pop && pop.hasAttribute("popover") && pop.hasAttribute("data-pagefind-ignore") && pop.getAttribute("role") === "group" && document.getElementById(pop.getAttribute("aria-labelledby")) !== null
            }))
            assert(wiring, `${name}: each term button has aria-expanded=false, aria-controls to a labelled popover marked data-pagefind-ignore`)
            assert(await page.evaluate(() => document.querySelectorAll(".sl-markdown-content [title]").length === 0), `${name}: no title attributes in the content`)
            assert(await page.evaluate(() => document.querySelectorAll(".gge-term__pop .gge-term__pop, .gge-term__pop [popover]").length === 0), `${name}: no popover inside a popover`)
            return page
        }

        const termPage = await termTests("/quick-start/", "en 1440", WIDE)
        const first = termPage.locator(".gge-term__btn").first()
        const firstPop = termPage.locator(`#${await first.getAttribute("aria-controls")}`)
        await first.focus()
        await termPage.keyboard.press("Enter")
        await termPage.waitForFunction(el => el.getAttribute("aria-expanded") === "true", await first.elementHandle())
        assert(await first.getAttribute("aria-expanded") === "true" && await firstPop.evaluate(el => el.matches(":popover-open")), "Enter opens the term popover and sets aria-expanded=true")
        const snapshot = await firstPop.ariaSnapshot()
        assert(/group "Game account"/.test(snapshot) && /link "Read more"/.test(snapshot), `the open popover is a named group with a Read more link for a screen reader (${snapshot.replace(/\n/g, " ").slice(0, 120)})`)
        assert(await firstPop.locator("a.gge-term__more").getAttribute("href") === "/glossary/#game-account", "Read more links to the glossary anchor")
        const box = await firstPop.boundingBox()
        const trigger = await first.boundingBox()
        const below = box.y >= trigger.y + trigger.height - 1, above = box.y + box.height <= trigger.y + 1
        assert((below || above) && box.y >= 0 && box.y + box.height <= WIDE.height && box.x >= 0 && box.x + box.width <= WIDE.width, `the popover opens beside its term, flipping above when there's no room below, inside the viewport (pop ${JSON.stringify(box)}, term ${JSON.stringify(trigger)})`)
        await termPage.screenshot({ path: `${out}/term-popover-1440.png` })
        await termPage.keyboard.press("Tab")
        assert(await termPage.evaluate(() => document.activeElement.matches(".gge-term__more")), "Tab from the open term reaches Read more in the popover")
        await termPage.keyboard.press("Escape")
        await termPage.waitForFunction(el => el.getAttribute("aria-expanded") === "false", await first.elementHandle())
        assert(await first.getAttribute("aria-expanded") === "false" && !(await firstPop.evaluate(el => el.matches(":popover-open"))), "Esc closes the popover")
        assert(await termPage.evaluate(el => document.activeElement === el, await first.elementHandle()), "Esc returns focus to the term button")
        await first.focus()
        await termPage.keyboard.press("Space")
        await termPage.waitForFunction(el => el.getAttribute("aria-expanded") === "true", await first.elementHandle())
        assert(true, "Space opens it too")
        await termPage.keyboard.press("Escape")
        await termPage.mouse.move(5, 5)
        await first.hover()
        await termPage.waitForTimeout(120)
        assert(!(await firstPop.evaluate(el => el.matches(":popover-open"))), "hover alone does not open it before the 300 ms delay")
        await termPage.waitForTimeout(450)
        assert(await firstPop.evaluate(el => el.matches(":popover-open")), "hovering for 300 ms opens the popover")
        await termPage.mouse.move(5, 5)
        await termPage.waitForTimeout(500)
        assert(!(await firstPop.evaluate(el => el.matches(":popover-open"))), "moving away closes a hover popover")
        await termPage.context().close()

        const sheetPage = await termTests("/quick-start/", "en 390", PHONE)
        const sheetFirst = sheetPage.locator(".gge-term__btn").first()
        await sheetFirst.scrollIntoViewIfNeeded()
        await sheetFirst.click()
        const sheetPop = sheetPage.locator(`#${await sheetFirst.getAttribute("aria-controls")}`)
        await sheetPop.waitFor({ state: "visible" })
        await sheetPage.waitForTimeout(350)
        const sheet = await sheetPop.boundingBox()
        assert(Math.round(sheet.x) === 0 && Math.round(sheet.width) === PHONE.width && Math.round(sheet.y + sheet.height) === PHONE.height, `at 390 the popover is a bottom sheet (${JSON.stringify(sheet)})`)
        const close = sheetPop.locator(".gge-term__close")
        const closeBox = await close.boundingBox()
        assert(await close.isVisible() && closeBox.height >= 44, "the sheet has a close button at least 44px tall")
        await axe(sheetPage, "en light 390 with a term sheet open")
        await sheetPage.screenshot({ path: `${out}/term-sheet-390.png` })
        await close.click()
        assert(!(await sheetPop.evaluate(el => el.matches(":popover-open"))), "the close button closes the sheet")
        assert(await sheetPage.evaluate(el => document.activeElement === el, await sheetFirst.elementHandle()), "closing the sheet returns focus to the term")
        await sheetPage.context().close()

        const rtlTerms = await termTests("/ar/quick-start/", "ar 1440", WIDE)
        const rtlFirst = rtlTerms.locator(".gge-term__btn").first()
        await rtlFirst.focus()
        await rtlTerms.keyboard.press("Enter")
        const rtlPop = rtlTerms.locator(`#${await rtlFirst.getAttribute("aria-controls")}`)
        const rtlBox = await rtlPop.boundingBox()
        const rtlTrigger = await rtlFirst.boundingBox()
        assert(await rtlPop.evaluate(el => getComputedStyle(el).direction === "rtl" && getComputedStyle(el).textAlign === "start"), "the Arabic popover reads right to left")
        assert(rtlBox.x >= 0 && rtlBox.x + rtlBox.width <= WIDE.width && Math.abs((rtlBox.x + rtlBox.width) - (rtlTrigger.x + rtlTrigger.width)) < 2, `the Arabic popover lines up with the term's right edge (${Math.round(rtlBox.x + rtlBox.width)} vs ${Math.round(rtlTrigger.x + rtlTrigger.width)})`)
        await rtlTerms.screenshot({ path: `${out}/ar-term-popover-1440.png` })
        await rtlTerms.keyboard.press("Escape")
        await rtlTerms.context().close()

        const gloss = await open(browser, base, "/glossary/")
        const total = await gloss.locator(".gge-gloss").count()
        const countText = () => gloss.locator(".gge-glossary__count").textContent()
        assert(await gloss.locator(".gge-glossary__count").getAttribute("aria-live") === "polite" && await gloss.locator(".gge-glossary__count").getAttribute("role") === "status", "the result count is a polite live region")
        assert((await countText()).includes(String(total)), `the glossary starts with all ${total} terms: ${await countText()}`)
        assert(await gloss.locator(".gge-filter[aria-pressed=true]").count() === 1 && await gloss.locator(".gge-filter[aria-pressed=true]").textContent() === "All", "the All filter starts pressed")
        await gloss.locator(".gge-filter", { hasText: "Game" }).click()
        const games = await gloss.locator(".gge-gloss:not([hidden])").evaluateAll(els => els.map(e => e.dataset.category))
        assert(games.length > 0 && games.length < total && games.every(c => c === "game"), `the Game filter shows only game terms (${games.length})`)
        assert((await countText()).includes(String(games.length)), `the live region announces the new count: ${await countText()}`)
        assert(await gloss.locator(".gge-filter[aria-pressed=true]").textContent() === "Game", "the pressed filter follows the click")
        assert(await gloss.locator(".gge-letter:not([hidden]) .gge-gloss:not([hidden])").count() === games.length && await gloss.locator(".gge-letter[hidden]").count() > 0, "letter sections with no match hide")
        await gloss.screenshot({ path: `${out}/glossary-filtered-1440.png` })
        await gloss.evaluate(() => { location.hash = "#two-factor" })
        await gloss.waitForTimeout(300)
        assert(await gloss.locator(".gge-filter[aria-pressed=true]").textContent() === "All" && await gloss.evaluate(() => document.activeElement.id === "two-factor"), "a link to a hidden term resets the filter and focuses the entry")
        assert((await gloss.locator('[data-id="two-factor"] .gge-gloss__aliases').textContent()).includes("TOTP"), "the 2FA entry lists TOTP among its aliases")
        assert((await gloss.locator('[data-id="plugin"] .gge-gloss__used a').allTextContents()).includes("Quick start"), "Used on lists the Quick start for Plugin")
        assert(await gloss.locator('[data-id="game-account"] .gge-gloss__used').count() === 1 && await gloss.locator('[data-id="khan-camp"] .gge-gloss__used a').first().getAttribute("href") === "/modules/khan/", "Used on links are computed from the term tags on each page")
        await gloss.context().close()

        const search = async (browser, query, locale = "") => {
            const page = await open(browser, base, `${locale}/`, { viewport: WIDE })
            await page.keyboard.press("Control+k")
            await page.locator("dialog[open] input").fill(query)
            await page.locator("dialog[open] .pagefind-ui__result-link, dialog[open] a[href]").first().waitFor({ timeout: 8000 })
            await page.waitForTimeout(800)
            const hits = await page.locator("dialog[open] .pagefind-ui__result-link").evaluateAll(els => els.map(e => new URL(e.href).pathname))
            const results = await page.locator("dialog[open] .pagefind-ui__result").count()
            return { page, hits, results }
        }
        for (const query of ["TOO_MANY_ATTACK_PLUGINS", "too many attack plugins"]) {
            const { page, hits } = await search(browser, query)
            assert(hits.includes("/errors/"), `searching "${query}" finds the errors page (${hits.slice(0, 4).join(", ")})`)
            if (query === "TOO_MANY_ATTACK_PLUGINS") await page.screenshot({ path: `${out}/search-error-code.png` })
            await page.context().close()
        }
        const totp = await search(browser, "TOTP")
        assert(totp.hits[0] === "/glossary/" && totp.results === 1, `"TOTP" lands on the glossary as the only result (${totp.results} result: ${totp.hits.join(", ")})`)
        assert(!totp.hits.includes("/quick-start/"), "popover copies on the quick start stay out of the TOTP results")
        const totpLink = await totp.page.locator("dialog[open] .pagefind-ui__result-nested .pagefind-ui__result-link").first().getAttribute("href")
        assert(/#two-factor$/.test(totpLink), `the TOTP result jumps to the 2FA entry (${totpLink})`)
        await totp.page.screenshot({ path: `${out}/search-totp.png` })
        await totp.page.context().close()
        const popoverText = await search(browser, "six-digit code")
        assert(!popoverText.hits.includes("/quick-start/"), `a popover definition is not indexed on the page that uses it (${popoverText.hits.join(", ")})`)
        await popoverText.page.context().close()

        for (const [url, name] of [["/errors/", "errors"], ["/alerts/", "alerts"], ["/glossary/", "glossary"], ["/modules/khan/", "attack-khan"], ["/ar/errors/", "ar errors"], ["/ar/alerts/", "ar alerts"], ["/ar/glossary/", "ar glossary"]]) {
            for (const theme of ["dark", "light"]) {
                const page = await open(browser, base, url, { theme })
                await axe(page, `${name} ${theme} 1440`)
                assert(page.errors.length === 0, `no console errors on ${name} ${theme}${page.errors.length ? ": " + page.errors.join("; ") : ""}`)
                if (theme === "light") await page.screenshot({ path: `${out}/${name.replace(" ", "-")}-1440.png`, fullPage: false })
                await page.setViewportSize(PHONE)
                await page.waitForTimeout(300)
                await axe(page, `${name} ${theme} 390`)
                assert(await overflow(page) <= 0, `no horizontal scroll on ${name} ${theme} at 390`)
                if (theme === "light") await page.screenshot({ path: `${out}/${name.replace(" ", "-")}-390.png` })
                const stray = await violets(page)
                assert(stray.length === 0, `no Starlight violet on ${name} ${theme}${stray.length ? ": " + stray.slice(0, 3).join("; ") : ""}`)
                await page.context().close()
            }
        }

        const khan = await open(browser, base, "/modules/khan/")
        const rows = await khan.locator("table.gge-settings tbody tr").count()
        assert(rows > 10, `the Khan settings table lists ${rows} options`)
        const difficulty = await khan.locator('tr[data-option="eventDifficulty"]').evaluate(tr => [...tr.children].map(c => c.textContent))
        assert(difficulty[0] === "Event difficulty" && difficulty[1] === "Choice" && difficulty[2] === "Intermediate+" && difficulty[3].includes("Archmaster"), `a choice option shows its label, type, default and choices (${JSON.stringify(difficulty).slice(0, 120)})`)
        assert(await khan.locator(".gge-status--planned").count() === 1 && /Planned/.test(await khan.locator(".gge-status--planned").textContent()), "the planned status badge renders with a text label")
        await khan.context().close()
        const khanDe = await open(browser, base, "/de/modules/khan/")
        assert(await khanDe.locator('tr[data-option="eventDifficulty"] th').textContent() !== "Event difficulty", "the German page shows the German option label")
        await khanDe.context().close()

        const errorsPage = await open(browser, base, "/errors/#too-many-attack-plugins")
        await errorsPage.waitForTimeout(300)
        assert(await errorsPage.evaluate(() => document.activeElement.id === "too-many-attack-plugins" && document.querySelector("#too-many-attack-plugins code").textContent === "TOO_MANY_ATTACK_PLUGINS" && document.activeElement.closest("article").dataset.id === "too-many-attack-plugins"), "an error's anchor is the lowercase dashed code, shows the code as text and takes focus")
        assert(await errorsPage.evaluate(() => /Turn some attack plugins off|turn some attack plugins off/i.test(document.querySelector('[data-id="too-many-attack-plugins"] .gge-ref__fix').textContent)), "the fix text renders")
        assert(await errorsPage.locator("#admins-only").count() === 0, "admin-only codes stay off the page")
        assert(await errorsPage.locator("#plan-limit").count() === 1, "PLAN_LIMIT has an entry")
        await errorsPage.screenshot({ path: `${out}/errors-anchor-1440.png` })
        await errorsPage.context().close()
        const gate = await open(browser, base, "/quick-start/")
        assert((await gate.locator("#one-bot-each").textContent()).includes("Every account gets 1 bot while billing is off."), "plan-gate shows the billing-off line while billing is dormant")
        await gate.context().close()


        await shotLanes(browser, base)
        await seoLanes(browser, base)

        console.log("ALL OK")
    } finally {
        await browser.close()
        server.close()
    }
})().catch(e => { console.error(e.message); process.exit(1) })
