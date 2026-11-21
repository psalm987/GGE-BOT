import { describe, expect, it } from "vitest"
import { createClock } from "../src/clock.ts"
import { IDLE, transition, type Rec } from "../src/lifecycle.ts"
import { frameText, parseFrame } from "../src/wire.ts"

describe("lifecycle", () => {
  const start = { type: "start", sessionId: "s1", tabId: 7, salt: "x" } as const
  const recording = transition(IDLE, start) as Rec
  const paused = transition(recording, { type: "pause" }) as Rec

  it("walks idle, recording, paused and back", () => {
    expect(recording).toEqual({ phase: "recording", sessionId: "s1", tabId: 7, salt: "x" })
    expect(paused).toEqual({ ...recording, phase: "paused" })
    expect(transition(paused, { type: "resume" })).toEqual(recording)
    expect(transition(recording, { type: "stop" })).toEqual(IDLE)
    expect(transition(paused, { type: "stop" })).toEqual(IDLE)
  })

  it("rejects actions that are not legal in the current phase", () => {
    expect(transition(recording, start)).toBeUndefined()
    expect(transition(paused, start)).toBeUndefined()
    expect(transition(IDLE, { type: "pause" })).toBeUndefined()
    expect(transition(IDLE, { type: "resume" })).toBeUndefined()
    expect(transition(IDLE, { type: "stop" })).toBeUndefined()
    expect(transition(recording, { type: "resume" })).toBeUndefined()
    expect(transition(paused, { type: "pause" })).toBeUndefined()
  })
})

describe("clock", () => {
  it("uses the smallest receipt delay seen so far until a handshake fixes the offset", () => {
    const clock = createClock()
    expect(clock.toEpoch(10, 1_000_010_030)).toBe(1_000_010_030)
    expect(clock.toEpoch(11, 1_000_011_005)).toBe(1_000_011_005)
    expect(clock.toEpoch(12, 1_000_012_040)).toBe(1_000_012_005)
    clock.calibrate(13, 1_000_013)
    expect(clock.toEpoch(14, 1_000_014_500)).toBe(1_000_014_000)
    expect(clock.toEpoch(15, 1_000_014_000)).toBe(1_000_015_000)
  })
})

describe("parseFrame", () => {
  it("splits outbound and inbound xt frames and keeps `%` inside the payload", () => {
    expect(parseFrame("tx", "%xt%EmpireEx_9%vck%1%1234%web-html5%<x>%5e-7%"))
      .toEqual({ kind: "xt", dir: "tx", head: "%xt%EmpireEx_9%vck%1%", zone: "EmpireEx_9", cmd: "vck", res: 0, body: "1234%web-html5%<x>%5e-7", tail: "%" })
    expect(parseFrame("rx", `%xt%sbp%1%114%{"a":"50%"}%`))
      .toEqual({ kind: "xt", dir: "rx", head: "%xt%sbp%1%114%", cmd: "sbp", res: 114, body: `{"a":"50%"}`, tail: "%" })
    expect(parseFrame("tx", "%xt%EmpireEx_9%pin%1%")).toMatchObject({ cmd: "pin", body: "", tail: "" })
  })

  it("treats XML and anything else as a system frame", () => {
    expect(parseFrame("rx", "<msg t='sys'></msg>")).toEqual({ kind: "sys", dir: "rx", raw: "<msg t='sys'></msg>" })
    expect(parseFrame("rx", "%xt%short%")).toMatchObject({ kind: "sys" })
  })
})

describe("frameText", () => {
  const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))

  it("keeps a text frame as it came", () => {
    expect(frameText({ opcode: 1, payloadData: "%xt%pin%1%0%" })).toBe("%xt%pin%1%0%")
  })

  it("decodes a binary frame that holds UTF-8 text, so server replies parse as xt frames", () => {
    const text = frameText({ opcode: 2, payloadData: b64(`%xt%gpi%1%0%{"N":"Bjørn"}%`) })
    expect(text).toBe(`%xt%gpi%1%0%{"N":"Bjørn"}%`)
    expect(parseFrame("rx", text)).toMatchObject({ kind: "xt", cmd: "gpi", res: 0, body: `{"N":"Bjørn"}` })
  })

  it("drops the NUL that ends a SmartFox message", () => {
    expect(frameText({ opcode: 2, payloadData: b64("%xt%pin%1%0%\0") })).toBe("%xt%pin%1%0%")
  })

  it("keeps a placeholder with the byte count for a binary frame that is not text", () => {
    expect(frameText({ opcode: 2, payloadData: btoa("\xff\xfe\x00\x01") })).toBe("<binary 4 bytes>")
  })
})
