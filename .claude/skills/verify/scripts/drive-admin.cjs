// Drives the new admin app the way a person does, against a running `pnpm dev` stack.
// Usage: node drive-admin.cjs [out-dir]   (default: .verify-evidence/<time>-admin)
const path = require("node:path")
const pw = process.env.HOME + "/.cache/gge-bot-verify/pw/node_modules/"
const { chromium } = require(pw + "playwright")
const { nextCode } = require("./dev-totp.cjs")
const axeSource = require("fs").readFileSync(pw + "axe-core/axe.min.js", "utf8")
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173"
const ADMIN_URL = process.env.ADMIN_URL ?? "http://localhost:5174"
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3000"
const out = process.argv[2] ?? path.join(__dirname, "../../../../.verify-evidence", `${new Date().toISOString().replace(/[:.]/g, "-")}-admin`)
require("fs").mkdirSync(out, { recursive: true })
const base = ADMIN_URL
const assert = (ok, what) => { if (!ok) throw new Error("FAILED: " + what); console.log("ok:", what) }

async function axe(page, name) {
    await page.waitForTimeout(700)
    await page.addScriptTag({ content: axeSource })
    const result = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => `${v.id} (${v.impact}): ${v.nodes.length} node(s) e.g. ${v.nodes[0].target.join(" ")}`))
    console.log(`axe ${name}: ${result.length ? "\n  " + result.join("\n  ") : "no WCAG A/AA violations"}`)
}

const call = async (path, body, cookie) => {
    const res = await fetch(`${API_URL}/rpc/${path}`, { method: "POST", headers: { origin: CLIENT_URL, "content-type": "application/json", ...(cookie && { cookie }) }, body: JSON.stringify({ json: body }) })
    return { json: (await res.json()).json, cookie: res.headers.getSetCookie()[0]?.split(";")[0] }
}

async function restoreIronhold() {
    const { cookie } = await call("auth/login", { login: "demo", password: "demo-password" })
    const list = (await call("accounts/list", {}, cookie)).json
    await call("accounts/setDesiredState", { ids: [list.find(a => a.name === "Ironhold").id], state: "running" }, cookie)
}

async function signIn(page, username) {
    await page.goto(`${base}/login`)
    await page.getByLabel("Username or email").fill(username)
    await page.getByLabel("Password").fill("demo-password")
    await page.getByRole("button", { name: "Sign in" }).click()
}

/** Types a current authenticator code and submits; true when the API took it. Another run may have just spent this step's code, so callers retry. */
async function submitCode(page, button, procedure) {
    for (let attempt = 0; attempt < 3; attempt++) {
        await page.getByLabel("Authenticator code").fill(await nextCode())
        const [response] = await Promise.all([
            page.waitForResponse(r => r.url().endsWith(`/admin/rpc/${procedure}`)),
            page.getByRole("button", { name: button, exact: true }).click(),
        ])
        if (response.ok())
            return
    }
    throw new Error(`FAILED: ${procedure} refused three authenticator codes`)
}

const nav = (page, name) => page.getByRole("menuitem", { name }).click()
const confirm = (page, name) => page.locator(".ant-popover").getByRole("button", { name, exact: true }).click()

;(async () => {
    await restoreIronhold()
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

    await page.goto(base)
    await page.getByRole("heading", { name: "Admin sign in" }).waitFor()
    assert(true, "unauthenticated visit redirects to Admin sign in")
    await axe(page, "login")
    await page.screenshot({ path: `${out}/admin-login-1440.png` })
    await signIn(page, "demo")
    const alert = await page.getByRole("alert").first().textContent()
    assert(/not an admin/i.test(alert), `player demo is refused: "${alert}"`)

    await signIn(page, "admin")
    await page.getByRole("heading", { name: "Two-factor sign-in" }).waitFor()
    assert(await page.getByLabel("Authenticator code").getAttribute("autocomplete") === "one-time-code", "the right password leads to the authenticator code step, not into the app")
    await axe(page, "two-factor code")
    await page.screenshot({ path: `${out}/admin-2fa-code-1440.png` })
    await page.getByRole("button", { name: "Use a recovery code" }).click()
    await page.getByLabel("Recovery code").waitFor()
    assert(await page.getByLabel("Authenticator code").count() === 0, "Use a recovery code swaps the code field for a recovery code field")
    await axe(page, "two-factor recovery code")
    await page.screenshot({ path: `${out}/admin-2fa-recovery-1440.png` })
    await page.getByRole("button", { name: "Use an authenticator code" }).click()
    await page.getByLabel("Authenticator code").fill("12345")
    await page.getByRole("button", { name: "Verify" }).click()
    await page.getByText("Enter the 6-digit code").waitFor()
    assert(true, "a 5-digit code is caught in the form")
    await submitCode(page, "Verify", "auth/verifyTotp")
    await page.getByRole("heading", { name: "Overview" }).waitFor()
    assert(true, "a current authenticator code signs the admin in")
    await page.getByText("Game accounts").first().waitFor()
    assert(await page.getByText("The runner isn't reporting").isVisible(), "overview shows the runner warning")
    const stat = await page.locator(".ant-statistic").filter({ hasText: "Users" }).first().textContent()
    assert(/\d/.test(stat), `overview shows user count (${stat})`)
    assert(await page.getByText("Bots by state").isVisible(), "overview shows bots by state")
    await axe(page, "overview")
    await page.screenshot({ path: `${out}/admin-overview-1440.png` })
    assert(await page.getByRole("menuitem", { name: "Invites" }).count() === 0, "there is no Invites page")

    await nav(page, "Accounts")
    const iron = page.getByRole("row").filter({ hasText: "Ironhold" })
    await iron.waitFor()
    await axe(page, "accounts")
    await page.screenshot({ path: `${out}/admin-accounts-1440.png` })
    await iron.getByRole("button", { name: "Force stop" }).click()
    await confirm(page, "Force stop")
    await page.getByText("Account stopped").waitFor()
    await iron.getByRole("button", { name: "Force stop" }).waitFor({ state: "detached" })
    assert(true, "Ironhold force-stopped; the action disappears")

    await nav(page, "Users")
    const demo = () => page.getByRole("row").filter({ hasText: "demo" }).filter({ hasText: /Player/ })
    await demo().getByRole("button", { name: "Disable" }).click()
    await page.getByText("Disabling ends their sessions and stops their bots.").waitFor()
    assert(true, "disable confirm explains the effect")
    await axe(page, "users with popconfirm")
    await confirm(page, "Disable")
    await demo().getByText("Disabled", { exact: true }).waitFor()
    assert(true, "demo is disabled")
    await demo().getByRole("button", { name: "Enable" }).click()
    await demo().getByText("Active", { exact: true }).waitFor()
    assert(true, "demo is re-enabled")
    const { cookie: demoCookie } = await call("auth/login", { login: "demo", password: "demo-password" })
    const addBot = name => call("accounts/create", { name, serverId: 26, password: "x" }, demoCookie)
    const owned = (await call("accounts/list", {}, demoCookie)).json.length
    const limit = page.getByLabel("Bot limit for demo")
    assert(await limit.inputValue() === "1", `demo starts at the default limit of 1 bot, owning ${owned} (existing bots are kept)`)
    assert((await addBot("Capped")).json.code === "FORBIDDEN", "demo is refused another bot at the limit")
    await limit.fill(String(owned + 1))
    await limit.blur()
    await page.getByText("Bot limit updated").waitFor()
    assert((await addBot("Capped")).json.name === "Capped", `after the admin raises demo's limit to ${owned + 1}, demo can add a bot`)
    await page.reload()
    await nav(page, "Users")
    assert(await page.getByLabel("Bot limit for demo").inputValue() === String(owned + 1), "the raised limit persisted")
    await page.screenshot({ path: `${out}/admin-users-bot-limit.png` })
    await call("accounts/remove", { ids: [(await call("accounts/list", {}, demoCookie)).json.find(a => a.name === "Capped").id] }, demoCookie)
    await page.getByLabel("Bot limit for demo").fill("1")
    await page.getByLabel("Bot limit for demo").blur()
    await page.getByText("Bot limit updated").waitFor()
    assert(true, "demo's limit and bots restored")
    const self = page.getByRole("row").filter({ hasText: "admin" }).filter({ hasText: /Admin/ }).first()
    assert(await self.getByRole("button", { name: /Reset 2FA/ }).count() === 0, "an admin gets no Reset 2FA action on their own row")
    await self.getByRole("button", { name: "Disable" }).click()
    await confirm(page, "Disable")
    await page.waitForTimeout(1500)
    const notices = await page.locator(".ant-message-notice").allTextContents()
    const refusal = notices.find(t => !/updated/i.test(t)) ?? ""
    assert(refusal.trim().length > 0, `self-disable refused: "${refusal}"`)
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${out}/admin-users-1440.png` })
    await axe(page, "users")

    const names = async () => (await page.locator(".ant-table-tbody tr.ant-table-row td:first-child").allTextContents()).map(t => t.trim())
    /** The table's first-column texts as soon as `ok` accepts them, so a request still in flight has landed; the last texts if none do within 8 s. */
    const rowsUntil = async ok => {
        let rows = await names()
        for (let i = 0; i < 32 && !ok(rows); i++) { await page.waitForTimeout(250); rows = await names() }
        return rows
    }
    const is = expected => rows => JSON.stringify(rows) === JSON.stringify(expected)
    const urlHas = part => page.waitForFunction(p => location.search.includes(p), part)

    await page.goto(`${base}/users?size=1`)
    await page.locator(".ant-table-tbody tr.ant-table-row").first().waitFor()
    const pageOne = await rowsUntil(r => r.length === 1)
    assert(pageOne.length === 1, `page size 1 in the URL shows 1 user (${pageOne})`)
    await page.locator(".ant-pagination-item-2").click()
    await urlHas("page=2")
    const pageTwo = await rowsUntil(r => r.length > 0 && r.every(n => !pageOne.includes(n)))
    assert(pageTwo.length > 0 && pageTwo.every(n => !pageOne.includes(n)), `page 2 shows different users (${pageTwo})`)
    await page.reload()
    await page.locator(".ant-table-tbody tr.ant-table-row").first().waitFor()
    assert(is(pageTwo)(await rowsUntil(is(pageTwo))), "reload keeps page 2")

    await page.goto(`${base}/users`)
    await page.getByLabel("Search users").fill("demo")
    await urlHas("q=demo")
    { const got = await rowsUntil(is(["demo"])); assert(is(["demo"])(got), `search narrows the table to the matching user (${got})`) }
    await page.reload()
    assert(await page.getByLabel("Search users").inputValue() === "demo", "reload keeps the search text")
    assert(is(["demo"])(await rowsUntil(is(["demo"]))), "reload keeps the search result")
    await page.goto(`${base}/users?size=1&page=2&q=m`)
    await page.locator(".ant-table-tbody tr.ant-table-row").first().waitFor()
    await page.getByLabel("Search users").fill("demo")
    await page.waitForFunction(() => !location.search.includes("page="))
    assert(is(["demo"])(await rowsUntil(is(["demo"]))), "changing the search returns to page 1")

    await page.goto(`${base}/users`)
    const allUsers = await rowsUntil(r => r.length > 1)
    await page.getByLabel("Filter by role").click()
    await page.locator(".ant-select-item-option").filter({ hasText: "Admin" }).click()
    await urlHas("role=admin")
    const adminsOnly = await rowsUntil(r => r.length < allUsers.length)
    assert(adminsOnly.length > 0 && adminsOnly.length < allUsers.length, `the role filter narrows the table (${allUsers.length} to ${adminsOnly.length})`)
    assert(await page.locator(".ant-table-tbody tr.ant-table-row").filter({ hasText: /Player/ }).count() === 0, "only admins are listed under the Admin filter")
    await axe(page, "users search and filters")
    await page.screenshot({ path: `${out}/admin-users-filtered-1440.png` })

    await page.goto(`${base}/accounts?size=1`)
    await page.locator(".ant-table-tbody tr.ant-table-row").first().waitFor()
    await page.getByLabel("Search accounts").fill("zzz-no-such-account")
    await page.getByText("No game accounts").waitFor()
    assert(true, "an account search with no match shows the empty state, with the search box still there")
    await page.getByLabel("Search accounts").fill("Ironhold")
    await page.locator(".ant-table-tbody tr.ant-table-row").filter({ hasText: "Ironhold" }).waitFor()
    await page.getByLabel("Filter by state").click()
    await page.locator(".ant-select-item-option").filter({ hasText: "Banned" }).click()
    await urlHas("state=banned")
    await page.waitForTimeout(700)
    assert(await page.locator(".ant-table-tbody tr.ant-table-row").filter({ hasText: "Ironhold" }).count() === 0, "the state filter removes accounts in other states")
    await axe(page, "accounts search and filters")
    await nav(page, "Users")

    await nav(page, "Audit")
    await page.getByRole("heading", { name: "Audit log" }).waitFor()
    await page.getByText("user.disable").first().waitFor()
    const text = await page.locator("tbody").textContent()
    for (const a of ["user.disable", "user.enable", "auth.login.admin"]) assert(text.includes(a), `audit shows ${a}`)
    assert(text.includes("admin"), "audit shows actor admin")
    assert(text.includes("account.force_stop"), "audit shows account.force_stop")
    await axe(page, "audit")
    await page.screenshot({ path: `${out}/admin-audit-1440.png` })

    await nav(page, "Settings")
    await page.getByRole("button", { name: "Regenerate recovery codes" }).click()
    const dialog = page.getByRole("dialog", { name: "Regenerate recovery codes" })
    await dialog.getByLabel("Authenticator code").waitFor()
    await axe(page, "settings regenerate recovery codes")
    await page.screenshot({ path: `${out}/admin-settings-regenerate-1440.png` })
    await submitCode(page, "Regenerate", "security/regenerateRecoveryCodes")
    const fresh = page.getByRole("dialog", { name: "Your new recovery codes" })
    await fresh.getByText("Shown once").waitFor()
    const codes = await fresh.getByRole("list", { name: "Recovery codes" }).getByRole("listitem").allTextContents()
    assert(codes.length === 10 && codes.every(c => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(c)), `regenerating with a current code shows 10 new recovery codes once (${codes.length})`)
    await axe(page, "settings new recovery codes")
    await page.screenshot({ path: `${out}/admin-settings-recovery-codes-1440.png` })
    await fresh.getByRole("button", { name: "I've saved them" }).click()
    await fresh.waitFor({ state: "hidden" })

    await page.setViewportSize({ width: 390, height: 844 })
    for (const [path, file] of [["/", "overview"], ["/users", "users"], ["/accounts", "accounts"], ["/audit", "audit"], ["/settings", "settings"]]) {
        await page.goto(base + path)
        await page.locator(".ant-layout-header").waitFor()
        await page.waitForTimeout(900)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        assert(overflow === 0, `no horizontal overflow at 390 on ${file} (diff ${overflow})`)
        if (file === "overview" || file === "users") await page.screenshot({ path: `${out}/admin-${file}-390.png` })
    }

    await browser.close()
    console.log("ALL OK")
})().catch(e => { console.error(e); process.exit(1) })
