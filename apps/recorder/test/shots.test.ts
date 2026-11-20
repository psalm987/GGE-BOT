import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ShotEvent } from "../src/format.ts"
import { createShots } from "../src/shots.ts"

const T0 = 1_800_000_000_000

function setup() {
  const saved = new Map<string, string>()
  const events: ShotEvent[] = []
  const shots = createShots({ save: (id, data) => saved.set(id, data), emit: e => events.push(e) })
  const frameOf = (e: ShotEvent | undefined) => e && saved.get(e.id)
  const post = () => events.find(e => e.why === "post")
  return { shots, saved, events, frameOf, post }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => vi.useRealTimers())

describe("shots", () => {
  it("saves the frame from before the input as pre, even when a newer frame has arrived", () => {
    const { shots, events, frameOf } = setup()
    shots.frame("before", T0 - 50)
    shots.frame("after", T0 + 5)
    shots.anchor(T0)
    expect(events).toMatchObject([{ t: T0, k: "shot", why: "pre" }])
    expect(frameOf(events[0])).toBe("before")
    expect(events[0]!.file).toBe(`shots/${events[0]!.id}.jpg`)
  })

  it("takes post 800 ms after an input that caused no traffic", () => {
    const { shots, post, frameOf } = setup()
    shots.frame("before", T0 - 50)
    shots.anchor(T0)
    shots.frame("menu open", T0 + 100)
    vi.advanceTimersByTime(799)
    expect(post()).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(post()).toMatchObject({ t: T0 + 800 })
    expect(frameOf(post())).toBe("menu open")
  })

  it("takes post 400 ms after the first reply", () => {
    const { shots, post, frameOf } = setup()
    shots.frame("before", T0 - 50)
    shots.anchor(T0)
    vi.advanceTimersByTime(100)
    shots.traffic("tx")
    vi.advanceTimersByTime(900)
    expect(post()).toBeUndefined()
    shots.traffic("rx")
    shots.frame("result", T0 + 1100)
    vi.advanceTimersByTime(200)
    shots.traffic("rx")
    vi.advanceTimersByTime(200)
    expect(post()).toMatchObject({ t: T0 + 1400 })
    expect(frameOf(post())).toBe("result")
  })

  it("stops waiting for a reply 2 s after the input", () => {
    const { shots, post } = setup()
    shots.frame("before", T0 - 50)
    shots.anchor(T0)
    shots.traffic("tx")
    vi.advanceTimersByTime(1900)
    shots.traffic("rx")
    vi.advanceTimersByTime(99)
    expect(post()).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(post()).toMatchObject({ t: T0 + 2000 })
  })

  it("stores an unchanged screen once and reuses its id", () => {
    const { shots, saved, events } = setup()
    shots.frame("same", T0 - 50)
    shots.anchor(T0)
    vi.advanceTimersByTime(800)
    shots.mark(T0 + 900)
    expect(events.map(e => e.why)).toEqual(["pre", "post", "mark"])
    expect(new Set(events.map(e => e.id)).size).toBe(1)
    expect(saved.size).toBe(1)
  })

  it("closes the previous input's post just before the next input", () => {
    const { shots, events } = setup()
    shots.frame("a", T0 - 50)
    shots.anchor(T0)
    vi.advanceTimersByTime(300)
    shots.frame("b", T0 + 200)
    shots.anchor(T0 + 300)
    expect(events.map(e => e.why)).toEqual(["pre", "post", "pre"])
    expect(events[1]!.t).toBeGreaterThan(T0)
    expect(events[1]!.t).toBeLessThan(T0 + 300)
    vi.advanceTimersByTime(800)
    expect(events.map(e => e.why)).toEqual(["pre", "post", "pre", "post"])
  })

  it("takes no shot without a frame, and none after a reset", () => {
    const { shots, events } = setup()
    shots.anchor(T0)
    vi.advanceTimersByTime(800)
    shots.frame("a", T0 + 900)
    shots.anchor(T0 + 1000)
    shots.reset()
    vi.advanceTimersByTime(5000)
    shots.mark(T0 + 6000)
    expect(events.map(e => e.why)).toEqual(["pre"])
  })
})
