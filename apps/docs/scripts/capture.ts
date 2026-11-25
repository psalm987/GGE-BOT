// Captures GGE Command's own screens for the docs, against `pnpm dev`'s seeded stack (runner off).
// Usage: GGE_DEV_PORT_SHIFT=80 DEV_LOG=<dev stack output> node scripts/capture.ts [id ...]   (CAPTURE_OUT=<dir> writes elsewhere)
// Writes src/assets/screens/en/<id>-{1440,390}.webp. Two runs write identical files: the clock is frozen, the seeded
// timestamps are moved to one fixed instant, the page is in UTC with its animations stopped, and emails are masked.
process.env.TZ = "UTC"
import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { chromium } = require(path.join(homedir(), ".cache/gge-bot-verify/pw/node_modules/playwright"))
const { withDatabase, insertNotification } = require(path.join(here, "../../../.claude/skills/verify/scripts/dev-db.cjs"))

const shift = Number(process.env.GGE_DEV_PORT_SHIFT ?? 0)
const CLIENT_URL = process.env.CLIENT_URL ?? `http://localhost:${5173 + shift}`
const OUT = process.env.CAPTURE_OUT ?? path.join(here, "../src/assets/screens/en")
const NOW = new Date("2026-06-15T12:00:00Z")
const VIEWS = { 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } } as const
type Width = keyof typeof VIEWS

/** Every seeded time moves to NOW, in the order it was seeded, so relative and absolute times read the same on every run. */
async function fixTimes() {
    await withDatabase(async (db: any) => {
        const at = (offset: string) => `($1::timestamptz ${offset})`
        await db.query(`update bot_logs set ts = ${at("- ((select max(id) from bot_logs) - id) * interval '51 seconds'")}`, [NOW])
        await db.query(`update bot_status set heartbeat_at = case when actual_state = 'running' then ${at("- interval '40 seconds'")} else ${at("- interval '6 hours'")} end,
            banned_until = case when banned_until is null then null else ${at("+ interval '3 days'")} end,
            resources = case when resources is null then null else jsonb_set(resources, '{reportedAt}', to_jsonb(to_char(${at("- interval '40 seconds'")} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"'))) end`, [NOW])
        await db.query(`update bot_runs set started_at = case when end_reason = 'deploy' then ${at("- interval '30 hours'")} else ${at("- interval '20 hours'")} end,
            ended_at = case when ended_at is null then null when end_reason = 'deploy' then ${at("- interval '20 hours'")} else ${at("- interval '6 hours'")} end`, [NOW])
        await db.query("delete from notifications")
    })
    await insertNotification({ accountName: "Emberfall", kind: "crash_loop" })
    await insertNotification({ accountName: "Ironhold", kind: "incoming_attack" })
    await withDatabase(async (db: any) => {
        await db.query(`update notifications set created_at = case kind when 'crash_loop' then $1::timestamptz - interval '3 hours' else $1::timestamptz - interval '12 minutes' end,
            data = case kind when 'incoming_attack' then jsonb_set(data, '{arrival}', to_jsonb(to_char(($1::timestamptz + interval '10 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"'))) else data end`, [NOW])
    })
}

/** The Overview's attack and error counts come from the API's own clock, so the page gets the figures it would show at NOW. */
async function activityAtNow() {
    return withDatabase(async (db: any) => {
        const { rows } = await db.query(`select account_id as "accountId",
            count(*) filter (where parts->>4 = 'hittingTargetAttack' and ts > $1::timestamptz - interval '24 hours')::int as attacks,
            count(*) filter (where level = 2 and ts > $1::timestamptz - interval '7 days')::int as errors
            from bot_logs group by account_id order by account_id`, [NOW])
        return { accounts: rows.map((row: any) => ({ ...row, attacksComplete: true, errorsComplete: true })) }
    })
}

/** Software rasterising on one thread, with fixed text rendering, so a curve's edge pixels come out the same each run. */
const DETERMINISTIC_FLAGS = [
    "--disable-gpu", "--disable-gpu-rasterization", "--disable-accelerated-2d-canvas", "--disable-lcd-text", "--font-render-hinting=none",
    "--force-color-profile=srgb", "--run-all-compositor-stages-before-draw", "--disable-threaded-animation", "--disable-threaded-scrolling",
    "--disable-checker-imaging", "--disable-partial-raster", "--num-raster-threads=1",
]

const FREEZE_CSS = `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important }`

async function openPage(browser: any, width: Width, activity: unknown) {
    const context = await browser.newContext({
        viewport: VIEWS[width], deviceScaleFactor: 1, locale: "en-US", timezoneId: "UTC", colorScheme: "dark",
    })
    await context.addInitScript(() => { try { localStorage.setItem("gge.locale", "en") } catch {} })
    const page = await context.newPage()
    page.inflight = 0
    page.on("request", () => { page.inflight++ })
    page.on("requestfinished", () => { page.inflight-- })
    page.on("requestfailed", () => { page.inflight-- })
    await page.clock.setFixedTime(NOW)
    await page.route("**/rpc/logs/activity*", (route: any) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ json: activity }) }))
    await page.goto(`${CLIENT_URL}/login`)
    await page.getByLabel("Username or email").fill("demo")
    await page.getByLabel("Password").fill("demo-password")
    await page.getByRole("button", { name: "Sign in" }).click()
    await page.getByRole("heading", { name: "Overview" }).waitFor()
    const gotIt = page.getByRole("button", { name: "Got it" })
    if (await gotIt.count()) await gotIt.click()
    return page
}

const openSidebar = async (page: any, width: Width) => {
    if (width !== 390) return
    await page.getByRole("button", { name: "Open menu" }).click()
    await page.getByRole("dialog").waitFor()
}

/** Goes to a page the way a player does: filter the sidebar, click the link. */
async function viaSidebar(page: any, width: Width, name: string) {
    await page.goto(CLIENT_URL)
    await openSidebar(page, width)
    await page.getByLabel("Find a module").fill(name)
    const link = page.getByRole("navigation", { name: "Modules" }).getByRole("link", { name: new RegExp(`^${name}( Soon)?$`) }).first()
    await link.click()
}

async function pickAccount(page: any, account: string) {
    const picker = page.locator("#module-account")
    await picker.waitFor()
    if (!(await picker.locator("xpath=ancestor::div[contains(@class,'ant-select')][1]").innerText()).startsWith(account)) {
        await picker.click()
        await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option", { hasText: account }).first().click()
    }
}

async function pick(page: any, scope: any, name: string) {
    const box = scope.getByRole("combobox", { name, exact: true })
    await box.scrollIntoViewIfNeeded()
    await box.click()
    const dropdown = page.locator(`.ant-select-dropdown:has([id="${await box.getAttribute("aria-controls")}"])`)
    await dropdown.waitFor()
    await dropdown.locator(".rc-virtual-list-holder").evaluate((el: HTMLElement) => { el.scrollTop = 0 }).catch(() => {})
    await dropdown.locator(".ant-select-item-option").first().click()
    await dropdown.waitFor({ state: "hidden" })
}

type Shot = { id: string; show: (page: any, width: Width) => Promise<void>; frame?: (page: any, width: Width) => Promise<void>; clip?: (page: any, width: Width) => Promise<{ x: number; y: number; width: number; height: number } | undefined> }

const SHOTS: Shot[] = [
    { id: "overview", async show(page) {
        await page.goto(CLIENT_URL)
        await page.getByText("48,250,310").waitFor()
        await page.locator(".gge-top-accounts").waitFor()
    } },
    { id: "sidebar", async show(page, width) {
        await page.goto(CLIENT_URL)
        await openSidebar(page, width)
        await page.getByRole("button", { name: /^Attacks and gear$/i }).click()
    }, async clip(page, width) {
        if (width === 390) return undefined
        const box = await page.getByRole("navigation", { name: "Modules" }).boundingBox()
        return { x: 0, y: 0, width: 232, height: Math.min(900, box.y + box.height + 24) }
    } },
    { id: "towers", async show(page, width) {
        await viaSidebar(page, width, "Towers")
        await pickAccount(page, "Ironhold")
        await page.getByText("Account daily cap").waitFor()
    } },
    { id: "army-editor", async show(page, width) {
        await viaSidebar(page, width, "Fortress")
        await pickAccount(page, "Ironhold")
        await page.getByRole("tab", { name: "Attack fortresses (Burning Sands)", selected: true }).waitFor()
        const form = page.getByRole("tabpanel")
        await form.locator(`[aria-label="Army"] .ant-segmented-item`, { hasText: "Waves" }).click()
        const headers = form.locator(".ant-collapse-header")
        await headers.nth(0).click()
        await form.locator(`[aria-label="Wave 1 comes from"] .ant-segmented-item`, { hasText: "Custom slots" }).click()
        await pick(page, form, "Wave 1, Left flank, troop 1")
        await form.getByRole("spinbutton", { name: "Wave 1, Left flank, troop 1: how many" }).fill("40")
        await form.getByRole("spinbutton", { name: "Wave 1, Left flank, troop 1: how many" }).blur()
    }, async frame(page) {
        await page.getByRole("tabpanel").locator(`[aria-label="Army"]`).evaluate((el: HTMLElement) => window.scrollTo(0, Math.round(el.getBoundingClientRect().top + window.scrollY) - 140))
    } },
    { id: "virtual-presets", async show(page, width) {
        await viaSidebar(page, width, "Virtual presets")
        await pickAccount(page, "Ironhold")
        await page.getByRole("button", { name: "New preset" }).waitFor()
        await page.locator(".gge-preset-list li, :text('No virtual presets yet')").first().waitFor()
        if (await page.locator(".gge-preset-list li").count() === 0) {
            await page.getByRole("button", { name: "New preset" }).click()
            await page.getByLabel("Name", { exact: true }).fill("Ranged first")
            await page.locator(".ant-collapse-header").nth(0).click()
            await page.locator(`[aria-label="Wave 1 comes from"] .ant-segmented-item`, { hasText: "Custom slots" }).click()
            await pick(page, page, "Wave 1, Left flank, troop 1")
            await pick(page, page, "Courtyard row 2")
            await page.getByRole("button", { name: "Save" }).click()
            await page.getByText("Ranged first saved").first().waitFor()
        }
        await page.locator(".gge-preset-list li", { hasText: "Ranged first" }).waitFor()
    } },
    { id: "logs", async show(page) {
        await page.goto(`${CLIENT_URL}/logs`)
        await page.getByRole("log", { name: "Bot log" }).getByText("Attacking", { exact: false }).first().waitFor()
        await page.getByRole("button", { name: "Pause" }).click()
    } },
    { id: "alerts-bell", async show(page) {
        await page.goto(CLIENT_URL)
        await page.getByText("48,250,310").waitFor()
        await page.getByRole("button", { name: /^Notifications, [1-9]\d* unread$/ }).click()
        await page.getByText("Raider is attacking Ironhold Keep on Ironhold").first().waitFor()
    } },
    { id: "settings", async show(page) {
        await page.goto(`${CLIENT_URL}/settings`)
        await page.getByText("Delete account", { exact: true }).first().waitFor()
    } },
    { id: "add-account", async show(page) {
        await page.goto(`${CLIENT_URL}/?add=1`)
        await page.getByLabel("Game account name").waitFor()
    } },
    { id: "coming-soon", async show(page, width) {
        await viaSidebar(page, width, "Castle manager")
        await page.getByRole("heading", { name: "Castle manager" }).first().waitFor()
    } },
]

/** Emails are masked, and anything that moves on its own is hidden, before each shot. */
async function settle(page: any) {
    await page.mouse.move(1, 1)
    // Ant Design's motion needs its animationend, so each entrance finishes before the animations are switched off.
    await page.waitForTimeout(700)
    await page.waitForFunction(() => !document.querySelector(".ant-skeleton, .ant-spin-spinning"))
    for (let quiet = 0; quiet < 3; ) {
        await page.waitForTimeout(250)
        quiet = page.inflight === 0 ? quiet + 1 : 0
    }
    await page.addStyleTag({ content: FREEZE_CSS })
    await page.evaluate(async () => {
        await document.fonts.ready
        const mask = (text: string) => text.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "player@example.com")
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) node.nodeValue = mask(node.nodeValue ?? "")
        for (const input of document.querySelectorAll("input")) if (input.value.includes("@")) input.value = mask(input.value)
        for (const live of document.querySelectorAll("[data-live], .gge-live, .gge-reconnect")) (live as HTMLElement).style.visibility = "hidden"
        for (const dev of document.querySelectorAll('a[href="/m/dev-preview"]')) ((dev.closest("li") ?? dev) as HTMLElement).style.display = "none"
    })
    await page.waitForTimeout(400)
}

/** Screenshots until two in a row match, so a transition that is still finishing never ends up in the file. */
async function stableShot(page: any, clip?: object): Promise<Buffer> {
    let last: Buffer = await page.screenshot({ ...(clip && { clip }) })
    for (let tries = 0; tries < 20; tries++) {
        await page.waitForTimeout(150)
        const next: Buffer = await page.screenshot({ ...(clip && { clip }) })
        if (next.equals(last)) return next
        last = next
    }
    throw new Error("the page never stopped changing")
}

async function main() {
    const wanted = process.argv.slice(2)
    const shots = wanted.length ? SHOTS.filter(shot => wanted.includes(shot.id)) : SHOTS
    if (wanted.length && shots.length !== wanted.length) throw new Error(`unknown shot id in ${wanted.join(", ")}`)
    mkdirSync(OUT, { recursive: true })
    await fixTimes()
    const activity = await activityAtNow()
    const browser = await chromium.launch({ args: DETERMINISTIC_FLAGS })
    try {
        for (const width of [1440, 390] as const) {
            const page = await openPage(browser, width, activity)
            for (const shot of shots) {
                await shot.show(page, width)
                await settle(page)
                if (shot.frame) {
                    await shot.frame(page, width)
                    await page.mouse.move(1, 1)
                    await page.waitForTimeout(400)
                }
                const clip = await shot.clip?.(page, width)
                const png = await stableShot(page, clip)
                const file = path.join(OUT, `${shot.id}-${width}.webp`)
                const webp = await sharp(png).webp({ quality: 80, effort: 6 }).toBuffer()
                writeFileSync(file, webp)
                console.log(`${path.relative(process.cwd(), file)} ${webp.length} bytes`)
            }
            await page.context().close()
        }
    } finally {
        await browser.close()
    }
}

await main()
