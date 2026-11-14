// Drives the new player app the way a person does, against a running `pnpm dev` stack.
// Usage: node drive-client.cjs [out-dir]   (default: .verify-evidence/<time>-client)
const path = require("node:path")
const pw = process.env.HOME + "/.cache/gge-bot-verify/pw/node_modules/"
const { chromium } = require(pw + "playwright")
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

async function freshInvite() {
    const call = async (path, body, cookie) => {
        const res = await fetch(`${API_URL}/admin/rpc/${path}`, {
            method: "POST",
            headers: { origin: ADMIN_URL, "content-type": "application/json", ...(cookie && { cookie }) },
            body: JSON.stringify({ json: body }),
        })
        return { json: (await res.json()).json, cookie: res.headers.getSetCookie()[0]?.split(";")[0] }
    }
    const { cookie } = await call("auth/login", { login: "admin", password: "demo-password" })
    return (await call("invites/create", { role: "user", expiresInHours: 1 }, cookie)).json.code
}

;(async () => {
    const invite = await freshInvite()
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    const name = "u" + Date.now().toString(36)
    await page.goto(`${CLIENT_URL}/signup?invite=${invite}`)
    await page.getByRole("heading", { name: "Join the campaign" }).waitFor()
    await axe(page, "signup")
    assert(await page.getByLabel("Invite code").inputValue() === invite, "invite code prefilled from the link")
    await page.getByLabel("Username").fill(name)
    await page.getByLabel("Email").fill(`${name}@example.test`)
    await page.getByLabel("Password", { exact: true }).fill("a-strong-password")
    await page.getByLabel("Confirm password").fill("a-strong-password")
    await page.getByRole("button", { name: "Create account" }).click()
    await page.getByText("No accounts yet").waitFor()
    assert(true, "signup lands on an empty roster with a call to action")
    await axe(page, "empty dashboard")

    await page.getByText("Check your inbox").waitFor()
    assert(true, "an unverified player sees the verification banner")
    const verifyPage = await browser.newPage()
    await verifyPage.goto(emailedLink(`${name}@example.test`))
    await verifyPage.getByText("Email verified").waitFor()
    await verifyPage.close()
    await page.reload()
    await page.getByText("No accounts yet").waitFor()
    assert(await page.getByText("Check your inbox").count() === 0, "the banner is gone once the emailed link is opened")

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
    await resetPage.getByLabel("Confirm password").fill("third-strong-password")
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
    const row = page.getByRole("row", { name: new RegExp(`Storm${name}`) })
    await row.waitFor()
    assert(await row.getByText("Stopped").isVisible(), "new account shows as stopped")

    await row.getByRole("button", { name: "Start" }).click()
    await row.getByRole("button", { name: "Stop" }).waitFor()
    assert(true, "Start flips to Stop at once (optimistic)")
    await page.reload()
    await page.getByRole("row", { name: new RegExp(`Storm${name}`) }).getByRole("button", { name: "Stop" }).waitFor()
    assert(true, "desired state persisted across reload")
    await page.getByRole("row", { name: new RegExp(`Storm${name}`) }).getByRole("button", { name: "Stop" }).click()
    await page.getByRole("row", { name: new RegExp(`Storm${name}`) }).getByRole("button", { name: "Start" }).waitFor()

    await page.getByRole("button", { name: `Edit Storm${name}` }).click()
    await page.getByLabel("Game account name").fill(`Storm${name} Keep`)
    await page.getByRole("button", { name: "Cancel" }).click()
    await page.getByRole("dialog", { name: "Discard your changes?" }).waitFor()
    assert(true, "closing with unsaved edits asks first")
    await page.getByRole("button", { name: "Keep editing" }).click()
    await page.getByRole("button", { name: "Save changes" }).click()
    await page.getByText(`Storm${name} Keep saved`).waitFor()
    assert(await page.getByRole("row", { name: new RegExp(`Storm${name} Keep`) }).isVisible(), "rename saved and shown")

    await page.getByRole("row", { name: new RegExp(`Storm${name} Keep`) }).getByRole("checkbox").check()
    await page.getByRole("button", { name: "Remove" }).click()
    await page.getByText("Remove 1 account?").first().waitFor()
    await page.screenshot({ path: `${out}/11-remove-confirm.png` })
    await page.getByRole("button", { name: "Remove", exact: true }).last().click()
    await page.getByText("No accounts yet").waitFor()
    assert(true, "remove asks to confirm, then the roster is empty again")
    await browser.close()
})().catch(e => { console.error(e.message); process.exit(1) })
