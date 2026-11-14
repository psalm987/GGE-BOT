#!/usr/bin/env node
// Drive the GGE-BOT web UI of an instance started by `gge-verify up NAME` with Playwright.
// Usage: drive.js NAME STEP [STEP...] [--label L] [--headed]
//                 [--game-name N --game-pass P --server ID] [--live]
// Steps run in order in one browser context. See SKILL.md for the step list.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const HOME_DIR = process.env.GGE_VERIFY_HOME ?? path.join(process.env.HOME, '.cache/gge-bot-verify')
const { chromium } = require(path.join(HOME_DIR, 'pw/node_modules/playwright'))
const REPO = path.resolve(__dirname, '../../../..')
const CLI = path.join(__dirname, 'gge-verify')

const args = process.argv.slice(2)
const flags = {}
const positional = []
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith('--')) { positional.push(args[i]); continue }
  const key = args[i].slice(2)
  if (['headed', 'live'].includes(key)) flags[key] = true
  else flags[key] = args[++i]
}
const [name, ...steps] = positional
if (!name || steps.length === 0) {
  console.error(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 5).join('\n'))
  process.exit(2)
}
const instDir = path.join(HOME_DIR, 'instances', name)
const port = fs.readFileSync(path.join(instDir, 'port'), 'utf8').trim()
const BASE = `http://127.0.0.1:${port}`

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const EVIDENCE = path.join(REPO, '.verify-evidence', `${stamp}-${flags.label ?? steps.join('+')}`)
fs.mkdirSync(EVIDENCE, { recursive: true })

const run = stamp.slice(11, 19).replace(/-/g, '')
const webUser = { username: `verify-${run}`, password: `pw-${run}` }
const game = {
  name: flags['game-name'] ?? `dummy-${run}`,
  pass: flags['game-pass'] ?? 'not-a-real-password',
  server: flags.server,
}

let shot = 0
const transcript = []
const log = (...m) => { const line = m.join(' '); transcript.push(line); console.log(line) }
const snap = async (page, label) => {
  const file = `${String(++shot).padStart(2, '0')}-${label}.png`
  await page.screenshot({ path: path.join(EVIDENCE, file), fullPage: true })
  log(`  screenshot ${file}`)
}
const dumpDb = label => {
  const file = path.join(EVIDENCE, `db-${label}.json`)
  execFileSync(CLI, ['db', name, file])
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
const expect = (cond, msg) => { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); log(`  ok: ${msg}`) }
const myAccounts = db => db.SubUsers.filter(r => r.uuid === state.uuid)
const accountRow = page => page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: game.name, exact: true }) })

const state = { uuid: undefined }

async function signedIn(page) {
  if (state.uuid) return
  await STEPS.signup(page)
}

async function openUsersTable(page) {
  if (!page.url().endsWith('/index.html')) await page.goto(`${BASE}/index.html`)
  await page.getByRole('columnheader', { name: 'Name' }).waitFor({ timeout: 30000 })
}

const STEPS = {
  async signup(page) {
    await page.goto(`${BASE}/signup.html`)
    await page.locator('#username').fill(webUser.username)
    await page.locator('#password').fill(webUser.password)
    await page.locator('#token').fill('verify')
    await snap(page, 'signup-filled')
    await page.getByRole('button', { name: 'Signup' }).click()
    await page.waitForURL('**/index.html')
    await openUsersTable(page)
    state.uuid = (await page.context().cookies()).find(c => c.name === 'uuid')?.value
    await snap(page, 'signup-landed')
    const db = dumpDb('after-signup')
    expect(db.Users.some(u => u.username === webUser.username && u.uuid === state.uuid),
      `Users row for ${webUser.username} matches uuid cookie`)
  },

  async signin(page) {
    await signedIn(page)
    await page.context().clearCookies()
    await page.goto(`${BASE}/index.html`)
    await page.waitForURL('**/signin.html')
    log('  ok: logged-out visit to /index.html redirects to /signin.html')
    await page.locator('#email_name').fill(webUser.username)
    await page.locator('#password').fill('wrong-password')
    await page.getByRole('button', { name: 'Login' }).click()
    await page.locator('#login-info-banner', { hasText: 'Invalid login details.' }).waitFor()
    await snap(page, 'signin-rejected')
    await page.locator('#password').fill(webUser.password)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL('**/index.html')
    await openUsersTable(page)
    const uuid = (await page.context().cookies()).find(c => c.name === 'uuid')?.value
    expect(uuid === state.uuid, 'login sets the same uuid cookie as signup')
    await snap(page, 'signin-landed')
  },

  async 'add-account'(page) {
    await signedIn(page)
    await openUsersTable(page)
    await page.getByRole('button', { name: '+', exact: true }).click()
    await page.getByLabel('Username').fill(game.name)
    await page.getByLabel('Password').fill(game.pass)
    if (game.server) {
      await page.locator('#simple-select').click()
      await page.locator(`li[data-value="${game.server}"]`).click()
    }
    await snap(page, 'add-account-filled')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.getByRole('table', { name: 'plugins table' }).waitFor({ state: 'hidden' })
    await accountRow(page).waitFor({ timeout: 10000 })
    await snap(page, 'add-account-row')
    const rows = myAccounts(dumpDb('after-add-account')).filter(r => r.name === game.name)
    expect(rows.length === 1, `one SubUsers row named ${game.name}`)
    expect(rows[0].state === 0, 'new account is stored stopped (state 0)')
  },

  async 'edit-plugins'(page) {
    await signedIn(page)
    if (!(await accountRow(page).count())) await STEPS['add-account'](page)
    const before = myAccounts(dumpDb('before-edit-plugins')).find(r => r.name === game.name)
    await accountRow(page).getByRole('button', { name: 'Settings' }).click()
    const pluginsTable = page.getByRole('table', { name: 'plugins table' })
    await pluginsTable.waitFor()
    // First plugin row that has an enabled Start button (forced plugins render a disabled button).
    const firstStartable = pluginsTable.getByRole('row').filter({ has: page.getByRole('button', { name: 'Start', exact: true }) }).first()
    const pluginLabel = (await firstStartable.getByRole('cell').first().innerText()).trim()
    // Re-anchor on the name: the "has Start" filter stops matching this row once it flips to Stop.
    const pluginRow = pluginsTable.getByRole('row').filter({ has: page.getByRole('cell', { name: pluginLabel, exact: true }) })
    await pluginRow.getByRole('cell').first().click()
    await snap(page, 'edit-plugins-options')
    await pluginRow.getByRole('button', { name: 'Start', exact: true }).click()
    await expectVisible(pluginRow.getByRole('button', { name: 'Stop', exact: true }), `plugin "${pluginLabel}" toggled to Stop in the form`)
    await snap(page, 'edit-plugins-toggled')
    await page.getByRole('button', { name: 'Save' }).click()
    await pluginsTable.waitFor({ state: 'hidden' })
    const after = myAccounts(dumpDb('after-edit-plugins')).find(r => r.name === game.name)
    const newlyOn = Object.keys(after.plugins).filter(k => after.plugins[k]?.state && !before.plugins[k]?.state)
    expect(newlyOn.length === 1, `exactly one plugin newly enabled in SubUsers.plugins (${newlyOn.join(',')}; UI label "${pluginLabel}")`)
    expect(after.state === 0, 'account still stopped after saving settings (no bot spawned)')
    await expectVisible(accountRow(page).getByRole('cell').filter({ hasText: pluginLabel }), 'users table Plugins column lists the enabled plugin')
    await snap(page, 'edit-plugins-saved')
  },

  async 'remove-account'(page) {
    await signedIn(page)
    if (!(await accountRow(page).count())) await STEPS['add-account'](page)
    await accountRow(page).getByRole('checkbox').check()
    await snap(page, 'remove-account-selected')
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await accountRow(page).waitFor({ state: 'detached', timeout: 10000 })
    await snap(page, 'remove-account-gone')
    expect(myAccounts(dumpDb('after-remove-account')).every(r => r.name !== game.name), `SubUsers row ${game.name} deleted`)
  },

  // Logs into the LIVE Goodgame Empire servers with a real game account. Needs --live.
  async 'start-bot'(page) {
    if (!flags.live) throw new Error('start-bot connects to live game servers; rerun with --live and --game-name/--game-pass/--server')
    if (!flags['game-name'] || !flags['game-pass'] || !flags.server) throw new Error('start-bot needs --game-name, --game-pass and --server')
    await signedIn(page)
    if (!(await accountRow(page).count())) await STEPS['add-account'](page)
    await accountRow(page).getByRole('button', { name: 'Start', exact: true }).click()
    await expectVisible(accountRow(page).getByRole('button', { name: 'Stop', exact: true }), 'row button flips to Stop')
    expect(myAccounts(dumpDb('after-start')).find(r => r.name === game.name).state === 1, 'SubUsers.state = 1')
    await page.waitForTimeout(20000)
    await accountRow(page).getByRole('button', { name: 'Logs' }).click()
    await page.waitForTimeout(2000)
    await snap(page, 'start-bot-logs')
    await page.keyboard.press('Escape')
    await page.mouse.click(5, 5)
    await snap(page, 'start-bot-status')
    await accountRow(page).getByRole('button', { name: 'Stop', exact: true }).click()
    await page.waitForTimeout(1000)
    expect(myAccounts(dumpDb('after-stop')).find(r => r.name === game.name).state === 0, 'SubUsers.state back to 0 after Stop')
  },
}

async function expectVisible(locator, msg) {
  await locator.waitFor({ state: 'visible', timeout: 10000 })
  log(`  ok: ${msg}`)
}

;(async () => {
  for (const s of steps) if (!STEPS[s]) { console.error(`unknown step ${s}; known: ${Object.keys(STEPS).join(', ')}`); process.exit(2) }
  const browser = await chromium.launch({ headless: !flags.headed })
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await context.newPage()
  const frames = fs.createWriteStream(path.join(EVIDENCE, 'ws-frames.log'))
  const consoleLog = fs.createWriteStream(path.join(EVIDENCE, 'browser-console.log'))
  page.on('console', m => consoleLog.write(`[${m.type()}] ${m.text()}\n`))
  page.on('pageerror', e => consoleLog.write(`[pageerror] ${e.message}\n`))
  page.on('websocket', ws => {
    if (!ws.url().includes(`:${port}`)) return
    // GetUsers/SetUser frames carry game-account passwords in clear text; never write them to evidence.
    const redact = payload => String(payload).replace(/"pass":"(?:[^"\\]|\\.)*"/g, '"pass":"<redacted>"')
    ws.on('framesent', f => frames.write(`> ${redact(f.payload)}\n`))
    ws.on('framereceived', f => frames.write(`< ${redact(f.payload)}\n`))
  })
  let failed
  log(`instance ${name} at ${BASE}; web user ${webUser.username}; game account ${game.name}`)
  for (const s of steps) {
    log(`step ${s}`)
    try { await STEPS[s](page) }
    catch (e) { failed = e; log(`  FAILED: ${e.message.split('\n')[0]}`); await snap(page, `${s}-failure`).catch(() => {}); break }
  }
  await browser.close()
  frames.end(); consoleLog.end()
  fs.copyFileSync(path.join(instDir, 'server.log'), path.join(EVIDENCE, 'server.log'))
  log(failed ? 'RESULT: FAIL' : 'RESULT: PASS')
  log(`evidence: ${EVIDENCE}`)
  fs.writeFileSync(path.join(EVIDENCE, 'transcript.txt'), transcript.join('\n') + '\n')
  process.exit(failed ? 1 : 0)
})()
