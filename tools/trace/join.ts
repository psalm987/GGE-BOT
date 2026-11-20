import type { LifeEvent, Session, ShotEvent, TraceEvent } from "@gge/recorder/format"
import type { Call, Joined, Step, Task } from "./model.ts"

const WINDOW_MS = 1500
const DRAG_PX = 8
const PRE_MS = 100

/** Turns raw recorder events into steps and tasks. Pure: same input, same output. */
export function join(_session: Session, events: readonly TraceEvent[]): Joined {
  const sorted = events.map((e, n) => ({ e, n })).sort((a, b) => a.e.t - b.e.t || a.n - b.n).map((x) => x.e)

  const steps: Step[] = []
  const tasks: Task[] = []
  const shots: ShotEvent[] = []
  const open = new Map<string, Call[]>()
  const lastActive = new Map<Step, number>()
  let current: Step | undefined
  let anchor: Step | undefined
  let openDown: Step | undefined
  let label: string | undefined

  const begin = (t: number, input: Step["input"]): Step => {
    const step: Step = { i: steps.length, t, input, calls: [], pushes: [] }
    if (label !== undefined) {
      step.mark = label
      tasks[tasks.length - 1]?.steps.push(step.i)
    }
    steps.push(step)
    lastActive.set(step, t)
    current = step
    return step
  }

  const backgroundStep = (t: number, system: boolean): Step => {
    const fits = current && current.input === null && !!current.system === system && t - (lastActive.get(current) ?? 0) <= WINDOW_MS
    const step = fits && current ? current : begin(t, null)
    if (system) step.system = true
    lastActive.set(step, t)
    return step
  }

  const clearSock = (sock: string | undefined) => {
    for (const key of [...open.keys()]) if (sock === undefined || key.startsWith(`${sock}\0`)) open.delete(key)
  }

  for (const e of sorted) {
    switch (e.k) {
      case "in": {
        if (e.type === "up") {
          const down = openDown
          openDown = undefined
          if (!down?.input) break
          const dx = e.x - down.input.x
          const dy = e.y - down.input.y
          if (Math.hypot(dx, dy) > DRAG_PX) down.drag = { dx, dy }
          lastActive.set(down, e.t)
          break
        }
        const step = begin(e.t, e)
        anchor = step
        openDown = e.type === "down" ? step : undefined
        break
      }
      case "tx": {
        const anchored = anchor && e.t - (lastActive.get(anchor) ?? 0) <= WINDOW_MS
        const step = anchored && anchor ? anchor : backgroundStep(e.t, false)
        const call: Call = { tx: e }
        step.calls.push(call)
        const key = `${e.sock}\0${e.cmd}`
        const queue = open.get(key)
        if (queue) queue.push(call)
        else open.set(key, [call])
        break
      }
      case "rx": {
        const call = open.get(`${e.sock}\0${e.cmd}`)?.shift()
        if (call) {
          call.rx = e
          call.ms = e.t - call.tx.t
        } else {
          const step = current ?? begin(e.t, null)
          step.pushes.push(e)
        }
        break
      }
      case "sys": {
        const step = backgroundStep(e.t, true)
        step.sys = [...(step.sys ?? []), e]
        break
      }
      case "shot":
        if (e.why !== "mark") shots.push(e)
        break
      case "life":
        life(e)
        break
    }
  }

  function life(e: LifeEvent) {
    if (e.what === "open" || e.what === "close") clearSock(e.sock)
    else if (e.what === "mark") {
      label = e.note ?? ""
      tasks.push({ label, steps: [] })
    }
  }

  attachShots(steps, shots)
  return { steps, tasks }
}

function attachShots(steps: Step[], shots: ShotEvent[]) {
  const anchors = steps.filter((s) => s.input)
  anchors.forEach((step, n) => {
    const next = anchors[n + 1]?.t ?? Infinity
    for (const shot of shots) {
      // The recorder stamps a pre shot when it handles the click, so it can land a few ms after the input.
      if (shot.why === "pre" && !step.pre && step.t - shot.t <= PRE_MS && shot.t < next) step.pre = shot.id
      if (shot.why === "post" && shot.t > step.t && shot.t < next) step.post = shot.id
    }
  })
}
