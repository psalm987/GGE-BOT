// End-to-end check of the built extension (run `pnpm e2e`, which builds with --test first).
// A fake game speaks the real framing from inside a cross-origin iframe. Playwright loads dist/ into
// Chromium, records through the popup, exports, and asserts on the zip. Evidence goes to .verify-evidence/.
import { unzipSync } from "fflate"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocketServer } from "ws"

const require = createRequire(import.meta.url)
const { chromium } = require(join(process.env.PW_DIR ?? join(homedir(), ".cache/gge-bot-verify/pw"), "node_modules/playwright"))

const here = new URL("..", import.meta.url).pathname
const dist = join(here, "dist")
const evidence = join(here, ".verify-evidence")
rmSync(evidence, { recursive: true, force: true })
mkdirSync(evidence, { recursive: true })

const PASSWORD = "hunter2"
const EMAIL = "a@b.com"
const CHAT = "psst secret chat"
const COLOURS = [[200, 30, 30], [30, 160, 60], [40, 70, 210], [230, 200, 40], [150, 40, 170], [30, 30, 30]]
const CANVAS = { left: 20, top: 60, w: 400, h: 300 }

let passed = 0
const check = (ok, label) => {
  assert.ok(ok, label)
  passed++
  console.log(`ok ${passed} - ${label}`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ---- The fake game

const GAME_HTML = `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:14px sans-serif}canvas{display:block}</style>
<canvas id="game" width="${CANVAS.w}" height="${CANVAS.h}" tabindex="0"></canvas>
<input id="chat" placeholder="chat">
<script>
const colours = ${JSON.stringify(COLOURS)}
const canvas = document.getElementById("game"), ctx = canvas.getContext("2d")
let clicks = 0
const paint = () => { ctx.fillStyle = "rgb(" + colours[clicks % colours.length] + ")"; ctx.fillRect(0, 0, canvas.width, canvas.height) }
paint()
let ws
const xt = (cmd, payload) => ws.send("%xt%EmpireEx_9%" + cmd + "%1%" + JSON.stringify(payload) + "%")
// The real client downloads its bundle before it connects. A socket opened in the first milliseconds of a new
// iframe can beat the recorder's Network.enable to that iframe, and then its url is never reported.
setTimeout(() => {
  ws = new WebSocket("ws://" + location.host + "/game")
  ws.binaryType = "arraybuffer"
  ws.onopen = () => ws.send("<msg t='sys'><body action='verChk' r='0'><ver v='166' /></body></msg>")
  ws.onmessage = ({ data: bytes }) => {
    const data = new TextDecoder().decode(bytes)
    if (data.includes("apiOK")) ws.send("<msg t='sys'><body action='login' r='0'><login z='EmpireEx_9'><nick><![CDATA[]]></nick><pword><![CDATA[1234.5%en%0]]></pword></login></body></msg>")
    else if (data.includes("joinOK")) xt("lli", { CONM: 175, NOM: "TesterName", PW: "${PASSWORD}", AID: "aid-1", DID: "did-1", KID: "kid-1", LANG: "en" })
    else if (data.startsWith("%xt%lli%")) xt("ech", { note: "my pw is ${PASSWORD} ok" })
    else if (data.startsWith("%xt%ech%")) window.ready = true
  }
}, 300)
canvas.addEventListener("click", () => { clicks++; paint(); xt("sbp", { PID: 32 }) })
// Like the real client, the game runs a dedicated worker from the start and can start more later.
const echoWorker = () => new Worker(URL.createObjectURL(new Blob(["onmessage = e => postMessage(e.data * 2)"], { type: "text/javascript" })))
const asked = worker => new Promise(resolve => { worker.onmessage = e => resolve(e.data); worker.postMessage(21) })
const firstWorker = echoWorker()
window.askNewWorker = () => Promise.race([asked(echoWorker()), new Promise(resolve => setTimeout(() => resolve("no reply"), 5000))])
</script>`

const PARENT_HTML = gameOrigin => `<!doctype html><meta charset="utf-8"><title>Fake Game</title>
<style>body{margin:0;background:#eee}iframe{position:absolute;left:${CANVAS.left}px;top:${CANVAS.top}px;width:600px;height:400px;border:0;background:#fff}</style>
<p style="margin:16px 20px">Fake game portal (the game runs in a cross-origin iframe)</p>
<iframe src="${gameOrigin}/game.html"></iframe>`

const listen = (server, host) => new Promise(resolve => server.listen(0, host, () => resolve(server.address().port)))
const html = body => (_req, res) => res.writeHead(200, { "content-type": "text/html" }).end(body)

const gameServer = createServer(html(GAME_HTML))
const sockets = new WebSocketServer({ server: gameServer })
sockets.on("connection", socket => {
  // Like the real game server, every reply is UTF-8 text in a binary frame, ended by a NUL.
  const ws = { send: text => socket.send(Buffer.from(text + "\0")) }
  socket.on("message", data => {
    const frame = data.toString()
    if (frame.includes("verChk")) ws.send("<msg t='sys'><body action='apiOK' r='0'></body></msg>")
    else if (frame.includes("action='login'")) ws.send("<msg t='sys'><body action='joinOK' r='1'><pid id='0'/></body></msg>")
    else if (frame.includes("%lli%")) {
      ws.send(`%xt%gpi%1%0%{"UID":424242,"PID":777,"E":"${EMAIL}","PN":"Tester"}%`)
      ws.send(`%xt%gcu%1%0%{}%`)
      ws.send(`%xt%acm%1%0%{"M":"${CHAT}","PN":"Bob"}%`)
      ws.send(`%xt%lli%1%0%{}%`)
    } else if (frame.includes("%ech%")) ws.send(`%xt%ech%1%0%{"said":"you said ${PASSWORD}, mail ${EMAIL}"}%`)
    else if (frame.includes("%sbp%")) setTimeout(() => ws.send(`%xt%sbp%1%0%{"gcu":{"C1":5}}%`), 40)
  })
})
const gamePort = await listen(gameServer, "127.0.0.1")
const parentServer = createServer(html(PARENT_HTML(`http://127.0.0.1:${gamePort}`)))
const parentPort = await listen(parentServer, "127.0.0.1")
const gameUrl = `http://localhost:${parentPort}/`

// ---- The browser

const profile = mkdtempSync(join(tmpdir(), "gge-recorder-e2e-"))
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: process.env.HEADED ? false : true,
  // No emulated viewport: the screencast shows the real window, so the window is the viewport.
  viewport: null,
  acceptDownloads: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--window-size=1200,800"],
})
const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker")
const extensionId = new URL(worker.url()).host
const version = JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version

const game = context.pages()[0] ?? await context.newPage()
const loadGame = async () => {
  const frame = game.frames().find(f => f.url().includes("/game.html")) ?? await game.waitForEvent("frameattached").then(() => game.frames().at(-1))
  await frame.waitForFunction(() => window.ready === true)
  return frame
}
await game.goto(gameUrl)
let gameFrame = await loadGame()
check(new URL(gameFrame.url()).hostname !== new URL(game.url()).hostname, "the fake game runs in a cross-origin iframe")
const tabId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0].id, "http://localhost/*")

// A locator click waits until the canvas really is the hit target. Right after a tab switch or a reload,
// a raw mouse click at the same point can land on the parent page instead of the iframe.
const clickCanvas = async () => {
  await game.bringToFront()
  await gameFrame.locator("#game").click({ position: { x: CANVAS.w / 2, y: CANVAS.h / 2 } })
}
const openPopup = async () => {
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.waitForFunction(() => document.getElementById("version").textContent !== "")
  return popup
}
const control = (popup, msg) => popup.evaluate(m => chrome.runtime.sendMessage(m), msg)
const exportSession = async (popup, id) => {
  const [download] = await Promise.all([popup.waitForEvent("download"), popup.click(`li[data-id="${id}"] [data-do="export"]`)])
  const path = join(evidence, download.suggestedFilename())
  await download.saveAs(path)
  const zip = unzipSync(new Uint8Array(readFileSync(path)))
  const text = name => new TextDecoder().decode(zip[name])
  return {
    path,
    zip,
    name: download.suggestedFilename(),
    session: JSON.parse(text("session.json")),
    events: text("events.jsonl").split("\n").filter(Boolean).map(line => JSON.parse(line)),
  }
}
const liveSession = async popup => (await control(popup, { type: "status" })).sessions.find(s => s.live)

// ---- Run 1: does a websocket opened before the debugger attached get reported?

let popup = await openPopup()
check(await popup.textContent("#version") === `v${version}`, `the popup shows version v${version}`)
check(await popup.isDisabled("#record"), "Record is disabled on a tab that is not a game tab")
await popup.screenshot({ path: join(evidence, "01-popup-idle.png") })

await control(popup, { type: "start", tabId })
await popup.waitForSelector("#stop:visible")
const probeId = (await liveSession(popup)).id
await clickCanvas()
await sleep(1500)
await popup.bringToFront()
await sleep(600)
const hintWithoutReload = await popup.isVisible("#hint")
check(hintWithoutReload, "the popup suggests a reload when it has recorded traffic but no login")
await popup.screenshot({ path: join(evidence, "02-popup-recording-preattached-socket.png") })
await popup.click("#stop")
await popup.waitForSelector("#record:visible")
const probe = await exportSession(popup, probeId)
const preAttach = {
  framesReported: probe.events.some(e => e.k === "tx" || e.k === "rx"),
  txSbp: probe.events.some(e => e.k === "tx" && e.cmd === "sbp"),
  rxSbp: probe.events.some(e => e.k === "rx" && e.cmd === "sbp"),
  openNote: probe.events.find(e => e.k === "life" && e.what === "open")?.note,
  host: probe.session.game.host,
  zone: probe.session.game.zone,
  clientBuild: probe.session.game.clientBuild,
  reloadHintShown: hintWithoutReload,
  inputs: probe.events.filter(e => e.k === "in").length,
}
console.log("pre-attach socket probe:", JSON.stringify(preAttach))
check(preAttach.inputs >= 2, "input is captured on a tab that was open before recording started")

// ---- Run 2: the full flow, as a tester would do it

await control(popup, { type: "start", tabId })
await popup.waitForSelector("#stop:visible")
const mainId = (await liveSession(popup)).id
check((await popup.textContent("#tab")).includes("Fake Game"), "the popup names the recorded tab")
check(await popup.isVisible("#hint"), "the popup suggests a reload while it has seen no login")
await popup.screenshot({ path: join(evidence, "03-popup-reload-hint.png") })
await Promise.all([game.waitForEvent("load"), popup.click("#reload")])
gameFrame = await loadGame()
await popup.waitForSelector("#hint", { state: "hidden" })
check(true, "the Reload button reloads the game tab and the hint goes away once the login is seen")
check(!game.isClosed() && await game.evaluate(() => document.title) === "Fake Game", "the game tab survives a reload while recording, with its worker restarted")
check(await gameFrame.evaluate(() => window.askNewWorker()) === 42, "a worker the game starts while recording still runs and answers")

for (let i = 0; i < 3; i++) {
  await clickCanvas()
  await sleep(1300)
}
await game.keyboard.press("m")
await game.keyboard.press("Escape")
await gameFrame.click("#chat")
await game.keyboard.type("pw9")
await sleep(900)
await game.screenshot({ path: join(evidence, "04-game-after-three-clicks.png") })

await popup.bringToFront()
await popup.fill("#note", "start: buy 10 rams")
await popup.screenshot({ path: join(evidence, "05-popup-recording-with-marker.png") })
// The popup closes itself on submit, which can cut the key press short.
await Promise.all([popup.waitForEvent("close"), popup.press("#note", "Enter").catch(() => {})])
check(true, "submitting a marker closes the popup")

popup = await openPopup()
const focusedOnOpen = await popup.evaluate(() => document.activeElement?.id)
check(focusedOnOpen === "note", "the popup opens with the marker input focused while recording")
const beforePause = (await liveSession(popup)).stats
check(beforePause.events > 20 && beforePause.shots >= 4 && beforePause.bytes > 10_000, `live counters count up (${JSON.stringify(beforePause)})`)
await popup.click("#pause")
await popup.waitForSelector("#resume:visible")
await popup.screenshot({ path: join(evidence, "06-popup-paused.png") })
const pausedFrom = Date.now()
await clickCanvas()
await sleep(1200)
const pausedTo = Date.now()
await popup.bringToFront()
check((await liveSession(popup)).stats.events === beforePause.events + 1, "while paused the counters stay still (only the pause event was added)")
await popup.click("#resume")
await popup.waitForSelector("#pause:visible")
await clickCanvas()
await sleep(1300)
await popup.bringToFront()
await popup.click("#stop")
await popup.waitForSelector("#record:visible")
await popup.screenshot({ path: join(evidence, "07-popup-stopped-two-recordings.png") })

const { zip, session, events, name, path: zipPath } = await exportSession(popup, mainId)
writeFileSync(join(evidence, "events.jsonl"), events.map(e => JSON.stringify(e)).join("\n") + "\n")
writeFileSync(join(evidence, "session.json"), JSON.stringify(session, null, 2))

// ---- Assertions on the exported zip

check(name === `gge-trace-${mainId}.zip`, `the download is named ${name}`)
const names = Object.keys(zip)
check(names.every(n => n === "session.json" || n === "events.jsonl" || /^shots\/\d+\.jpg$/.test(n)), "the zip holds only session.json, events.jsonl and shots/<id>.jpg")
check(session.schema === 1 && session.id === mainId && session.extVersion === version, "session.json carries schema, id and the extension version")
check(session.game.host === `127.0.0.1:${gamePort}`, `session.game.host is the websocket host (${session.game.host})`)
check(session.game.zone === "EmpireEx_9", "session.game.zone is EmpireEx_9")
check(session.game.clientBuild === "1234.5", "session.game.clientBuild is 1234.5")
const view = await game.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }))
check(session.viewport.w === view.w && session.viewport.h === view.h && session.dpr === view.dpr && /Chrome/.test(session.browser), `session.json carries the page's viewport, dpr and the browser (${JSON.stringify(session.viewport)}, dpr ${session.dpr})`)
check(Math.abs(session.startedAt - Date.now()) < 120_000, "session.startedAt is epoch milliseconds")

check(events.every((e, i) => i === 0 || events[i - 1].t <= e.t), `events.jsonl is sorted by t (${events.length} events)`)
check(events.every(e => Math.abs(e.t - Date.now()) < 120_000), "every event time is epoch milliseconds on one clock")
const of = (k, extra = () => true) => events.filter(e => e.k === k && extra(e))
const kinds = new Set(events.map(e => e.k))
check(["in", "tx", "rx", "sys", "shot", "life"].every(k => kinds.has(k)), "in, tx, rx, sys, shot and life events are all present")

const sys = of("sys").map(e => `${e.dir}:${/action='(\w+)'/.exec(e.raw)?.[1]}`)
check(["tx:verChk", "rx:apiOK", "tx:login", "rx:joinOK"].every(s => sys.includes(s)), `the XML handshake is recorded as sys frames (${sys.join(", ")})`)
const opened = of("life", e => e.what === "open")
check(opened.length === 1 && opened[0].sock && !opened[0].note && opened[0].t <= of("sys")[0].t, "the socket inside the iframe gets a life: open before its first frame")
check(of("life", e => e.what === "close").length === 0, "the socket stays open until the end, so there is no life: close")

const downs = of("in", e => e.type === "down" && e.w === CANVAS.w && e.h === CANVAS.h)
check(downs.length === 4, `four canvas clicks are recorded outside the pause (${downs.length})`)
check(downs.every(e => e.x === CANVAS.w / 2 && e.y === CANVAS.h / 2 && e.btn === 0), "click coordinates are relative to the canvas, with the canvas size")
check(of("in", e => e.type === "up").length >= downs.length, "pointer up events are recorded")
const sbpTx = of("tx", e => e.cmd === "sbp")
const sbpRx = of("rx", e => e.cmd === "sbp")
check(sbpTx.length === 4 && sbpRx.length === 4, "each click has its sbp request and reply")
check(sbpTx.every(e => e.raw === `%xt%EmpireEx_9%sbp%1%{"PID":32}%` && e.payload.PID === 32 && e.sock === opened[0].sock), "tx sbp keeps the wire frame, the parsed payload and the socket id")
check(sbpRx.every(e => e.res === 0 && e.payload.gcu.C1 === 5 && e.raw === `%xt%sbp%1%0%{"gcu":{"C1":5}}%`), "rx sbp keeps the result code, the payload and the wire frame")
downs.forEach((down, i) => {
  const lag = sbpTx[i].t - down.t
  const reply = sbpRx[i].t - sbpTx[i].t
  check(lag >= 0 && lag < 1500 && reply > 0 && reply < 1500, `click ${i + 1}: tx sbp ${lag.toFixed(1)} ms after the input, rx sbp ${reply.toFixed(1)} ms after that`)
})
check(of("rx", e => e.cmd === "gcu").length === 1, "the unsolicited gcu push is recorded")

const keys = of("in", e => e.type === "key").map(e => e.key)
check(keys.join() === "<char>,Escape,<text>,<text>,<text>", `a printable key is never recorded by value, a named key keeps its name (${keys.join()})`)

const marks = of("life", e => e.what === "mark")
check(marks.length === 1 && marks[0].note === "start: buy 10 rams", "the marker is a life: mark with its note")
check(of("shot", e => e.why === "mark" && Math.abs(e.t - marks[0].t) < 5).length === 1, "the marker has a mark shot")

const pause = of("life", e => e.what === "pause")[0]
const resume = of("life", e => e.what === "resume")[0]
check(pause && resume && pause.t < pausedFrom + 50 && resume.t > pausedTo - 50, "pause and resume are life events")
check(events.filter(e => e.t > pause.t && e.t < resume.t).length === 0, "nothing is recorded between pause and resume")

const shots = of("shot")
check(shots.every(e => zip[e.file] && e.file === `shots/${e.id}.jpg`), "every shot event points at a file in the zip")
check(names.filter(n => n.startsWith("shots/")).every(n => zip[n][0] === 0xff && zip[n][1] === 0xd8 && zip[n].at(-2) === 0xff && zip[n].at(-1) === 0xd9), "every shot file is a JPEG")
const steps = downs.map((down, i) => ({
  down,
  pre: shots.find(e => e.why === "pre" && e.t <= down.t && down.t - e.t <= 100),
  post: shots.find(e => e.why === "post" && e.t > down.t && e.t < (downs[i + 1]?.t ?? Infinity)),
}))
check(steps.every(s => s.pre && s.post), "every click has a pre shot at or just before it and a post shot before the next click")
check(steps.every(s => s.post.t - s.down.t <= 2050), `post shots come within the 2 s cap (${steps.map(s => Math.round(s.post.t - s.down.t)).join(", ")} ms)`)

const viewer = await context.newPage()
const colourAt = (file, x, y) => viewer.evaluate(async ({ b64, x, y }) => {
  const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob())
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext("2d")
  ctx.drawImage(bitmap, 0, 0)
  return { rgb: Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3)), width: bitmap.width, height: bitmap.height }
}, { b64: Buffer.from(zip[file]).toString("base64"), x, y })
const nearest = rgb => COLOURS.map((c, i) => [Math.hypot(...c.map((v, j) => v - rgb[j])), i]).sort((a, b) => a[0] - b[0])[0][1]
const seen = []
const scale = 960 / view.w
const centre = [Math.round((CANVAS.left + CANVAS.w / 2) * scale), Math.round((CANVAS.top + CANVAS.h / 2) * scale)]
check(view.w > 960, `the window is wider than the 960 px shot limit (${view.w} px)`)
for (const step of steps) {
  const pre = await colourAt(step.pre.file, ...centre)
  const post = await colourAt(step.post.file, ...centre)
  seen.push([nearest(pre.rgb), nearest(post.rgb)])
  check(pre.width === 960 && post.width === 960, `shots are scaled down to 960 px wide (${pre.width}x${pre.height}, ${post.width}x${post.height})`)
}
// The paused click also changed the canvas, so the click after the pause goes from colour 4 to 5.
check(JSON.stringify(seen) === JSON.stringify([[0, 1], [1, 2], [2, 3], [4, 5]]), `each pre shot shows the canvas before the click and each post shot after it (${JSON.stringify(seen)})`)
await viewer.close()
for (const [i, step] of steps.entries()) {
  writeFileSync(join(evidence, `shot-click${i + 1}-pre.jpg`), zip[step.pre.file])
  writeFileSync(join(evidence, `shot-click${i + 1}-post.jpg`), zip[step.post.file])
}

const everything = Buffer.concat(Object.values(zip).map(bytes => Buffer.from(bytes))).toString("latin1")
for (const [label, secret] of [["password", PASSWORD], ["email", EMAIL], ["chat text", CHAT], ["login name", "TesterName"], ["account id", "aid-1"], ["player UID", "424242"]])
  check(!everything.includes(secret), `the ${label} "${secret}" appears nowhere in the zip`)
const lli = of("tx", e => e.cmd === "lli")[0]
check(lli.payload.PW === "<redacted>" && lli.payload.NOM === "<redacted>" && lli.payload.CONM === 175 && lli.raw === `%xt%EmpireEx_9%lli%1%${JSON.stringify(lli.payload)}%`, "tx lli is stored with its secrets masked and raw rebuilt from that payload")
const ech = [of("tx", e => e.cmd === "ech")[0], of("rx", e => e.cmd === "ech")[0]]
check(ech[0].payload.note === "my pw is <redacted> ok" && ech[1].payload.said === "you said <redacted>, mail <email>", "the password and an email are scrubbed from later frames in both directions")
const gpi = of("rx", e => e.cmd === "gpi")[0]
check(gpi.payload.E === "<redacted>" && /^#[0-9a-f]{16}$/.test(gpi.payload.UID) && /^#[0-9a-f]{16}$/.test(gpi.payload.PID) && gpi.payload.PN === "Tester", "rx gpi has no email and hashed UID and PID")
const acm = of("rx", e => e.cmd === "acm")[0]
check(acm.payload.dropped === "chat" && acm.payload.length > 0 && Object.keys(acm.payload).length === 2, `the acm chat payload is dropped, length kept (${JSON.stringify(acm.payload)})`)

// ---- Delete, with its confirm step

const deleteButton = `li[data-id="${probeId}"] [data-do="delete"]`
await popup.click(deleteButton)
check(await popup.textContent(deleteButton) === "Really delete?" && await popup.locator("#sessions li").count() === 2, "Delete asks for confirmation first")
await popup.click(deleteButton)
await popup.waitForFunction(() => document.querySelectorAll("#sessions li").length === 1)
const left = await popup.evaluate(() => new Promise(resolve => {
  const open = indexedDB.open("gge-recorder")
  open.onsuccess = () => {
    const tx = open.result.transaction(["sessions", "events", "shots"])
    const rows = name => new Promise(done => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => done(r.result) })
    Promise.all(["sessions", "events", "shots"].map(rows)).then(resolve)
  }
}).then(([sessions, events, shots]) => ({ sessions: sessions.map(s => s.id), eventSids: [...new Set(events.map(e => e.sid))], shotSids: [...new Set(shots.map(s => s.sid))] })))
check(left.sessions.join() === mainId && left.eventSids.join() === mainId && left.shotSids.join() === mainId, "confirming removes that session's rows and leaves the other recording")
await popup.screenshot({ path: join(evidence, "08-popup-after-delete.png") })

// ---- Run 3: the real toolbar popup, then a service worker restart in the middle of a recording

await game.bringToFront()
const browser = await context.newCDPSession(game)
const findTarget = async match => (await browser.send("Target.getTargets")).targetInfos.find(match)
check(await worker.evaluate(() => chrome.action.openPopup().then(() => true)), "the toolbar popup opens over the game tab")
let toolbarPopup
for (let i = 0; i < 50 && !toolbarPopup; i++, await sleep(100)) toolbarPopup = await findTarget(t => t.url.endsWith("/popup.html") && !t.attached)
// Playwright does not expose the toolbar popup as a page, so it is driven over a raw DevTools session.
const { sessionId: popupSession } = await browser.send("Target.attachToTarget", { targetId: toolbarPopup.targetId, flatten: false })
let calls = 0
const inToolbarPopup = expression => new Promise(resolve => {
  const id = ++calls
  const onMessage = event => {
    const message = JSON.parse(event.message)
    if (message.id !== id) return
    browser.off("Target.receivedMessageFromTarget", onMessage)
    resolve(message.result?.result?.value)
  }
  browser.on("Target.receivedMessageFromTarget", onMessage)
  browser.send("Target.sendMessageToTarget", { sessionId: popupSession, message: JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }) })
})
const popupState = `({ phase: document.body.dataset.phase, tab: document.getElementById("tab").textContent, recordDisabled: document.getElementById("record").disabled, focus: document.activeElement.id })`
const before = await inToolbarPopup(popupState)
check(before.phase === "idle" && before.recordDisabled === false, "in the toolbar popup, Record this tab is enabled on the game tab")
const after = await inToolbarPopup(`document.getElementById("record").click(); new Promise(done => setTimeout(() => done(${popupState}), 1500))`)
check(after.phase === "recording" && after.tab === "Fake Game", `Record this tab starts recording the active tab (${JSON.stringify(after)})`)
check(after.focus === "note", "the marker input takes focus when recording starts")

await clickCanvas()
await sleep(1300)
const extensionPage = await openPopup()
const extensionSession = await context.newCDPSession(extensionPage)
await extensionSession.send("ServiceWorker.enable")
await extensionSession.send("ServiceWorker.stopAllWorkers")
await extensionPage.close()
await sleep(500)
await clickCanvas()
await sleep(1500)
popup = await openPopup()
const resumed = await control(popup, { type: "status" })
const resumedLive = resumed.sessions.find(s => s.live)
check(resumed.phase === "recording" && resumedLive, "after the restart the recorder is still recording the same session")
await popup.click("#stop")
await popup.waitForSelector("#record:visible")
const restart = await exportSession(popup, resumedLive.id)
const restartMark = restart.events.find(e => e.k === "life" && e.what === "resume")
// Only a worker that boots with a recording in progress writes this event.
check(restartMark?.note === "service worker restarted", "the service worker was stopped mid-recording, and its restart is logged as life: resume")
const around = cmd => [restart.events.filter(e => e.cmd === cmd && e.t < restartMark.t).length, restart.events.filter(e => e.cmd === cmd && e.t > restartMark.t).length]
check(around("sbp").join() === "2,2", `traffic from before the restart is kept and traffic after it is recorded (${around("sbp")} sbp frames)`)
check(restart.events.filter(e => e.k === "in" && e.type === "down").length === 2 && restart.events.filter(e => e.why === "post").length === 2, "input and screenshots carry on after the restart")
const finalStats = (await control(popup, { type: "status" })).sessions.find(s => s.id === resumedLive.id).stats
check(finalStats.events === restart.events.length && finalStats.shots === Object.keys(restart.zip).filter(n => n.startsWith("shots/")).length, `the counters were rebuilt from storage (${JSON.stringify(finalStats)})`)

writeFileSync(join(evidence, "result.json"), JSON.stringify({ passed, preAttach, zip: zipPath, counts: Object.fromEntries([...kinds].map(k => [k, of(k).length])), shots: names.filter(n => n.startsWith("shots/")).length }, null, 2))
console.log(`\n${passed} checks passed. Evidence in ${evidence}`)

await context.close()
gameServer.closeAllConnections()
gameServer.close()
parentServer.close()
rmSync(profile, { recursive: true, force: true })
