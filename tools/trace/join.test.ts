import { describe, expect, it } from "vitest"
import { join } from "./join.ts"
import { T0, down, life, rx, session, shot, sys, tx, up } from "./synthetic.ts"

const run = (...events: Parameters<typeof join>[1][number][]) => join(session, events)

describe("join", () => {
  it("keeps a click with no traffic as its own step", () => {
    const { steps } = run(down(T0), up(T0 + 50))
    expect(steps).toHaveLength(1)
    expect(steps[0]?.input?.type).toBe("down")
    expect(steps[0]?.calls).toEqual([])
    expect(steps[0]?.drag).toBeUndefined()
  })

  it("puts every command sent after one click into that step", () => {
    const { steps } = run(down(T0), up(T0 + 40), tx(T0 + 100, "sbp"), tx(T0 + 300, "gcu"), rx(T0 + 400, "sbp"), rx(T0 + 500, "gcu"))
    expect(steps).toHaveLength(1)
    expect(steps[0]?.calls.map((c) => [c.tx.cmd, c.rx?.cmd, c.ms])).toEqual([["sbp", "sbp", 300], ["gcu", "gcu", 200]])
  })

  it("records a drag only when the pointer moved more than 8 px", () => {
    const moved = run(down(T0, 100, 100), up(T0 + 300, 160, 70), tx(T0 + 400, "gaa"), rx(T0 + 500, "gaa"))
    expect(moved.steps).toHaveLength(1)
    expect(moved.steps[0]?.drag).toEqual({ dx: 60, dy: -30 })
    expect(moved.steps[0]?.calls).toHaveLength(1)
    expect(run(down(T0), up(T0 + 50, 105, 104)).steps[0]?.drag).toBeUndefined()
  })

  it("counts the 1.5 s window from the end of a drag", () => {
    const { steps } = run(down(T0, 0, 0), up(T0 + 2000, 100, 0), tx(T0 + 3000, "gaa"))
    expect(steps).toHaveLength(1)
    expect(steps[0]?.calls).toHaveLength(1)
  })

  it("starts a background step for a command with no click, and shares it within 1.5 s", () => {
    const { steps } = run(tx(T0, "pin"), rx(T0 + 20, "pin"), tx(T0 + 1000, "pin"), tx(T0 + 5000, "pin"))
    expect(steps).toHaveLength(2)
    expect(steps[0]?.input).toBeNull()
    expect(steps[0]?.calls).toHaveLength(2)
    expect(steps[1]?.calls).toHaveLength(1)
  })

  it("does not attach a command past the window to the click", () => {
    const { steps } = run(down(T0), tx(T0 + 1600, "pin"))
    expect(steps).toHaveLength(2)
    expect(steps[0]?.calls).toEqual([])
    expect(steps[1]?.input).toBeNull()
  })

  it("starts a new step for a newer click even inside the old window", () => {
    const { steps } = run(down(T0), down(T0 + 500), tx(T0 + 600, "sbp"))
    expect(steps[0]?.calls).toEqual([])
    expect(steps[1]?.calls).toHaveLength(1)
  })

  it("files a server push with no request under the step that spans it", () => {
    const { steps } = run(down(T0), tx(T0 + 100, "sbp"), rx(T0 + 200, "sbp"), rx(T0 + 220, "gcu", 0, { C1: 5 }), down(T0 + 5000), rx(T0 + 5100, "atk"))
    expect(steps[0]?.pushes.map((p) => p.cmd)).toEqual(["gcu"])
    expect(steps[1]?.pushes.map((p) => p.cmd)).toEqual(["atk"])
  })

  it("makes a push with no step at all a background step", () => {
    const { steps } = run(rx(T0, "gcu"))
    expect(steps).toHaveLength(1)
    expect(steps[0]?.input).toBeNull()
    expect(steps[0]?.pushes).toHaveLength(1)
  })

  it("pairs overlapping same-cmd requests in order", () => {
    const first = tx(T0 + 10, "gaa", { n: 1 })
    const second = tx(T0 + 20, "gaa", { n: 2 })
    const { steps } = run(down(T0), first, second, rx(T0 + 100, "gaa", 0, { a: 1 }), rx(T0 + 150, "gaa", 0, { a: 2 }))
    const [a, b] = steps[0]?.calls ?? []
    expect(a?.rx?.payload).toEqual({ a: 1 })
    expect(a?.ms).toBe(90)
    expect(b?.rx?.payload).toEqual({ a: 2 })
    expect(b?.ms).toBe(130)
  })

  it("keeps an error reply and its result code", () => {
    const { steps } = run(down(T0), tx(T0 + 10, "sbp"), rx(T0 + 60, "sbp", 10))
    expect(steps[0]?.calls[0]?.rx?.res).toBe(10)
  })

  it("never pairs across sockets, and a reconnect leaves unanswered requests bare", () => {
    const { steps } = run(
      down(T0), tx(T0 + 10, "sbp", {}, "a"),
      life(T0 + 100, "close", { sock: "a" }), life(T0 + 200, "open", { sock: "b" }),
      rx(T0 + 300, "sbp", 0, {}, "b"),
    )
    expect(steps[0]?.calls[0]?.rx).toBeUndefined()
    expect(steps[0]?.pushes.map((p) => p.cmd)).toEqual(["sbp"])
  })

  it("does not pair a reply on another socket while the first stays open", () => {
    const { steps } = run(down(T0), tx(T0 + 10, "sbp", {}, "a"), rx(T0 + 20, "sbp", 0, {}, "b"))
    expect(steps[0]?.calls[0]?.rx).toBeUndefined()
    expect(steps[0]?.pushes).toHaveLength(1)
  })

  it("splits tasks on marks and tags each step with the current label", () => {
    const { steps, tasks } = run(
      down(T0), life(T0 + 1000, "mark", { note: "buy rams" }), down(T0 + 2000), down(T0 + 3000),
      life(T0 + 4000, "mark", { note: "open shop" }), down(T0 + 5000),
    )
    expect(steps.map((s) => s.mark)).toEqual([undefined, "buy rams", "buy rams", "open shop"])
    expect(tasks).toEqual([{ label: "buy rams", steps: [1, 2] }, { label: "open shop", steps: [3] }])
  })

  it("puts the XML handshake in a system step", () => {
    const { steps } = run(sys(T0, "<verChk/>"), sys(T0 + 200, "<apiOK/>", "rx"), down(T0 + 3000))
    expect(steps).toHaveLength(2)
    expect(steps[0]?.system).toBe(true)
    expect(steps[0]?.input).toBeNull()
    expect(steps[0]?.sys).toHaveLength(2)
    expect(steps[1]?.system).toBeUndefined()
  })

  it("attaches pre and post shots to the click they surround", () => {
    const { steps } = run(
      shot(T0 - 60, "p1", "pre"), down(T0), tx(T0 + 10, "sbp"), shot(T0 + 400, "q1", "post"),
      shot(T0 + 2940, "p2", "pre"), down(T0 + 3000), shot(T0 + 3400, "q2", "post"),
      shot(T0 + 3500, "m", "mark"),
    )
    expect(steps.map((s) => [s.pre, s.post])).toEqual([["p1", "q1"], ["p2", "q2"]])
  })

  it("keeps a click's command in its step when a system frame lands in between", () => {
    const { steps } = run(down(T0), sys(T0 + 200, "<msg t='sys'><body action='roundTripRes' r='1'></body></msg>", "rx"), tx(T0 + 600, "sbp"), rx(T0 + 700, "sbp"))
    expect(steps.map((s) => [s.input?.type ?? null, s.calls.map((c) => c.tx.cmd)])).toEqual([["down", ["sbp"]], [null, []]])
  })

  it("attaches a pre shot stamped just after the click", () => {
    const { steps } = run(down(T0), shot(T0 + 8, "p", "pre"), shot(T0 + 500, "q", "post"), down(T0 + 3000), shot(T0 + 3005, "p2", "pre"))
    expect(steps.map((s) => s.pre)).toEqual(["p", "p2"])
  })

  it("ignores a pre shot more than 100 ms before the click", () => {
    expect(run(shot(T0 - 500, "p", "pre"), down(T0)).steps[0]?.pre).toBeUndefined()
  })

  it("sorts unordered input by time", () => {
    const { steps } = run(tx(T0 + 10, "sbp"), down(T0))
    expect(steps[0]?.calls).toHaveLength(1)
  })
})
