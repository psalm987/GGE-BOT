import { createClock, type Clock } from "./clock.ts"
import * as db from "./db.ts"
import { SCHEMA, type LifeEvent, type TraceEvent } from "./format.ts"
import { IDLE, transition, type Action, type Active, type Rec } from "./lifecycle.ts"
import type { ControlMsg, FrameMsg, PageMsg, Status, Viewport } from "./messages.ts"
import { createRedactor, type Redactor } from "./redact.ts"
import { createShots, type Shots } from "./shots.ts"
import { frameText, learnGame, parseFrame, type Dir, type Frame } from "./wire.ts"

const STATE_KEY = "rec"
const ANCHORS = new Set(["down", "key", "wheel"])

/** Everything one recording needs in memory. It exists exactly while the lifecycle is not idle. */
interface Live {
  rec: Active
  stored: db.StoredSession
  redact: Redactor
  clock: Clock
  shots: Shots
  /** Websocket url by socket id. A socket opened before the debugger attached has none. */
  urls: Map<string, string>
  /** Socket ids that have a `life: open`. */
  open: Set<string>
}
let live: Live | undefined

const noop = () => {}
const state = (): Rec => live?.rec ?? IDLE

function record(l: Live, e: TraceEvent) {
  if (l.rec.phase !== "recording") return
  l.stored.stats.events++
  l.stored.stats.bytes += db.eventBytes(e)
  db.addEvent(l.stored.id, e).catch(console.error)
}

const life = (l: Live, what: LifeEvent["what"], t: number, extra: Pick<LifeEvent, "sock" | "note"> = {}) =>
  record(l, { t, k: "life", what, ...extra })

function makeLive(rec: Active, stored: db.StoredSession): Live {
  const l: Live = {
    rec,
    stored,
    redact: createRedactor(rec.salt),
    clock: createClock(),
    urls: new Map(),
    open: new Set(),
    shots: createShots({
      save(id, jpegBase64) {
        const blob = new Blob([Uint8Array.from(atob(jpegBase64), c => c.charCodeAt(0))], { type: "image/jpeg" })
        stored.stats.shots++
        stored.stats.bytes += blob.size
        db.addShot(stored.id, id, blob).catch(console.error)
      },
      emit: e => record(l, e),
    }),
  }
  return l
}

function learn(l: Live, frame: Frame, sock: string) {
  const game = l.stored.session.game
  const known = learnGame(game, frame, l.urls.get(sock))
  if (JSON.stringify(known) === JSON.stringify(game)) return
  l.stored.session.game = known
  db.saveSession(l.stored).catch(console.error)
}

// ---- Chrome DevTools Protocol. Read-only domains: the recorder never sends a frame, blocks a request or runs script in the page.

type Target = chrome.debugger.DebuggerSession
const cdp = (target: Target, method: string, params?: object) => chrome.debugger.sendCommand(target, method, params)

/**
 * Watches one target's websockets, and its child iframes, so a socket inside a cross-origin iframe is seen too.
 * Workers stay unattached: a worker started while chrome.debugger is auto-attached never runs, which hung the game's
 * login and crashed the tab on reload. The game's socket lives in its page, not in a worker.
 */
async function observe(target: Target) {
  await cdp(target, "Network.enable")
  await cdp(target, "Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: "iframe" }] })
}
const startScreencast = (tabId: number) => cdp({ tabId }, "Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 960 })
const stopScreencast = (tabId: number) => cdp({ tabId }, "Page.stopScreencast").catch(noop)

interface SocketFrame { requestId: string; timestamp: number; response: { opcode: number; payloadData: string } }
interface CdpEvents {
  "Network.webSocketCreated": { requestId: string; url: string }
  "Network.webSocketWillSendHandshakeRequest": { requestId: string; timestamp: number; wallTime: number }
  "Network.webSocketFrameSent": SocketFrame
  "Network.webSocketFrameReceived": SocketFrame
  "Network.webSocketClosed": { requestId: string; timestamp: number }
  "Page.screencastFrame": { data: string; metadata: { timestamp?: number } }
  "Target.attachedToTarget": { sessionId: string }
}

function openSocket(l: Live, sock: string, t: number) {
  if (l.open.has(sock)) return
  l.open.add(sock)
  life(l, "open", t, l.urls.has(sock) ? { sock } : { sock, note: "already open" })
}

async function socketFrame(l: Live, dir: Dir, { requestId: sock, timestamp, response }: SocketFrame) {
  const t = l.clock.toEpoch(timestamp, Date.now())
  const frame = parseFrame(dir, frameText(response))
  const redacted = await l.redact(frame)
  openSocket(l, sock, t)
  learn(l, frame, sock)
  record(l, { t, sock, ...redacted })
  l.shots.traffic(dir)
}

const onCdp: { [M in keyof CdpEvents]: (l: Live, params: CdpEvents[M], tabId: number) => void | Promise<void> } = {
  "Network.webSocketCreated": (l, { requestId, url }) => void l.urls.set(requestId, url),
  "Network.webSocketWillSendHandshakeRequest": (l, { requestId, timestamp, wallTime }) => {
    l.clock.calibrate(timestamp, wallTime)
    openSocket(l, requestId, wallTime * 1000)
  },
  "Network.webSocketFrameSent": (l, params) => socketFrame(l, "tx", params),
  "Network.webSocketFrameReceived": (l, params) => socketFrame(l, "rx", params),
  "Network.webSocketClosed": (l, { requestId, timestamp }) => {
    if (l.open.delete(requestId)) life(l, "close", l.clock.toEpoch(timestamp, Date.now()), { sock: requestId })
  },
  "Page.screencastFrame": (l, { data, metadata }) => {
    if (l.rec.phase === "recording") l.shots.frame(data, metadata.timestamp ? metadata.timestamp * 1000 : Date.now())
  },
  // Not every target type has every domain (a worker has no Target domain), and a short-lived one may be gone already.
  "Target.attachedToTarget": (_l, { sessionId }, tabId) => observe({ tabId, sessionId }).catch(noop),
}

// ---- Lifecycle effects

const tell = (tabId: number, on: boolean) =>
  chrome.tabs.sendMessage(tabId, { type: "rec", on } satisfies FrameMsg).catch(noop)

async function viewportOf(tab: chrome.tabs.Tab): Promise<Viewport> {
  const fallback = { w: tab.width ?? 0, h: tab.height ?? 0, dpr: 1 }
  const reply: Viewport | undefined = await chrome.tabs
    .sendMessage(tab.id!, { type: "viewport" } satisfies FrameMsg, { frameId: 0 })
    .catch(noop)
  return reply ?? fallback
}

function sessionId(at: Date) {
  const stamp = at.toISOString().replace(/[-:]|\.\d+Z/g, "").replace("T", "-")
  return `${stamp}-${crypto.randomUUID().slice(0, 6)}`
}

const effects = {
  async start(rec: Active) {
    const tab = await chrome.tabs.get(rec.tabId)
    await chrome.debugger.attach({ tabId: rec.tabId }, "1.3")
    // A tab that was open before the extension was installed has no content script yet.
    await chrome.scripting.executeScript({ target: { tabId: rec.tabId, allFrames: true }, files: ["content.js"] }).catch(noop)
    const { dpr, ...viewport } = await viewportOf(tab)
    const stored: db.StoredSession = {
      id: rec.sessionId,
      session: {
        schema: SCHEMA,
        id: rec.sessionId,
        startedAt: Date.now(),
        extVersion: chrome.runtime.getManifest().version,
        browser: navigator.userAgent,
        viewport,
        dpr,
        game: {},
      },
      stats: { events: 0, shots: 0, bytes: 0 },
    }
    await db.saveSession(stored)
    live = makeLive(rec, stored)
    await observe({ tabId: rec.tabId })
    await startScreencast(rec.tabId)
    await tell(rec.tabId, true)
  },
  async pause(next: Active) {
    const l = live!
    life(l, "pause", Date.now())
    l.rec = next
    l.shots.reset()
    await stopScreencast(l.rec.tabId)
    await tell(l.rec.tabId, false)
    await db.saveSession(l.stored)
  },
  async resume(next: Active) {
    const l = live!
    l.rec = next
    life(l, "resume", Date.now())
    await startScreencast(l.rec.tabId)
    await tell(l.rec.tabId, true)
  },
  async stop() {
    const l = live!
    live = undefined
    l.shots.reset()
    l.stored.endedAt = Date.now()
    await chrome.debugger.detach({ tabId: l.rec.tabId }).catch(noop)
    await tell(l.rec.tabId, false)
    await db.saveSession(l.stored)
  },
} satisfies Record<Action["type"], (next: never) => Promise<void>>

async function dispatch(action: Action) {
  const next = transition(state(), action)
  if (!next) return
  try {
    // transition() yields an Active state for every action except stop, whose effect takes no state.
    await (effects[action.type] as (next: Rec) => Promise<void>)(next)
  } catch (error) {
    if (action.type === "start") {
      live = undefined
      await chrome.debugger.detach({ tabId: action.tabId }).catch(noop)
    }
    throw error
  }
  await chrome.storage.session.set({ [STATE_KEY]: state() })
}

/** Runs when the service worker starts. A recording that was live when the worker died carries on. */
async function boot() {
  const saved = ((await chrome.storage.session.get(STATE_KEY))[STATE_KEY] as Rec | undefined) ?? IDLE
  const all = await db.sessions()
  const stored = saved.phase === "idle" ? undefined : all.find(s => s.id === saved.sessionId)
  for (const session of all) {
    if (session.endedAt || session === stored) continue
    await db.saveSession({ ...session, stats: await db.measure(session.id), endedAt: Date.now() })
  }
  if (saved.phase === "idle") return
  if (!stored) return chrome.storage.session.set({ [STATE_KEY]: IDLE })
  stored.stats = await db.measure(stored.id)
  const l = (live = makeLive(saved, stored))
  // The debugger stays attached when only the worker restarted, and then attach rejects.
  await chrome.debugger.attach({ tabId: saved.tabId }, "1.3").catch(noop)
  try {
    await observe({ tabId: saved.tabId })
    if (saved.phase === "recording") await startScreencast(saved.tabId)
  } catch {
    return dispatch({ type: "stop" })
  }
  life(l, "resume", Date.now(), { note: "service worker restarted" })
  await tell(saved.tabId, saved.phase === "recording")
}

// ---- One queue for every event, so frames are redacted in arrival order and nothing runs before boot has finished.

let queue: Promise<unknown> = boot().catch(console.error)
function enqueue<T>(work: () => T | Promise<T>): Promise<T> {
  const run = queue.then(work)
  queue = run.catch(console.error)
  return run
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId
  if (tabId === undefined) return
  // Chrome sends the next screencast frame only after this one is acknowledged.
  if (method === "Page.screencastFrame")
    cdp({ tabId }, "Page.screencastFrameAck", { sessionId: (params as { sessionId: number }).sessionId }).catch(noop)
  const handler = onCdp[method as keyof CdpEvents] as ((l: Live, params: unknown, tabId: number) => void | Promise<void>) | undefined
  if (!handler) return
  enqueue(() => {
    if (live?.rec.tabId === tabId) return handler(live, params, tabId)
  }).catch(noop)
})

chrome.debugger.onDetach.addListener(source => {
  // The user closed the tab or dismissed Chrome's debugging bar.
  enqueue(() => {
    if (live?.rec.tabId === source.tabId) return dispatch({ type: "stop" })
  }).catch(noop)
})

// ---- Messages

async function status(): Promise<Status> {
  const rec = state()
  const base = { phase: rec.phase, version: chrome.runtime.getManifest().version }
  const sessions = (await db.sessions())
    .map(s => (s.id === live?.stored.id ? live.stored : s))
    .sort((a, b) => b.session.startedAt - a.session.startedAt)
    .map(s => ({ id: s.id, startedAt: s.session.startedAt, game: s.session.game, stats: s.stats, live: s === live?.stored }))
  if (rec.phase === "idle" || !live) return { ...base, sessions }
  const tab = await chrome.tabs.get(rec.tabId).catch(noop)
  return { ...base, sessions, tabId: rec.tabId, tabTitle: tab?.title }
}

const control: { [T in ControlMsg["type"]]: (msg: Extract<ControlMsg, { type: T }>) => Promise<unknown> | void } = {
  status,
  start: ({ tabId }) => dispatch({ type: "start", tabId, sessionId: sessionId(new Date()), salt: crypto.randomUUID() }),
  pause: () => dispatch({ type: "pause" }),
  resume: () => dispatch({ type: "resume" }),
  stop: () => dispatch({ type: "stop" }),
  mark({ note }) {
    if (live?.rec.phase !== "recording") return
    const t = Date.now()
    life(live, "mark", t, { note })
    live.shots.mark(t)
  },
  reload: () => {
    if (live) return chrome.tabs.reload(live.rec.tabId)
  },
  async delete({ id }) {
    if (live?.stored.id !== id) await db.deleteSession(id)
  },
}

const page: { [T in PageMsg["type"]]: (msg: Extract<PageMsg, { type: T }>, recorded: Live | undefined) => unknown } = {
  hello: (_msg, l) => ({ on: l?.rec.phase === "recording" }),
  in({ e }, l) {
    if (l?.rec.phase !== "recording") return
    record(l, { t: e.t, k: "in", type: e.type, x: e.x, y: e.y, w: e.w, h: e.h, btn: e.btn, key: e.key })
    if (ANCHORS.has(e.type)) l.shots.anchor(e.t)
  },
  life({ what, t }, l) {
    if (l?.rec.phase !== "recording") return
    life(l, what, t)
    if (what === "hidden") l.shots.reset()
  },
}

chrome.runtime.onMessage.addListener((msg: ControlMsg | PageMsg, sender, reply) => {
  const fromExtensionPage = sender.url?.startsWith(chrome.runtime.getURL("")) ?? false
  const handle = (): unknown => {
    if (msg.type in control)
      return fromExtensionPage ? (control[msg.type as ControlMsg["type"]] as (m: ControlMsg) => unknown)(msg as ControlMsg) : undefined
    if (msg.type in page) {
      const recorded = live && sender.tab?.id === live.rec.tabId ? live : undefined
      return (page[msg.type as PageMsg["type"]] as (m: PageMsg, l: Live | undefined) => unknown)(msg as PageMsg, recorded)
    }
  }
  enqueue(handle).then(reply, (error: unknown) => reply({ error: error instanceof Error ? error.message : String(error) }))
  return true
})
