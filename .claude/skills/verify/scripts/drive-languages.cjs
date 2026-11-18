// Visits the main player and admin screens in each language and records what the translations break.
// Usage: LANGS=ar,hu,it,de DEV_LOG=<dev log> node drive-languages.cjs [out-dir]   (default: .verify-evidence/languages-run)
// Against `pnpm dev`, with GGE_DEV_PORT_SHIFT set, point CLIENT_URL, ADMIN_URL and API_URL at the shifted ports.
// Failing checks print as FAIL lines and the script exits 1 at the end, so one bad screen doesn't hide the rest.
const fs = require("node:fs")
const path = require("node:path")
const pw = process.env.HOME + "/.cache/gge-bot-verify/pw/node_modules/"
const { chromium } = require(pw + "playwright")
const { adminSessionCookie } = require("./dev-totp.cjs")
const { insertNotification, insertResources } = require("./dev-db.cjs")
const axeSource = fs.readFileSync(pw + "axe-core/axe.min.js", "utf8")
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173"
const ADMIN_URL = process.env.ADMIN_URL ?? "http://localhost:5174"
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3000"
const LANGS = (process.env.LANGS ?? "ar,hu,it,de").split(",")
const root = path.join(__dirname, "../../../..")
const outRoot = process.argv[2] ?? path.join(root, ".verify-evidence", "languages-run")
const WIDE = { width: 1440, height: 900 }, PHONE = { width: 390, height: 844 }

const catalogDir = path.join(root, "packages/i18n/catalogs")
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"))
const catalogCache = {}
function catalogOf(lng) {
    if (catalogCache[lng]) return catalogCache[lng]
    const merged = {}
    const dir = path.join(catalogDir, lng)
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".json")))
        Object.assign(merged, readJson(path.join(dir, file)))
    const bot = path.join(root, "packages/bot-core/locales", `${lng}.json`)
    if (fs.existsSync(bot))
        for (const [key, value] of Object.entries(readJson(bot))) merged["bot:" + key] = value
    return catalogCache[lng] = merged
}
const english = catalogOf("en")
const words = text => text.match(/\p{L}+/gu) ?? []
const needles = lng => {
    const local = catalogOf(lng)
    const list = []
    for (const [key, value] of Object.entries(english)) {
        if (typeof value !== "string") continue
        for (const segment of value.split(/\{\{[^}]*\}\}/)) {
            const trimmed = segment.trim().toLowerCase()
            if (words(trimmed).length >= 3 && /^[\x20-\x7e’]+$/.test(trimmed))
                list.push({ text: trimmed, key, same: local[key] === value })
        }
    }
    return list
}

const failures = []
let current = ""
const record = (ok, what) => {
    console.log(`${ok ? "ok" : "FAIL"}: [${current}] ${what}`)
    if (!ok) failures.push(`[${current}] ${what}`)
}

async function axe(page) {
    await page.addScriptTag({ content: axeSource })
    return page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => `${v.id} (${v.impact}): ${v.nodes.length} node(s) e.g. ${v.nodes[0].target.join(" ")}`))
}

const probe = () => {
    const visible = el => {
        const style = getComputedStyle(el)
        if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false
        const box = el.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && !el.closest(".gge-sr-only, [aria-hidden='true']")
    }
    const texts = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent.replace(/\s+/g, " ").trim()
        if (text && node.parentElement && !/^(SCRIPT|STYLE|NOSCRIPT)$/.test(node.parentElement.tagName) && visible(node.parentElement))
            texts.push(text)
    }
    for (const el of document.querySelectorAll("[title]"))
        if (visible(el) && el.title.trim()) texts.push(el.title.trim())
    const clipped = []
    for (const el of document.querySelectorAll("body *")) {
        if (!el.childNodes.length || !visible(el)) continue
        const style = getComputedStyle(el)
        const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
        if (!own) continue
        const hidden = /hidden|clip/.test(style.overflowX)
        if (hidden && el.scrollWidth > el.clientWidth + 1 && style.textOverflow !== "ellipsis")
            clipped.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")} "${el.textContent.trim().slice(0, 40)}" ${el.scrollWidth}>${el.clientWidth}`)
    }
    const wide = []
    for (const el of document.querySelectorAll("body *")) {
        if (!visible(el)) continue
        const box = el.getBoundingClientRect()
        const sheet = el.closest(".ant-drawer-content, .ant-modal, .ant-table-content, .ant-table-body, [class*='scroll']")
        if (!sheet && (box.right > window.innerWidth + 1 || box.left < -1) && getComputedStyle(el).position !== "fixed")
            wide.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")} left=${Math.round(box.left)} right=${Math.round(box.right)}`)
    }
    return {
        lang: document.documentElement.lang, dir: document.documentElement.dir,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        texts, clipped: clipped.slice(0, 8), wide: wide.slice(0, 8),
    }
}

const samples = {}
const leftovers = {}
async function snapshot(page, lng, screen, width, dirOut, list) {
    await page.waitForTimeout(500)
    await page.evaluate(() => document.fonts.ready)
    const label = `${screen} ${width}`
    current = `${lng} ${label}`
    const info = await page.evaluate(probe)
    record(info.lang === lng, `html lang is ${lng} (${info.lang})`)
    record(info.dir === (lng === "ar" ? "rtl" : "ltr"), `html dir is ${lng === "ar" ? "rtl" : "ltr"} (${info.dir})`)
    record(info.overflow <= 0, `no horizontal overflow, scrollWidth - innerWidth = ${info.overflow}`)
    for (const line of info.wide) console.log(`  note: [${current}] element past the viewport edge: ${line}`)
    for (const line of info.clipped) console.log(`  note: [${current}] text clipped without an ellipsis: ${line}`)
    const violations = await axe(page)
    record(violations.length === 0, violations.length ? "axe: " + violations.join(" | ") : "axe: no WCAG A/AA violations")
    const file = `${screen.replace(/\W+/g, "-")}-${width}.png`
    await page.screenshot({ path: path.join(dirOut, file), fullPage: !screen.startsWith("dialog"), timeout: 40_000 })
    const found = lng === "en" ? [] : needles(lng)
    const lower = info.texts.map(t => t.toLowerCase())
    for (const needle of found)
        for (const text of lower)
            if (text.includes(needle.text)) {
                const id = `${needle.key}\t${needle.same ? "catalog is identical to English" : "catalog is translated"}\t${needle.text}`
                const entry = (leftovers[lng] ??= new Map()).get(id) ?? new Set()
                entry.add(label)
                leftovers[lng].set(id, entry)
            }
    for (const text of info.texts)
        for (const m of text.match(/\d{1,3}(?:[.,   ]\d{3})+(?:[.,]\d+)?|\d{1,2}\.? \p{L}{3,9}\.?(?: \d{4})?(?:,? \d{1,2}:\d{2})?|\p{L}{3,9}\.? \d{1,2},? \d{4}/gu) ?? [])
            (samples[lng] ??= new Map()).set(m, label)
    list?.push(info)
}

async function bothWidths(page, lng, screen, dirOut) {
    await page.setViewportSize(WIDE)
    await snapshot(page, lng, screen, 1440, dirOut)
    await page.setViewportSize(PHONE)
    await snapshot(page, lng, screen, 390, dirOut)
    await page.setViewportSize(WIDE)
}

const call = async (base, p, body, cookie, origin) => {
    const res = await fetch(`${base}/${p}`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": "10.9.9.9", ...(cookie && { cookie }) }, body: JSON.stringify({ json: body }) })
    return { json: (await res.json()).json, cookie: res.headers.getSetCookie()[0]?.split(";")[0] }
}
const asCookie = (pair, url) => ({ name: pair.split("=")[0], value: pair.slice(pair.indexOf("=") + 1), url })

async function screens(label, fn) {
    current = `${current.split(" ")[0]} ${label}`
    try { await fn() } catch (error) {
        record(false, `${label} did not finish: ${String(error.message).split("\n")[0]}`)
    }
}

async function drivePlayer(browser, lng, dirOut, demoCookie) {
    const context = await browser.newContext({ viewport: WIDE })
    await context.addCookies([asCookie(demoCookie, CLIENT_URL)])
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    current = lng
    const t = (key, params = {}) => (catalogOf(lng)[key] ?? english[key]).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => params[name])
    const bot = key => catalogOf(lng)["bot:" + key] ?? english["bot:" + key]
    const apple = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent))
    const edit = page.getByRole("button", { name: t("dashboard.edit", { name: "Ironhold" }), exact: true })
    const drawer = page.getByRole("dialog").last()

    await page.goto(CLIENT_URL)
    await page.evaluate(async code => { await fetch("/rpc/account/setLocale", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: { locale: code } }) }) }, lng)
    await page.reload()
    await page.waitForFunction(code => document.documentElement.lang === code, lng)

    await screens("home", async () => {
        await edit.waitFor()
        await bothWidths(page, lng, "home", dirOut)
    })
    await screens("drawer overview", async () => {
        await edit.click()
        await drawer.locator(".ant-tabs-tab").first().waitFor()
        await bothWidths(page, lng, "drawer overview", dirOut)
    })
    await screens("drawer plugins", async () => {
        await drawer.locator(".ant-tabs-tab").nth(1).click()
        await page.getByRole("switch", { name: t("plugins.enable", { label: bot("attackNomads") }), exact: true }).waitFor()
        await bothWidths(page, lng, "drawer plugins", dirOut)
    })
    await screens("close drawer", async () => {
        await page.keyboard.press("Escape")
        await page.getByRole("dialog").waitFor({ state: "hidden" })
    })
    for (const [id, screen] of [["nom-sam-daimyo", "module nomads"], ["invasion-events", "module invasion events"], ["castle-manager", "module coming soon"]])
        await screens(screen, async () => {
            await page.goto(`${CLIENT_URL}/m/${id}`)
            await page.locator(".gge-module-plugin-row, .ant-tag").first().waitFor()
            await page.locator(".gge-module-tools .ant-segmented-item").last().click({ timeout: 1000 }).catch(() => {})
            await page.waitForTimeout(200)
            await bothWidths(page, lng, screen, dirOut)
        })
    await screens("logs", async () => {
        await page.goto(`${CLIENT_URL}/logs?level=1`)
        await page.locator(".gge-term-level, .gge-terminal, [class*='gge-term']").first().waitFor()
        await bothWidths(page, lng, "logs filtered", dirOut)
        await page.setViewportSize(PHONE)
        const filters = page.locator("button", { hasText: /\(\d+\)|\（\d+\）/ }).first()
        if (await filters.count()) {
            await filters.click()
            await page.getByRole("dialog").last().waitFor()
            await snapshot(page, lng, "logs filters drawer", 390, dirOut)
            await page.keyboard.press("Escape")
        } else console.log(`  note: [${lng}] no Filters (n) button found at 390 on /logs`)
        await page.setViewportSize(WIDE)
    })
    await screens("settings", async () => {
        await page.goto(`${CLIENT_URL}/settings`)
        await page.waitForSelector("form, .ant-card")
        await bothWidths(page, lng, "settings", dirOut)
    })
    await screens("bell", async () => {
        await page.goto(CLIENT_URL)
        await edit.waitFor()
        await page.locator("button:has(.anticon-bell)").first().click()
        await page.locator(".gge-notifications").waitFor()
        await bothWidths(page, lng, "notification bell", dirOut)
        await page.keyboard.press("Escape")
    })
    await screens("palette", async () => {
        await page.goto(CLIENT_URL)
        await edit.waitFor()
        await page.keyboard.press(apple ? "Meta+k" : "Control+k")
        await page.locator(".gge-cmdk-group").first().waitFor()
        await bothWidths(page, lng, "command palette", dirOut)
        await page.keyboard.press("Escape")
    })
    await context.close()
}

async function driveAdmin(browser, lng, dirOut, adminCookie) {
    const context = await browser.newContext({ viewport: WIDE })
    await context.addCookies([asCookie(adminCookie, ADMIN_URL)])
    await context.addInitScript(code => { try { localStorage.setItem("gge.locale", code) } catch {} }, lng)
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    current = lng
    for (const [route, screen] of [["/users", "admin users"], ["/billing", "admin billing"]])
        await screens(screen, async () => {
            await page.goto(ADMIN_URL + route)
            await page.waitForFunction(code => document.documentElement.lang === code, lng)
            await page.locator("table, .ant-tabs, .ant-card").first().waitFor()
            await bothWidths(page, lng, screen, dirOut)
        })
    await context.close()
}

;(async () => {
    const demo = await call(API_URL, "rpc/auth/login", { login: "demo", password: "demo-password" }, undefined, CLIENT_URL)
    const adminCookie = await adminSessionCookie({ apiUrl: API_URL, adminUrl: ADMIN_URL })
    await insertResources({ accountName: "Ironhold", resources: { castles: [], cash: 1_240_567, gold: 12_345, food: 4_000_000, aquamarin_name: 5_300, attackDailyCount: 38 } })
    await insertNotification({ accountName: "Ironhold", kind: "crash_loop" })
    const browser = await chromium.launch()
    try {
        for (const lng of LANGS) {
            const dirOut = path.join(outRoot, lng)
            fs.mkdirSync(dirOut, { recursive: true })
            await drivePlayer(browser, lng, dirOut, demo.cookie)
            await driveAdmin(browser, lng, dirOut, adminCookie)
        }
    } finally {
        await call(API_URL, "rpc/account/setLocale", { locale: null }, demo.cookie, CLIENT_URL)
        await browser.close()
    }
    for (const lng of LANGS) {
        console.log(`\nleftover English in ${lng} (key, whether the catalog itself is English, text, screens):`)
        for (const [id, screens] of leftovers[lng] ?? []) console.log(`  ${id}\t${[...screens].join("; ")}`)
        console.log(`numbers and dates seen in ${lng}:`)
        for (const [text, screen] of [...(samples[lng] ?? [])].slice(0, 25)) console.log(`  "${text}" (${screen})`)
    }
    console.log(`\n${failures.length} failing checks`)
    for (const line of failures) console.log("FAIL " + line)
    console.log(`evidence: ${outRoot}`)
    process.exit(failures.length ? 1 : 0)
})().catch(error => { console.error(error); process.exit(2) })
