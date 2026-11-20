import type { Ms, ShotEvent, ShotWhy } from "./format.ts"
import type { Dir } from "./wire.ts"

/** Wait for `post` when the input caused no traffic. */
export const QUIET_MS = 800
/** Wait after the first reply, so the client has drawn the result. */
export const SETTLE_MS = 400
/** Longest wait for `post`, measured from the input. */
export const CAP_MS = 2000
/** Screencast frames kept in memory, so `pre` can be a frame from before the input even if a newer one has arrived. */
const KEPT_FRAMES = 4

export interface ShotSink {
  save(id: string, jpegBase64: string): void
  emit(event: ShotEvent): void
}

interface ScreenFrame { data: string; at: Ms; id?: string }

/** Picks which screencast frames become `pre`, `post` and `mark` shots. A frame is saved once and reused by id. */
export function createShots(sink: ShotSink, now: () => Ms = Date.now) {
  const frames: ScreenFrame[] = []
  let pending: { since: Ms; replied: boolean; timer?: ReturnType<typeof setTimeout> } | undefined
  let lastId = 0

  const take = (frame: ScreenFrame | undefined, why: ShotWhy, t: Ms) => {
    if (!frame) return
    if (!frame.id) {
      lastId = Math.max(Math.floor(now()), lastId + 1)
      frame.id = String(lastId)
      sink.save(frame.id, frame.data)
    }
    sink.emit({ t, k: "shot", id: frame.id, why, file: `shots/${frame.id}.jpg` })
  }

  const settle = (t: Ms) => {
    if (!pending) return
    clearTimeout(pending.timer)
    pending = undefined
    take(frames.at(-1), "post", t)
  }

  const settleIn = (ms: number) => {
    if (!pending) return
    clearTimeout(pending.timer)
    pending.timer = setTimeout(() => settle(now()), Math.max(0, ms))
  }

  return {
    frame(data: string, at: Ms) {
      frames.push({ data, at })
      if (frames.length > KEPT_FRAMES) frames.shift()
    },
    /** An input at page time `t` that should get a `pre` and a `post`. */
    anchor(t: Ms) {
      // The previous input's `post` has to sort before this input.
      settle(t - 0.01)
      take(frames.findLast(frame => frame.at <= t) ?? frames[0], "pre", t)
      pending = { since: now(), replied: false }
      settleIn(QUIET_MS)
    },
    traffic(dir: Dir) {
      if (!pending || pending.replied) return
      const left = pending.since + CAP_MS - now()
      if (dir === "tx") return settleIn(left)
      pending.replied = true
      settleIn(Math.min(SETTLE_MS, left))
    },
    mark(t: Ms) {
      take(frames.at(-1), "mark", t)
    },
    /** Forget pending work and stale frames (pause, hidden tab). */
    reset() {
      clearTimeout(pending?.timer)
      pending = undefined
      frames.length = 0
    },
  }
}
export type Shots = ReturnType<typeof createShots>
