// Drives the new player app the way a person does, against a running `pnpm dev` stack.
// Usage: node drive-client.cjs [out-dir]   (default: .verify-evidence/<time>-client)
const path = require("node:path")
const pw = process.env.HOME + "/.cache/gge-bot-verify/pw/node_modules/"
const { chromium } = require(pw + "playwright")
const { adminSessionCookie } = require("./dev-totp.cjs")
const axeSource = require("fs").readFileSync(pw + "axe-core/axe.min.js", "utf8")
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173"
const ADMIN_URL = process.env.ADMIN_URL ?? "http://localhost:5174"
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3000"
const DEV_LOG = process.env.DEV_LOG ?? "/tmp/gge-dev.log"
const out = process.argv[2] ?? path.join(__dirname, "../../../../.verify-evidence", `${new Date().toISOString().replace(/[:.]/g, "-")}-client`)
require("fs").mkdirSync(out, { recursive: true })
const assert = (ok, what) => { if (!ok) throw new Error("FAILED: " + what); console.log("ok:", what) }

async function axe(page, name) {
    await page.addScriptTag({ content: axeSource })
    const result = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => `${v.id} (${v.impact}): ${v.nodes.length} node(s) e.g. ${v.nodes[0].target.join(" ")}`))
    console.log(`axe ${name}: ${result.length ? "\n  " + result.join("\n  ") : "no WCAG A/AA violations"}`)
}

let adminCookie
/** Sets a player's bot limit through the admin API, as the seeded admin (signed in once per run). */
async function setMaxBots(username, maxBots) {
    adminCookie ??= await adminSessionCookie({ apiUrl: API_URL, adminUrl: ADMIN_URL })
    const call = async (path, body) => {
        const res = await fetch(`${API_URL}/admin/rpc/${path}`, { method: "POST", headers: { origin: ADMIN_URL, "content-type": "application/json", cookie: adminCookie }, body: JSON.stringify({ json: body }) })
        return (await res.json()).json
    }
    const user = (await call("users/list", { search: username })).find(u => u.username === username)
    await call("users/setMaxBots", { id: user.id, maxBots })
}

async function addAccount(page, accountName) {
    await page.getByLabel("Game account name").fill(accountName)
    await page.getByLabel("Server").click()
    await page.keyboard.type("Germany")
    await page.locator(".ant-select-item-option", { hasText: "Germany 1" }).click()
    await page.getByLabel("Game password").fill("hunter2")
    await page.getByRole("button", { name: "Add account", exact: true }).last().click()
    await page.getByText(`${accountName} added`).waitFor()
    await drawerClosed(page)
}

// The drawer keeps its own "Add account" button on screen until its close animation ends.
const drawerClosed = page => page.locator(".ant-drawer-content-wrapper").waitFor({ state: "hidden" })

/** The link in the newest email the dev API logged for an address (the log mailer prints every message). */
function emailedLink(address) {
    const lines = require("fs").readFileSync(DEV_LOG, "utf8").split("\n").reverse()
    for (const line of lines) {
        try {
            const entry = JSON.parse(line)
            if (entry.to === address) return entry.text.match(/https?:\/\/\S+/)[0]
        } catch {}
    }
    throw new Error(`no email logged for ${address}; start the stack with its output in ${DEV_LOG}`)
}

;(async () => {
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    const name = "u" + Date.now().toString(36)
    await page.goto(`${CLIENT_URL}/signup`)
    await page.getByRole("heading", { name: "Join the campaign" }).waitFor()
    await axe(page, "signup")
    assert(await page.getByLabel("Invite code").count() === 0, "signup asks for no invite code")
    const top = label => page.getByLabel(label, { exact: true }).evaluate(el => Math.round(el.getBoundingClientRect().top))
    assert(await top("Password") === await top("Confirm password"), "password and confirm share a row on a wide screen")
    await page.screenshot({ path: `${out}/client-signup-1280.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    assert(await top("Password") < await top("Confirm password"), "password and confirm stack at 390 px")
    assert(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) === 0, "no horizontal overflow on signup at 390")
    await page.screenshot({ path: `${out}/client-signup-390.png`, fullPage: true })
    await page.setViewportSize({ width: 1280, height: 860 })
    await page.getByLabel("Username").fill(name)
    await page.getByLabel("Email").fill(`${name}@example.test`)
    await page.getByLabel("Password", { exact: true }).fill("a-strong-password")
    await page.getByLabel("Confirm password").fill("a-different-password")
    await page.getByRole("button", { name: "Create account" }).click()
    await page.getByText("The passwords don't match").waitFor()
    assert(true, "mismatched passwords are caught before submitting")
    await page.getByLabel("Confirm password").fill("a-strong-password")
    await page.getByRole("button", { name: "Create account" }).click()

    await page.getByText("Confirm your email", { exact: true }).waitFor()
    assert(await page.getByText("No accounts yet").count() === 0, "an unverified player sees the email gate, not the roster")
    await axe(page, "email gate")
    await page.screenshot({ path: `${out}/client-email-gate-1280.png` })
    const verifyPage = await browser.newPage()
    await verifyPage.goto(emailedLink(`${name}@example.test`))
    await verifyPage.getByText("Email verified").waitFor()
    await verifyPage.close()
    await page.reload()
    await page.getByText("No accounts yet").waitFor()
    assert(await page.getByText("Confirm your email", { exact: true }).count() === 0, "the roster opens once the emailed link is opened")
    await axe(page, "empty dashboard")

    await page.getByRole("menuitem", { name: "Settings" }).click()
    await page.getByRole("heading", { name: "Change password" }).waitFor().catch(() => {})
    await page.getByLabel("Current password").fill("a-strong-password")
    await page.getByLabel("New password", { exact: true }).fill("another-strong-password")
    await page.getByLabel("Confirm new password").fill("another-strong-password")
    await page.getByRole("button", { name: "Change password" }).click()
    await page.getByText("Password changed").waitFor()
    await axe(page, "settings")
    assert(true, "Settings changes the password")
    await page.getByRole("menuitem", { name: "Accounts" }).click()

    const resetPage = await browser.newPage()
    await resetPage.goto(`${CLIENT_URL}/forgot-password`)
    await resetPage.getByLabel("Email").fill(`${name}@example.test`)
    await resetPage.getByRole("button", { name: "Send reset link" }).click()
    await resetPage.getByText("a reset link is on its way").waitFor()
    await resetPage.goto(emailedLink(`${name}@example.test`))
    await resetPage.getByLabel("New password", { exact: true }).fill("third-strong-password")
    await resetPage.getByLabel("Confirm new password").fill("third-strong-password")
    await resetPage.getByRole("button", { name: "Change password" }).click()
    await resetPage.getByText("Password changed").first().waitFor()
    await resetPage.goto(`${CLIENT_URL}/login`)
    await resetPage.getByLabel("Username or email").fill(`${name}@example.test`)
    await resetPage.getByLabel("Password").fill("third-strong-password")
    await resetPage.getByRole("button", { name: "Sign in" }).click()
    await resetPage.getByText("No accounts yet").waitFor()
    assert(true, "forgot password, reset link, then sign in by email with the new password")
    await resetPage.close()
    await page.reload()
    await page.getByRole("heading", { name: "Sign in" }).waitFor()
    assert(true, "the reset signed the first browser out")
    await page.goto(`${CLIENT_URL}/login`)
    await page.getByLabel("Username or email").fill(name)
    await page.getByLabel("Password").fill("third-strong-password")
    await page.getByRole("button", { name: "Sign in" }).click()
    await page.getByText("No accounts yet").waitFor()

    await page.getByRole("button", { name: "Add your first account" }).click()
    await page.getByLabel("Game account name").fill(`Storm${name}`)
    await page.getByLabel("Server").click()
    await page.keyboard.type("Germany")
    await page.locator(".ant-select-item-option", { hasText: "Germany 1" }).click()
    await page.getByLabel("Game password").fill("hunter2")
    await page.screenshot({ path: `${out}/10-add-account.png` })
    await axe(page, "add-account drawer")
    await page.getByRole("button", { name: "Add account", exact: true }).last().click()
    await page.waitForTimeout(1500)
    const alerts = await page.getByRole("alert").allTextContents()
    const fieldErrors = await page.locator(".ant-form-item-explain-error").allTextContents()
    if (alerts.length || fieldErrors.length) console.log("form errors:", alerts, fieldErrors)
    await page.getByText(`Storm${name} added`).waitFor()
    await drawerClosed(page)
    const row = page.getByRole("row", { name: new RegExp(`Storm${name}`) })
    await row.waitFor()
    assert(await row.getByText("Stopped").isVisible(), "new account shows as stopped")
    assert(await page.getByRole("button", { name: "Add account", exact: true }).isDisabled(), "Add account is disabled at the one-bot limit")
    assert(await page.getByText("Your plan allows 1 bot. Remove one to add another.").first().isVisible(), "the limit is explained on the page")
    await page.screenshot({ path: `${out}/10b-at-bot-limit.png` })
    const refused = await page.evaluate(async serverId => {
        const res = await fetch("/rpc/accounts/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: { name: "OneTooMany", serverId, password: "x" } }) })
        return { status: res.status, code: (await res.json()).json?.code }
    }, 27)
    assert(refused.status === 403 && refused.code === "FORBIDDEN", "calling the API directly for a second bot is refused (FORBIDDEN)")

    await row.getByRole("button", { name: "Start" }).click()
    await row.getByRole("button", { name: "Stop" }).waitFor()
    assert(true, "Start flips to Stop at once (optimistic)")
    await page.reload()
    await page.getByRole("row", { name: new RegExp(`Storm${name}`) }).getByRole("button", { name: "Stop" }).waitFor()
    assert(true, "desired state persisted across reload")
    const liveStatus = await page.evaluate(async () => (await fetch("/rpc/realtime/connectionToken", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status)
    if (liveStatus === 200) {
        // browser.newPage() owns its context, so the second tab is a context that shares the first one's session cookie.
        const tab = await (await browser.newContext({ storageState: await page.context().storageState() })).newPage()
        const events = []
        tab.on("websocket", ws => ws.on("framereceived", frame => events.push(String(frame.payload))))
        await tab.goto(CLIENT_URL)
        const tabRow = tab.getByRole("row", { name: new RegExp(`Storm${name}`) })
        await tabRow.getByRole("button", { name: "Stop" }).waitFor()
        await tab.waitForTimeout(1000)
        await row.getByRole("button", { name: "Stop" }).click()
        await tabRow.getByRole("button", { name: "Start" }).waitFor({ timeout: 5000 })
        assert(events.some(frame => /"kind": ?"account"/.test(frame) && /"desiredState": ?"stopped"/.test(frame)), "a second tab shows the stop live, from a websocket event")
        assert(await tab.getByRole("status").locator(".ant-tag").count() === 0, "no Reconnecting badge while live")
        await tab.close()
    } else {
        assert(liveStatus === 501, "Centrifugo isn't running, so the API says live updates are off (the second-tab check is skipped)")
        await row.getByRole("button", { name: "Stop" }).click()
    }
    await row.getByRole("button", { name: "Start" }).waitFor()

    await page.getByRole("button", { name: `Edit Storm${name}` }).click()
    await page.getByLabel("Game account name").fill(`Storm${name} Keep`)
    await page.getByRole("button", { name: "Cancel" }).click()
    await page.getByRole("dialog", { name: "Discard your changes?" }).waitFor()
    assert(true, "closing with unsaved edits asks first")
    await page.getByRole("button", { name: "Keep editing" }).click()
    await page.getByRole("button", { name: "Save changes" }).click()
    await page.getByText(`Storm${name} Keep saved`).waitFor()
    await page.getByRole("row", { name: new RegExp(`Storm${name} Keep`) }).waitFor()
    assert(true, "rename saved and shown")

    await page.getByRole("row", { name: new RegExp(`Storm${name} Keep`) }).getByRole("checkbox").check()
    await page.getByRole("button", { name: "Remove" }).click()
    await page.getByText("Remove 1 account?").first().waitFor()
    await page.screenshot({ path: `${out}/11-remove-confirm.png` })
    await page.getByRole("button", { name: "Remove", exact: true }).last().click()
    await page.getByText("No accounts yet").waitFor()
    assert(true, "remove asks to confirm, then the roster is empty again")

    const gale = `Gale${name}`
    await page.getByRole("button", { name: "Add your first account" }).click()
    await addAccount(page, gale)
    assert(await page.getByRole("button", { name: "Add account", exact: true }).isDisabled(), "Add account is disabled again at the limit")
    await page.getByRole("button", { name: `Add event twin for ${gale}` }).click()
    await page.getByText(`Add event twin for ${gale}`, { exact: true }).waitFor()
    assert(await page.getByLabel("Game account name").inputValue() === gale, "the twin drawer is prefilled with the main's name")
    assert(await page.getByRole("switch", { name: "External event account" }).isChecked(), "the twin drawer has External event on")
    assert(await page.locator('.ant-select-content[title="Germany 1"]').count() > 0, "the twin drawer is prefilled with the main's server")
    await axe(page, "add-twin drawer")
    await page.getByLabel("Game password").fill("hunter2")
    await page.getByRole("button", { name: "Add account", exact: true }).last().click()
    await page.getByText(`${gale} added`).waitFor()
    await drawerClosed(page)
    const galeRows = page.getByRole("row", { name: new RegExp(gale) })
    await galeRows.nth(1).waitFor()
    assert(await galeRows.count() === 2, "the event twin was added at the limit")
    const accountsStat = await page.locator(".ant-statistic").filter({ hasText: "Accounts" }).textContent()
    assert(/Accounts\s*1\s*\/\s*1/.test(accountsStat), `the counter counts the main only (${accountsStat})`)
    const twinRow = page.getByRole("row").filter({ hasText: "· event" })
    assert(await twinRow.getByRole("button", { name: `Start ${gale}` }).isEnabled(), "the twin can be started")
    assert(await page.getByRole("button", { name: `Add event twin for ${gale}` }).count() === 0, "a main that has its twin offers no second one")
    await page.screenshot({ path: `${out}/12-event-twin-at-limit.png` })

    await setMaxBots(name, 2)
    await page.reload()
    await page.getByRole("button", { name: "Add account", exact: true }).click()
    const hail = `Hail${name}`
    await addAccount(page, hail)
    await setMaxBots(name, 1)
    await page.reload()
    const hailRow = page.getByRole("row", { name: new RegExp(hail) })
    await hailRow.getByText("Over plan limit").waitFor()
    assert(await hailRow.getByRole("button", { name: `Start ${hail}` }).isDisabled(), "after the admin lowers the limit the newest account shows Over plan limit with Start disabled")
    assert(await galeRows.first().getByRole("button", { name: `Start ${gale}` }).isEnabled(), "the oldest account can still start")
    assert(await page.getByText("1 account is over your plan limit and can't start.").isVisible(), "the page explains the over-limit account")
    await hailRow.getByText("Over plan limit").hover()
    await page.getByRole("tooltip").filter({ hasText: "Your plan runs your oldest bot" }).waitFor()
    assert(true, "the over-limit state explains itself in a tooltip")
    await page.screenshot({ path: `${out}/13-over-plan-limit-1280.png` })
    await axe(page, "dashboard over limit")
    const startRefused = await page.evaluate(async accountName => {
        const post = (p, json) => fetch(`/rpc/${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json }) }).then(async r => ({ status: r.status, body: (await r.json()).json }))
        const list = (await post("accounts/list", {})).body
        return post("accounts/setDesiredState", { ids: [list.find(a => a.name === accountName).id], state: "running" })
    }, hail)
    assert(startRefused.status === 403 && startRefused.body.code === "FORBIDDEN", "calling the API to start the over-limit account is refused (FORBIDDEN)")
    // An open tooltip keeps its wide-screen position through a resize and would read as overflow.
    await page.mouse.move(0, 0)
    await page.getByRole("tooltip").filter({ hasText: "Your plan runs your oldest bot" }).waitFor({ state: "hidden" })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)
    assert(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) === 0, "no horizontal overflow on the over-limit dashboard at 390")
    await page.screenshot({ path: `${out}/13b-over-plan-limit-390.png`, fullPage: true })
    await axe(page, "dashboard over limit 390")
    await browser.close()
    console.log("ALL OK")
})().catch(e => { console.error(e.message); process.exit(1) })
