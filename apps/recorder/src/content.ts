import type { InputEvent, InputType } from "./format.ts"
import type { FrameMsg, PageMsg, Viewport } from "./messages.ts"

const WHEEL_EVERY_MS = 500
const TEXT_KEY = "<text>"

function main() {
  const scope = globalThis as { ggeRecorderAlive?: () => boolean }
  // The service worker injects this file again when recording starts. Only a copy whose extension was reloaded is replaced.
  if (scope.ggeRecorderAlive?.()) return
  const alive = () => Boolean(chrome.runtime?.id)
  scope.ggeRecorderAlive = alive

  let on = false
  const send = (msg: PageMsg) => {
    if (on && alive()) chrome.runtime.sendMessage(msg).catch(() => {})
  }
  const now = () => performance.timeOrigin + performance.now()
  const round = (n: number) => Math.round(n * 10) / 10

  let place = { x: 0, y: 0, w: innerWidth, h: innerHeight }
  const locate = (ev: MouseEvent) => {
    const rect = ev.target instanceof HTMLCanvasElement
      ? ev.target.getBoundingClientRect()
      : { left: 0, top: 0, width: innerWidth, height: innerHeight }
    place = { x: round(ev.clientX - rect.left), y: round(ev.clientY - rect.top), w: round(rect.width), h: round(rect.height) }
  }
  const input = (type: InputType, extra: Pick<InputEvent, "btn" | "key"> = {}) =>
    send({ type: "in", e: { t: now(), k: "in", type, ...place, ...extra } })

  const isTextField = (target: EventTarget | null) =>
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && target.isContentEditable)

  const listen = <K extends keyof WindowEventMap>(type: K, handler: (ev: WindowEventMap[K]) => void) =>
    addEventListener(type, handler, { capture: true, passive: true })

  listen("pointerdown", ev => {
    locate(ev)
    input("down", { btn: ev.button })
  })
  listen("pointerup", ev => {
    locate(ev)
    input("up", { btn: ev.button })
  })
  listen("keydown", ev => {
    if (ev.repeat) return
    input("key", { key: isTextField(ev.target) ? TEXT_KEY : ev.key })
  })
  let lastWheel = -Infinity
  listen("wheel", ev => {
    if (ev.timeStamp - lastWheel < WHEEL_EVERY_MS) return
    lastWheel = ev.timeStamp
    locate(ev)
    input("wheel")
  })

  if (window === top) {
    document.addEventListener("visibilitychange", () => send({ type: "life", what: document.hidden ? "hidden" : "visible", t: now() }))
    // The top window blurs whenever focus moves into the game iframe. document.hasFocus() stays true for that, so it reports only real focus changes.
    let focused = document.hasFocus()
    const syncFocus = () => setTimeout(() => {
      if (document.hasFocus() === focused) return
      focused = !focused
      send({ type: "life", what: focused ? "focus" : "blur", t: now() })
    })
    listen("focus", syncFocus)
    listen("blur", syncFocus)
  }

  chrome.runtime.onMessage.addListener((msg: FrameMsg, _sender, reply) => {
    if (msg.type === "rec") on = msg.on
    else if (window === top) reply({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio } satisfies Viewport)
  })
  chrome.runtime.sendMessage({ type: "hello" } satisfies PageMsg).then(
    (reply: { on?: boolean } | undefined) => { on = Boolean(reply?.on) },
    () => {},
  )
}

main()
