// Drives the new player app the way a person does, against a running `pnpm dev` stack.
// Usage: node drive-client.cjs [out-dir]   (default: .verify-evidence/<time>-client)
const path = require("node:path")
const pw = process.env.HOME + "/.cache/gge-bot-verify/pw/node_modules/"
const { chromium } = require(pw + "playwright")
const { adminSessionCookie } = require("./dev-totp.cjs")
const { insertLogLine, insertNotification, insertResources, storePluginSettings } = require("./dev-db.cjs")
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
    const result = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => `${v.id} (${v.impact}): ${v.nodes.length} node(s) e.g. ${v.nodes[0].target.join(" ")} ${v.nodes[0].html.slice(0, 160)}`))
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
    const user = (await call("users/list", { search: username })).items.find(u => u.username === username)
    await call("users/setMaxBots", { id: user.id, maxBots })
}

/** Fills the open add-account drawer and submits it. `beforeAdding` runs on the filled drawer first. */
async function addAccount(page, accountName, beforeAdding = async () => {}) {
    await page.getByLabel("Game account name").fill(accountName)
    await page.getByLabel("Server").click()
    await page.keyboard.type("Germany")
    await page.locator(".ant-select-item-option", { hasText: "Germany 1" }).click()
    await page.getByLabel("Game password").fill("hunter2")
    await beforeAdding()
    await page.getByRole("button", { name: "Add account", exact: true }).last().click()
    await page.getByText(`${accountName} added`).first().waitFor()
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

/** What the terminal's rendered rows show. The list is virtualised, so these are the rows in and near view. */
const sampleRows = log => log.evaluate(el => [...el.querySelectorAll(".gge-term-row")].map(row => ({
    level: row.dataset.level,
    tag: row.querySelector(".gge-term-tag")?.textContent ?? null,
    account: row.querySelector(".gge-term-acct")?.textContent ?? null,
    text: row.querySelector(".gge-term-msg")?.textContent ?? "",
})))
/** The rows once they stop changing for 400 ms, so a slow render on a loaded machine isn't read half done. */
async function termRows(log) {
    let last = JSON.stringify(await sampleRows(log)), steady = 0
    for (let i = 0; i < 60 && steady < 2; i++) {
        await new Promise(resolve => setTimeout(resolve, 200))
        const now = JSON.stringify(await sampleRows(log))
        steady = now === last ? steady + 1 : 0
        last = now
    }
    return JSON.parse(last)
}
const atBottom = log => log.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight <= 8)
const rpc = (page, path, json = {}) => page.evaluate(async ([p, body]) => (await (await fetch(`/rpc/${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: body }) })).json()).json, [path, json])

/** A sidebar link's name: the label, and the "Soon" tag a module that isn't built carries. */
const linkName = name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( Soon)?$`)
/** On a phone the sidebar is a drawer behind the header's menu button. */
async function openSidebar(page) {
    if (page.viewportSize().width < 768) {
        await page.getByRole("button", { name: "Open menu" }).click()
        await page.getByRole("dialog").waitFor()
    }
}
/** Goes to a page the way a player does: filter the sidebar, click the link. */
async function sidebar(page, name) {
    await openSidebar(page)
    await page.getByLabel("Find a module").fill(name)
    await page.getByRole("navigation", { name: "Modules" }).getByRole("link", { name: linkName(name) }).first().click()
}
/** Opens a module's page for an account: through the sidebar, then the account picker. */
async function openModule(page, module, account = "Ironhold") {
    await page.goto(CLIENT_URL)
    await sidebar(page, module)
    const picker = page.locator("#module-account")
    await picker.waitFor()
    if (!(await picker.locator("xpath=ancestor::div[contains(@class,'ant-select')][1]").innerText()).startsWith(account)) {
        await picker.click()
        await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option", { hasText: account }).first().click()
    }
    await page.locator(".gge-module-plugin-row").first().waitFor()
}

/** The Towers page: a panel for each kingdom in the spec's order, the settings of one, and a config stored before the horse, tool and wave Selects. */
async function driveTowers(page) {
    const KINGDOMS = [["Green", "Great Empire", "attackBarronsGreatEmpire"], ["Sands", "Burning Sands", "attackBarronsBurningSands"], ["Ice", "Everwinter Glacier", "attackBarronsEverWinterGlacier"], ["Fire", "Fire Peaks", "attackBarronsFirePeaks"]]
    const account = async () => (await rpc(page, "accounts/list")).find(a => a.name === "Ironhold")
    const ironhold = await account()
    const before = ironhold.plugins
    const stored = async plugin => (await account()).plugins[plugin] ?? { enabled: false, options: {} }
    for (const preset of await rpc(page, "virtualPresets/list", { accountId: ironhold.id }))
        await rpc(page, "virtualPresets/remove", { id: preset.id })
    for (const [, , plugin] of KINGDOMS.slice(1))
        await storePluginSettings({ accountName: "Ironhold", plugin, enabled: false, options: {} })
    await storePluginSettings({ accountName: "Ironhold", plugin: KINGDOMS[0][2], enabled: true, options: { useFeather: true, useCoin: false, useShields: true, attackWaves: "4", toolBudgetPerDay: 900 } })

    const panel = short => page.locator(`section.gge-kingdom[aria-label="${short}"]`)
    const chosen = async (scope, name) => (await scope.getByRole("combobox", { name, exact: true }).locator("xpath=ancestor::div[contains(@class,'ant-select')][1]").innerText()).trim()
    const pickOption = async (scope, name, text) => {
        const box = scope.getByRole("combobox", { name, exact: true })
        await box.scrollIntoViewIfNeeded()
        await box.click()
        const dropdown = page.locator(`.ant-select-dropdown:has([id="${await box.getAttribute("aria-controls")}"])`)
        await dropdown.waitFor()
        await dropdown.locator(".ant-select-item-option", { hasText: text }).first().click()
        await dropdown.waitFor({ state: "hidden" })
    }
    const optionsOf = async (scope, name) => {
        const box = scope.getByRole("combobox", { name, exact: true })
        await box.click()
        const dropdown = page.locator(`.ant-select-dropdown:has([id="${await box.getAttribute("aria-controls")}"])`)
        await dropdown.waitFor()
        const texts = await dropdown.locator(".ant-select-item-option").allInnerTexts()
        await page.keyboard.press("Escape")
        await dropdown.waitFor({ state: "hidden" })
        return texts
    }
    const open = async () => {
        await page.goto(`${CLIENT_URL}/m/towers?account=${ironhold.id}`)
        await page.locator("section.gge-kingdom").first().waitFor()
        await page.waitForTimeout(300)
    }
    const saveBar = page.locator(".gge-savebar")

    await page.setViewportSize(WIDE_VIEW)
    await page.goto(CLIENT_URL)
    await sidebar(page, "Towers")
    await panel("Green").waitFor()
    const heads = await page.locator("section.gge-kingdom .gge-kingdom-toggle").allInnerTexts()
    assert(JSON.stringify(heads.map(text => text.replace(/\s+/g, " ").trim())) === JSON.stringify(KINGDOMS.map(([short, full], kid) => `${short} ${full} KID ${kid}`)),
        `the kingdoms come in the spec's order with their ids: ${heads.map(text => text.replace(/\s+/g, " ").trim()).join(" | ")}`)
    await open()
    assert(await panel("Green").getByRole("checkbox", { name: "Enable Green" }).isChecked(), "Green, which is on, has its box ticked")
    assert(await panel("Green").locator(".gge-kingdom-toggle").getAttribute("aria-expanded") === "true" && await panel("Ice").locator(".gge-kingdom-toggle").getAttribute("aria-expanded") === "false",
        "a kingdom that is on is open and one that is off is closed")
    assert(await page.locator(".gge-module-plugin-row").count() === 0, "the kingdoms' switches are in their headers, not repeated in the status card")

    const green = panel("Green")
    assert(await chosen(green, "Horse") === "Feather", "a config stored with Use fast horse feathers shows Horse as Feather")
    assert(await chosen(green, "Tools") === "Ladders, rams and mantlets", "stored wall tools and flank tools show as Ladders, rams and mantlets")
    assert(await chosen(green, "Waves") === "4 waves", "the stored text 4 shows as 4 waves")
    assert(await saveBar.count() === 0, "reading the old config changes nothing by itself")
    assert(await green.locator("[data-army-summary]").innerText() === "L·F·R+CY · 4w · Ladders, rams and mantlets", `the army line sums the old config up: ${await green.locator("[data-army-summary]").innerText()}`)

    const castles = await optionsOf(green, "Castle to attack from")
    assert(castles.length === 2 && castles.every(text => text.includes("Great Empire")) && !castles.some(text => text.includes("Frostgate")), `Green's source castle lists only its own castles: ${castles.join(" | ")}`)
    await pickOption(green, "Castle to attack from", "Ironhold Watch")

    const radius = green.locator(".ant-form-item", { has: page.getByText("Search radius", { exact: true }) })
    const slider = radius.getByRole("slider", { name: "Search radius" })
    assert(await slider.getAttribute("aria-valuenow") === "50" && await radius.getByRole("spinbutton").inputValue() === "50", "Search radius starts at 50 on the slider and in the field")
    await radius.getByRole("spinbutton").fill("80")
    await radius.getByRole("spinbutton").blur()
    assert(await slider.getAttribute("aria-valuenow") === "80", "typing 80 moves the slider")
    await slider.focus()
    await page.keyboard.press("ArrowRight")
    assert(await radius.getByRole("spinbutton").inputValue() === "81", "an arrow key on the slider moves the field to 81")
    assert(await green.getByRole("slider", { name: "Most attacks a day" }).count() === 1, "Most attacks a day has a slider beside its field")
    assert(await page.getByText("Tool budget a day").count() === 0, "the daily tool budget is gone from the page")
    await green.locator(".ant-form-item", { has: page.getByText("Most attacks a day", { exact: true }) }).getByRole("spinbutton").fill("25")
    await pickOption(green, "Tower filter", "Non-maxed only")

    const sands = panel("Sands")
    await sands.getByRole("checkbox", { name: "Enable Sands" }).check()
    assert(await sands.locator(".gge-kingdom-toggle").getAttribute("aria-expanded") === "true", "ticking Sands opens it")
    assert(await sands.getByText("This account has no castle in Burning Sands").isVisible() && await sands.locator("form").count() === 0, "a kingdom the account holds no castle in says so and shows no settings")
    await sands.getByRole("checkbox", { name: "Enable Sands" }).uncheck()

    const ice = panel("Ice")
    await ice.getByRole("checkbox", { name: "Enable Ice" }).check()
    const iceCastles = await optionsOf(ice, "Castle to attack from")
    assert(iceCastles.length === 1 && iceCastles[0].includes("Frostgate"), `Ice's source castle lists Frostgate alone: ${iceCastles.join(" | ")}`)
    assert(await chosen(ice, "Horse") === "Coin horse", "Ice starts on the coin horse")
    await green.getByRole("button", { name: "Apply to all kingdoms" }).click()
    await page.getByText("Horse copied to every kingdom").first().waitFor()
    assert(await chosen(ice, "Horse") === "Feather", "Apply to all kingdoms copies Green's horse to Ice")
    assert(!(await ice.getByText("Feather beyond", { exact: true }).isVisible()), "Feather beyond is hidden while the horse is Feather")
    await pickOption(ice, "Horse", "By distance")
    await ice.getByText("Feather beyond", { exact: true }).waitFor()
    assert(true, "choosing By distance shows Feather beyond")
    await pickOption(ice, "Horse", "Feather")
    await ice.getByText("Feather beyond", { exact: true }).waitFor({ state: "hidden" })
    assert(true, "going back to Feather hides it again")

    // Commanders: Ironhold has 18, which the seeded bot report says.
    const commanders = scope => scope.getByLabel("Commanders to use", { exact: true })
    const card = page.locator(".ant-card", { has: page.getByText("All kingdoms", { exact: true }) })
    assert(await commanders(green).inputValue() === "1-50", `the commander list starts on 1-50, the game's most: ${await commanders(green).inputValue()}`)
    assert(await green.getByText("You have 18 commanders (positions 1–18).", { exact: true }).isVisible(), "the commander field names the account's real range")
    assert(await page.getByRole("complementary", { name: "Setup checks" }).count() === 0, "Towers has no Setup checks panel")
    await commanders(green).fill("1;2;3")
    await commanders(ice).fill("4-6")
    assert((await card.locator("li[data-commanders]").innerText()).replace(/\s+/g, " ").includes("6 configured · 18 maximum · 12 remaining"), `the card sums the kingdoms that are on: ${(await card.locator("li[data-commanders]").innerText()).replace(/\s+/g, " ")}`)
    await commanders(green).fill("1-50")
    await commanders(ice).fill("1-50")
    await axe(page, "towers 1440")
    await page.screenshot({ path: `${out}/70-towers-1440.png`, fullPage: true })

    await saveBar.getByRole("button", { name: "Save" }).click()
    await page.getByText("Ironhold saved").first().waitFor()
    const savedGreen = await stored(KINGDOMS[0][2]), savedIce = await stored(KINGDOMS[2][2]), savedSands = await stored(KINGDOMS[1][2])
    const sorted = options => JSON.stringify(Object.entries(options).sort(([a], [b]) => a.localeCompare(b)))
    assert(sorted(savedGreen.options) === sorted({ sourceCastle: { kingdom: 0, id: 1002 }, towerFilter: 2, searchRadius: 81, maxPerDay: 25, horse: 2, tools: 2, attackWaves: 4 }),
        `Green saves the new options and none of the old ones, the old tool budget included: ${JSON.stringify(savedGreen.options)}`)
    assert(savedIce.enabled && savedIce.options.horse === 2 && !savedSands.enabled && savedSands.options.horse === 2, "each kingdom saves by itself: Ice on with the feather, Sands still off")
    await open()
    assert(await chosen(panel("Green"), "Tower filter") === "Non-maxed only" && await panel("Green").getByRole("slider", { name: "Search radius" }).getAttribute("aria-valuenow") === "81"
        && await panel("Ice").getByRole("checkbox", { name: "Enable Ice" }).isChecked(), "the saved kingdoms come back after a reload")

    const global = page.locator(".ant-card", { has: page.getByText("All kingdoms", { exact: true }) })
    assert((await global.getByText(/attacks in 24 hours/).innerText()).startsWith("3500"), "the Global card shows the account's daily cap")
    assert(await global.getByText(/ask for .* attacks a day between them/).count() === 0, "the kingdoms' 25 attacks a day fit under the account's cap, so the card says nothing about it")
    await panel("Green").locator(".ant-form-item", { has: page.getByText("Most attacks a day", { exact: true }) }).getByRole("spinbutton").fill("3900")
    assert(await global.getByText("The kingdoms that are on ask for 3900 attacks a day between them. The account's cap of 3500 still holds.").isVisible(), "kingdoms that ask for more than the account's cap get a warning on the card")
    await page.locator(".gge-savebar").getByRole("button", { name: "Discard changes" }).click()
    assert(await global.getByRole("link", { name: "Change it in Account settings" }).getAttribute("href") === `/?account=${ironhold.id}&tab=account-settings`, "and links to Account settings")
    const soon = await global.locator("li[data-soon]").allInnerTexts()
    assert(soon.length === 4 && soon.every(text => text.includes("Coming soon")) && ["Loot priority", "Stop after a defeat", "Speed bonus", "VIP commanders"].every((name, i) => soon[i].startsWith(name)),
        "loot priority, stop after a defeat, the speed bonus and VIP commanders are listed as coming soon")
    assert(await global.locator("input, button, [role=switch], [role=combobox]").count() === 0, "what is coming soon has no control to set")

    await page.setViewportSize(PHONE_VIEW)
    await page.waitForTimeout(400)
    assert(await overflowOf(page) <= 0, "no horizontal overflow on Towers at 390")
    await axe(page, "towers 390")
    await page.screenshot({ path: `${out}/70-towers-390.png`, fullPage: true })
    await page.setViewportSize(WIDE_VIEW)

    const made = await rpc(page, "virtualPresets/create", { accountId: ironhold.id, name: "Towers, ranged first", plan: { kind: "manual", waves: Array.from({ length: 4 }, () => ({ kind: "preset", preset: 0 })), ast: [null, null, null], rw: [{ item: 1, amount: 40 }, ...Array(7).fill(null)] } })
    await page.goto(`${CLIENT_URL}/m/virtual-presets?account=${ironhold.id}`)
    await page.getByRole("button", { name: "Duplicate Towers, ranged first" }).click()
    await page.getByText("Towers, ranged first (copy) added").first().waitFor()
    const presets = await rpc(page, "virtualPresets/list", { accountId: ironhold.id })
    const copy = presets.find(preset => preset.name === "Towers, ranged first (copy)")
    assert(presets.length === 2 && copy && copy.id !== made.id && JSON.stringify(copy.plan) === JSON.stringify(made.plan), "Duplicate adds a second preset with the same waves under a name of its own")
    await axe(page, "virtual presets with a copy 1440")
    await page.screenshot({ path: `${out}/71-preset-duplicate-1440.png` })
    for (const preset of presets) await rpc(page, "virtualPresets/remove", { id: preset.id })

    await rpc(page, "account/setLocale", { locale: "ar" })
    await open()
    assert(await page.evaluate(() => document.documentElement.dir) === "rtl", "in Arabic the Towers page is right to left")
    assert(await overflowOf(page) <= 0, "no horizontal overflow on Towers in Arabic at 1440")
    await axe(page, "towers ar 1440")
    await page.screenshot({ path: `${out}/72-towers-ar-1440.png`, fullPage: true })
    await page.setViewportSize(PHONE_VIEW)
    await page.waitForTimeout(400)
    assert(await overflowOf(page) <= 0, "no horizontal overflow on Towers in Arabic at 390")
    await axe(page, "towers ar 390")
    await page.screenshot({ path: `${out}/72-towers-ar-390.png`, fullPage: true })
    await page.setViewportSize(WIDE_VIEW)
    await rpc(page, "account/setLocale", { locale: null })
    for (const [, , plugin] of KINGDOMS)
        await storePluginSettings({ accountName: "Ironhold", plugin, enabled: Boolean(before[plugin]?.enabled), options: before[plugin]?.options ?? {} })
    assert(JSON.stringify((await account()).plugins[KINGDOMS[0][2]] ?? null) === JSON.stringify(before[KINGDOMS[0][2]] ?? { enabled: false, options: {} }) || !before[KINGDOMS[0][2]], "Ironhold's tower settings are back as they were")
}

/**
 * The Phase C attack pages: Nomads and Samurai, Khan, Green Berimond and Storms. Each opens on a config stored before
 * its new options, shows what that config always meant, takes a new choice, saves it and shows it again after a reload.
 */
async function drivePhaseC(page) {
    const account = async () => (await rpc(page, "accounts/list")).find(a => a.name === "Ironhold")
    const before = (await account()).plugins
    const stored = async plugin => (await account()).plugins[plugin] ?? { enabled: false, options: {} }
    const OLD = {
        attackNomads: { useFeather: true },
        attackKhan: { wavesTillChests: "2" },
        attackBerimondInvasion: { wavesTillChests: "4", reputation: true },
        attackStormForts: { buyDecoration: true },
    }
    for (const [plugin, options] of Object.entries(OLD))
        await storePluginSettings({ accountName: "Ironhold", plugin, enabled: false, options })

    const chosen = async name => (await page.getByRole("combobox", { name, exact: true }).first().locator("xpath=ancestor::div[contains(@class,'ant-select')][1]").innerText()).trim()
    const pickOption = async (name, text) => {
        const box = page.getByRole("combobox", { name, exact: true }).first()
        await box.scrollIntoViewIfNeeded()
        await box.click()
        const dropdown = page.locator(`.ant-select-dropdown:has([id="${await box.getAttribute("aria-controls")}"])`)
        await dropdown.waitFor()
        await dropdown.locator(".ant-select-item-option", { hasText: text }).first().click()
        await dropdown.waitFor({ state: "hidden" })
    }
    const number = label => page.locator(".ant-form-item:visible", { has: page.getByText(label, { exact: true }) }).getByRole("spinbutton").first()
    const save = async () => {
        await page.locator(".gge-savebar").getByRole("button", { name: "Save" }).click()
        await page.getByText("Ironhold saved").first().waitFor()
    }
    const shots = async (file, what) => {
        await axe(page, `${what} 1440`)
        await page.screenshot({ path: `${out}/${file}-1440.png`, fullPage: true })
        await page.setViewportSize(PHONE_VIEW)
        await page.waitForTimeout(400)
        assert(await overflowOf(page) <= 0, `no horizontal overflow on ${what} at 390`)
        await axe(page, `${what} 390`)
        await page.screenshot({ path: `${out}/${file}-390.png`, fullPage: true })
        await page.setViewportSize(WIDE_VIEW)
    }

    await openModule(page, "Nomads, Samurai and Daimyo")
    assert(await chosen("Camps to attack") === "Cycle mode with time skips (classic)", "a Nomads config stored before the target options cycles the camps with skips")
    assert(!(await page.getByText("Camp X", { exact: true }).first().isVisible()), "the camp's coordinates are hidden while every camp is attacked")
    await pickOption("Camps to attack", "Skip mode: one camp, uses time skips")
    await page.getByText("Camp X", { exact: true }).first().waitFor()
    await number("Camp X").fill("640")
    await number("Camp Y").fill("12")
    assert(await page.getByRole("radio", { name: "Autofill" }).first().isChecked(), "the army starts on Autofill")
    await save()
    const nomads = (await stored("attackNomads")).options
    assert(nomads.targetMode === 2 && nomads.targetX === 640 && nomads.targetY === 12 && nomads.horse === 2 && !("useFeather" in nomads), `Nomads saves one camp at 640:12 and the old feather as the Horse choice: ${JSON.stringify(nomads)}`)
    await openModule(page, "Nomads, Samurai and Daimyo")
    assert(await chosen("Camps to attack") === "Skip mode: one camp, uses time skips" && await number("Camp X").inputValue() === "640", "the one camp comes back after a reload")
    await shots("80-nomads", "nomads")

    await openModule(page, "Khan")
    assert(await chosen("Rage waves") === "1 wave" && await chosen("Tablet chest waves") === "Every later wave", "a stored wavesTillChests of 2 shows as one rage wave, then chests in every later wave")
    const khanSummary = await page.locator("[data-army-summary]").innerText()
    assert(khanSummary === "L·F·R+CY · all waves · Event tools", `the army line says event tools go while no tool option is on: ${khanSummary}`)
    await page.getByRole("checkbox", { name: "Tablets only: never taunt the Khan" }).check()
    await number("Pause hits at this many incoming Khan attacks").fill("120")
    assert(await number("Flaming arrows").inputValue() === "0", "the defence stock starts at 0, which buys nothing")
    await number("Flaming arrows").fill("500")
    await save()
    const khan = (await stored("attackKhan")).options
    assert(khan.rageWaves === 1 && khan.tabletsOnly === true && khan.pauseAtTaunts === 120 && khan.stockFlamingArrows === 500 && !("wavesTillChests" in khan), `Khan saves the new options and drops the old key: ${JSON.stringify(khan)}`)
    await openModule(page, "Khan")
    assert(await page.getByRole("checkbox", { name: "Tablets only: never taunt the Khan" }).isChecked() && await number("Pause hits at this many incoming Khan attacks").inputValue() === "120", "Khan's choices come back after a reload")
    await shots("81-khan", "khan")

    await openModule(page, "Green Berimond")
    assert(await chosen("Camp side") === "All camps" && await chosen("Event tools from") === "Wave 2", "a stored Berimond config attacks all camps, with event tools from the second wave as it always did")
    await pickOption("Camp side", "Red camps only")
    await save()
    const berimond = (await stored("attackBerimondInvasion")).options
    assert(berimond.campSide === 1 && berimond.reputation === true && !("wavesTillChests" in berimond), `Berimond saves the red side and drops the unread key: ${JSON.stringify(berimond)}`)
    await openModule(page, "Green Berimond")
    assert(await chosen("Camp side") === "Red camps only", "the camp side comes back after a reload")
    await shots("82-berimond", "green berimond")

    await openModule(page, "Storms")
    assert(await chosen("Decoration") === "Whale Lagoon" && await chosen("Fort order") === "Highest level first", "the old Buy decoration checkbox shows as the Whale Lagoon, and forts go by level")
    await pickOption("Fort order", "Nearest first")
    await pickOption("Decoration", "Tide Garden")
    await page.getByRole("checkbox", { name: "Buy 5-hour skips" }).check()
    await number("Scaling ladders").fill("2000")
    await save()
    const storms = (await stored("attackStormForts")).options
    assert(storms.fortOrder === 1 && storms.decoration === 2 && storms.buySkips5h === true && storms.stockLadders === 2000 && !("buyDecoration" in storms), `Storms saves the new options and drops the old key: ${JSON.stringify(storms)}`)
    await openModule(page, "Storms")
    assert(await chosen("Decoration") === "Tide Garden" && await number("Scaling ladders").inputValue() === "2000", "the Storm choices come back after a reload")
    await shots("83-storms", "storms")
    await page.getByRole("tab", { name: /Mead/ }).click()
    await page.getByText("Send mead when it lasts less than", { exact: true }).waitFor()
    assert(await number("Send mead when it lasts less than").inputValue() === "2.1", "the mead tab shows the threshold the plugin always used")
    await page.screenshot({ path: `${out}/83-storms-mead-1440.png`, fullPage: true })

    await rpc(page, "account/setLocale", { locale: "ar" })
    for (const [id, file] of [["nom-sam-daimyo", "80-nomads"], ["khan", "81-khan"], ["green-berimond", "82-berimond"], ["storms", "83-storms"]]) {
        await page.goto(`${CLIENT_URL}/m/${id}?account=${(await account()).id}`)
        await page.locator(".gge-module-plugin-row").first().waitFor()
        assert(await page.evaluate(() => document.documentElement.dir) === "rtl" && await overflowOf(page) <= 0, `${id} is right to left in Arabic with no overflow at 1440`)
        await axe(page, `${id} ar 1440`)
        await page.screenshot({ path: `${out}/${file}-ar-1440.png`, fullPage: true })
        await page.setViewportSize(PHONE_VIEW)
        await page.waitForTimeout(400)
        assert(await overflowOf(page) <= 0, `no horizontal overflow on ${id} in Arabic at 390`)
        await axe(page, `${id} ar 390`)
        await page.screenshot({ path: `${out}/${file}-ar-390.png`, fullPage: true })
        await page.setViewportSize(WIDE_VIEW)
    }
    await rpc(page, "account/setLocale", { locale: null })
    for (const plugin of Object.keys(OLD))
        await storePluginSettings({ accountName: "Ironhold", plugin, enabled: Boolean(before[plugin]?.enabled), options: before[plugin]?.options ?? {} })
}

/**
 * The Nomads and Samurai tabs of the event camp page: configs stored with the old horse, tool and score options show
 * as the same choices, the mode shows and hides the camp's coordinates and the skip types, the autofill options save
 * and come back, and the All events card.
 */
async function driveEventCamps(page) {
    const account = async () => (await rpc(page, "accounts/list")).find(a => a.name === "Ironhold")
    const ironhold = await account()
    const before = ironhold.plugins
    const stored = async plugin => (await account()).plugins[plugin] ?? { enabled: false, options: {} }
    await storePluginSettings({ accountName: "Ironhold", plugin: "attackNomads", enabled: true, options: { useFeather: true, scoreShutoff: "5000", lowValueChests: true } })
    await storePluginSettings({ accountName: "Ironhold", plugin: "attackSamurai", enabled: false, options: { noChests: true, useCoin: true, scoreShutoff: "" } })

    const tab = () => page.getByRole("tabpanel")
    const chosen = async name => (await tab().getByRole("combobox", { name, exact: true }).locator("xpath=ancestor::div[contains(@class,'ant-select')][1]").innerText()).trim()
    const dropdownOf = async name => {
        const box = tab().getByRole("combobox", { name, exact: true })
        await box.scrollIntoViewIfNeeded()
        await box.click()
        const dropdown = page.locator(`.ant-select-dropdown:has([id="${await box.getAttribute("aria-controls")}"])`)
        await dropdown.waitFor()
        return dropdown
    }
    const pickOption = async (name, text) => {
        const dropdown = await dropdownOf(name)
        await dropdown.locator(".ant-select-item-option", { hasText: text }).first().click()
        await dropdown.waitFor({ state: "hidden" })
    }
    const optionsOf = async name => {
        const dropdown = await dropdownOf(name)
        const texts = await dropdown.locator(".ant-select-item-option").allInnerTexts()
        await page.keyboard.press("Escape")
        await dropdown.waitFor({ state: "hidden" })
        return texts
    }
    const field = label => tab().locator(".ant-form-item", { has: page.getByText(label, { exact: true }) })
    const number = label => field(label).getByRole("spinbutton").first()
    const shown = label => tab().getByText(label, { exact: true }).first().isVisible()
    const summary = () => tab().locator("[data-army-summary]").innerText()
    const saveBar = page.locator(".gge-savebar")
    const open = async () => {
        await page.goto(`${CLIENT_URL}/m/nom-sam-daimyo?account=${ironhold.id}`)
        await page.locator(".gge-module-plugin-row").first().waitFor()
        await page.waitForTimeout(300)
    }
    const SKIP_TYPES = "Time skips the bot may use"

    await page.setViewportSize(WIDE_VIEW)
    await openModule(page, "Nomads, Samurai and Daimyo")
    await open()
    const tabs = await page.getByRole("tab").allInnerTexts()
    assert(JSON.stringify(tabs) === JSON.stringify(["Attack Nomads", "Attack Samurai"]), `each event has a tab of its own: ${tabs.join(" | ")}`)

    assert(await chosen("Camps to attack") === "Cycle mode with time skips (classic)", "a Nomads config stored before the modes stays on every camp with time skips")
    assert(await chosen("Event difficulty") === "Intermediate+", "the difficulty stays on Intermediate+")
    assert(await chosen("Horse") === "Feather", "a config stored with Use fast horse feathers shows Horse as Feather")
    assert(await chosen("Tools") === "Wave 1 tools and event boosters", "a config stored with event tools allowed shows Tools as wave 1 tools and event boosters")
    assert(await number("Stop at this score").inputValue() === "5000", "the score stored as the text 5000 shows as the number 5000")
    assert(await number("Attacks per run").inputValue() === "0" && await number("Minimum troops").inputValue() === "0" && await chosen("Waves") === "All waves", "attacks per run, minimum troops and waves start on no limit, 0 and all waves")
    for (const side of ["Attack left flank", "Attack middle", "Attack right flank", "Attack courtyard"])
        assert(await tab().getByRole("checkbox", { name: side }).isChecked(), `${side} starts ticked`)
    assert(await summary() === "L·F·R+CY · all waves · Wave 1 tools and event boosters", `the Nomads army line names the default tools choice: ${await summary()}`)
    assert(await saveBar.count() === 0, "reading the old config changes nothing by itself")

    assert(!(await shown("Camp X")) && await shown(SKIP_TYPES), "the classic mode hides the camp's coordinates and shows the skip types")
    await pickOption("Camps to attack", "Cycle mode: every camp nearby, no skips")
    await tab().getByText(SKIP_TYPES, { exact: true }).first().waitFor({ state: "hidden" })
    assert(!(await shown("Camp X")), "Cycle mode hides the skip types and the camp's coordinates")
    await pickOption("Camps to attack", "Skip mode: one camp, uses time skips")
    await tab().getByText("Camp X", { exact: true }).first().waitFor()
    assert(await shown("Camp Y") && await shown(SKIP_TYPES), "Skip mode shows Camp X, Camp Y and the skip types")
    await number("Camp X").fill("640")
    await number("Camp Y").fill("12")

    // The list draws only the choices in view. From Intermediate+, eight steps down reach the thirteenth and last choice.
    const difficulties = await dropdownOf("Event difficulty")
    for (let step = 0; step < 8; step++) await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")
    await difficulties.waitFor({ state: "hidden" })
    assert(await chosen("Event difficulty") === "Keep the game's current difficulty", "the difficulty list ends with keeping the game's own difficulty")
    const castles = await optionsOf("Castle to attack from")
    assert(castles.length === 2 && castles.every(text => text.includes("Great Empire")), `the source castle lists only the Great Empire's castles: ${castles.join(" | ")}`)
    await pickOption("Castle to attack from", "Ironhold Watch")
    await number("Attacks per run").fill("5")

    assert(!(await shown("Feather beyond")), "Feather beyond is hidden while the horse is Feather")
    await pickOption("Horse", "By distance")
    await tab().getByText("Feather beyond", { exact: true }).first().waitFor()
    assert(await number("Feather beyond").inputValue() === "15", "choosing By distance shows Feather beyond, at 15")
    assert(await tab().getByText("clicks", { exact: true }).first().isVisible() && await tab().getByText("tiles", { exact: true }).count() === 0, "Feather beyond counts in clicks, not tiles")

    assert(JSON.stringify(await optionsOf("Tools")) === JSON.stringify(["No tools", "Wave 1 tools only", "Wave 1 tools and event boosters"]), "Tools offers no tools, wave 1 tools, and wave 1 tools with event boosters")
    await pickOption("Tools", "No tools")
    await pickOption("Waves", "2 waves")
    await number("Minimum troops").fill("300")
    await tab().getByRole("checkbox", { name: "Attack courtyard" }).uncheck()
    assert(await summary() === "L·F·R · 2w · No tools", `the army line follows the autofill options: ${await summary()}`)
    assert(await tab().getByRole("radio", { name: "Autofill" }).isChecked() && await tab().locator(".ant-modal, [role=dialog]").count() === 0, "the autofill options sit on the page under the Autofill switch, with no pop-up")

    await tab().getByRole("button", { name: "Apply to all events" }).click()
    await page.getByText("Horse copied to every event").first().waitFor()
    await page.getByRole("tab", { name: /Attack Samurai/ }).click()
    await tab().getByRole("combobox", { name: "Horse", exact: true }).waitFor()
    assert(await chosen("Horse") === "By distance", "Apply to all events copies the Nomads horse to Samurai")
    assert(await chosen("Tools") === "Wave 1 tools only", "a Samurai config stored with Don't use event tools shows Tools as wave 1 tools only")
    assert(await summary() === "L·F·R+CY · all waves · Wave 1 tools only", `the Samurai army line names its tools choice: ${await summary()}`)
    assert(await number("Stop at this score").inputValue() === "0", "a score stored as empty text shows as 0, which is no limit")
    assert((await optionsOf("Castle to attack from")).length === 2, "Samurai picks from the same castles")
    await page.getByRole("tab", { name: /Attack Nomads/ }).click()

    const card = page.locator(".ant-card", { has: page.getByText("All events", { exact: true }) })
    assert((await card.getByText(/attacks in 24 hours/).innerText()).startsWith("3500"), "the All events card shows the account's daily cap")
    assert(await card.getByRole("link", { name: "Change it in Account settings" }).getAttribute("href") === `/?account=${ironhold.id}&tab=account-settings`, "and links to Account settings")
    const usage = (await card.locator("li[data-commanders]").innerText()).replace(/\s+/g, " ")
    assert(usage.includes("18 configured · 18 maximum · 0 remaining"), `the card counts the commanders of the events that are on: ${usage}`)
    const soon = await card.locator("li[data-soon]").allInnerTexts()
    assert(soon.length === 3 && soon.every(text => text.includes("Coming soon")) && ["Stop after a defeat", "VIP commanders", "Nomad Advisor"].every((name, i) => soon[i].startsWith(name)),
        "stop after a defeat, VIP commanders and the Nomad Advisor are listed as coming soon")
    assert(await card.locator("input, button, [role=switch], [role=combobox]").count() === 0, "what is coming soon has no control to set")
    await axe(page, "event camps 1440")
    await page.screenshot({ path: `${out}/90-event-camps-1440.png`, fullPage: true })

    await saveBar.getByRole("button", { name: "Save" }).click()
    await page.getByText("Ironhold saved").first().waitFor()
    const sorted = options => JSON.stringify(Object.entries(options).sort(([a], [b]) => a.localeCompare(b)))
    const nomads = await stored("attackNomads"), samurai = await stored("attackSamurai")
    const wanted = { targetMode: 2, targetX: 640, targetY: 12, eventDifficulty: 12, sourceCastle: { kingdom: 0, id: 1002 }, attacksPerRun: 5, scoreShutoff: 5000, horse: 3, tools: 0, attackWaves: 2, minTroops: 300, attackCourtyard: false, lowValueChests: true }
    assert(nomads.enabled && sorted(nomads.options) === sorted(wanted), `Nomads saves the new options and none of the old ones: ${JSON.stringify(nomads.options)}`)
    assert(!samurai.enabled && sorted(samurai.options) === sorted({ horse: 3, tools: 1 }), `Samurai saves by itself, with its old options as choices: ${JSON.stringify(samurai.options)}`)

    await open()
    assert(await chosen("Camps to attack") === "Skip mode: one camp, uses time skips" && await number("Camp X").inputValue() === "640" && await number("Camp Y").inputValue() === "12", "the mode and the camp come back after a reload")
    assert(await chosen("Event difficulty") === "Keep the game's current difficulty" && (await chosen("Castle to attack from")).startsWith("Ironhold Watch"), "the difficulty and the source castle come back")
    assert(await chosen("Horse") === "By distance" && await chosen("Tools") === "No tools" && await chosen("Waves") === "2 waves" && await number("Minimum troops").inputValue() === "300" && await number("Attacks per run").inputValue() === "5",
        "the horse, tools, waves, minimum troops and attacks per run come back")
    assert(!(await tab().getByRole("checkbox", { name: "Attack courtyard" }).isChecked()) && await tab().getByRole("checkbox", { name: "Attack left flank" }).isChecked(), "the sides come back: courtyard off, left on")
    assert(await summary() === "L·F·R · 2w · No tools", "and the army line says the same after the reload")
    await page.screenshot({ path: `${out}/91-event-camps-saved-1440.png`, fullPage: true })

    await page.setViewportSize(PHONE_VIEW)
    await page.waitForTimeout(400)
    assert(await overflowOf(page) <= 0, "no horizontal overflow on the event camps at 390")
    await axe(page, "event camps 390")
    await page.screenshot({ path: `${out}/90-event-camps-390.png`, fullPage: true })
    await page.setViewportSize(WIDE_VIEW)

    await rpc(page, "account/setLocale", { locale: "ar" })
    await open()
    assert(await page.evaluate(() => document.documentElement.dir) === "rtl", "in Arabic the event camp page is right to left")
    assert(await overflowOf(page) <= 0, "no horizontal overflow on the event camps in Arabic at 1440")
    await axe(page, "event camps ar 1440")
    await page.screenshot({ path: `${out}/92-event-camps-ar-1440.png`, fullPage: true })
    await page.setViewportSize(PHONE_VIEW)
    await page.waitForTimeout(400)
    assert(await overflowOf(page) <= 0, "no horizontal overflow on the event camps in Arabic at 390")
    await axe(page, "event camps ar 390")
    await page.screenshot({ path: `${out}/92-event-camps-ar-390.png`, fullPage: true })
    await page.setViewportSize(WIDE_VIEW)
    await rpc(page, "account/setLocale", { locale: null })
    for (const plugin of ["attackNomads", "attackSamurai"])
        await storePluginSettings({ accountName: "Ironhold", plugin, enabled: Boolean(before[plugin]?.enabled), options: before[plugin]?.options ?? {} })
}

/** The account drawer's Logs tab and the Logs page, as the seeded demo player, in English. */
async function driveLogs(page) {
    const searchOf = () => new URL(page.url()).searchParams
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    const accounts = await rpc(page, "accounts/list")
    const idOf = name => accounts.find(a => a.name === name).id
    const unique = () => 100000 + Math.floor(Math.random() * 900000)

    const mine = unique(), theirs = unique()
    await insertLogLine({ accountName: "Ironhold", level: 0, plugin: "feast", parts: ["consumed", mine] })
    await insertLogLine({ accountName: "Ravenmoor", level: 0, plugin: "feast", parts: ["consumed", theirs] })
    await page.getByRole("button", { name: "Edit Ironhold" }).click()
    await page.getByRole("tab", { name: "Logs" }).click()
    const drawer = page.getByRole("dialog")
    const drawerLog = drawer.getByRole("log", { name: "Bot log" })
    await drawerLog.getByText(`Feasts used this much food: ${mine}`).waitFor()
    const facets = await rpc(page, "logs/facets")
    const ironholdCount = facets.accounts.find(a => a.name === "Ironhold").count
    assert(await drawerLog.getByText(`Feasts used this much food: ${theirs}`).count() === 0, "the drawer's Logs tab shows Ironhold's new line and not Ravenmoor's")
    assert((await drawer.locator(".ant-segmented-item", { hasText: "All" }).innerText()).includes(String(ironholdCount)), `the drawer counts Ironhold's ${ironholdCount} lines, not every account's`)
    assert((await termRows(drawerLog)).every(row => row.account === null), "the drawer's terminal has no account column")
    await drawer.locator(".ant-segmented-item", { hasText: "Warning" }).click()
    await page.waitForTimeout(300)
    const warnings = await termRows(drawerLog)
    assert(warnings.length > 0 && warnings.every(row => row.level === "1"), "the drawer's level filter leaves only warnings")
    await axe(page, "account drawer logs")
    await page.screenshot({ path: `${out}/14-account-logs.png` })
    await page.keyboard.press("Escape")

    await page.setViewportSize({ width: 1440, height: 900 })
    await sidebar(page, "Logs")
    await page.waitForURL(/\/logs$/)
    const log = page.getByRole("log", { name: "Bot log" })
    const count = page.locator(".gge-logs-count")
    const showing = n => count.filter({ hasText: new RegExp(`^${n.toLocaleString("en")} of `) }).waitFor()
    // The URL changes at once, the list a moment later; a person clicks what the list shows.
    const showingAll = () => count.filter({ hasText: /^([\d,]+) of \1 lines$/ }).waitFor()
    await log.locator(".gge-term-row").first().waitFor()
    const all = await rpc(page, "logs/facets")
    await count.filter({ hasText: `${all.total.toLocaleString("en")} of ${all.total.toLocaleString("en")} lines` }).waitFor()
    assert(true, `the Logs nav item opens /logs with every line counted: ${all.total} of ${all.total}`)
    const rows = await termRows(log)
    assert(new Set(rows.map(r => r.account)).size > 1 && rows.every(r => r.tag?.startsWith("[")), "lines from several accounts show with a tag and an account chip")
    assert(await atBottom(log) && rows.at(-1).text.length > 0, "the newest line sits at the bottom")
    await page.screenshot({ path: `${out}/logs-1440.png` })

    const feed = await rpc(page, "logs/feed", { limit: 500 })
    await page.getByLabel("Filter text").fill("consumed")
    await page.waitForFunction(() => new URL(location.href).searchParams.get("q") === "consumed")
    const consumed = feed.filter(l => l.message.toLowerCase().includes("consumed")).length
    await showing(consumed)
    assert((await termRows(log)).every(r => r.text.toLowerCase().includes("consumed")), `the text filter narrows the list to ${consumed} lines and puts q=consumed in the URL`)
    await page.getByLabel("Filter text").fill("")
    await page.locator(".gge-logs-filters .ant-segmented-item", { hasText: "Error" }).click()
    await page.waitForFunction(() => new URL(location.href).searchParams.get("level") === "2")
    const errors = all.levels.find(l => l.level === 2).count
    await showing(errors)
    assert((await termRows(log)).every(r => r.level === "2"), `the Error level leaves the ${errors} errors and puts level=2 in the URL`)
    await page.getByRole("button", { name: "Clear filters" }).first().click()
    await page.waitForFunction(() => location.search === "")
    await showingAll()
    assert(true, "Clear filters empties the URL")

    await page.getByLabel("Tags").click()
    await page.locator(".ant-select-item-option", { hasText: "feast" }).click()
    await page.keyboard.press("Escape")
    await page.waitForFunction(() => new URL(location.href).searchParams.getAll("tag").join() === "feast")
    const feasts = all.plugins.find(p => p.key === "feast").count
    await showing(feasts)
    assert((await termRows(log)).every(r => r.tag === "[feast]"), `picking feast in the tag select leaves its ${feasts} lines and puts tag=feast in the URL`)
    await page.getByRole("button", { name: "Clear filters" }).first().click()
    await page.waitForFunction(() => location.search === "")
    await showingAll()

    const tagButton = log.locator("button.gge-term-tag").last()
    const clickedTag = (await tagButton.innerText()).slice(1, -1)
    await tagButton.click()
    await page.waitForFunction(tag => new URL(location.href).searchParams.getAll("tag").join() === tag, clickedTag)
    await page.waitForTimeout(300)
    assert((await termRows(log)).every(r => r.tag === `[${clickedTag}]`), `clicking the tag [${clickedTag}] in a row filters to it`)
    const chip = log.locator("button.gge-term-acct").last()
    const chipName = await chip.innerText()
    await chip.click()
    await page.waitForFunction(id => new URL(location.href).searchParams.getAll("account").join() === id, idOf(chipName))
    await page.waitForTimeout(300)
    const narrowed = await termRows(log)
    assert(narrowed.length > 0 && narrowed.every(r => r.account === chipName && r.tag === `[${clickedTag}]`), `clicking the account chip ${chipName} adds it to the filters`)
    const shownText = await count.innerText()
    await page.screenshot({ path: `${out}/logs-filtered-1440.png` })

    await page.reload()
    await log.locator(".gge-term-row").first().waitFor()
    await count.filter({ hasText: shownText }).waitFor()
    assert(searchOf().getAll("tag").join() === clickedTag && searchOf().get("account") === idOf(chipName)
        && await page.locator(".gge-tag-chip", { hasText: clickedTag }).count() === 1, "a reload keeps the tag and account filters, in the URL and the selects")
    await page.goBack()
    await page.waitForFunction(() => !new URL(location.href).searchParams.has("account"))
    assert(searchOf().getAll("tag").join() === clickedTag, "Back undoes the account filter and keeps the tag")
    await page.goForward()
    await page.waitForFunction(() => new URL(location.href).searchParams.has("account"))
    await count.filter({ hasText: shownText }).waitFor()
    assert(true, "Forward brings the account filter back")

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download .txt" }).click()])
    const file = `${out}/${download.suggestedFilename()}`
    await download.saveAs(file)
    const fileLines = require("fs").readFileSync(file, "utf8").trimEnd().split("\n")
    const shown = Number(shownText.split(" ")[0].replace(/,/g, ""))
    assert(/^gge-bot-logs-.*\.txt$/.test(download.suggestedFilename()) && fileLines.length === shown
        && fileLines.every(line => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d (INFO |WARN |ERROR) /.test(line) && line.includes(`[${clickedTag}] ${chipName}: `)),
        `Download .txt saves the ${shown} filtered lines and nothing else`)
    await page.getByRole("button", { name: "Clear filters" }).first().click()
    await page.waitForFunction(() => location.search === "")
    await showingAll()
    assert(true, "Clear filters on the page empties the URL and shows every line again")

    await page.waitForTimeout(1500)
    const first = unique()
    await insertLogLine({ accountName: "Ironhold", level: 1, plugin: "feast", parts: ["consumed", first] })
    await log.getByText(`Feasts used this much food: ${first}`).waitFor()
    await page.waitForTimeout(300)
    assert((await termRows(log)).at(-1).text.includes(String(first)) && await atBottom(log) && await page.getByText("Following live").isVisible(),
        "a line written while following appears at the bottom and the view stays there")
    await log.hover()
    await page.mouse.wheel(0, -900)
    await page.getByText("Paused", { exact: true }).waitFor()
    const second = unique()
    await insertLogLine({ accountName: "Ravenmoor", level: 2, plugin: "ggeBot", parts: ["closedReason", "timedOut", " ", second] })
    const pill = page.getByRole("button", { name: "1 new line · Jump to latest" })
    await pill.waitFor()
    assert(!await atBottom(log), "scrolling up pauses following, and a new line shows the 1 new line · Jump to latest pill instead of moving the view")
    await page.screenshot({ path: `${out}/logs-live-pill-1440.png` })
    await pill.click()
    await page.getByText("Following live").waitFor()
    await page.waitForTimeout(800)
    assert((await termRows(log)).at(-1).text.includes(String(second)) && await atBottom(log) && await pill.count() === 0, "Jump to latest lands on the new line at the bottom and follows again")
    await axe(page, "logs 1440")

    await insertNotification({ accountName: "Ironhold" })
    await page.getByRole("button", { name: /^Notifications, [1-9]\d* unread$/ }).click()
    await page.getByRole("link", { name: "View logs for Ironhold" }).first().click()
    await page.waitForURL(url => url.pathname === "/logs" && url.searchParams.get("account") === idOf("Ironhold") && url.searchParams.get("level") === "2")
    await log.locator(".gge-term-row").first().waitFor()
    await page.waitForTimeout(300)
    assert((await termRows(log)).every(r => r.level === "2" && r.account === "Ironhold"), "a notification's View logs link opens Ironhold's errors on the Logs page")

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${CLIENT_URL}/logs`)
    await log.locator(".gge-term-row").first().waitFor()
    await page.waitForTimeout(500)
    assert(await overflow() === 0, "no horizontal overflow on /logs at 390")
    await page.screenshot({ path: `${out}/logs-390.png` })
    await axe(page, "logs 390")
    await page.locator("button", { hasText: /^Filters$/ }).click()
    const filtersDrawer = page.getByRole("dialog", { name: "Filters" })
    await filtersDrawer.locator(".ant-segmented-item", { hasText: "Warning" }).click()
    await page.waitForFunction(() => new URL(location.href).searchParams.get("level") === "1")
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${out}/logs-390-filters.png` })
    await axe(page, "logs 390 filters drawer")
    await filtersDrawer.getByRole("button", { name: /^Show [\d,]+ lines?$/ }).click()
    await page.locator("button", { hasText: /^Filters \(1\)$/ }).waitFor()
    await page.waitForTimeout(300)
    assert((await termRows(log)).every(r => r.level === "1") && await overflow() === 0, "at 390 the Filters drawer sets the level, the button counts it, and nothing overflows")
    await page.setViewportSize({ width: 320, height: 700 })
    await page.waitForTimeout(400)
    assert(await overflow() === 0, "no horizontal overflow on /logs at 320")
    await page.setViewportSize({ width: 1280, height: 860 })
}

const WIDE_VIEW = { width: 1440, height: 900 }, PHONE_VIEW = { width: 390, height: 844 }
const randomIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`

/** One player-API call from outside a browser, as a fresh IP so the per-IP sign-up limit never trips. Returns the answer and any cookies set. */
async function clientCall(path, body, cookie) {
    const res = await fetch(`${API_URL}/rpc/${path}`, { method: "POST", headers: { origin: CLIENT_URL, "content-type": "application/json", "x-forwarded-for": randomIp(), ...(cookie && { cookie }) }, body: JSON.stringify({ json: body }) })
    return { json: (await res.json()).json, cookies: res.headers.getSetCookie().map(c => c.split(";")[0]) }
}

/** An admin-API call as the seeded admin. `meta` marks Date fields the way oRPC's wire format does. */
async function adminCall(path, body, meta) {
    adminCookie ??= await adminSessionCookie({ apiUrl: API_URL, adminUrl: ADMIN_URL })
    const res = await fetch(`${API_URL}/admin/rpc/${path}`, { method: "POST", headers: { origin: ADMIN_URL, "content-type": "application/json", cookie: adminCookie }, body: JSON.stringify({ json: body, meta }) })
    return (await res.json()).json
}

/** A player signed up and confirmed through the API: what billing needs as a starting point, with no gate to click through. */
async function verifiedPlayer(prefix) {
    const name = prefix + Date.now().toString(36)
    const email = `${name}@example.test`
    const { cookies } = await clientCall("auth/signup", { username: name, email, password: "a-strong-password" })
    await clientCall("auth/verifyEmail", { token: new URL(emailedLink(email)).searchParams.get("token") })
    return { name, email, cookie: cookies.find(c => c.startsWith("gge_session=")) }
}

const asCookie = (pair, url) => ({ name: pair.split("=")[0], value: pair.slice(pair.indexOf("=") + 1), url })
const overflowOf = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

/** axe and a screenshot at 1440 and at 390, with no sideways scroll on the phone. */
async function atBothWidths(page, file, what) {
    await page.setViewportSize(WIDE_VIEW)
    await axe(page, `${what} 1440`)
    await page.screenshot({ path: `${out}/${file}-1440.png`, fullPage: true })
    await page.setViewportSize(PHONE_VIEW)
    await page.waitForTimeout(300)
    await axe(page, `${what} 390`)
    assert(await overflowOf(page) <= 0, `no horizontal overflow on ${what} at 390`)
    await page.screenshot({ path: `${out}/${file}-390.png`, fullPage: true })
    await page.setViewportSize(WIDE_VIEW)
}

/**
 * Plans, banners and Paystack. With billing off a new player sees no plan anywhere, and an announcement closes for
 * good. With the stack started on the stub Paystack it then goes live from the admin app, buys Basic through the
 * stub, gets a Team-5 purchase recorded for it, has a second player redeem one of the codes from a shared link, and
 * goes back to free.
 */
/** A refusal the player reads on screen is the errors catalog's text for the code the API sent, not a string the API wrote into the page. */
async function driveErrors(browser) {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
    await page.goto(`${CLIENT_URL}/login`)
    await page.getByLabel("Username or email").fill("demo")
    await page.getByLabel("Password").fill("not-the-password")
    const answered = page.waitForResponse(response => response.url().includes("/rpc/auth/login"))
    await page.getByRole("button", { name: "Sign in" }).click()
    const body = (await (await answered).json()).json
    assert(body.data?.code === "WRONG_CREDENTIALS" && typeof body.data.params === "object", `a wrong password answers with its code and params (${JSON.stringify(body.data)})`)
    const alert = page.getByRole("alert").filter({ hasText: "Wrong username or password" })
    await alert.waitFor()
    assert(true, "the sign-in page shows the catalog text for WRONG_CREDENTIALS")
    await page.screenshot({ path: `${out}/30-error-rendered-from-code.png` })
    await axe(page, "sign-in with an error rendered from its code")

    const direct = await page.evaluate(async () => {
        const res = await fetch("/rpc/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: { login: "", password: "" } }) })
        const json = (await res.json()).json
        return { status: res.status, issue: json?.data?.issues?.[0]?.code, message: json?.message }
    })
    assert(direct.status === 400 && typeof direct.issue === "string", `an input the schema refuses answers with an issue code, which the client maps to zod.<code> (${direct.issue})`)
    await page.context().close()
}

async function driveBilling(browser) {
    const start = await adminCall("billing/status", {})
    if (start.billingLive)
        await adminCall("billing/setLive", { live: false })
    const p1 = await verifiedPlayer("b")
    const player = await (await browser.newContext({ viewport: WIDE_VIEW })).newPage()
    await player.context().addCookies([asCookie(p1.cookie, CLIENT_URL)])
    const alertsLoaded = () => player.waitForResponse(r => r.url().includes("/rpc/alerts/list"))
    const banner = text => player.locator(".gge-alert", { hasText: text })

    let loaded = alertsLoaded()
    await player.goto(`${CLIENT_URL}/`)
    await player.getByText("No accounts yet").waitFor()
    await loaded
    assert(await player.getByRole("link", { name: "Plan", exact: true }).count() === 0, "billing off: the player's nav has no Plan")
    assert(await player.locator(".gge-alert").count() === 0, "billing off: a new player sees no plan, trial or points banner")
    await player.goto(`${CLIENT_URL}/plan`)
    await player.waitForURL(url => url.pathname === "/")
    assert(true, "billing off: /plan sends a player back to their accounts")
    await player.goto(`${CLIENT_URL}/settings`)
    await player.waitForFunction(() => document.querySelectorAll("[role=switch]:not([disabled])").length === 6)
    assert(await player.getByRole("switch", { name: "Email me when my free trial starts" }).count() === 0, "billing off: Settings hides the four plan email switches and shows the four bot and two Auto Station ones")

    const title = `Servers restart ${Date.now().toString(36)}`
    const announcement = await adminCall("announcements/create", {
        severity: "warning", title, body: "The game servers restart at 02:00 UTC. Your bots reconnect by themselves.", linkUrl: "https://example.com/status",
        startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: null, dismissible: true,
    }, [[1, "startsAt"]])
    await player.goto(`${CLIENT_URL}/`)
    await banner(title).waitFor()
    assert(await banner(title).getAttribute("role") === "status" && await banner(title).getByRole("link", { name: "Learn more" }).count() === 1, "an admin's announcement shows under the header as a status with its Learn more link")
    await atBothWidths(player, "billing-01-announcement", "announcement banner")
    await banner(title).getByRole("button", { name: "Close this message" }).click()
    await banner(title).waitFor({ state: "detached" })
    loaded = alertsLoaded()
    await player.reload()
    await loaded
    await player.getByText("No accounts yet").waitFor()
    assert(await banner(title).count() === 0, "a closed announcement stays closed after a reload")
    await adminCall("announcements/end", { id: announcement.id })

    if (!start.paystackConfigured) {
        console.log("skip: billing live steps need PAYSTACK_SECRET_KEY=sk_test_dummy and PAYSTACK_BASE_URL pointing at stub-paystack.cjs")
        return
    }

    adminCookie ??= await adminSessionCookie({ apiUrl: API_URL, adminUrl: ADMIN_URL })
    const admin = await (await browser.newContext({ viewport: WIDE_VIEW })).newPage()
    await admin.context().addCookies([asCookie(adminCookie, ADMIN_URL)])
    await admin.goto(`${ADMIN_URL}/billing`)
    await admin.getByText("Test key", { exact: true }).waitFor()
    assert(await admin.getByText("This is a Paystack test key: it takes no real money.").isVisible(), "the admin's Billing page warns that the Paystack key is a test key")
    await admin.getByRole("tab", { name: "Packages" }).click()
    const basic = admin.locator(".gge-package-row", { hasText: "Basic" })
    await basic.getByLabel("Price").fill("5")
    const save = basic.getByRole("button", { name: "Save Basic" })
    // A run before this one may have set the same price already, which leaves nothing to save.
    if (await save.isEnabled()) {
        await save.click()
        await admin.getByText("Basic saved").waitFor()
    }
    assert((await adminCall("billing/packages", {})).some(p => p.id === "basic_28" && p.priceMinor === 500 && p.currency === "USD"), "the admin prices Basic at 5.00 USD on the Packages tab")
    await atBothWidths(admin, "billing-02-admin-packages", "admin billing packages")
    await admin.getByRole("button", { name: "Go live" }).click()
    const goLive = admin.getByRole("dialog", { name: "Go live with plans?" })
    await goLive.getByText(/active players? will get a 7-day trial\. When it ends, bots beyond their plan stop\./).waitFor()
    assert(await goLive.getByText("This is a Paystack test key: it takes no real money.").isVisible(), "the go-live dialog says how many players get a trial and warns about the test key again")
    await admin.waitForTimeout(400)
    await axe(admin, "admin go-live dialog")
    await admin.screenshot({ path: `${out}/billing-03-go-live-dialog-1440.png` })
    await goLive.getByRole("button", { name: "Go live" }).click()
    await admin.getByText("Plans (live)").waitFor()
    assert(true, "going live turns the switch on")
    await atBothWidths(admin, "billing-04-admin-live", "admin billing live")

    loaded = alertsLoaded()
    await player.goto(`${CLIENT_URL}/`)
    await loaded
    await banner("Your free trial ends in").waitFor()
    assert((await banner("Your free trial ends in").innerText()).includes("7 days"), "once live, the player sees their 7-day trial banner")
    await atBothWidths(player, "billing-05-trial-banner", "trial banner")
    await sidebar(player, "Plan")
    await player.waitForURL(url => url.pathname === "/plan")
    await player.locator(".gge-package", { hasText: "$5" }).waitFor()
    assert(await player.locator(".gge-plan-name").innerText() === "Basic" && await player.getByText("Free trial").first().isVisible(), "the Plan page shows Basic on a free trial and Basic for sale at $5")
    const team10 = player.locator(".gge-package", { hasText: "Team 10" })
    assert(await team10.getByText("Online payment isn't available yet. Contact support to buy.").isVisible() && await team10.getByRole("button", { name: /Pay/ }).count() === 0
        && /10 single-use codes to share/.test(await team10.innerText()), "a Team package with no price shows as a card that says online payment isn't available, what it includes, and no Pay button")
    await atBothWidths(player, "billing-06-plan", "plan page")

    await player.getByRole("button", { name: /^Pay \$5 for Basic/ }).click()
    await player.waitForURL(/\/plan\/return\?reference=gge_/)
    await player.getByText("Payment received").waitFor()
    assert(await player.getByText("You earned 1 point.").isVisible(), "paying through the stub lands on the return page, which says what was added and the point earned")
    await atBothWidths(player, "billing-07-return", "payment return page")
    await player.getByRole("button", { name: "Go to your plan" }).click()
    await player.locator(".gge-points-balance", { hasText: "1 point" }).waitFor()
    assert(true, "the Plan page shows 1 point")

    await admin.goto(`${ADMIN_URL}/users?plan=trial`)
    await admin.getByRole("link", { name: p1.name }).waitFor()
    assert(true, "the admin's Users page lists the player under the On a trial filter")
    await admin.screenshot({ path: `${out}/billing-08-admin-users-1440.png` })
    await admin.getByRole("link", { name: p1.name }).click()
    await admin.getByRole("tab", { name: "Plan" }).click()
    await admin.getByRole("button", { name: "Record purchase" }).click()
    const record = admin.getByRole("dialog", { name: `Record a purchase for ${p1.name}` })
    await record.getByLabel("Package").click()
    await admin.locator(".ant-select-item-option", { hasText: "Team 5:" }).click()
    await record.getByRole("button", { name: "Record purchase" }).click()
    await admin.getByText("Purchase recorded").waitFor()
    await admin.locator(".ant-tag", { hasText: "Unused" }).nth(4).waitFor()
    assert(true, "the admin records a Team-5 purchase on the player's Plan tab and sees its 5 codes")
    await atBothWidths(admin, "billing-09-admin-user-plan", "admin user plan")

    await player.reload()
    await player.getByRole("tab", { name: "Team codes" }).click()
    await player.locator("code.gge-code").nth(4).waitFor()
    const code = await player.locator("code.gge-code").first().innerText()
    assert(/^GGE-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code), "the player sees their 5 Team codes")

    const p2 = await verifiedPlayer("r")
    const friend = await (await browser.newContext({ viewport: WIDE_VIEW })).newPage()
    await friend.goto(`${CLIENT_URL}/redeem?code=${encodeURIComponent(code)}`)
    await friend.getByText("Sign in or create an account to redeem your code").waitFor()
    await friend.getByLabel("Username or email").fill(p2.name)
    await friend.getByLabel("Password").fill("a-strong-password")
    await friend.getByRole("button", { name: "Sign in" }).click()
    await friend.getByText("Code redeemed").waitFor()
    assert(await friend.getByText("28 days of Team added.").isVisible(), "a second player opens the shared link signed out, signs in, and the code is redeemed")
    await atBothWidths(friend, "billing-10-redeemed", "redeem link")
    await player.reload()
    await player.getByRole("tab", { name: "Team codes" }).click()
    await player.getByText(p2.name).waitFor()
    assert(true, "the buyer sees who redeemed the code")

    await admin.goto(`${ADMIN_URL}/billing`)
    await admin.getByRole("button", { name: "Back to free" }).click()
    await admin.locator(".ant-popover").getByRole("button", { name: "Back to free" }).click()
    await admin.getByText("Free rules").waitFor()
    loaded = alertsLoaded()
    await player.goto(`${CLIENT_URL}/`)
    await loaded
    await player.getByText("No accounts yet").waitFor()
    assert(await banner("Your free trial").count() === 0 && await player.getByRole("link", { name: "Plan", exact: true }).count() === 0, "back to free: the trial banner and the Plan nav are gone")

    for (const [who, cookie] of [[p1, p1.cookie], [p2, (await friend.context().cookies()).filter(c => c.name === "gge_session").map(c => `${c.name}=${c.value}`)[0]]])
        await clientCall("account/deleteMe", { password: "a-strong-password", confirmUsername: who.name }, cookie)
    await Promise.all([player.context().close(), admin.context().close(), friend.context().close()])
}

/** Ironhold's plugin settings dialogs, as the seeded demo: status, every option showing at once, no Setup checks, every option type, save and reopen. */
async function drivePluginSettings(page) {
    const ironhold = (await rpc(page, "accounts/list")).find(a => a.name === "Ironhold")
    // Starts from the seeded settings even after a run that failed before putting them back.
    const seeded = { ...ironhold.plugins, devSettingsPreview: { enabled: true, options: {} } }
    await rpc(page, "accounts/update", { id: ironhold.id, plugins: seeded })
    const banners = await rpc(page, "catalog/gameItems", { kind: "banner" })
    const bannerName = id => banners.find(b => b.id === id).name
    const saveBar = page.locator(".gge-savebar")
    const noToggleOrChecks = async what => {
        assert(await page.getByText("Setup checks").count() === 0 && await page.getByRole("complementary", { name: "Setup checks" }).count() === 0, `${what} has no Setup checks panel`)
        assert(await page.locator(".ant-segmented-item", { hasText: /^(Simple|Advanced)/ }).count() === 0 && await page.locator(".gge-module-tools").count() === 0, `${what} has no Simple/Advanced toggle`)
    }

    // Nomads, Samurai and Daimyo has a tab for each plugin, so the form is the open tab's panel.
    await openModule(page, "Nomads, Samurai and Daimyo")
    let form = page.getByRole("tabpanel")
    const nomadsRow = page.getByRole("switch", { name: "Enable Attack Nomads" }).locator("xpath=ancestor::div[1]")
    assert(await nomadsRow.getByText("Waiting", { exact: true }).count() === 1, "the Attack Nomads row shows its Waiting pill while Ironhold runs")
    assert(await nomadsRow.getByText("The event isn't running. This resumes when it opens.").count() === 1, "the row says why in words")
    assert(await form.getByText("Attacks Nomad camps during the Nomad event until it ends or the score you set is reached.").count() === 1, "the page describes Attack Nomads")
    await noToggleOrChecks("the Nomads page")
    assert(await form.getByText("The bot stops for this event once it reaches this many points. Leave it at 0 for no limit.").isVisible(), "a field's help shows under it")
    assert(await form.getByText("Log only: write the attacks to the log instead of sending them").isVisible(), "the Log only option shows with every other option")
    const food = form.getByRole("checkbox", { name: "Food troops only" })
    assert(await food.isVisible() && await form.getByText("Leaves out troops that eat mead, so only troops that eat food go.").isVisible(), "the Food troops only option has a label and its help, where it used to show a raw key")
    assert(await form.getByText("foodTroopsOnly").count() === 0, "no raw option key shows on the page")
    await page.screenshot({ path: `${out}/40-module-nomads-all-options-1440.png` })
    assert(await form.getByText("You have 18 commanders (positions 1–18).", { exact: true }).isVisible(), "the commander field names the account's real range")
    assert(await saveBar.count() === 0, "an untouched module page has no save bar")
    await form.getByLabel("Commanders to use").fill("")
    assert(await saveBar.count() === 0, "an empty whitelist means the default, so it is no change to save")
    await form.getByLabel("Commanders to use").fill("1-5")
    await saveBar.waitFor()
    assert(true, "a change brings up the sticky save bar")
    await page.screenshot({ path: `${out}/40-module-nomads-1440.png` })
    await axe(page, "nomads module 1440")
    await page.setViewportSize(PHONE_VIEW)
    await page.waitForTimeout(300)
    await axe(page, "nomads module 390")
    await page.screenshot({ path: `${out}/40-module-nomads-390.png` })
    await page.setViewportSize(WIDE_VIEW)
    await saveBar.getByRole("button", { name: "Discard changes" }).click()
    await saveBar.waitFor({ state: "detached" })
    const back = await form.getByLabel("Commanders to use").inputValue()
    assert(back === "1-50", `(${back}) Discard changes puts the saved whitelist back and takes the save bar away`)

    await openModule(page, "Settings preview (dev only)")
    form = page.locator(".gge-content")
    assert(await form.getByText("Running this plugin ends the account’s beginner or peace protection.").count() === 1, "a peace-breaking plugin says so on its page")
    await noToggleOrChecks("the Settings preview page")
    const list = form.locator(".gge-ordered-list ol > li")
    const order = async () => (await list.allInnerTexts()).map(text => text.split("\n")[1])
    assert(JSON.stringify(await order()) === JSON.stringify([660, 661, 77].map(bannerName)), "the banner order starts at its default, named from the game's items")
    await list.first().focus()
    await page.keyboard.press("Alt+ArrowDown")
    await page.waitForTimeout(100)
    assert(JSON.stringify(await order()) === JSON.stringify([661, 660, 77].map(bannerName)), "Alt+Down on a focused banner moves it down one place")
    assert((await page.getByRole("status").filter({ hasText: "moved to position" }).innerText()).includes(`${bannerName(660)} moved to position 2 of 3.`), "the move is announced to screen readers")
    await form.getByRole("button", { name: `Move ${bannerName(77)} up` }).focus()
    await page.keyboard.press("Enter")
    await page.waitForTimeout(100)
    assert(JSON.stringify(await order()) === JSON.stringify([661, 77, 660].map(bannerName)), "the Move up button works from the keyboard")
    await form.getByLabel("Stop before the event ends").fill("45")
    const openOption = text => page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option", { hasText: text })
    await form.getByLabel("Castle to attack from").focus()
    await page.keyboard.press("ArrowDown")
    await openOption("Ironhold Watch").waitFor()
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")
    await form.locator(".ant-select-content", { hasText: "Ironhold Watch" }).waitFor()
    assert(true, "the castle picker lists the castles the bot reported and picks one from the keyboard")
    await form.getByRole("button", { name: "Add row" }).click()
    await saveBar.getByRole("button", { name: "Save" }).click()
    await form.getByText("Fill in every column, or remove the row.").waitFor()
    assert(true, "an unfinished row is caught under its field and nothing is saved")
    await form.getByLabel("Castle, row 1").click()
    await openOption("Frostgate").click()
    await form.getByLabel("Tool, row 1").click()
    await page.keyboard.type("Battering ram")
    await openOption("Battering ram").first().click()
    await form.getByLabel("Target, row 1").fill("1500")
    await form.getByText("Fill in every column, or remove the row.").waitFor({ state: "hidden" })
    assert(true, "the row's error clears once every column is filled")
    await page.screenshot({ path: `${out}/41-module-preview-1440.png` })
    await axe(page, "module page with every option type 1440")
    await saveBar.getByRole("button", { name: "Save" }).click()
    await page.getByText("Ironhold saved").waitFor()
    await saveBar.waitFor({ state: "detached" })
    const saved = (await rpc(page, "accounts/list")).find(a => a.name === "Ironhold").plugins.devSettingsPreview.options
    assert(JSON.stringify(saved.bannerOrder) === "[661,77,660]" && saved.stopMinutesBefore === 45 && saved.sourceCastle?.id === 1002 && saved.toolTargets?.[0]?.castle.id === 2001 && saved.toolTargets[0].target === 1500,
        `Save stores the order, the number, the castle and the row at once (${JSON.stringify(saved)})`)

    await openModule(page, "Settings preview (dev only)")
    assert(JSON.stringify(await order()) === JSON.stringify([661, 77, 660].map(bannerName)) && await form.getByLabel("Stop before the event ends").inputValue() === "45"
        && await form.getByText("Ironhold Watch").count() > 0, "reopened, the page shows what was saved")

    await page.setViewportSize({ width: 390, height: 844 })
    await openModule(page, "Nomads, Samurai and Daimyo")
    await page.waitForTimeout(400)
    form = page.getByRole("tabpanel")
    await noToggleOrChecks("the Nomads page on a phone")
    assert(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) === 0, "no horizontal overflow at 390 on a module page")
    await page.screenshot({ path: `${out}/42-module-390.png` })
    await axe(page, "nomads module 390")
    await page.setViewportSize({ width: 1440, height: 900 })

    await openModule(page, "Refinery and toolsmith")
    form = page.locator(".gge-content")
    await noToggleOrChecks("the Toolsmith page")
    assert(await form.getByText("Keep at least this much of each resource").isVisible() && await form.getByText("Log only: write the orders to the log instead of sending them").isVisible(),
        "the Toolsmith resource floor and log only show without a toggle")
    await form.getByRole("button", { name: "Add row" }).first().click()
    await form.getByLabel("Tool, row 1").click()
    await page.keyboard.type("Battering ram")
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option", { hasText: "Battering ram" }).first().click()
    await form.getByLabel("Stock, row 1").fill("1500")
    await page.screenshot({ path: `${out}/43-toolsmith-1440.png` })
    await axe(page, "toolsmith module 1440")
    await saveBar.getByRole("button", { name: "Discard changes" }).click()
    await saveBar.waitFor({ state: "detached" })

    await openModule(page, "Armourer")
    form = page.locator(".gge-content")
    await noToggleOrChecks("the Armourer page")
    assert(/^4,?000$/.test(await form.getByLabel("Extra tools to buy on top of the shortfall").inputValue()), "Buy tools starts with a margin of 4,000")
    assert(await form.getByRole("checkbox", { name: "Spend coins above a limit on tools so none are lost" }).isChecked() === false, "the overflow burn shows, and is off by default")
    await page.screenshot({ path: `${out}/44-buy-tools-1440.png` })
    await axe(page, "armourer module 1440")

    await page.setViewportSize({ width: 390, height: 844 })
    for (const [module, shot] of [["Refinery and toolsmith", "45-toolsmith-390"], ["Armourer", "46-buy-tools-390"]]) {
        await openModule(page, module)
        await page.waitForTimeout(400)
        assert(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) === 0, `no horizontal overflow at 390 on the ${module} page`)
        await page.screenshot({ path: `${out}/${shot}.png` })
        await axe(page, `${module} page 390`)
    }
    await page.setViewportSize({ width: 1280, height: 860 })
    await rpc(page, "accounts/update", { id: ironhold.id, plugins: seeded })
}

/**
 * The Auto Station page (every option showing, the gate fallback off with its ruby cost in the label, a fixed
 * destination row with its kingdom picker) and an incoming-attack notification in the bell, at 1440 and 390.
 */
async function driveStationSettings(page) {
    const shots = path.join(out, "station-run")
    require("fs").mkdirSync(shots, { recursive: true })
    await page.setViewportSize(WIDE_VIEW)
    await openModule(page, "Alert and autostation")
    const dialog = page.locator(".gge-content")

    assert(await page.locator(".ant-segmented-item", { hasText: /^(Simple|Advanced)/ }).count() === 0, "the Auto Station page has no Simple/Advanced toggle")
    assert(await dialog.getByText("Running this plugin ends the account’s beginner or peace protection.").count() === 1, "the page's alert says stationing ends protection")
    assert(await dialog.getByText("Sending troops to an alliance castle ends your beginner or peace protection.").count() === 0, "the peace warning is not repeated as a heading in the form")
    assert(await dialog.getByText("When a player attacks one of your castles, moves its troops to a protected alliance castle just before the attack lands, then calls them home.").count() === 1, "the header describes Auto Station")
    assert(await dialog.getByLabel("Move the troops out this long before the attack lands").inputValue() === "60", "troops leave 60 seconds before the attack by default")
    const gate = dialog.getByLabel("If no alliance castle takes the troops, open the gates", { exact: true })
    assert(await gate.isVisible(), "the gate fallback is shown")
    assert(await dialog.getByText("Opening the gates costs rubies, from 450 to 56,700 each time", { exact: false }).isVisible(), "the gate fallback's help names its ruby cost")
    assert(await dialog.locator(".ant-select-content", { hasText: /^Off$/ }).count() === 1, "the gate fallback is off by default")
    await dialog.getByRole("button", { name: "Add row" }).first().click()
    await dialog.getByLabel("Kingdom, row 1").click()
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option", { hasText: "Everwinter Glacier" }).first().click()
    await dialog.getByLabel("X, row 1").fill("310")
    await dialog.getByLabel("Y, row 1").fill("402")
    assert(await dialog.locator(".ant-select-content", { hasText: "Everwinter Glacier" }).count() === 1, "a fixed destination row picks its kingdom by name")
    await axe(page, "auto station page 1440")
    await page.screenshot({ path: `${shots}/auto-station-1440.png` })

    assert(await dialog.getByText("Log only: write the station, recall and gate commands to the log instead of sending them").isVisible(), "Log only shows with every other option")
    assert(await dialog.getByRole("checkbox", { name: "Watch outposts" }).isChecked(), "outposts are watched by default")
    await axe(page, "auto station page with Log only 1440")
    await page.screenshot({ path: `${shots}/auto-station-log-only-1440.png` })

    await page.setViewportSize(PHONE_VIEW)
    await page.waitForTimeout(400)
    assert(await overflowOf(page) <= 0, "no horizontal overflow at 390 on the Auto Station page")
    await axe(page, "auto station page 390")
    await page.screenshot({ path: `${shots}/auto-station-390.png` })
    await dialog.getByLabel("Kingdom, row 1").scrollIntoViewIfNeeded()
    const kingdom = await dialog.getByLabel("Kingdom, row 1").boundingBox()
    const form = await dialog.locator("form").boundingBox()
    assert(kingdom.x >= 0 && form.x + form.width <= PHONE_VIEW.width, `at 390 a destination row scrolls inside its table instead of widening the form past the screen (form ends at ${form.x + form.width})`)
    await page.screenshot({ path: `${shots}/auto-station-rows-390.png` })
    await page.locator(".gge-savebar").getByRole("button", { name: "Discard changes" }).click()
    await page.locator(".gge-savebar").waitFor({ state: "detached" })

    for (const [viewport, width] of [[WIDE_VIEW, 1440], [PHONE_VIEW, 390]]) {
        await page.setViewportSize(viewport)
        await page.goto(CLIENT_URL)
        const notice = await insertNotification({ accountName: "Ironhold", kind: "incoming_attack" })
        await page.getByRole("button", { name: /^Notifications, [1-9]\d* unread$/ }).click()
        const item = page.getByText("Raider is attacking Ironhold Keep on Ironhold").first()
        await item.waitFor()
        await page.getByText("Auto Station moves the troops out just before.", { exact: false }).first().waitFor()
        assert(true, `the bell words an incoming attack at ${width}`)
        const href = await page.getByRole("link", { name: "View logs for Ironhold" }).first().getAttribute("href")
        assert(href === `/logs?account=${notice.accountId}&tag=autoStation`, `its View logs link opens Ironhold's Auto Station lines (${href})`)
        await axe(page, `bell incoming attack ${width}`)
        assert(await overflowOf(page) <= 0, `no horizontal overflow at ${width} with the bell open`)
        await page.screenshot({ path: `${shots}/bell-incoming-attack-${width}.png` })
        await page.keyboard.press("Escape")
    }
    await page.setViewportSize({ width: 1280, height: 860 })
}

/** The sidebar and module pages as a player meets them: groups, filter, keys, the phone drawer, a coming-soon page, old links, the unsaved guard and the moved notice. */
async function driveSidebar(page) {
    const ironhold = (await rpc(page, "accounts/list")).find(a => a.name === "Ironhold")
    const nav = page.getByRole("navigation", { name: "Modules" })
    await page.setViewportSize(WIDE_VIEW)
    await page.goto(`${CLIENT_URL}/m/khan`)
    await page.locator(".gge-module-plugin-row").first().waitFor()
    const links = await nav.locator("a[href]").count()
    assert(links >= 30, `the sidebar lists every module as a link (${links})`)
    assert(await nav.locator("[aria-current=page]").count() === 1 && await nav.locator("[aria-current=page]").innerText() === "Khan", "exactly one link is the current page, Khan")
    const group = page.getByRole("button", { name: "Utilities" })
    const open = await group.getAttribute("aria-expanded")
    await group.click()
    assert(await group.getAttribute("aria-expanded") !== open, "a group folds and unfolds")
    const filter = page.getByLabel("Find a module")
    await filter.fill("ber")
    assert(await nav.getByRole("link").filter({ visible: true }).count() === 2, "filtering for \"ber\" leaves Berimond and Green Berimond")
    await filter.press("ArrowDown")
    assert(await page.evaluate(() => Boolean(document.activeElement?.closest(".gge-nav"))), "ArrowDown moves focus from the filter into the list")
    await filter.fill("zzzz")
    await page.getByText("No module matches").waitFor()
    await filter.fill("")
    await axe(page, "sidebar and module page 1440")
    await page.screenshot({ path: `${out}/60-sidebar-1440.png` })

    await sidebar(page, "Castle manager")
    await page.getByText("Coming soon", { exact: true }).waitFor()
    assert(await page.getByRole("switch").count() === 0 && await page.locator(".gge-content form").count() === 0, "a coming-soon page has no form and no switches")
    assert(await page.getByRole("link", { name: "Ask for it on Discord" }).count() === 1, "a coming-soon page links to Discord")
    await axe(page, "coming soon page 1440")
    await page.screenshot({ path: `${out}/61-coming-soon-1440.png` })

    await page.goto(`${CLIENT_URL}/?account=${ironhold.id}&plugin=attackKhan`)
    await page.waitForURL(url => url.pathname === "/m/khan")
    assert(new URL(page.url()).searchParams.get("account") === ironhold.id, "an old ?account=&plugin= link lands on the module page for that account")

    await page.goto(`${CLIENT_URL}/m/account-settings?account=${ironhold.id}`)
    await page.getByRole("dialog").getByRole("tab", { name: "Account settings", selected: true }).waitFor()
    assert(await nav.getByRole("link", { name: /Account settings/ }).count() === 0, "the old Account settings module address opens the account's panel on Account settings, and the sidebar lists no such module")
    await page.keyboard.press("Escape")
    await drawerClosed(page)

    await openModule(page, "Khan")
    const waves = page.getByLabel("Stop at this score", { exact: true })
    const before = await waves.inputValue()
    await waves.fill(before === "5000" ? "4000" : "5000")
    await page.locator(".gge-savebar").waitFor()
    await page.locator("#module-account").click()
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").nth(1).click()
    await page.locator(".ant-modal-confirm-title", { hasText: "Discard your changes?" }).waitFor()
    assert(true, "switching account with an unsaved change asks first")
    await page.getByRole("button", { name: "Keep editing" }).click()
    await sidebar(page, "Storms")
    await page.locator(".ant-modal-confirm-title", { hasText: "Discard your changes?" }).waitFor()
    assert(true, "leaving through the sidebar with an unsaved change asks first")
    await page.getByRole("button", { name: "Keep editing" }).click()
    await page.locator(".gge-savebar").getByRole("button", { name: "Discard changes" }).click()
    await page.locator(".gge-savebar").waitFor({ state: "detached" })
    assert(await waves.inputValue() === before, "Discard changes puts the saved value back")

    await page.evaluate(() => localStorage.removeItem("gge.movedNoticeSeen"))
    await page.goto(CLIENT_URL)
    await page.getByText("Settings moved to the sidebar").waitFor()
    await page.getByRole("button", { name: "Got it" }).click()
    await page.reload()
    await page.getByRole("button", { name: "Edit Ironhold" }).waitFor()
    assert(await page.getByText("Settings moved to the sidebar").count() === 0, "the moved notice shows once and stays closed after Got it")

    await page.setViewportSize(PHONE_VIEW)
    await page.goto(`${CLIENT_URL}/m/khan`)
    await page.locator(".gge-module-plugin-row").first().waitFor()
    assert(await page.getByRole("navigation", { name: "Modules" }).count() === 0, "on a phone the sidebar is closed until the menu button opens it")
    await openSidebar(page)
    await axe(page, "phone drawer 390")
    await page.screenshot({ path: `${out}/62-phone-drawer-390.png` })
    await page.getByLabel("Find a module").fill("Storms")
    await page.getByRole("navigation", { name: "Modules" }).getByRole("link", { name: linkName("Storms") }).click()
    await page.waitForURL(/\/m\/storms/)
    await page.getByRole("dialog").waitFor({ state: "hidden" })
    assert(await overflowOf(page) <= 0, "the drawer closes on navigation and nothing overflows at 390")
    await page.setViewportSize(WIDE_VIEW)
}

/** The Foreign Lords and Bloodcrow glory pages: every option showing and the off-by-default safety options, at 1440 and 390. */
async function driveGlorySettings(page) {
    for (const [plugin, file, described] of [["Attack Foreign Lords", "50-glory-foreign", "Attacks Foreign Lords' camps during the Foreign Invasion event"], ["Attack Bloodcrows", "51-glory-bloodcrows", "Attacks Bloodcrow camps during the Bloodcrow event"]]) {
        await page.setViewportSize(WIDE_VIEW)
        await openModule(page, "Invasion events")
        await page.getByRole("tab", { name: plugin }).click()
        await page.getByRole("tab", { name: plugin, selected: true }).waitFor()
        await page.waitForTimeout(400)
        const dialog = page.getByRole("tabpanel")

        assert(await page.locator(".ant-segmented-item", { hasText: /^(Simple|Advanced)/ }).count() === 0, `${plugin}: no Simple/Advanced toggle`)
        assert(await dialog.getByText(described, { exact: false }).isVisible(), `${plugin}: the header describes the plugin`)
        assert(await dialog.getByText("Hard and above are rented with rubies when you pick one by hand", { exact: false }).isVisible(), `${plugin}: the difficulty help says tiers 5 and up are rented with rubies`)
        for (const label of ["Difficulty", "Stop at this score", "Stop before the event ends", "Commanders to use", "Horse"])
            assert(await dialog.getByLabel(label, { exact: true }).isVisible(), `${plugin}: shows ${label} (${await dialog.getByLabel(label, { exact: true }).count()} found, ${await page.getByRole("tabpanel").count()} panels)`)
        assert(await dialog.getByText("Dethrone camps before attacking them").isVisible(), `${plugin}: shows the dethrone setting`)
        assert(await dialog.locator(".ant-select-content", { hasText: "Highest unlocked without rubies" }).count() === 1, `${plugin}: the difficulty starts at the highest tier that needs no rubies`)
        await axe(page, `${plugin} module top 1440`)
        await page.screenshot({ path: `${out}/${file}-top-1440.png` })

        assert(await dialog.locator(".ant-select-content", { hasText: /^Off$/ }).count() === 1, `${plugin}: dethrone is off by default`)
        const protection = dialog.getByRole("checkbox", { name: /Attack while under protection/ })
        assert(await protection.isVisible() && !(await protection.isChecked()), `${plugin}: attacking under protection is off by default`)
        assert(await dialog.getByText("This ends your beginner or peace protection.", { exact: true }).isVisible(), `${plugin}: the protection option warns in words`)
        assert(await dialog.getByText("Log only: write the attacks to the log instead of sending them").isVisible(), `${plugin}: shows Log only`)
        for (const label of ["Most to spend on one dethrone", "Most to spend on dethrones in one event", "Always keep at least this many coins or rubies"])
            assert(await dialog.getByLabel(label).inputValue() === "0", `${plugin}: "${label}" starts at 0, which allows no dethrone`)
        await axe(page, `${plugin} module with every option 1440`)
        await page.screenshot({ path: `${out}/${file}-1440.png` })
        await protection.scrollIntoViewIfNeeded()
        await page.screenshot({ path: `${out}/${file}-safety-1440.png` })

        await page.setViewportSize(PHONE_VIEW)
        await page.waitForTimeout(400)
        assert(await overflowOf(page) <= 0, `${plugin}: no horizontal overflow at 390 on the module page`)
        await axe(page, `${plugin} module 390`)
        await page.screenshot({ path: `${out}/${file}-390.png` })
        await protection.scrollIntoViewIfNeeded()
        await page.screenshot({ path: `${out}/${file}-safety-390.png` })
    }
    await page.setViewportSize({ width: 1280, height: 860 })
}

/** What the army drivers share on Ironhold's Fortress page: the select and segmented pickers, the save bar and opening the module. */
function armyHelpers(page) {
    /** Picks an option of the select with this accessible name: by its text, or the first one. Returns the option's text. */
    const pick = async (scope, name, text) => {
        const box = scope.getByRole("combobox", { name, exact: true })
        await box.scrollIntoViewIfNeeded()
        await box.click()
        // A select that has just closed can swallow the click while its list fades out.
        const handle = await box.elementHandle()
        const opened = () => page.waitForFunction(el => el.getAttribute("aria-expanded") === "true", handle, { timeout: 1500 }).then(() => true, () => false)
        if (!(await opened())) { await box.click(); await opened() }
        const dropdown = page.locator(`.ant-select-dropdown:has([id="${await box.getAttribute("aria-controls")}"])`)
        await dropdown.waitFor()
        // The list only draws the rows around the current choice, so start from its top.
        await dropdown.locator(".rc-virtual-list-holder").evaluate(el => { el.scrollTop = 0 }).catch(() => {})
        const option = text ? dropdown.locator(".ant-select-item-option", { hasText: text }).first() : dropdown.locator(".ant-select-item-option").first()
        const label = (await option.innerText()).trim()
        await option.click()
        await dropdown.waitFor({ state: "hidden" })
        return label
    }
    const segment = (scope, group, text) => scope.locator(`[aria-label="${group}"] .ant-segmented-item`, { hasText: text })
    const saveBar = page.locator(".gge-savebar")
    const save = async () => {
        await saveBar.getByRole("button", { name: "Save" }).click()
        await page.getByText("Ironhold saved").first().waitFor()
        await saveBar.waitFor({ state: "detached" })
    }
    const openFortress = async () => {
        await openModule(page, "Fortress")
        await page.getByRole("tab", { name: "Attack fortresses (Burning Sands)", selected: true }).waitFor()
        await page.waitForTimeout(300)
        return page.getByRole("tabpanel")
    }
    return { pick, segment, saveBar, save, openFortress }
}

/**
 * The army settings, as the seeded demo player on Ironhold: the Autofill or Waves switch and its summary on Fortress, the
 * wave editor (every wave opened, an in-game preset, custom flanks, a support tool, a courtyard row), a save read back
 * through the API and after a reload, then a virtual preset made, sent by the module, refused for deletion while in
 * use, and deleted. Puts Ironhold's plugin settings back at the end.
 */
async function driveArmies(page) {
    const ironhold = (await rpc(page, "accounts/list")).find(a => a.name === "Ironhold")
    const plugin = "attackFortressesBurningSands"
    const stored = async () => (await rpc(page, "accounts/list")).find(a => a.id === ironhold.id).plugins[plugin]?.options ?? {}
    // Starts from no army settings and no presets, even after a run that failed before putting them back.
    const { armyMode: _mode, waves: _waves, ...otherOptions } = ironhold.plugins[plugin]?.options ?? {}
    const before = { ...ironhold.plugins, ...(ironhold.plugins[plugin] && { [plugin]: { ...ironhold.plugins[plugin], options: otherOptions } }) }
    await rpc(page, "accounts/update", { id: ironhold.id, plugins: before })
    for (const preset of await rpc(page, "virtualPresets/list", { accountId: ironhold.id }))
        await rpc(page, "virtualPresets/remove", { id: preset.id })
    const { pick, segment, saveBar, save, openFortress } = armyHelpers(page)

    await page.setViewportSize(WIDE_VIEW)
    let form = await openFortress()
    const summary = () => form.locator("[data-army-summary]").innerText()
    assert(await summary() === "L+CY · 3w · no tools", `Fortress starts on Autofill, summed up as "${await summary()}"`)
    assert(await form.getByLabel("Horse", { exact: true }).isVisible(), "the fortress plugin has a Horse choice")
    assert(await form.locator(".ant-select-content", { hasText: /^Feather$/ }).count() === 1, "the horse starts on the feather the plugin always rode")
    assert(await form.getByRole("region", { name: "Courtyard troops" }).count() === 0, "on Autofill the wave editor isn't drawn")
    assert(await form.getByLabel("Unit order", { exact: true }).isVisible() && await form.getByLabel("Troop supply", { exact: true }).isVisible(), "Unit order and Troop supply show on Autofill")
    await axe(page, "fortress autofill 1440")
    await page.screenshot({ path: `${out}/60-army-autofill-1440.png`, fullPage: true })

    await segment(form, "Army", "Waves").click()
    assert(await summary() === "No waves written yet", "switching to Waves says no waves are written yet")
    assert(!(await form.getByLabel("Unit order", { exact: true }).isVisible()), "the autofill options hide on Waves")
    assert(await saveBar.count() === 1, "the switch is a change to save")
    const headers = form.locator(".ant-collapse-header")
    assert(await headers.count() === 4 && await form.locator(".ant-collapse-header .ant-tag", { hasText: "Empty" }).count() === 4, "the editor lists waves 1 to 4, each Empty")
    for (let n = 1; n <= 4; n++) {
        await headers.nth(n - 1).click()
        await form.getByRole("combobox", { name: `In-game preset for wave ${n}`, exact: true }).waitFor()
    }
    assert(true, "each wave opens on its in-game preset choice")

    const presetBox = form.getByRole("combobox", { name: "In-game preset for wave 4", exact: true })
    await presetBox.scrollIntoViewIfNeeded()
    await presetBox.click()
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").first().waitFor()
    const presetChoices = await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").allInnerTexts()
    assert(presetChoices.length === 1 && presetChoices[0] === "Empty (no troops)", `in-game presets 1 to 30 stay hidden until the bot can read them (${JSON.stringify(presetChoices)})`)
    await page.keyboard.press("Escape")

    await segment(form, "Wave 1 comes from", "Custom slots").click()
    const ranged = await pick(form, "Wave 1, Left flank, troop 1")
    await form.getByRole("spinbutton", { name: "Wave 1, Left flank, troop 1: how many" }).fill("40")
    const ladder = await pick(form, "Wave 1, Left flank, tool 1")
    await pick(form, "Wave 1, Front, troop 6")
    await form.getByRole("spinbutton", { name: "Wave 1, Front, troop 6: how many" }).fill("9999")
    await form.getByRole("spinbutton", { name: "Wave 1, Front, troop 6: how many" }).blur()
    assert(await headers.nth(0).locator(".ant-tag").innerText() === "Custom · 3 filled", "wave 1's tag counts its filled slots")
    await segment(form, "Wave 2 comes from", "Custom slots").click()
    await pick(form, "Wave 2, Right flank, troop 2")
    const support = await pick(form, "Support tool 1")
    await pick(form, "Courtyard row 1")
    await form.getByRole("spinbutton", { name: "Courtyard row 1: how many" }).fill("25")
    await form.getByRole("spinbutton", { name: "Courtyard row 1: how many" }).blur()
    assert(await summary() === "Waves written: 2 of 4 · Support tools: 1 · Courtyard rows: 1", `the summary counts what is written: "${await summary()}"`)
    await axe(page, "fortress waves editor 1440")
    await page.screenshot({ path: `${out}/61-army-waves-editor-1440.png`, fullPage: true })

    await save()
    let options = await stored()
    const troop = (await rpc(page, "catalog/gameItems", { kind: "troop" }))[0]
    assert(options.armyMode === "waves" && options.waves.kind === "manual", "the API stores Waves mode and a written plan")
    assert(JSON.stringify(options.waves.waves[0].left.units[0]) === JSON.stringify({ item: troop.id, amount: 40 }), `wave 1's left flank holds 40 of ${ranged}`)
    assert(options.waves.waves[0].left.tools[0].amount === 10 && options.waves.waves[0].front.units[5].amount === 9999, `the tool slot (${ladder}) keeps its starting 10, and the last front slot its 9999`)
    assert(options.waves.waves[1].kind === "custom" && options.waves.waves[1].right.units[1] !== null && options.waves.waves[2].kind === "preset" && options.waves.waves[3].preset === 0, "wave 2 is custom, waves 3 and 4 are the empty preset")
    assert(options.waves.ast[0] !== null && options.waves.ast[1] === null && options.waves.rw[0].amount === 25 && options.waves.rw[1] === null, `the plan holds ${support} and a courtyard row of 25`)

    await page.reload()
    form = await openFortress()
    assert(await summary() === "Waves written: 2 of 4 · Support tools: 1 · Courtyard rows: 1", "after a reload the page still shows the saved plan's summary")
    assert(await form.locator(".ant-collapse-item-active").count() === 2, "the two written waves open by themselves")
    assert(await form.getByRole("spinbutton", { name: "Wave 1, Left flank, troop 1: how many" }).inputValue() === "40", "wave 1's amount reads back")
    assert(await form.getByRole("spinbutton", { name: "Courtyard row 1: how many" }).inputValue() === "25", "the courtyard row reads back")
    await page.setViewportSize(PHONE_VIEW)
    await page.waitForTimeout(400)
    assert(await overflowOf(page) <= 0, "no horizontal overflow on the wave editor at 390")
    await axe(page, "fortress waves editor 390")
    await page.screenshot({ path: `${out}/61-army-waves-editor-390.png`, fullPage: true })
    await page.setViewportSize(WIDE_VIEW)

    await segment(form, "Army", "Autofill").click()
    assert(await summary() === "L+CY · 3w · no tools", "back on Autofill the summary is the autofill's")
    await segment(form, "Army", "Waves").click()
    assert(await form.getByRole("spinbutton", { name: "Wave 1, Left flank, troop 1: how many" }).inputValue() === "40", "the plan is still there after a look at Autofill")
    assert(await saveBar.count() === 0, "and nothing is left to save")

    // Virtual presets: make one, send it from the module, and delete it.
    await sidebar(page, "Virtual presets")
    await page.getByRole("button", { name: "New preset" }).waitFor()
    assert(await page.getByText("No virtual presets yet.", { exact: false }).isVisible(), "the Virtual presets page starts empty for Ironhold")
    await axe(page, "virtual presets empty 1440")
    await page.getByRole("button", { name: "New preset" }).click()
    await page.getByRole("button", { name: "Save" }).click()
    assert(await page.getByRole("alert").filter({ hasText: "Give the preset a name." }).count() === 1, "a preset without a name is refused under its field")
    const name = `Ranged first ${Date.now().toString(36)}`
    await page.getByLabel("Name", { exact: true }).fill(name)
    await page.locator(".ant-collapse-header").nth(0).click()
    await segment(page, "Wave 1 comes from", "Custom slots").click()
    await pick(page, "Wave 1, Left flank, troop 1")
    await pick(page, "Courtyard row 2")
    await axe(page, "virtual preset editor 1440")
    await page.screenshot({ path: `${out}/62-virtual-preset-editor-1440.png`, fullPage: true })
    await page.getByRole("button", { name: "Save" }).click()
    await page.getByText(`${name} saved`).first().waitFor()
    const row = page.locator(".gge-preset-list li", { hasText: name })
    assert(await row.getByText("Waves written: 1 of 4 · Support tools: 0 · Courtyard rows: 1").count() === 1, "the list shows the new preset and what it holds")
    const [preset] = await rpc(page, "virtualPresets/list", { accountId: ironhold.id })
    assert(preset.name === name && preset.plan.waves[0].kind === "custom" && preset.plan.rw[1] !== null, "the API lists the preset with its plan")
    await atBothWidths(page, "63-virtual-presets-list", "virtual presets list")

    form = await openFortress()
    await segment(form, "Waves come from", "Virtual preset").click()
    assert(await summary() === `Virtual preset: ${name}`, "picking Virtual preset sums up as the preset's name")
    assert(await form.getByRole("region", { name: "Courtyard troops" }).count() === 0, "the written plan's editor gives way to the preset choice")
    await page.screenshot({ path: `${out}/64-army-virtual-1440.png`, fullPage: true })
    await save()
    options = await stored()
    assert(options.waves.kind === "virtual" && options.waves.presetId === preset.id, "the API stores the module's plan as that virtual preset")

    await sidebar(page, "Virtual presets")
    await page.locator(".gge-preset-list li", { hasText: name }).getByText("Sent by: Attack fortresses (Burning Sands)").waitFor()
    assert(true, "the list says which module sends the preset")
    await page.getByRole("button", { name: `Delete ${name}` }).click()
    const inUse = page.getByRole("dialog", { name: "This preset is in use" })
    assert(await inUse.getByText(`${name} is still sent by Attack fortresses (Burning Sands).`, { exact: false }).count() === 1, "deleting a preset a module still sends is stopped, naming the module")
    await page.screenshot({ path: `${out}/65-virtual-preset-in-use-1440.png` })
    await inUse.getByRole("button", { name: "OK" }).click()
    const refused = await rpc(page, "virtualPresets/remove", { id: preset.id })
    assert((await rpc(page, "virtualPresets/list", { accountId: ironhold.id })).length === 1, `the API refuses it too (${refused?.data?.code ?? refused?.code})`)

    form = await openFortress()
    await segment(form, "Waves come from", "Written here").click()
    assert(await summary() === "Waves written: 0 of 4 · Support tools: 0 · Courtyard rows: 0", "switching back to Written here starts a new plan, since the preset took the saved one's place")
    await segment(form, "Army", "Autofill").click()
    await save()
    assert((await stored()).waves.kind === "manual", "the module no longer names the preset")
    await sidebar(page, "Virtual presets")
    await page.getByRole("button", { name: `Delete ${name}` }).click()
    await page.getByRole("dialog", { name: `Delete ${name}?` }).getByRole("button", { name: "Delete" }).click()
    await page.getByText(`${name} deleted`).first().waitFor()
    assert((await rpc(page, "virtualPresets/list", { accountId: ironhold.id })).length === 0, "once no module sends it the preset deletes")

    // Right to left, and the settings as they were.
    await rpc(page, "account/setLocale", { locale: "ar" })
    await page.goto(`${CLIENT_URL}/m/fortress?account=${ironhold.id}`)
    await page.locator("[data-army-summary]").first().waitFor()
    assert(await page.evaluate(() => document.documentElement.dir) === "rtl", "in Arabic the page is right to left")
    assert(await overflowOf(page) <= 0, "no horizontal overflow on the army settings in Arabic at 1440")
    await axe(page, "fortress army settings ar 1440")
    await page.screenshot({ path: `${out}/66-army-ar-1440.png`, fullPage: true })
    await page.setViewportSize(PHONE_VIEW)
    await page.waitForTimeout(400)
    assert(await overflowOf(page) <= 0, "no horizontal overflow on the army settings in Arabic at 390")
    await axe(page, "fortress army settings ar 390")
    await page.screenshot({ path: `${out}/66-army-ar-390.png`, fullPage: true })
    await page.setViewportSize(WIDE_VIEW)
    await rpc(page, "account/setLocale", { locale: null })
    await rpc(page, "accounts/update", { id: ironhold.id, plugins: before })
    assert((await stored()).armyMode === undefined, "Ironhold's plugin settings are back as they were")
}

/**
 * The wave editor's growth, as the seeded demo player on Ironhold's Fortress: four waves to begin with, "Apply to the rest
 * of the waves" on wave 1, two waves added and one written apart, a save read back through the API and after a reload,
 * a wave removed, the plan grown to the 25-wave limit, and a one-wave plan that can't shrink or copy. Runs axe at 1440,
 * 390 and in Arabic. Puts Ironhold's plugin settings back at the end.
 */
async function driveUxWaves(page) {
    const ironhold = (await rpc(page, "accounts/list")).find(a => a.name === "Ironhold")
    const plugin = "attackFortressesBurningSands"
    const stored = async () => (await rpc(page, "accounts/list")).find(a => a.id === ironhold.id).plugins[plugin]?.options ?? {}
    const { armyMode: _mode, waves: _waves, ...otherOptions } = ironhold.plugins[plugin]?.options ?? {}
    const before = { ...ironhold.plugins, ...(ironhold.plugins[plugin] && { [plugin]: { ...ironhold.plugins[plugin], options: otherOptions } }) }
    await rpc(page, "accounts/update", { id: ironhold.id, plugins: before })
    const { pick, segment, saveBar, save, openFortress } = armyHelpers(page)

    await page.setViewportSize(WIDE_VIEW)
    let form = await openFortress()
    const summary = () => form.locator("[data-army-summary]").innerText()
    const count = () => form.locator("[data-wave-count]").innerText()
    const headers = form.locator(".ant-collapse-header")
    await segment(form, "Army", "Waves").click()
    assert(await count() === "4 of 25 waves" && await headers.count() === 4, "a new plan starts with 4 of 25 waves")
    assert(await form.getByRole("button", { name: "Add wave" }).isEnabled(), "Add wave is on below the limit")

    await headers.nth(0).click()
    await segment(form, "Wave 1 comes from", "Custom slots").click()
    await pick(form, "Wave 1, Left flank, troop 1")
    await form.getByRole("spinbutton", { name: "Wave 1, Left flank, troop 1: how many" }).fill("40")
    await pick(form, "Wave 1, Front, troop 6")
    await form.getByRole("spinbutton", { name: "Wave 1, Front, troop 6: how many" }).fill("500")
    await form.getByRole("spinbutton", { name: "Wave 1, Front, troop 6: how many" }).blur()
    await form.getByRole("button", { name: "Apply to the rest of the waves" }).click()
    const tags = await headers.locator(".ant-tag").allInnerTexts()
    assert(tags.length === 4 && tags.every(tag => tag === "Custom · 2 filled"), `wave 1 copied into waves 2 to 4 (${tags.join(" | ")})`)

    await form.getByRole("button", { name: "Add wave" }).click()
    await form.getByRole("button", { name: "Add wave" }).click()
    assert(await count() === "6 of 25 waves" && await headers.count() === 6, "two added waves make 6 of 25")
    assert(await headers.nth(5).locator(".ant-tag").innerText() === "Empty", "an added wave is empty")
    assert(await form.getByText("The game sends at most 4 waves", { exact: false }).isVisible(), "past 4 waves the editor says the game sends at most 4 plus the commander's")
    await headers.nth(5).click()
    await segment(form, "Wave 6 comes from", "Custom slots").click()
    await pick(form, "Wave 6, Right flank, troop 1")
    await form.getByRole("spinbutton", { name: "Wave 6, Right flank, troop 1: how many" }).fill("12")
    await form.getByRole("spinbutton", { name: "Wave 6, Right flank, troop 1: how many" }).blur()
    assert(await summary() === "Waves written: 5 of 6 · Support tools: 0 · Courtyard rows: 0", `the summary counts 5 of 6 (${await summary()})`)
    assert(await form.getByRole("button", { name: "Apply to the rest of the waves" }).count() === 1, "of the open waves 1 and 6 only the last has no Apply to the rest button")
    await axe(page, "six waves 1440")
    await page.screenshot({ path: `${out}/90-ux-waves-six-1440.png`, fullPage: true })

    await save()
    let waves = (await stored()).waves.waves
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    assert(waves.length === 6 && [1, 2, 3].every(i => same(waves[i], waves[0])) && waves[0].kind === "custom", "the API stores six waves, 2 to 4 equal to wave 1")
    assert(waves[4].kind === "preset" && waves[4].preset === 0 && waves[5].right.units[0].amount === 12, "wave 5 is empty and wave 6 holds 12 on the right flank")
    await page.reload()
    form = await openFortress()
    assert(await count() === "6 of 25 waves" && await summary() === "Waves written: 5 of 6 · Support tools: 0 · Courtyard rows: 0", "after a reload the six waves are still there")

    await form.locator(".ant-collapse-item-active").first().waitFor()
    await headers.nth(4).click()
    await form.getByRole("button", { name: "Remove wave 5" }).click()
    assert(await count() === "5 of 25 waves", "removing wave 5 leaves 5 of 25")
    await save()
    waves = (await stored()).waves.waves
    assert(waves.length === 5 && waves[4].right.units[0].amount === 12, "the API stores five waves, the one written apart now last")

    const add = form.getByRole("button", { name: "Add wave" })
    for (let i = 0; i < 20; i++) await add.click()
    assert(await count() === "25 of 25 waves" && await add.isDisabled(), "the plan stops at 25 waves and Add wave turns off")
    await axe(page, "twenty-five waves 1440")
    await page.screenshot({ path: `${out}/91-ux-waves-25-1440.png`, fullPage: true })
    await page.setViewportSize(PHONE_VIEW)
    await page.waitForTimeout(400)
    assert(await overflowOf(page) <= 0, "no horizontal overflow on the 25-wave editor at 390")
    await axe(page, "twenty-five waves 390")
    await page.screenshot({ path: `${out}/91-ux-waves-25-390.png`, fullPage: true })
    await page.setViewportSize(WIDE_VIEW)
    await save()
    assert((await stored()).waves.waves.length === 25, "the API stores 25 waves")

    const one = { ...(await stored()).waves, waves: [(await stored()).waves.waves[0]] }
    await rpc(page, "accounts/update", { id: ironhold.id, plugins: { ...before, [plugin]: { ...before[plugin], options: { ...otherOptions, armyMode: "waves", waves: one } } } })
    await page.reload()
    form = await openFortress()
    assert(await count() === "1 of 25 waves", "a stored one-wave plan opens as 1 of 25")
    await headers.nth(0).click()
    assert(await form.getByRole("button", { name: "Remove wave 1" }).isDisabled() && await form.getByRole("button", { name: "Apply to the rest of the waves" }).count() === 0, "a single wave can't be removed or copied")

    await rpc(page, "account/setLocale", { locale: "ar" })
    await page.goto(`${CLIENT_URL}/m/fortress?account=${ironhold.id}`)
    await page.locator("[data-wave-count]").first().waitFor()
    assert(await page.evaluate(() => document.documentElement.dir) === "rtl", "in Arabic the wave editor is right to left")
    assert(await overflowOf(page) <= 0, "no horizontal overflow on the wave editor in Arabic at 1440")
    await axe(page, "waves editor ar 1440")
    await page.screenshot({ path: `${out}/92-ux-waves-ar-1440.png`, fullPage: true })
    await page.setViewportSize(PHONE_VIEW)
    await page.waitForTimeout(400)
    assert(await overflowOf(page) <= 0, "no horizontal overflow on the wave editor in Arabic at 390")
    await axe(page, "waves editor ar 390")
    await page.screenshot({ path: `${out}/92-ux-waves-ar-390.png`, fullPage: true })
    await page.setViewportSize(WIDE_VIEW)
    await rpc(page, "account/setLocale", { locale: null })
    await rpc(page, "accounts/update", { id: ironhold.id, plugins: before })
    assert((await stored()).armyMode === undefined, "Ironhold's plugin settings are back as they were")
}

/** The account drawer's Overview tab, as the seeded demo player: figures for Ironhold, a live change, and the empty state for an account that never ran. */
async function driveOverview(page) {
    const castles = [{ kingdom: 0, id: 1001, name: "Ironhold", x: 412, y: 288, type: 1 }, { kingdom: 0, id: 1002, name: "Ironhold Watch", x: 430, y: 301, type: 4 }, { kingdom: 2, id: 2001, name: "Frostgate", x: 120, y: 77, type: 12 }]
    const seededFigures = { castles, cash: 48_250_310, gold: 1_284, food: 3_912_450, mead: 126_800, aquamarin_name: 5_240, attackDailyCount: 37 }
    await insertResources({ accountName: "Ironhold", resources: seededFigures })
    await page.setViewportSize(WIDE_VIEW)
    await page.goto(CLIENT_URL)
    await page.getByRole("button", { name: "Edit Ironhold" }).click()
    const drawer = page.getByRole("dialog")
    const tiles = drawer.locator(".gge-kpi")
    await tiles.first().waitFor()
    assert(await drawer.getByRole("tab", { selected: true }).innerText() === "Overview", "an existing account's drawer opens on Overview")
    assert(await tiles.count() === 6, "the Overview has six tiles: cash, gold, food, mead, aquamarine and attacks today")
    const tile = label => tiles.filter({ hasText: label }).locator(".gge-kpi-value")
    assert(await tile("Coins").innerText() === (48_250_310).toLocaleString("en"), "the coins tile shows the figure with locale grouping")
    assert((await tile("Coins").evaluate(el => getComputedStyle(el).fontVariantNumeric)).includes("tabular-nums"), "tile figures use tabular numbers")
    assert(/^Updated .+\. Food, mead/.test(await drawer.locator(".gge-overview-note").first().innerText()), "the Overview says when its figures were last updated")
    await axe(page, "account overview")
    await atBothWidths(page, "overview", "the account Overview")
    await drawer.getByRole("tab", { name: "Logs" }).click()
    await drawer.getByRole("log", { name: "Bot log" }).waitFor()
    await drawer.getByRole("tab", { name: "Overview" }).click()
    await tiles.first().waitFor()
    assert(await drawer.locator(".gge-top-errors").count() === 1, "the Logs tab opens beside the Overview without breaking either, though both read the same account's lines")

    await page.setViewportSize(WIDE_VIEW)
    await insertResources({ accountName: "Ironhold", resources: { castles, cash: 49_000_001, gold: 1_300, food: 4_000_000, aquamarin_name: 5_300, attackDailyCount: 38 } })
    await drawer.locator(".gge-kpi-value", { hasText: (49_000_001).toLocaleString("en") }).waitFor({ timeout: 30_000 })
    assert(await tile("Mead").evaluate(el => el.hasAttribute("data-missing")) && /Not reported/.test(await tile("Mead").innerText()), "a new report reaches the open Overview, and a figure the game left out shows a dash with a spoken reason")
    await page.keyboard.press("Escape")
    await drawerClosed(page)

    await page.getByRole("button", { name: "Edit Brightwater" }).click()
    await drawer.getByText("No figures yet").waitFor()
    assert(await drawer.getByText(/doesn't cover this account/).isVisible() && await drawer.getByRole("button", { name: "Start the bot" }).count() === 0, "an account the plan doesn't cover says so and offers no Start button")
    await page.keyboard.press("Escape")
    await drawerClosed(page)

    const ironhold = (await rpc(page, "accounts/list")).find(a => a.name === "Ironhold")
    await rpc(page, "accounts/setDesiredState", { ids: [ironhold.id], state: "stopped" })
    await insertResources({ accountName: "Ironhold", resources: null })
    await page.reload()
    await page.getByRole("button", { name: "Edit Ironhold" }).click()
    await drawer.getByText("No figures yet").waitFor()
    await drawer.getByRole("button", { name: "Start the bot" }).waitFor()
    assert(true, "a stopped account that never reported shows an empty state that says what to do, with a Start button")
    await axe(page, "account overview empty")
    await page.screenshot({ path: `${out}/overview-empty-1440.png` })
    await drawer.getByRole("button", { name: "Start the bot" }).click()
    await drawer.getByText("The bot is starting").waitFor()
    assert(true, "Start asks the runner, and the empty state says the bot is starting")
    await insertResources({ accountName: "Ironhold", resources: seededFigures })
    await page.keyboard.press("Escape")
    await drawerClosed(page)
}

/** Errors split in two: the Overview's top errors say how serious each is in words, and the Logs page filters the lines the game said "not now" to. */
async function driveErrorSplit(page) {
    const refusal = (level, code) => insertLogLine({ accountName: "Ironhold", level, plugin: "ggeBot", parts: ["cra", code] })
    for (let i = 0; i < 3; i++) await refusal(3, "COOLING_DOWN")
    await refusal(3, "NOT_ENOUGH_CURRENCY1")
    await refusal(2, "INVALID_PARAMETER_VALUE")
    await page.setViewportSize(WIDE_VIEW)
    await page.goto(CLIENT_URL)
    await page.getByRole("button", { name: "Edit Ironhold" }).click()
    const drawer = page.getByRole("dialog")
    const list = drawer.locator(".gge-top-error")
    await list.first().waitFor()
    const first = await list.first().innerText()
    assert(/Game said not now/.test(first) && first.includes("COOLING_DOWN") && /\d+ times?/.test(first), `the Overview lists the most frequent refusal first, with its class in words and a count (${first.replace(/\n/g, " | ")})`)
    const severe = list.filter({ hasText: "INVALID_PARAMETER_VALUE" })
    assert(/Severe/.test(await severe.innerText()) && await severe.getAttribute("data-class") === "severe", "a severe code says Severe, not only a colour")
    assert(await drawer.locator(".gge-top-error-class svg").count() === await list.count(), "every top error has an icon beside its class word")
    assert(/Counted from the latest \d+ warning and error lines/.test(await drawer.locator(".gge-top-errors").innerText()), "the Overview says how many lines the top errors were counted from")
    await axe(page, "overview with top errors")
    await atBothWidths(page, "overview-top-errors", "the Overview with top errors")
    await page.setViewportSize(WIDE_VIEW)
    await drawer.getByRole("link", { name: "See the logs" }).click()
    await page.waitForURL(/\/logs\?account=/)
    const facets = await rpc(page, "logs/facets")
    const notNow = facets.levels.find(l => l.level === 3).count
    const level = page.locator(".gge-logs-filters .ant-segmented-item", { hasText: "Game said not now" })
    await level.filter({ hasText: String(notNow) }).waitFor()
    assert(true, `the level filter offers Game said not now with its count (${notNow})`)
    await level.click()
    await page.waitForFunction(() => new URL(location.href).searchParams.get("level") === "3")
    const log = page.getByRole("log", { name: "Bot log" })
    await page.locator(".gge-logs-count").filter({ hasText: new RegExp(`^${notNow.toLocaleString("en")} of `) }).waitFor()
    const rows = await termRows(log)
    assert(rows.length > 0 && rows.every(r => r.level === "3"), "the filter leaves only the lines the game said not now to, and level=3 is in the URL")
    assert(await log.locator(".gge-term-level").first().innerText() === "Game said not now", "each such line says Game said not now beside its icon")
    await axe(page, "logs filtered to not now")
    await page.screenshot({ path: `${out}/logs-not-now-1440.png` })
    await page.reload()
    await level.waitFor()
    assert(await page.locator(".gge-logs-filters .ant-segmented-item-selected").innerText().then(t => t.includes("Game said not now")), "the not-now filter survives a reload")
}

/** The dashboard's figures above the roster: real counts from the kept lines with their bound stated, a Top accounts table, and an empty state that says what to do. */
async function driveDashboardHome(page, browser) {
    const hit = (accountName, n) => Promise.all(Array.from({ length: n }, () => insertLogLine({ accountName, level: 0, plugin: "attackNomads", parts: ["hittingTargetAttack", "C", 1, " ", 412, ":", 288, " ", "00:42"] })))
    await hit("Ironhold", 3)
    await hit("Ravenmoor", 1)
    await insertLogLine({ accountName: "Ironhold", level: 2, plugin: "ggeBot", parts: ["closedReason", "timedOut"] })
    await page.setViewportSize(WIDE_VIEW)
    await page.goto(CLIENT_URL)
    const card = title => page.locator(".gge-kpi-card").filter({ hasText: title })
    const value = title => card(title).first().locator(".ant-statistic-content").innerText()
    await card("Attacks").locator(".ant-statistic-content").waitFor()
    const activity = await rpc(page, "logs/activity")
    const attacks = activity.accounts.reduce((sum, a) => sum + a.attacks, 0)
    const errors = activity.accounts.reduce((sum, a) => sum + a.errors, 0)
    const shown = text => Number(text.replace(/[^\d]/g, ""))
    assert(shown(await value("Attacks")) === attacks && attacks >= 4, `the Attacks tile shows the API's count (${attacks}), including the lines just written`)
    assert(shown(await value("Errors")) === errors && errors >= 1, `the Errors tile shows the API's count (${errors})`)
    assert(await card("Attacks").innerText().then(t => /in the last 24 hours/.test(t)) && await card("Errors").innerText().then(t => /in the last 7 days/.test(t)), "each tile names its window")
    assert(/counted from the log lines kept for each account: the newest 500, and none older than 7 days/.test(await page.locator(".gge-kpi-footnote").innerText()), "the page states the bound the counts come from")
    assert(/^\d+\s*\/\s*1$/.test((await value("Accounts")).replace(/\s+/g, " ").trim()), "the Accounts tile keeps the limit that applies")
    const topRows = page.locator(".gge-top-accounts tbody tr")
    await topRows.first().waitFor()
    const ranked = activity.accounts.filter(a => a.attacks > 0).sort((a, b) => b.attacks - a.attacks)
    assert(await topRows.count() === Math.min(5, ranked.length) && (await topRows.first().innerText()).startsWith("Ironhold") && ranked[0].attacks === Math.max(...ranked.map(a => a.attacks)), `Top accounts lists the ${await topRows.count()} accounts that attacked most, Ironhold first`)
    const attacksColumn = await topRows.evaluateAll(rows => rows.map(r => Number(r.querySelector("td")?.textContent.replace(/[^\d]/g, ""))))
    assert(attacksColumn.every((n, i) => i === 0 || attacksColumn[i - 1] >= n), `the attacks column runs from most to fewest (${attacksColumn.join(", ")})`)
    assert(await page.getByRole("heading", { name: "Roster" }).isVisible() || await page.getByText("Roster", { exact: true }).first().isVisible(), "the roster is still on the page, under the figures")
    await axe(page, "dashboard home")
    await atBothWidths(page, "dashboard-home", "the dashboard home")
    await page.setViewportSize({ width: 320, height: 640 })
    await page.waitForTimeout(300)
    assert(await overflowOf(page) <= 0, "no horizontal overflow on the dashboard home at 320")
    await page.screenshot({ path: `${out}/dashboard-home-320.png`, fullPage: true })
    await page.setViewportSize(WIDE_VIEW)
    await page.getByRole("button", { name: "Open Ironhold" }).click()
    await page.getByRole("dialog").getByRole("tab", { selected: true }).waitFor()
    assert(await page.getByRole("dialog").getByText("Ironhold", { exact: true }).first().isVisible(), "a Top accounts row opens that account's drawer")
    await page.keyboard.press("Escape")
    await drawerClosed(page)

    const fresh = await verifiedPlayer("t")
    await setMaxBots(fresh.name, 2)
    const servers = (await clientCall("servers/list", {}, fresh.cookie)).json
    for (const accountName of [`TopA${fresh.name}`, `TopB${fresh.name}`])
        await clientCall("accounts/create", { name: accountName, serverId: servers[0].id, password: "pw", externalEvent: false, plugins: {} }, fresh.cookie)
    const empty = await (await browser.newContext({ viewport: WIDE_VIEW })).newPage()
    await empty.context().addCookies([asCookie(fresh.cookie, CLIENT_URL)])
    await empty.goto(CLIENT_URL)
    await empty.getByText("No attacks logged yet").waitFor()
    assert(await empty.getByText(/Turn on an attack plugin/).isVisible() && !/\+/.test(await empty.locator(".gge-kpi-card").filter({ hasText: "Attacks" }).innerText()), "with nothing logged the Top accounts card says what to do, and the Attacks tile is an exact zero")
    await axe(empty, "dashboard home, nothing logged")
    await empty.screenshot({ path: `${out}/dashboard-home-empty-1440.png`, fullPage: true })
    await clientCall("account/deleteMe", { password: "a-strong-password", confirmUsername: fresh.name }, fresh.cookie)
    await empty.context().close()
}

/** The command palette: its shortcut for this platform only, labels a screen reader reads, arrows and Enter, a focus trap, focus coming back, and each kind of entry. */
async function drivePalette(page, browser) {
    await page.setViewportSize(WIDE_VIEW)
    await page.goto(CLIENT_URL)
    const apple = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent))
    const [right, wrong] = apple ? ["Meta+k", "Control+k"] : ["Control+k", "Meta+k"]
    const dialog = page.getByRole("dialog", { name: "Command palette" })
    const search = dialog.getByRole("combobox", { name: "Search pages, accounts, plugins and languages" })
    const options = dialog.getByRole("option")
    const opener = page.getByRole("button", { name: "Edit Ironhold" })
    const openFrom = async () => {
        await opener.focus()
        await page.keyboard.press(right)
        await search.waitFor()
    }
    const closed = () => dialog.waitFor({ state: "hidden" })

    await opener.focus()
    await page.keyboard.press(wrong)
    await page.waitForTimeout(400)
    assert(await dialog.count() === 0, `${wrong.replace("+k", "+K")} does not open the palette on ${apple ? "macOS" : "this platform"}, only ${right.replace("+k", "+K")} does`)
    await page.keyboard.press(right)
    await search.waitFor()
    assert(await search.evaluate(el => el === document.activeElement), `${right.replace("+k", "+K")} opens it with the search box focused`)
    const trigger = page.getByRole("button", { name: "Open the command palette" })
    assert(await trigger.getAttribute("aria-keyshortcuts") === (apple ? "Meta+K" : "Control+K") && await trigger.getAttribute("aria-haspopup") === "dialog", "the header button says which shortcut opens it, for screen readers too")
    const groups = await dialog.locator(".gge-cmdk-group").allInnerTexts()
    assert(groups.join(",").toLowerCase() === "pages,accounts,session", `with nothing typed it lists Pages, Accounts and Session (${groups.join(", ")})`)
    assert(await dialog.getByRole("listbox", { name: "Results" }).isVisible() && await search.getAttribute("aria-activedescendant") !== null && await options.first().getAttribute("aria-selected") === "true", "the first option is the active one, named by aria-activedescendant")
    assert(/^\d+ results?$/.test(await dialog.getByRole("status").innerText()), "a screen reader hears how many results there are")
    await axe(page, "command palette open")
    await page.screenshot({ path: `${out}/palette-1440.png` })

    for (let i = 0; i < 6; i++) await page.keyboard.press("Tab")
    assert(await dialog.evaluate(el => el.contains(document.activeElement)), "Tab six times and focus is still inside the palette")
    for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+Tab")
    assert(await dialog.evaluate(el => el.contains(document.activeElement)), "Shift+Tab six times and focus is still inside the palette")
    await search.focus()
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    assert(await options.nth(2).getAttribute("aria-selected") === "true" && await options.first().getAttribute("aria-selected") === "false", "the arrow keys move the active option")
    await page.keyboard.press("End")
    assert(await options.last().getAttribute("aria-selected") === "true", "End moves to the last option")
    await page.keyboard.press("ArrowDown")
    assert(await options.first().getAttribute("aria-selected") === "true", "ArrowDown from the last option wraps to the first")
    await page.keyboard.press("Escape")
    await closed()
    assert(await opener.evaluate(el => el === document.activeElement), "Escape closes the palette and focus goes back to the button it came from")

    await openFrom()
    await search.fill("dzienn")
    assert(await options.count() === 0 && /Nothing matches/.test(await dialog.innerText()), "a search with no match says so and suggests what to try")
    await search.fill("logs")
    await options.first().waitFor()
    assert((await options.first().innerText()).includes("Logs"), "typing 'logs' puts the Logs page first")
    await page.keyboard.press("Enter")
    await page.waitForURL(/\/logs$/)
    await closed()
    assert(true, "Enter on a page entry goes to that page and closes the palette")

    await page.keyboard.press(right)
    await search.fill("ironhold")
    await dialog.getByRole("option", { name: /Ironhold/ }).first().click()
    const drawer = page.getByRole("dialog", { name: /Ironhold/ })
    await drawer.getByRole("tab", { selected: true }).waitFor()
    assert(page.url().endsWith("/") && await drawer.getByRole("tab", { selected: true }).innerText() === "Overview", "an account entry goes to the dashboard and opens that account's drawer")
    await page.keyboard.press("Escape")
    await drawerClosed(page)

    await page.keyboard.press(right)
    await search.fill("attack nomads ironhold")
    const plugin = dialog.getByRole("option", { name: /Attack Nomads/ }).first()
    await plugin.waitFor()
    assert((await plugin.innerText()).includes("Ironhold"), "a plugin entry names the account it belongs to")
    await page.keyboard.press("Enter")
    await page.waitForURL(/\/m\/nom-sam-daimyo\?account=/)
    await page.getByRole("switch", { name: "Enable Attack Nomads" }).waitFor()
    assert(true, "a plugin entry opens its module's page for that account")
    await page.goto(CLIENT_URL)
    await opener.focus()

    await page.keyboard.press(right)
    await search.fill("polski")
    await page.keyboard.press("Enter")
    await page.waitForFunction(() => document.documentElement.lang === "pl")
    assert(true, "a language entry switches the interface language (html lang is pl)")
    await page.keyboard.press(right)
    // The interface is Polish now, so the search box has its Polish name; "automat" finds the Automatic entry in both languages.
    await page.getByRole("dialog").getByRole("combobox").fill("automat")
    await page.getByRole("dialog").getByRole("option").first().waitFor()
    await page.keyboard.press("Enter")
    await page.waitForFunction(() => document.documentElement.lang === "en")
    assert(true, "the Automatic entry puts the language back")

    await page.setViewportSize(PHONE_VIEW)
    await page.waitForTimeout(300)
    assert(await trigger.count() === 0, "on a phone the header has no palette button, which would not fit at 320")
    await page.getByRole("button", { name: /Account menu for/ }).click()
    await page.getByRole("menuitem", { name: "Open the command palette" }).click()
    await search.waitFor()
    assert(true, "on a phone the account menu opens the palette")
    await search.fill("ironhold")
    await options.first().waitFor()
    assert(await overflowOf(page) <= 0, "no horizontal overflow with the palette open at 390")
    await page.waitForTimeout(500)
    const optionHeight = (await options.first().boundingBox()).height
    assert(optionHeight >= 44, `an option is at least 44px tall (${optionHeight})`)
    await axe(page, "command palette 390")
    await page.screenshot({ path: `${out}/palette-390.png` })
    await page.setViewportSize({ width: 320, height: 640 })
    await page.waitForTimeout(300)
    assert(await overflowOf(page) <= 0, "no horizontal overflow with the palette open at 320")
    await page.keyboard.press("Escape")
    await closed()
    await page.setViewportSize(WIDE_VIEW)

    const who = await verifiedPlayer("p")
    const signedIn = await (await browser.newContext({ viewport: WIDE_VIEW })).newPage()
    await signedIn.context().addCookies([asCookie(who.cookie, CLIENT_URL)])
    await signedIn.goto(CLIENT_URL)
    await signedIn.getByText("No accounts yet").waitFor()
    await signedIn.keyboard.press(right)
    await signedIn.getByRole("combobox", { name: "Search pages, accounts, plugins and languages" }).fill("sign out")
    await signedIn.keyboard.press("Enter")
    await signedIn.waitForURL(/\/login/)
    assert(true, "the Sign out entry ends the session and goes to sign-in")
    await clientCall("auth/login", { login: who.name, password: "a-strong-password" }).then(async ({ cookies }) => {
        await clientCall("account/deleteMe", { password: "a-strong-password", confirmUsername: who.name }, cookies.find(c => c.startsWith("gge_session=")))
    })
    await signedIn.context().close()
}

/**
 * Towers auto-buy: the Armourer group on a kingdom (switch, minimum tools, coin limits), the old daily tool budget gone from the page
 * and from what is saved, the values saved and read back through the API and after a reload, and axe at 1440, 390 and in Arabic.
 * A config stored with toolBudgetPerDay opens without it. The runner is off, so nothing buys anything.
 */
async function driveUxAutobuy(page) {
    const account = async () => (await rpc(page, "accounts/list")).find(a => a.name === "Ironhold")
    const ironhold = await account()
    const before = ironhold.plugins
    const plugin = "attackBarronsGreatEmpire"
    await rpc(page, "account/setLocale", { locale: null })
    await storePluginSettings({ accountName: "Ironhold", plugin, enabled: true, options: { tools: 2, toolBudgetPerDay: 900 } })
    const green = page.locator("section.gge-kingdom").first()
    const field = label => green.locator(".ant-form-item", { has: page.getByText(label, { exact: true }) })
    const open = async () => {
        await page.goto(`${CLIENT_URL}/m/towers?account=${ironhold.id}`)
        await green.waitFor()
        await page.waitForTimeout(300)
    }

    await page.setViewportSize(WIDE_VIEW)
    await open()
    assert(await page.getByText("Tool budget a day").count() === 0, "a config stored with a daily tool budget opens without that option")
    assert(await green.getByText("Armourer", { exact: true }).isVisible(), "the kingdom has an Armourer group")
    const autoBuy = green.getByRole("checkbox", { name: "Auto-buy from the armourer" })
    assert(await autoBuy.isVisible() && !(await autoBuy.isChecked()), "Auto-buy from the armourer is there and off")
    assert(await green.getByText("Minimum tools", { exact: true }).isVisible() === false && await green.getByText("Coins to keep", { exact: true }).isVisible() === false, "the minimum and the coin limits stay hidden while Auto-buy is off")
    assert(await page.locator(".gge-savebar").count() === 0, "reading the old config changes nothing by itself")
    await autoBuy.check()
    await field("Minimum tools").waitFor()
    assert(await field("Minimum tools").getByRole("spinbutton").inputValue() === "1000", "ticking Auto-buy shows Minimum tools at 1000")
    assert(await green.getByText("Coins to keep", { exact: true }).isVisible() && await green.getByText("Most coins spent on them in one check", { exact: true }).isVisible(), "and the coin floor and the spend cap")
    assert(await green.getByText("buys the difference from the armourer with coins", { exact: false }).isVisible(), "the switch has its help text")
    await field("Minimum tools").getByRole("spinbutton").fill("2500")
    await field("Coins to keep").getByRole("spinbutton").fill("50000")
    await field("Minimum tools").getByRole("spinbutton").blur()
    await axe(page, "towers auto-buy 1440")
    await page.screenshot({ path: `${out}/81-ux-autobuy-1440.png`, fullPage: true })
    await page.locator(".gge-savebar").getByRole("button", { name: "Save" }).click()
    await page.getByText("Ironhold saved").first().waitFor()
    const saved = (await account()).plugins[plugin]
    assert(saved.enabled && saved.options.autoBuy === true && saved.options.autoBuyMin === 2500 && saved.options.armourerCoinFloor === 50000 && saved.options.tools === 2 && !("toolBudgetPerDay" in saved.options),
        `the API holds Auto-buy on, 2500 minimum and a 50000 floor, and no tool budget: ${JSON.stringify(saved.options)}`)
    await open()
    assert(await autoBuy.isChecked() && await field("Minimum tools").getByRole("spinbutton").inputValue() === "2500" && await field("Coins to keep").getByRole("spinbutton").inputValue() === "50000", "after a reload the switch, the minimum and the floor are as saved")

    await page.setViewportSize(PHONE_VIEW)
    await page.waitForTimeout(400)
    assert(await overflowOf(page) <= 0, "no horizontal overflow on Towers with Auto-buy at 390")
    await axe(page, "towers auto-buy 390")
    await page.screenshot({ path: `${out}/81-ux-autobuy-390.png`, fullPage: true })
    await page.setViewportSize(WIDE_VIEW)

    await rpc(page, "account/setLocale", { locale: "ar" })
    await open()
    assert(await page.evaluate(() => document.documentElement.dir) === "rtl", "in Arabic the page is right to left")
    assert(await green.getByText("الشراء التلقائي من صانع الأسلحة", { exact: true }).isVisible() && await green.getByText("الحد الأدنى للأدوات", { exact: true }).isVisible(), "in Arabic the Auto-buy switch and Minimum tools are translated")
    assert(await overflowOf(page) <= 0, "no horizontal overflow on Towers with Auto-buy in Arabic")
    await axe(page, "towers auto-buy Arabic 1440")
    await page.screenshot({ path: `${out}/81-ux-autobuy-ar-1440.png`, fullPage: true })
    await rpc(page, "account/setLocale", { locale: null })
    await rpc(page, "accounts/update", { id: ironhold.id, plugins: before })
}

/**
 * The narrowing and the words: no Setup checks and no Simple/Advanced toggle on a module page, wolves instead of dogs, clicks
 * instead of tiles (Feather beyond and the search radius), the preset count and the disabled New button at the limit, and a
 * sidebar that keeps its scroll position across a group toggle, a module, and a move to another page.
 */
async function driveUxNarrow(page) {
    const ironhold = (await rpc(page, "accounts/list")).find(a => a.name === "Ironhold")
    const before = ironhold.plugins
    await rpc(page, "account/setLocale", { locale: null })
    const clearPresets = async () => { for (const preset of await rpc(page, "virtualPresets/list", { accountId: ironhold.id })) await rpc(page, "virtualPresets/remove", { id: preset.id }) }
    await clearPresets()
    await storePluginSettings({ accountName: "Ironhold", plugin: "attackBarronsGreatEmpire", enabled: true, options: { horse: 3 } })

    await page.setViewportSize(WIDE_VIEW)
    await page.goto(`${CLIENT_URL}/m/towers?account=${ironhold.id}`)
    const green = page.locator("section.gge-kingdom").first()
    await green.waitFor()
    await page.waitForTimeout(300)
    assert(await page.getByText("Setup checks").count() === 0 && await page.getByRole("complementary", { name: "Setup checks" }).count() === 0, "a module page has no Setup checks panel")
    assert(await page.locator(".ant-segmented-item", { hasText: /^(Simple|Advanced)/ }).count() === 0 && await page.getByRole("radio", { name: /^(Simple|Advanced)/ }).count() === 0, "a module page has no Simple/Advanced toggle")
    assert(await green.getByRole("checkbox", { name: "Send wolves only" }).isVisible(), "the Towers option says Send wolves only")
    assert(await green.getByText("Sends only wolves. Other troops stay home.").isVisible(), "its help says wolves too")
    assert(await page.getByText(/\bdogs?\b/i).count() === 0, "no dogs anywhere on the page")
    assert(await green.getByText("Feather beyond", { exact: true }).isVisible(), "By distance shows Feather beyond")
    assert(await green.getByText("clicks", { exact: true }).count() >= 2, "Feather beyond and the search radius count in clicks")
    assert(await green.getByText("in clicks.", { exact: false }).count() === 1, "the search radius help says clicks")
    assert(await page.getByText(/\btiles?\b/i).count() === 0, "no tiles anywhere on the page")
    await axe(page, "towers narrowed 1440")
    await page.screenshot({ path: `${out}/80-ux-narrow-towers-1440.png`, fullPage: true })
    await page.setViewportSize(PHONE_VIEW)
    await page.waitForTimeout(300)
    await axe(page, "towers narrowed 390")
    assert(await overflowOf(page) <= 0, "no horizontal overflow on Towers at 390")
    await page.screenshot({ path: `${out}/80-ux-narrow-towers-390.png`, fullPage: true })
    await page.setViewportSize(WIDE_VIEW)
    await rpc(page, "account/setLocale", { locale: "ar" })
    await page.reload()
    await green.waitFor()
    await page.waitForTimeout(300)
    assert(await page.evaluate(() => document.documentElement.dir) === "rtl", "in Arabic the page is right to left")
    assert(await green.getByText("ذئاب", { exact: false }).count() >= 2 && await green.getByText("نقرات", { exact: false }).count() >= 2, "in Arabic the wolf and click words show")
    assert(await green.getByText(/كلاب|مربعات/).count() === 0, "in Arabic neither the dog nor the tile word is left")
    await axe(page, "towers narrowed Arabic 1440")
    await page.screenshot({ path: `${out}/80-ux-narrow-towers-ar-1440.png` })
    await rpc(page, "account/setLocale", { locale: null })
    await rpc(page, "accounts/update", { id: ironhold.id, plugins: before })

    await page.goto(`${CLIENT_URL}/m/virtual-presets?account=${ironhold.id}`)
    const count = page.getByTestId("preset-count")
    await count.waitFor()
    const newButton = page.getByRole("button", { name: "New preset" })
    assert(await count.innerText() === "0 of 30 presets" && await newButton.isEnabled(), "an empty account reads 0 of 30 presets with New enabled")
    const plan = { kind: "manual", waves: Array.from({ length: 4 }, () => ({ kind: "preset", preset: 0 })), ast: [null, null, null], rw: Array(8).fill(null) }
    for (let n = 1; n <= 30; n++) { const made = await rpc(page, "virtualPresets/create", { accountId: ironhold.id, name: `Seed ${n}`, plan }); if (!made?.id) throw new Error("FAILED: seeding preset " + n + ": " + JSON.stringify(made)) }
    await page.reload()
    await count.waitFor()
    assert(await count.innerText() === "30 of 30 presets", `thirty presets read 30 of 30 presets (${await count.innerText()})`)
    assert(await newButton.isDisabled(), "New is disabled at the limit")
    const reason = page.getByText("An account keeps up to 30 virtual presets.")
    assert(await reason.isVisible() && await newButton.getAttribute("aria-describedby") === await reason.getAttribute("id"), "the reason shows beside New and is tied to the button")
    const refused = await rpc(page, "virtualPresets/create", { accountId: ironhold.id, name: "One too many", plan })
    assert((refused?.data?.code ?? refused?.code) !== undefined && (await rpc(page, "virtualPresets/list", { accountId: ironhold.id })).length === 30, "the API refuses a thirty-first preset too")
    await axe(page, "virtual presets at the limit 1440")
    await page.screenshot({ path: `${out}/81-ux-narrow-presets-limit-1440.png` })
    const [last] = await rpc(page, "virtualPresets/list", { accountId: ironhold.id })
    await rpc(page, "virtualPresets/remove", { id: last.id })
    await page.reload()
    await count.waitFor()
    assert(await count.innerText() === "29 of 30 presets" && await newButton.isEnabled() && await reason.count() === 0, "removing one reads 29 of 30 presets, with New enabled and the reason gone")
    await page.setViewportSize(PHONE_VIEW)
    await page.waitForTimeout(300)
    await axe(page, "virtual presets count 390")
    assert(await overflowOf(page) <= 0, "no horizontal overflow on Virtual presets at 390")
    await page.screenshot({ path: `${out}/81-ux-narrow-presets-390.png` })
    await page.setViewportSize(WIDE_VIEW)
    await clearPresets()

    await page.setViewportSize({ width: 1440, height: 520 })
    await page.goto(`${CLIENT_URL}/m/khan?account=${ironhold.id}`)
    await page.locator(".gge-module-plugin-row").first().waitFor()
    const nav = page.getByRole("navigation", { name: "Modules" })
    const box = nav.evaluate.bind(nav)
    const state = () => box(el => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight, marked: el.dataset.kept === "yes" }))
    const inView = () => box(el => { const link = el.querySelector("[aria-current=page]").getBoundingClientRect(), room = el.getBoundingClientRect(); return link.top >= room.top && link.bottom <= room.bottom })
    assert(await inView(), "arriving on a page, its link is scrolled into view when it was off screen")
    await box(el => { el.dataset.kept = "yes"; el.scrollTop = 120 })
    const start = await state()
    assert(start.top === 120 && start.max > 300, `the menu is scrolled down and has room to move (${start.top} of ${start.max})`)
    const groupButtons = nav.locator(".gge-nav-group-button")
    const fullyInView = async item => {
        const at = await item.boundingBox(), room = await nav.boundingBox()
        return Boolean(at) && at.y >= room.y && at.y + at.height <= room.y + room.height
    }
    let button
    for (let i = 0; i < await groupButtons.count() && !button; i++)
        if (await fullyInView(groupButtons.nth(i))) button = groupButtons.nth(i)
    assert(button, "a group heading is in view to click")
    for (const turn of ["first", "second"]) {
        const was = await button.getAttribute("aria-expanded")
        await button.click()
        assert(await button.getAttribute("aria-expanded") !== was && (await state()).top === 120, `the ${turn} click on the group heading toggled it and the menu stays at 120 (${(await state()).top})`)
    }
    const links = nav.locator("a[href]:visible")
    let target
    for (let i = 0; i < await links.count(); i++) {
        const at = await links.nth(i).boundingBox(), room = await nav.boundingBox()
        if (at && at.y >= room.y && at.y + at.height <= room.y + room.height && await links.nth(i).getAttribute("aria-current") !== "page" && (await links.nth(i).getAttribute("href")).startsWith("/m/")) { target = links.nth(i); break }
    }
    const href = await target.getAttribute("href")
    await target.click()
    await page.waitForURL(url => url.pathname === href.split("?")[0])
    await page.waitForTimeout(400)
    const afterModule = await state()
    assert(afterModule.marked && afterModule.top === 120, `opening a module that is already in view leaves the menu where it was (${afterModule.top}), and it is the same menu`)
    await nav.locator('a[href="/logs"]').evaluate(link => link.click())
    await page.waitForURL(url => url.pathname === "/logs")
    await page.waitForTimeout(400)
    const afterPage = await state()
    assert(afterPage.marked && afterPage.top === 120, `moving to the Logs page keeps the same menu at 120 (${afterPage.top})`)
    await page.screenshot({ path: `${out}/82-ux-narrow-sidebar-kept-1440.png` })
    await axe(page, "sidebar kept its place 1440")
    await page.setViewportSize(WIDE_VIEW)
}

/** Start and Stop on a module page: the button turns to Stop, the Overview row agrees after a reload, Stop works, and the cases with no button. */
async function driveUxStartStop(page, browser) {
    const find = async name => (await rpc(page, "accounts/list")).find(a => a.name === name)
    const ironhold = await find("Ironhold")
    await rpc(page, "account/setLocale", { locale: null })
    await rpc(page, "accounts/setDesiredState", { ids: [ironhold.id], state: "stopped" })
    const start = page.getByRole("button", { name: "Start the bot" }), stop = page.getByRole("button", { name: "Stop the bot" })
    const row = page.getByRole("row", { name: /^Select row\s+Ironhold/ })

    await page.setViewportSize(WIDE_VIEW)
    await page.goto(`${CLIENT_URL}/m/towers?account=${ironhold.id}`)
    await start.waitFor()
    assert(await stop.count() === 0 && await page.locator(".ant-card-extra .ant-tag").count() === 0, "a stopped account's page offers Start the bot, with no status tag")
    await page.screenshot({ path: `${out}/90-ux-startstop-stopped-1440.png` })
    await start.click()
    await stop.waitFor()
    assert((await find("Ironhold")).desiredState === "running", "Start the bot on a module page starts the account through the API")
    assert(await page.getByText("Starting", { exact: true }).count() === 0, "the seeded status says running, so the page shows Stop the bot and no Starting tag")
    await axe(page, "module page running 1440")
    await page.screenshot({ path: `${out}/90-ux-startstop-running-1440.png` })

    await page.reload()
    await stop.waitFor()
    assert(await stop.isVisible(), "after a reload the module page still offers Stop the bot")
    await page.goto(CLIENT_URL)
    await row.waitFor()
    assert(await row.getByRole("button", { name: /Stop$/ }).isVisible() && await row.getByRole("button", { name: "Start Ironhold" }).count() === 0, "the Overview row agrees: it offers Stop")
    await page.screenshot({ path: `${out}/91-ux-startstop-overview-running-1440.png` })

    await page.goto(`${CLIENT_URL}/m/towers?account=${ironhold.id}`)
    await stop.click()
    await start.waitFor()
    assert((await find("Ironhold")).desiredState === "stopped" && await page.getByText("Starting", { exact: true }).count() === 0, "Stop the bot on a module page stops the account")
    await page.goto(CLIENT_URL)
    await row.getByRole("button", { name: "Start Ironhold" }).waitFor()
    assert(await row.getByRole("button", { name: /Stop$/ }).count() === 0, "the Overview row agrees: it offers Start and no Stop")

    await page.setViewportSize(PHONE_VIEW)
    await page.goto(`${CLIENT_URL}/m/towers?account=${ironhold.id}`)
    await start.waitFor()
    await start.click()
    await stop.waitFor()
    await page.waitForTimeout(300)
    await axe(page, "module page running 390")
    assert(await overflowOf(page) <= 0, "no horizontal overflow on a module page with the button at 390")
    await page.screenshot({ path: `${out}/92-ux-startstop-running-390.png` })
    try {
        await rpc(page, "account/setLocale", { locale: "ar" })
        await page.setViewportSize(WIDE_VIEW)
        await page.reload()
        await page.getByRole("button", { name: "شغّل البوت" }).or(page.getByRole("button", { name: "أوقف البوت" })).waitFor()
        assert(await page.evaluate(() => document.documentElement.dir) === "rtl" && await page.getByRole("button", { name: "أوقف البوت" }).isVisible(), "in Arabic the button reads أوقف البوت, right to left")
        await axe(page, "module page running Arabic 1440")
        await page.screenshot({ path: `${out}/93-ux-startstop-running-ar-1440.png` })
    } finally {
        await rpc(page, "account/setLocale", { locale: null })
    }
    await rpc(page, "accounts/setDesiredState", { ids: [ironhold.id], state: "stopped" })

    const brightwater = await find("Brightwater")
    await page.goto(`${CLIENT_URL}/m/towers?account=${brightwater.id}`)
    await page.getByText(/^Over your plan limit\./).waitFor()
    assert(await start.count() === 0 && await stop.count() === 0, "an account the plan doesn't cover shows the plan reason and no button")
    await page.screenshot({ path: `${out}/94-ux-startstop-over-plan-1440.png` })
    await axe(page, "module page over plan 1440")

    const fresh = await verifiedPlayer("startstop")
    const empty = await browser.newPage({ viewport: WIDE_VIEW })
    try {
        await empty.context().addCookies([asCookie(fresh.cookie, CLIENT_URL)])
        await empty.goto(`${CLIENT_URL}/m/towers`)
        await empty.getByText(/You have no accounts yet/).waitFor()
        assert(await empty.getByRole("button", { name: "Start the bot" }).isDisabled(), "with no account the Start button is disabled")
        await empty.getByRole("button", { name: "Start the bot" }).hover({ force: true })
        const why = await empty.getByText("Add an account to start its bot.").waitFor().then(() => true, () => false)
        assert(why, "and it says why: add an account to start its bot")
        await axe(empty, "module page with no account 1440")
        await empty.screenshot({ path: `${out}/95-ux-startstop-no-account-1440.png` })
    } finally {
        await empty.close()
        await clientCall("account/deleteMe", { password: "a-strong-password", confirmUsername: fresh.name }, fresh.cookie)
    }
}

/** Account settings moved out of the sidebar into a cog on each Overview row and a tab of the account's side panel. */
async function driveUxAccountSettings(page) {
    const find = async () => (await rpc(page, "accounts/list")).find(a => a.name === "Ironhold")
    const ironhold = await find()
    const original = Object.fromEntries(["attack", "skips", "shutoffTimer"].map(key => [key, ironhold.plugins[key] ?? { enabled: false, options: {} }]))
    const drawer = page.getByRole("dialog")
    const row = page.getByRole("row", { name: /^Select row\s+Ironhold/ })
    const tabName = () => drawer.getByRole("tab", { selected: true }).innerText()
    const cog = row.getByRole("button", { name: "Account settings for Ironhold" })
    const limit = () => drawer.getByLabel("Daily attack limit", { exact: true })
    const saveBar = page.locator(".gge-savebar")
    const stored = async key => (await find()).plugins[key]
    // A panel opened from the address can still count its first load as an edit, so the guard may ask once.
    const closePanel = async () => {
        await drawer.getByRole("button", { name: "Close", exact: true }).first().click()
        await page.locator(".ant-modal-confirm-title", { hasText: "Discard your changes?" }).waitFor({ timeout: 1500 }).then(() => page.getByRole("button", { name: "Discard" }).click(), () => {})
        await drawerClosed(page)
    }
    const reopen = async () => {
        await page.goto(CLIENT_URL)
        await cog.click()
        await limit().waitFor()
    }
    try {
        await rpc(page, "account/setLocale", { locale: null })
        await page.setViewportSize(WIDE_VIEW)
        await page.goto(CLIENT_URL)
        await row.waitFor()
        const nav = page.getByRole("navigation", { name: "Modules" })
        assert(await nav.getByRole("link", { name: /Account settings/ }).count() === 0, "the sidebar no longer has an Account settings module")
        assert(await page.goto(`${CLIENT_URL}/m/towers?account=${ironhold.id}`).then(() => true) && await page.getByRole("link", { name: "Change it in Account settings" }).getAttribute("href") === `/?account=${ironhold.id}&tab=account-settings`, "Towers' All kingdoms card links to the account's Account settings tab")
        await page.getByRole("link", { name: "Change it in Account settings" }).click()
        await limit().waitFor()
        assert(await tabName() === "Account settings" && new URL(page.url()).search === "", "that link opens the side panel on Account settings and takes the address parameters off")
        await page.keyboard.press("Escape")
        await drawerClosed(page)

        await page.goto(CLIENT_URL)
        await row.waitFor()
        await cog.click()
        await limit().waitFor()
        assert(await tabName() === "Account settings", "the cog on an Overview row opens the side panel on Account settings")
        assert(await page.locator("form form").count() === 0, "the tab's forms are not nested in the panel's form")
        const names = await drawer.locator(".gge-account-settings .ant-card-head-title").allInnerTexts()
        assert(["Attack", "Time skips", "Shutoff timer"].every((name, i) => names[i] === name), `it holds Attack, Time skips and Shutoff timer: ${names}`)
        await axe(page, "account settings tab 1440")
        await page.screenshot({ path: `${out}/96-ux-account-settings-1440.png` })

        const before = await limit().inputValue()
        const next = before === "3300" ? "3200" : "3300"
        await limit().fill(next)
        await drawer.getByLabel("Seconds between attacks", { exact: true }).fill("5")
        await saveBar.waitFor()
        await axe(page, "account settings tab unsaved 1440")
        await page.screenshot({ path: `${out}/96-ux-account-settings-unsaved-1440.png` })
        await page.getByRole("button", { name: "Close" }).first().click()
        await page.locator(".ant-modal-confirm-title", { hasText: "Discard your changes?" }).waitFor()
        await page.getByRole("button", { name: "Keep editing" }).click()
        assert(await limit().inputValue() === next, "closing the panel with an unsaved change asks first, and Keep editing keeps it")
        await saveBar.getByRole("button", { name: "Save" }).click()
        await saveBar.waitFor({ state: "detached" })
        const attack = await stored("attack")
        assert(attack.options.attackLimit === next && attack.options.attackDelaySeconds === "5", `Save stores the options through the API: ${JSON.stringify(attack.options)}`)

        await drawer.getByRole("tab", { name: "Settings", exact: true }).click()
        await drawer.getByRole("button", { name: "Save changes" }).click()
        await drawerClosed(page)
        assert((await stored("attack")).options.attackLimit === next, "saving the connection tab afterwards does not put the old Account settings back")

        await page.reload()
        await cog.click()
        await limit().waitFor()
        assert(await limit().inputValue() === next && await drawer.getByLabel("Seconds between attacks", { exact: true }).inputValue() === "5", "after a reload the saved values are in the tab")

        const shutoff = drawer.getByRole("switch", { name: "Enable Shutoff timer" })
        await shutoff.setChecked(!(await shutoff.isChecked()))
        const wasOn = await shutoff.isChecked()
        await drawer.getByLabel("Hours until the bot stops", { exact: true }).fill("3")
        await saveBar.getByRole("button", { name: "Save" }).click()
        await saveBar.waitFor({ state: "detached" })
        const timer = await stored("shutoffTimer")
        assert(timer.enabled === wasOn && timer.options.hours === "3", `the Shutoff timer's switch and hours save: ${JSON.stringify(timer)}`)

        await drawer.getByLabel("Daily attack limit", { exact: true }).fill("2900")
        await page.getByRole("button", { name: "Discard changes" }).click()
        assert(await limit().inputValue() === next, "Discard changes puts the saved value back")
        await page.keyboard.press("Escape")
        await drawerClosed(page)

        for (const link of [`/m/account-settings?account=${ironhold.id}`, `/?account=${ironhold.id}&plugin=attack`, `/?account=${ironhold.id}&plugin=skips`]) {
            await page.goto(CLIENT_URL + link)
            await limit().waitFor()
            assert(await tabName() === "Account settings" && new URL(page.url()).pathname === "/" && new URL(page.url()).search === "", `the old link ${link.replace(ironhold.id, "<id>")} lands on the panel's Account settings tab`)
            await closePanel()
        }
        await page.goto(`${CLIENT_URL}/?account=${ironhold.id}`)
        await drawer.getByRole("tab", { name: "Overview", selected: true }).waitFor()
        assert(true, "the Edit button's plain /?account= link still opens on Overview")
        await closePanel()

        await page.setViewportSize(PHONE_VIEW)
        await reopen()
        assert(await tabName() === "Account settings", "at 390 the cog opens the same tab")
        await limit().fill("2800")
        await saveBar.waitFor()
        await axe(page, "account settings tab 390")
        assert(await overflowOf(page) <= 0, "no horizontal overflow on the tab at 390")
        await page.screenshot({ path: `${out}/97-ux-account-settings-390.png` })
        await page.getByRole("button", { name: "Discard changes" }).click()

        await rpc(page, "account/setLocale", { locale: "ar" })
        await page.setViewportSize(WIDE_VIEW)
        await page.reload()
        await page.getByRole("button", { name: "إعدادات الحساب Ironhold" }).click()
        await drawer.getByRole("tab", { selected: true }).filter({ hasText: "إعدادات الحساب" }).waitFor()
        assert(await page.evaluate(() => document.documentElement.dir) === "rtl", "in Arabic the tab reads إعدادات الحساب, right to left")
        await axe(page, "account settings tab Arabic 1440")
        await page.screenshot({ path: `${out}/98-ux-account-settings-ar-1440.png` })
    } finally {
        await rpc(page, "account/setLocale", { locale: null })
        for (const [plugin, { enabled, options }] of Object.entries(original))
            await storePluginSettings({ accountName: "Ironhold", plugin, enabled, options })
    }
    const back = await find()
    assert(JSON.stringify(back.plugins.attack ?? null) === JSON.stringify(original.attack) || !ironhold.plugins.attack, "Ironhold's account settings are back as they were")
}

;(async () => {
    const browser = await chromium.launch()
    if (process.env.DRIVE_ONLY === "ux-narrow") {
        const demo = await browser.newPage({ viewport: WIDE_VIEW })
        await demo.goto(`${CLIENT_URL}/login`)
        await demo.getByLabel("Username or email").fill("demo")
        await demo.getByLabel("Password").fill("demo-password")
        await demo.getByRole("button", { name: "Sign in" }).click()
        await demo.getByRole("button", { name: "Edit Ironhold" }).waitFor()
        await driveUxNarrow(demo)
        await browser.close()
        return console.log(`evidence: ${out}`)
    }
    if (process.env.DRIVE_ONLY === "ux-autobuy") {
        const demo = await browser.newPage({ viewport: WIDE_VIEW })
        await demo.goto(`${CLIENT_URL}/login`)
        await demo.getByLabel("Username or email").fill("demo")
        await demo.getByLabel("Password").fill("demo-password")
        await demo.getByRole("button", { name: "Sign in" }).click()
        await demo.getByRole("button", { name: "Edit Ironhold" }).waitFor()
        await driveUxAutobuy(demo)
        await browser.close()
        return console.log(`evidence: ${out}`)
    }
    if (process.env.DRIVE_ONLY === "ux-startstop") {
        const demo = await browser.newPage({ viewport: WIDE_VIEW })
        await demo.goto(`${CLIENT_URL}/login`)
        await demo.getByLabel("Username or email").fill("demo")
        await demo.getByLabel("Password").fill("demo-password")
        await demo.getByRole("button", { name: "Sign in" }).click()
        await demo.getByRole("button", { name: "Edit Ironhold" }).waitFor()
        await driveUxStartStop(demo, browser)
        await browser.close()
        return console.log(`evidence: ${out}`)
    }
    if (process.env.DRIVE_ONLY === "ux-account-settings") {
        const demo = await browser.newPage({ viewport: WIDE_VIEW })
        await demo.goto(`${CLIENT_URL}/login`)
        await demo.getByLabel("Username or email").fill("demo")
        await demo.getByLabel("Password").fill("demo-password")
        await demo.getByRole("button", { name: "Sign in" }).click()
        await demo.getByRole("button", { name: "Edit Ironhold" }).waitFor()
        await driveUxAccountSettings(demo)
        await browser.close()
        return console.log(`evidence: ${out}`)
    }
    if (process.env.DRIVE_ONLY === "towers") {
        const demo = await browser.newPage({ viewport: WIDE_VIEW })
        await demo.goto(`${CLIENT_URL}/login`)
        await demo.getByLabel("Username or email").fill("demo")
        await demo.getByLabel("Password").fill("demo-password")
        await demo.getByRole("button", { name: "Sign in" }).click()
        await demo.getByRole("button", { name: "Edit Ironhold" }).waitFor()
        await driveTowers(demo)
        await browser.close()
        return console.log(`evidence: ${out}`)
    }
    if (process.env.DRIVE_ONLY === "event-camps") {
        const demo = await browser.newPage({ viewport: WIDE_VIEW })
        await demo.goto(`${CLIENT_URL}/login`)
        await demo.getByLabel("Username or email").fill("demo")
        await demo.getByLabel("Password").fill("demo-password")
        await demo.getByRole("button", { name: "Sign in" }).click()
        await demo.getByRole("button", { name: "Edit Ironhold" }).waitFor()
        await driveEventCamps(demo)
        await browser.close()
        return console.log(`evidence: ${out}`)
    }
    if (process.env.DRIVE_ONLY === "phase-c") {
        const demo = await browser.newPage({ viewport: WIDE_VIEW })
        await demo.goto(`${CLIENT_URL}/login`)
        await demo.getByLabel("Username or email").fill("demo")
        await demo.getByLabel("Password").fill("demo-password")
        await demo.getByRole("button", { name: "Sign in" }).click()
        await demo.getByRole("button", { name: "Edit Ironhold" }).waitFor()
        await drivePhaseC(demo)
        await browser.close()
        return console.log(`evidence: ${out}`)
    }
    if (process.env.DRIVE_ONLY === "ux-waves") {
        const demo = await browser.newPage({ viewport: WIDE_VIEW })
        await demo.goto(`${CLIENT_URL}/login`)
        await demo.getByLabel("Username or email").fill("demo")
        await demo.getByLabel("Password").fill("demo-password")
        await demo.getByRole("button", { name: "Sign in" }).click()
        await demo.getByRole("button", { name: "Edit Ironhold" }).waitFor()
        await driveUxWaves(demo)
        await browser.close()
        return console.log(`evidence: ${out}`)
    }
    if (process.env.DRIVE_ONLY === "armies") {
        const demo = await browser.newPage({ viewport: WIDE_VIEW })
        await demo.goto(`${CLIENT_URL}/login`)
        await demo.getByLabel("Username or email").fill("demo")
        await demo.getByLabel("Password").fill("demo-password")
        await demo.getByRole("button", { name: "Sign in" }).click()
        await demo.getByRole("button", { name: "Edit Ironhold" }).waitFor()
        await driveArmies(demo)
        await browser.close()
        return console.log(`evidence: ${out}`)
    }
    if (process.env.DRIVE_ONLY === "glory-settings") {
        const demo = await browser.newPage({ viewport: { width: 1280, height: 860 } })
        await demo.goto(`${CLIENT_URL}/login`)
        await demo.getByLabel("Username or email").fill("demo")
        await demo.getByLabel("Password").fill("demo-password")
        await demo.getByRole("button", { name: "Sign in" }).click()
        await demo.getByRole("button", { name: "Edit Ironhold" }).waitFor()
        await driveGlorySettings(demo)
        await browser.close()
        return console.log(`evidence: ${out}`)
    }
    if (process.env.DRIVE_ONLY === "billing") {
        await driveBilling(browser)
        await browser.close()
        return console.log(`evidence: ${out}`)
    }
    if (process.env.DRIVE_ONLY === "phase4") {
        const demo = await browser.newPage({ viewport: { width: 1280, height: 860 } })
        await demo.goto(`${CLIENT_URL}/login`)
        await demo.getByLabel("Username or email").fill("demo")
        await demo.getByLabel("Password").fill("demo-password")
        await demo.getByRole("button", { name: "Sign in" }).click()
        await demo.getByRole("button", { name: "Edit Ironhold" }).waitFor()
        await driveOverview(demo)
        await driveErrorSplit(demo)
        await driveDashboardHome(demo, browser)
        await drivePalette(demo, browser)
        await browser.close()
        return console.log(`evidence: ${out}`)
    }
    if (process.env.DRIVE_ONLY === "sidebar") {
        const demo = await browser.newPage({ viewport: { width: 1440, height: 900 } })
        await demo.goto(`${CLIENT_URL}/login`)
        await demo.getByLabel("Username or email").fill("demo")
        await demo.getByLabel("Password").fill("demo-password")
        await demo.getByRole("button", { name: "Sign in" }).click()
        await demo.getByRole("button", { name: "Edit Ironhold" }).waitFor()
        await driveSidebar(demo)
        await browser.close()
        return console.log(`evidence: ${out}`)
    }
    if (process.env.DRIVE_ONLY === "station-settings") {
        const demo = await browser.newPage({ viewport: { width: 1280, height: 860 } })
        await demo.goto(`${CLIENT_URL}/login`)
        await demo.getByLabel("Username or email").fill("demo")
        await demo.getByLabel("Password").fill("demo-password")
        await demo.getByRole("button", { name: "Sign in" }).click()
        await demo.getByRole("button", { name: "Edit Ironhold" }).waitFor()
        await driveStationSettings(demo)
        await browser.close()
        return console.log(`evidence: ${out}`)
    }
    if (process.env.DRIVE_ONLY === "plugin-settings") {
        const demo = await browser.newPage({ viewport: { width: 1280, height: 860 } })
        await demo.goto(`${CLIENT_URL}/login`)
        await demo.getByLabel("Username or email").fill("demo")
        await demo.getByLabel("Password").fill("demo-password")
        await demo.getByRole("button", { name: "Sign in" }).click()
        await demo.getByRole("button", { name: "Edit Ironhold" }).waitFor()
        await drivePluginSettings(demo)
        await browser.close()
        return console.log(`evidence: ${out}`)
    }
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

    const bell = page.getByRole("button", { name: "Notifications, 0 unread", exact: true })
    await bell.click()
    await page.getByText("Nothing yet. You'll hear here when a bot stops and needs you.").waitFor()
    assert(await page.getByRole("button", { name: "Mark all read" }).isDisabled(), "the bell opens an empty list for a new player, with nothing to mark read")
    await axe(page, "empty notifications")
    await page.keyboard.press("Escape")

    await sidebar(page, "Settings")
    await page.getByRole("heading", { name: "Change password" }).waitFor().catch(() => {})
    const emailWhen = what => page.getByRole("switch", { name: `Email me when ${what}` })
    const emailsOn = async () => Promise.all(["the game bans an account", "the game rejects an account's password", "a bot is stopped after repeated crashes", "the shutoff timer stops a bot"]
        .map(async what => await emailWhen(what).getAttribute("aria-checked") === "true"))
    await page.waitForFunction(() => document.querySelectorAll("[role=switch]:not([disabled])").length >= 4)
    assert((await emailsOn()).join() === "true,true,true,false", "email alerts default to on for bans, rejected passwords and crash loops, off for the shutoff timer")
    assert(await emailWhen("a player attacks one of my castles (Auto Station)").getAttribute("aria-checked") === "false"
        && await emailWhen("Auto Station moves troops out or opens the gates").getAttribute("aria-checked") === "false", "the two Auto Station emails start off")
    let saves = 0
    page.on("response", response => { if (response.url().includes("/rpc/account/notificationPrefs")) saves++ })
    await emailWhen("the game bans an account").click()
    await emailWhen("the shutoff timer stops a bot").click()
    for (let waited = 0; saves < 2 && waited < 10_000; waited += 100) await page.waitForTimeout(100)
    await page.reload()
    await page.waitForFunction(() => document.querySelectorAll("[role=switch]:not([disabled])").length >= 4)
    assert((await emailsOn()).join() === "false,true,true,true", "the email switches keep their positions across a reload")
    await page.getByLabel("Current password").fill("a-strong-password")
    await page.getByLabel("New password", { exact: true }).fill("another-strong-password")
    await page.getByLabel("Confirm new password").fill("another-strong-password")
    await page.getByRole("button", { name: "Change password" }).click()
    await page.getByText("Password changed").waitFor()
    await axe(page, "settings")
    assert(true, "Settings changes the password")
    await sidebar(page, "Overview")

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
    for (const plugin of ["Daily login bonus", "Tax collector"]) {
        const toggle = page.getByRole("switch", { name: `Enable ${plugin}` })
        assert(await toggle.count() === 1 && !(await toggle.isChecked()), `the ${plugin} plugin is listed and off for a new account`)
        const pluginRow = toggle.locator("xpath=ancestor::div[2]")
        assert(await pluginRow.getByRole("button", { name: "Settings" }).count() === 0, `the ${plugin} plugin has no options to set`)
    }
    await page.getByRole("switch", { name: "Enable Daily login bonus" }).click()
    await page.getByRole("switch", { name: "Enable Tax collector" }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${out}/10-add-account-chore-plugins.png` })
    await page.screenshot({ path: `${out}/10-add-account.png` })
    await axe(page, "add-account drawer")
    await page.getByRole("button", { name: "Add account", exact: true }).last().click()
    await page.waitForTimeout(1500)
    const alerts = await page.getByRole("alert").allTextContents()
    const fieldErrors = await page.locator(".ant-form-item-explain-error").allTextContents()
    if (alerts.length || fieldErrors.length) console.log("form errors:", alerts, fieldErrors)
    await page.getByText(`Storm${name} added`).first().waitFor()
    await drawerClosed(page)
    const row = page.getByRole("row", { name: new RegExp(`Storm${name}`) })
    await row.waitFor()
    assert(await row.getByText("Stopped").isVisible(), "new account shows as stopped")
    assert(await page.getByRole("button", { name: "Add account", exact: true }).isDisabled(), "Add account is disabled at the one-bot limit")
    assert(await page.getByText("Your plan allows 1 bot. Remove one to add another.").first().isVisible(), "the limit is explained on the page")
    await page.screenshot({ path: `${out}/10b-at-bot-limit.png` })
    const refused = await page.evaluate(async serverId => {
        const res = await fetch("/rpc/accounts/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: { name: "OneTooMany", serverId, password: "x" } }) })
        const body = (await res.json()).json
        return { status: res.status, code: body?.code, data: body?.data, message: body?.message }
    }, 27)
    assert(refused.status === 403 && refused.code === "FORBIDDEN", "calling the API directly for a second bot is refused (FORBIDDEN)")
    assert(refused.data?.code === "PLAN_LIMIT" && refused.data.params?.context === "add" && refused.data.params.count === 1, `the refusal carries its code and params (${JSON.stringify(refused.data)})`)
    assert(refused.message === "Your plan allows 1 bot. Remove one to add another.", "and the English text, written from the errors catalog")

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
    await page.getByRole("tab").nth(1).click()
    assert(await page.getByRole("switch", { name: "Enable Daily login bonus" }).isChecked(), "the Daily login bonus plugin turned on at creation is still on when the account is reopened")
    assert(!(await page.getByRole("switch", { name: "Enable Tax collector" }).isChecked()), "the Tax collector plugin left off is still off")
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
    await page.getByText(`${gale} added`).first().waitFor()
    await drawerClosed(page)
    const galeRows = page.getByRole("row", { name: new RegExp(gale) })
    await galeRows.nth(1).waitFor()
    assert(await galeRows.count() === 2, "the event twin was added at the limit")
    const accountsStat = await page.locator(".gge-kpi-card").filter({ hasText: /^\s*Accounts\s*\d/ }).textContent()
    assert(/Accounts\s*1\s*\/\s*1/.test(accountsStat), `the counter counts the main only (${accountsStat})`)
    const twinRow = page.getByRole("row").filter({ hasText: "· event" })
    assert(await twinRow.getByRole("button", { name: `Start ${gale}` }).isEnabled(), "the twin can be started")
    assert(await page.getByRole("button", { name: `Add event twin for ${gale}` }).count() === 0, "a main that has its twin offers no second one")
    await page.screenshot({ path: `${out}/12-event-twin-at-limit.png` })

    const WIDE = { width: 1440, height: 900 }, PHONE = { width: 390, height: 844 }
    const overflowOf = target => target.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    // A resize is laid out after a moment, longer on a loaded machine, so the page gets 3 s to fit before this counts as overflow.
    const noOverflow = async (target, what) => {
        for (let waited = 0; waited < 3000 && await overflowOf(target) !== 0; waited += 200) await target.waitForTimeout(200)
        assert(await overflowOf(target) === 0, `no horizontal overflow on ${what} at 390`)
    }
    /** A screenshot at 1440 and at 390, with the overflow check at 390. Leaves the page wide. */
    const bothWidths = async (target, file, what) => {
        await target.setViewportSize(WIDE)
        await target.screenshot({ path: `${out}/${file}-1440.png`, fullPage: true })
        await target.setViewportSize(PHONE)
        await target.waitForTimeout(300)
        await noOverflow(target, what)
        await target.screenshot({ path: `${out}/${file}-390.png`, fullPage: true })
        await target.setViewportSize(WIDE)
    }

    const mainRow = galeRows.first()
    await mainRow.getByRole("button", { name: `Start ${gale}` }).click()
    await mainRow.getByRole("button", { name: "Stop" }).waitFor()
    const drawer = page.getByRole("dialog")
    const scheduleSwitch = drawer.getByRole("switch", { name: "Run on a schedule" })
    // Sorted by plugin, because the API lists them in the database's row order, which an update can change.
    const pluginsOf = async () => { const plugins = (await rpc(page, "accounts/list")).find(a => a.name === gale).plugins; return JSON.stringify(Object.fromEntries(Object.entries(plugins).sort(([a], [b]) => a.localeCompare(b)))) }
    let pluginsBefore
    const openSchedule = async () => {
        pluginsBefore ??= await pluginsOf()
        await mainRow.getByRole("button", { name: `Edit ${gale}` }).click()
        await drawer.getByRole("tab", { name: "Schedule" }).click()
        await scheduleSwitch.waitFor()
    }
    const windowBox = n => drawer.getByRole("group", { name: `Window ${n}`, exact: true })
    const setTime = async (n, label, value) => {
        const input = windowBox(n).getByLabel(label, { exact: true })
        await input.click()
        await input.fill(value)
        await input.press("Enter")
    }
    const nextStart = async () => (await drawer.getByText(/^Next start: /).innerText()).match(/^Next start: (\w{3} \d\d:\d\d) \(your time\)$/)[1]
    await openSchedule()
    assert(!(await scheduleSwitch.isChecked()) && await drawer.getByText("Without a schedule the bot runs whenever it is started.").isVisible(), "an account starts with no schedule")
    await scheduleSwitch.click()
    const { zone, hour } = await page.evaluate(() => ({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, hour: new Date().getHours() }))
    assert(await drawer.locator(`.ant-select-content[title="${zone}"]`).count() === 1, `the time zone defaults to the browser's (${zone})`)
    // Two to three hours from now, so the account is outside its window whatever the time of day.
    const clock = hours => `${String((hour + hours) % 24).padStart(2, "0")}:15`
    await setTime(1, "From", clock(2))
    await setTime(1, "to", clock(3))
    await drawer.getByRole("slider").focus()
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight")
    assert(await drawer.getByText("Vary start and stop times by up to 15 minutes each day").isVisible(), "the jitter slider says how far times vary")
    await drawer.getByRole("button", { name: "Add window" }).click()
    await setTime(2, "From", "23:00")
    await setTime(2, "to", "01:00")
    assert(await windowBox(2).getByText("ends next day").isVisible(), "a window that ends at or before its start says it ends next day")
    await axe(page, "schedule tab")
    await bothWidths(page, "15-schedule-tab", "the Schedule tab")
    await setTime(2, "to", "23:00")
    assert(await windowBox(2).getByRole("alert").innerText() === "A window can't start and end at the same time", "a window that starts and ends at the same time is flagged")
    assert(await drawer.getByText(/^Next start: /).count() === 0, "an invalid schedule shows no preview")
    await drawer.getByRole("button", { name: "Save changes" }).click()
    await drawer.getByText("Fix the schedule before saving").waitFor()
    assert(await drawer.isVisible(), "an invalid schedule isn't saved")
    await drawer.getByRole("button", { name: "Remove window 2" }).click()
    assert(await windowBox(2).count() === 0, "a window can be removed")
    const when = await nextStart()
    assert(true, `the preview reads "Next start: ${when} (your time)"`)
    await drawer.getByRole("button", { name: "Save changes" }).click()
    await page.getByText(`${gale} saved`).waitFor()
    await drawerClosed(page)
    {
        const afterPlugins = await pluginsOf()
        if (afterPlugins !== pluginsBefore) {
            const a = JSON.parse(pluginsBefore), b = JSON.parse(afterPlugins)
            console.log("plugin settings differ:", Object.keys({ ...a, ...b }).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(k => `${k}: ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`))
        }
    }
    assert(await pluginsOf() === pluginsBefore, "saving from the Schedule tab, without opening Settings, leaves the account's plugin settings as they were")
    const sleeping = mainRow.getByText(`Sleeping until ${when}`)
    await sleeping.waitFor()
    assert(true, `the started account's row shows "Sleeping until ${when}", the time the preview gave`)
    // The tag fades from the colour of the state it replaced, so the colour is read once the fade is over.
    const tagColour = () => sleeping.evaluate(el => getComputedStyle(el.closest(".ant-tag")).color)
    for (let i = 0; i < 20 && await tagColour() !== "rgb(169, 155, 234)"; i++) await page.waitForTimeout(100)
    assert(await tagColour() === "rgb(169, 155, 234)", "sleeping has its own calm colour, not the error one")
    assert(await twinRow.getByText("Sleeping").count() === 0, "the event twin doesn't follow its main's schedule")
    await bothWidths(page, "16-sleeping-row", "the roster with a sleeping account")
    await page.reload()
    await mainRow.getByText(`Sleeping until ${when}`).waitFor()
    await openSchedule()
    assert(await drawer.getByText(`Sleeping until ${when}`).isVisible(), "the drawer shows the same sleeping status")
    assert(await scheduleSwitch.isChecked()
        && await windowBox(1).getByLabel("From", { exact: true }).inputValue() === clock(2) && await windowBox(1).getByLabel("to", { exact: true }).inputValue() === clock(3)
        && await drawer.getByText("up to 15 minutes each day").isVisible() && await nextStart() === when, "the schedule survives a reload, and its preview still matches")
    await bothWidths(page, "17-sleeping-drawer", "the drawer of a sleeping account")
    await scheduleSwitch.click()
    await drawer.getByRole("button", { name: "Save changes" }).click()
    await page.getByText(`${gale} saved`).last().waitFor()
    await drawerClosed(page)
    await mainRow.getByText("Stopped").waitFor()
    assert(await mainRow.getByText("Sleeping").count() === 0, "turning the schedule off clears the sleeping state")
    await mainRow.getByRole("button", { name: "Stop" }).click()
    await mainRow.getByRole("button", { name: `Start ${gale}` }).waitFor()
    await page.setViewportSize({ width: 1280, height: 860 })

    await setMaxBots(name, 2)
    await page.reload()
    await page.getByRole("button", { name: "Add account", exact: true }).click()
    const hail = `Hail${name}`
    let hailStart
    await addAccount(page, hail, async () => {
        assert(await drawer.getByRole("tab").count() === 0 && !(await scheduleSwitch.isChecked()), "the add-account drawer offers a schedule as a section, off to begin with")
        await scheduleSwitch.click()
        await setTime(1, "From", clock(2))
        await setTime(1, "to", clock(3))
        const approximate = await drawer.getByText(/^Next start: /).innerText()
        assert(new RegExp(`^Next start: about \\w{3} ${clock(2)} \\(your time\\)\\. It varies by up to 10 minutes; the exact time shows once the account is added\\.$`).test(approximate),
            `before the account exists the preview gives the set time and says it varies ("${approximate}")`)
        await axe(page, "add-account drawer with a schedule")
        await bothWidths(page, "18-new-account-schedule", "the add-account drawer with a schedule")
        await page.setViewportSize({ width: 1280, height: 860 })
        await drawer.getByRole("slider").focus()
        for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft")
        await drawer.getByText("Vary start and stop times by up to 0 minutes each day").waitFor()
        hailStart = await nextStart()
        assert(hailStart.endsWith(clock(2)), `with no variation the preview is exact: "Next start: ${hailStart} (your time)"`)
    })
    const newRow = page.getByRole("row", { name: new RegExp(hail) })
    await newRow.getByRole("button", { name: `Start ${hail}` }).click()
    await newRow.getByText(`Sleeping until ${hailStart}`).waitFor()
    assert(true, `an account added with a schedule and then started shows "Sleeping until ${hailStart}" on its row`)
    assert(/Need attention\s*0/.test(await page.locator(".gge-kpi-card").filter({ hasText: "Need attention" }).textContent()), "a sleeping account isn't counted under Need attention")
    await page.screenshot({ path: `${out}/19-new-account-sleeping.png` })
    await newRow.getByRole("button", { name: "Stop" }).click()
    await newRow.getByRole("button", { name: `Start ${hail}` }).waitFor()
    await setMaxBots(name, 1)
    await page.reload()
    const hailRow = page.getByRole("row", { name: new RegExp(hail) })
    await hailRow.getByText("Over plan limit").waitFor()
    assert(await hailRow.getByRole("button", { name: `Start ${hail}` }).isDisabled(), "after the admin lowers the limit the newest account shows Over plan limit with Start disabled")
    assert(await galeRows.first().getByRole("button", { name: `Start ${gale}` }).isEnabled(), "the oldest account can still start")
    await page.locator(".gge-alert", { hasText: "1 account is stopped: your plan allows 1." }).waitFor()
    assert(true, "a banner under the header explains the over-limit account")
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
    const seeded = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage()
    await seeded.goto(`${CLIENT_URL}/login`)
    await seeded.getByLabel("Username or email").fill("demo")
    await seeded.getByLabel("Password").fill("demo-password")
    await seeded.getByRole("button", { name: "Sign in" }).click()
    await seeded.getByRole("button", { name: "Edit Ironhold" }).waitFor()
    await driveLogs(seeded)
    await driveOverview(seeded)
    await driveErrorSplit(seeded)
    await driveDashboardHome(seeded, browser)
    await drivePalette(seeded, browser)
    await driveSidebar(seeded)
    await driveUxNarrow(seeded)
    await driveUxStartStop(seeded, browser)
    await driveUxAutobuy(seeded)
    await driveUxWaves(seeded)
    await drivePluginSettings(seeded)
    await seeded.goto(CLIENT_URL)
    await seeded.getByRole("button", { name: "Edit Ironhold" }).click()
    await seeded.getByRole("tab", { name: "Run history" }).click()
    await seeded.getByRole("dialog").getByText("Server restart").first().waitFor()
    assert(true, "the Run history tab lists the account's runs")

    const pl = JSON.parse(require("fs").readFileSync(path.join(__dirname, "../../../../packages/bot-core/locales/pl.json"), "utf8"))
    const plClient = JSON.parse(require("fs").readFileSync(path.join(__dirname, "../../../../packages/i18n/catalogs/pl/client.json"), "utf8"))
    const editIronholdPl = plClient["dashboard.edit"].replace("{{name}}", "Ironhold")
    const picker = seeded.locator('header button[aria-haspopup="dialog"]:has(.anticon-global)')
    const htmlAttr = attr => seeded.evaluate(a => document.documentElement.getAttribute(a), attr)
    await seeded.goto(`${CLIENT_URL}/settings`)
    await picker.click()
    await seeded.getByRole("option").first().waitFor()
    await axe(seeded, "language picker open")
    await seeded.keyboard.press("Escape")
    await seeded.locator(".ant-popover").waitFor({ state: "hidden" })
    await axe(seeded, "settings with the inline language list")
    await seeded.goto(CLIENT_URL)
    await seeded.getByRole("button", { name: "Edit Ironhold" }).waitFor()
    assert(await htmlAttr("lang") === "en" && await htmlAttr("dir") === "ltr", "the demo player starts in English, left to right")
    await picker.click()
    const options = seeded.getByRole("option")
    await options.first().waitFor()
    assert(await options.count() === 29, "the header picker lists Automatic and 28 languages")
    assert((await options.first().innerText()).startsWith("Automatic"), "Automatic comes first")
    await seeded.screenshot({ path: `${out}/26-language-picker-open.png` })
    await seeded.waitForFunction(() => { const popover = document.querySelector(".ant-popover"); return popover && getComputedStyle(popover).opacity === "1" })
    await seeded.screenshot({ path: `${out}/language-picker-open-settled.png` })
    await seeded.keyboard.press("Escape")
    await seeded.getByRole("listbox").waitFor({ state: "hidden" })
    assert(await picker.evaluate(el => el === document.activeElement), "Escape closes the picker and returns focus to its button")
    await picker.click()
    await seeded.getByRole("combobox", { name: "Search languages" }).fill("pol")
    assert(await options.count() === 1, "searching 'pol' leaves one language")
    await options.getByText("Polski").click()
    await seeded.waitForFunction(() => document.documentElement.lang === "pl")
    assert(await htmlAttr("lang") === "pl", "picking Polski sets <html lang=pl>")
    await seeded.getByRole("button", { name: editIronholdPl }).click()
    await seeded.getByRole("tab").nth(1).click()
    const polishPlugin = seeded.getByRole("switch", { name: plClient["plugins.enable"].replace("{{label}}", pl.feast) })
    await polishPlugin.waitFor()
    assert(pl.feast !== "Feast", `a plugin name in the account drawer is Polish (${pl.feast})`)
    await seeded.screenshot({ path: `${out}/27-language-polish-drawer.png` })
    await seeded.reload()
    await seeded.getByRole("button", { name: editIronholdPl }).waitFor()
    assert(await htmlAttr("lang") === "pl" && await seeded.evaluate(() => localStorage.getItem("gge.locale")) === "pl", "the Polish choice survives a reload")

    await picker.click()
    await seeded.getByRole("combobox").fill("العر")
    await options.getByText("العربية").click()
    await seeded.waitForFunction(() => document.documentElement.dir === "rtl")
    assert(await htmlAttr("lang") === "ar" && await htmlAttr("dir") === "rtl", "picking العربية sets lang=ar and dir=rtl")
    await seeded.setViewportSize(PHONE)
    await seeded.waitForTimeout(400)
    await noOverflow(seeded, "the right-to-left dashboard")
    await seeded.screenshot({ path: `${out}/28-language-arabic-390.png`, fullPage: true })
    await seeded.setViewportSize({ width: 1280, height: 860 })

    await picker.click()
    await options.first().click()
    await seeded.waitForFunction(() => document.documentElement.dir === "ltr")
    assert(await seeded.evaluate(() => localStorage.getItem("gge.locale")) === "auto" && await htmlAttr("lang") === "en", "switching back to Automatic follows the browser (English) again")
    await seeded.close()

    if (!process.env.GEOIP_URL)
        console.log("skip: IP language detection (GEOIP_URL is not set; run stub-atlas.cjs and start pnpm dev with GEOIP_URL=http://127.0.0.1:8089)")
    else {
        // The stub maps every 93.x.x.x address to Italy. The dev proxy passes this header through to the API.
        const italian = () => browser.newContext({ viewport: { width: 1280, height: 860 }, extraHTTPHeaders: { "X-Forwarded-For": "93.58.1.10" } })
        const htmlLang = target => target.evaluate(() => document.documentElement.lang)
        const savedLocale = target => target.waitForResponse(response => response.url().includes("/rpc/account/setLocale") && response.ok())
        const signInDemo = async target => {
            await target.getByLabel("Username or email").fill("demo")
            await target.getByLabel("Password").fill("demo-password")
            await target.getByRole("button", { name: "Sign in" }).click()
        }

        const first = await italian()
        const phone1 = await first.newPage()
        await phone1.goto(`${CLIENT_URL}/login`)
        await phone1.waitForFunction(() => document.documentElement.lang === "it")
        assert(await htmlLang(phone1) === "it", "a fresh browser with an Italian IP opens the sign-in page in Italian")
        const loginPicker = phone1.locator('button[aria-haspopup="dialog"]')
        await loginPicker.click()
        const rows = phone1.getByRole("option")
        await rows.first().waitFor()
        const automatic = await rows.first().innerText()
        assert(automatic.startsWith("Automatic") && automatic.includes("Italiano"), `the picker's Automatic row says Italiano is detected (${automatic.replace(/\n/g, " ")})`)
        await phone1.waitForFunction(() => { const popover = document.querySelector(".ant-popover"); return popover && getComputedStyle(popover).opacity === "1" })
        await phone1.screenshot({ path: `${out}/29-geoip-login-italian-picker.png` })
        await axe(phone1, "sign-in page in detected Italian, picker open")
        await phone1.keyboard.press("Escape")
        await phone1.locator(".ant-popover").waitFor({ state: "hidden" })

        await signInDemo(phone1)
        await phone1.getByRole("button", { name: "Edit Ironhold" }).waitFor()
        assert(await htmlLang(phone1) === "it", "signing in as demo, who has no saved language, keeps the detected Italian")
        const header = phone1.locator('header button[aria-haspopup="dialog"]:has(.anticon-global)')
        await header.click()
        await phone1.getByRole("combobox", { name: "Search languages" }).fill("pol")
        const saved = savedLocale(phone1)
        await phone1.getByRole("option").getByText("Polski").click()
        await saved
        await phone1.waitForFunction(() => document.documentElement.lang === "pl")
        assert(await htmlLang(phone1) === "pl", "picking Polski switches the page and saves it to the account")
        await phone1.screenshot({ path: `${out}/30-geoip-polish-saved.png` })

        const second = await italian()
        const phone2 = await second.newPage()
        await phone2.goto(`${CLIENT_URL}/login`)
        await phone2.waitForFunction(() => document.documentElement.lang === "it")
        assert(await phone2.evaluate(() => localStorage.getItem("gge.locale")) === "auto", "a second fresh browser starts on Automatic, in Italian")
        await signInDemo(phone2)
        await phone2.waitForFunction(() => document.documentElement.lang === "pl")
        assert(await htmlLang(phone2) === "pl" && await phone2.evaluate(() => localStorage.getItem("gge.locale")) === "pl", "after sign-in the second device switches to the Polish saved to the account")
        await phone2.getByRole("button", { name: "Edit Ironhold" }).waitFor()
        await phone2.screenshot({ path: `${out}/31-geoip-second-device-polish.png` })

        const reset = savedLocale(phone2)
        await phone2.locator('header button[aria-haspopup="dialog"]:has(.anticon-global)').click()
        await phone2.getByRole("option").first().click()
        await reset
        await phone2.waitForFunction(() => document.documentElement.lang === "it")
        assert(await phone2.evaluate(() => localStorage.getItem("gge.locale")) === "auto" && await htmlLang(phone2) === "it", "Automatic is saved back to the account and follows the IP again")
        await first.close()
        await second.close()
    }

    const signIn = async (target, login) => {
        await target.goto(`${CLIENT_URL}/login`)
        await target.getByLabel("Username or email").fill(login)
        await target.getByLabel("Password").fill("third-strong-password")
        await target.getByRole("button", { name: "Sign in" }).click()
    }
    const email = `${name}@example.test`, newEmail = `${name}-new@example.test`
    await page.setViewportSize(WIDE)
    await page.goto(`${CLIENT_URL}/settings`)
    await page.getByText("Delete account", { exact: true }).first().waitFor()
    assert(await page.getByText(`Your email is ${email}`).isVisible(), "Settings shows the current email on the Change email card")
    await axe(page, "settings self-service cards")
    await bothWidths(page, "20-settings-self-service", "Settings with the self-service cards")

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download my data" }).click()])
    const today = new Date().toISOString().slice(0, 10)
    assert(download.suggestedFilename() === `gge-bot-export-${name}-${today}.json`, `the export is saved as ${download.suggestedFilename()}`)
    const exportPath = `${out}/${download.suggestedFilename()}`
    await download.saveAs(exportPath)
    const exportText = require("fs").readFileSync(exportPath, "utf8")
    const exported = JSON.parse(exportText)
    assert(["profile", "accounts", "pluginSettings", "runs", "logs", "notifications", "audit"].every(section => section in exported), "the export parses and has every section")
    assert(exported.profile.username === name && exported.accounts.some(a => a.name === gale), "the export holds this player's profile and game accounts")
    const keysOf = value => value && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => [...(Array.isArray(value) ? [] : [k]), ...keysOf(v)]) : []
    assert(keysOf(exported).every(key => !/password|sealed|hash/i.test(key)), "no field in the export is a password, a sealed value or a hash")
    assert(!exportText.includes("hunter2") && !exportText.includes("third-strong-password"), "neither the game password nor the panel password is in the export")
    await page.getByRole("button", { name: "Download my data" }).click()
    await page.getByText("You can download your data once every 10 minutes").waitFor()
    assert(true, "a second download straight away shows the API's rate-limit message")
    await page.screenshot({ path: `${out}/21-export-rate-limited-1440.png`, fullPage: true })

    await page.getByLabel("New email").fill(newEmail)
    await page.getByLabel("Confirm with your password").fill("not-the-password")
    await page.getByRole("button", { name: "Send confirmation link" }).click()
    await page.getByText("Your current password is wrong").waitFor()
    assert(true, "changing the email with a wrong password is refused")
    await page.getByLabel("Confirm with your password").fill("third-strong-password")
    await page.getByRole("button", { name: "Send confirmation link" }).click()
    await page.getByText("Check your new inbox").waitFor()
    assert(await page.getByText(`Your email is ${email}`).isVisible(), "the email stays the old one until the link is opened")
    await axe(page, "settings change email sent")
    await bothWidths(page, "22-change-email-sent", "Settings after asking to change the email")
    const confirmLink = emailedLink(newEmail)
    assert(new URL(confirmLink).pathname === "/confirm-email-change", "the confirm link went to the new address")

    // A browser with no session, as when the link opens on another device.
    const confirmPage = await (await browser.newContext({ viewport: WIDE })).newPage()
    await confirmPage.goto(confirmLink)
    await confirmPage.getByText("Email changed").waitFor()
    assert(await confirmPage.getByText("You were signed out on every device. Sign in with your new email.").isVisible(), "the confirm page says every device was signed out")
    await axe(confirmPage, "confirm email change")
    await bothWidths(confirmPage, "23-email-changed", "the confirm page")
    await confirmPage.goto(confirmLink)
    await confirmPage.getByText("This link is invalid or has expired").waitFor()
    assert(true, "the confirm link works once")
    await confirmPage.close()
    await page.reload()
    await page.getByRole("heading", { name: "Sign in" }).waitFor()
    assert(true, "confirming signed the browser that asked for the change out")
    await signIn(page, email)
    await page.getByText("Wrong username or password").waitFor()
    assert(true, "the old email no longer signs in")
    await signIn(page, newEmail)
    // The reload above left "come back to Settings" in the history state, so the sign-in lands there.
    await page.getByText(`Your email is ${newEmail}`).waitFor()
    assert(true, "the new email signs in, and Settings shows it")

    await page.getByRole("button", { name: "Delete account" }).click()
    const dialog = page.getByRole("dialog", { name: "Delete your account?" })
    await dialog.waitFor()
    await dialog.getByLabel("Password").fill("third-strong-password")
    await dialog.getByLabel("Your username").fill("someone-else")
    await dialog.getByRole("button", { name: "Delete account" }).click()
    await dialog.getByText(`Type ${name} to confirm`).waitFor()
    assert(true, "a username that doesn't match is caught in the delete dialog")
    await axe(page, "delete account dialog")
    await bothWidths(page, "24-delete-account-dialog", "the delete dialog")
    await dialog.getByLabel("Your username").fill(name)
    await dialog.getByRole("button", { name: "Delete account" }).click()
    await page.getByText("Your account was deleted").waitFor()
    assert(await page.getByRole("heading", { name: "Sign in" }).isVisible(), "deleting lands on the sign-in page with a message")
    await axe(page, "sign-in after delete")
    await bothWidths(page, "25-account-deleted", "the sign-in page after a delete")
    for (const login of [name, newEmail]) {
        await signIn(page, login)
        await page.getByText("Wrong username or password").waitFor()
    }
    assert(true, "the deleted account's username and email no longer sign in")
    await driveErrors(browser)
    await driveBilling(browser)
    await browser.close()
    console.log("ALL OK")
})().catch(e => { console.error(e.message); process.exit(1) })
