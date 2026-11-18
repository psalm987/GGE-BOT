// Drives the built docs site (apps/docs/dist) in a browser the way a reader does. It serves dist itself.
// Usage: pnpm --filter @gge/docs build && node drive-docs.cjs [out-dir]   (default: .verify-evidence/<time>-docs)
const path = require("node:path")
const fs = require("node:fs")
const http = require("node:http")
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
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".xml": "application/xml", ".txt": "text/plain" }

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

async function open(browser, base, url, { theme = "dark", viewport = WIDE, reducedMotion = "no-preference", clipboard = false } = {}) {
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

;(async () => {
    const { server, base } = await serve()
    const browser = await chromium.launch()
    try {
        assert(fs.existsSync(path.join(DIST, "quick-start/index.html")), "apps/docs/dist is built (pnpm --filter @gge/docs build)")

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
            return [...document.querySelectorAll("button, select, summary, .sidebar-content a, .right-sidebar a")].filter(visible).filter(el => !el.matches(".gge-sidenote__mark"))
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

        console.log("ALL OK")
    } finally {
        await browser.close()
        server.close()
    }
})().catch(e => { console.error(e.message); process.exit(1) })
