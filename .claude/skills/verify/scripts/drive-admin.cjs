// Drives the new admin app the way a person does, against a running `pnpm dev` stack.
// Usage: node drive-admin.cjs [out-dir]   (default: .verify-evidence/<time>-admin)
const path = require("node:path")
const pw = process.env.HOME + "/.cache/gge-bot-verify/pw/node_modules/"
const { chromium } = require(pw + "playwright")
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

async function restoreIronhold() {
    const call = async (path, body, cookie) => {
        const res = await fetch(`${API_URL}/rpc/${path}`, { method: "POST", headers: { origin: CLIENT_URL, "content-type": "application/json", ...(cookie && { cookie }) }, body: JSON.stringify({ json: body }) })
        return { json: (await res.json()).json, cookie: res.headers.getSetCookie()[0]?.split(";")[0] }
    }
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
    await page.getByRole("heading", { name: "Overview" }).waitFor()
    await page.getByText("Game accounts").first().waitFor()
    assert(await page.getByText("The runner isn't reporting").isVisible(), "overview shows the runner warning")
    const stat = await page.locator(".ant-statistic").filter({ hasText: "Users" }).first().textContent()
    assert(/\d/.test(stat), `overview shows user count (${stat})`)
    assert(await page.getByText("Bots by state").isVisible(), "overview shows bots by state")
    await axe(page, "overview")
    await page.screenshot({ path: `${out}/admin-overview-1440.png` })

    await nav(page, "Invites")
    await page.getByRole("button", { name: "Create invite" }).first().click()
    await page.getByRole("dialog", { name: "Create invite" }).getByRole("button", { name: "Create", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Invite created" })
    await dialog.waitFor()
    const code = await dialog.getByLabel("Invite code").inputValue()
    const link = await dialog.getByLabel("Signup link").inputValue()
    assert(code.length > 10 && link === `${CLIENT_URL}/signup?invite=${code}`, "created invite shows code and signup link once")
    assert(await dialog.getByText("This code won't be shown again.").isVisible(), "warns the code is shown once")
    await axe(page, "invite-created modal")
    await dialog.getByRole("button", { name: "Done" }).click()
    await dialog.waitFor({ state: "hidden" })
    assert(await page.getByText(code).count() === 0, "code is gone after closing")
    await page.screenshot({ path: `${out}/admin-invites-1440.png` })
    await axe(page, "invites")
    const openRows = page.getByRole("row").filter({ hasText: "Open" })
    const before = await openRows.count()
    await openRows.first().getByRole("button", { name: "Revoke" }).click()
    await confirm(page, "Revoke")
    await page.getByText("Invite revoked").waitFor()
    await page.waitForFunction(n => [...document.querySelectorAll("tbody tr")].filter(r => r.textContent.includes("Open")).length === n, before - 1)
    assert(true, `revoking an invite takes open invites from ${before} to ${before - 1}`)

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
    const self = page.getByRole("row").filter({ hasText: "admin" }).filter({ hasText: /Admin/ }).first()
    await self.getByRole("button", { name: "Disable" }).click()
    await confirm(page, "Disable")
    await page.waitForTimeout(1500)
    const notices = await page.locator(".ant-message-notice").allTextContents()
    const refusal = notices.find(t => !/updated/i.test(t)) ?? ""
    assert(refusal.trim().length > 0, `self-disable refused: "${refusal}"`)
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${out}/admin-users-1440.png` })
    await axe(page, "users")

    await nav(page, "Audit")
    await page.getByRole("heading", { name: "Audit log" }).waitFor()
    await page.getByText("user.disable").first().waitFor()
    const text = await page.locator("tbody").textContent()
    for (const a of ["invite.create", "invite.revoke", "user.disable", "user.enable"]) assert(text.includes(a), `audit shows ${a}`)
    assert(text.includes("admin"), "audit shows actor admin")
    assert(text.includes("account.force_stop"), "audit shows account.force_stop")
    await axe(page, "audit")
    await page.screenshot({ path: `${out}/admin-audit-1440.png` })

    await page.setViewportSize({ width: 390, height: 844 })
    for (const [path, file] of [["/", "overview"], ["/users", "users"], ["/invites", "invites"], ["/accounts", "accounts"], ["/audit", "audit"]]) {
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
