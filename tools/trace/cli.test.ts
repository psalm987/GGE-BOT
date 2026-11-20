import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join as p } from "node:path"
import { strToU8, zipSync } from "fflate"
import { beforeAll, describe, expect, it } from "vitest"
import { T0, down, life, rx, session, shot, sys, tx, up } from "./synthetic.ts"

const cli = p(import.meta.dirname, "trace.ts")
const run = (...args: string[]) => execFileSync("node", [cli, ...args], { encoding: "utf8" })

const events = [
  sys(T0 - 500, "<verChk/>"),
  life(T0 - 100, "mark", { note: "buy rams" }),
  shot(T0 - 20, "p1", "pre"),
  down(T0), up(T0 + 30),
  tx(T0 + 100, "sbp", { PID: 32 }), rx(T0 + 180, "sbp", 10, { error: "x" }),
  rx(T0 + 200, "gcu", 0, { C1: 5 }),
  shot(T0 + 500, "q1", "post"),
  tx(T0 + 9000, "pin"), rx(T0 + 9010, "pin"),
]
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
const files: Record<string, Uint8Array> = {
  "session.json": strToU8(JSON.stringify(session)),
  "events.jsonl": strToU8(events.map((e) => JSON.stringify(e)).join("\n") + "\n"),
  "shots/p1.jpg": jpg,
  "shots/q1.jpg": jpg,
}

let root: string
let dir: string
let zip: string

beforeAll(() => {
  root = mkdtempSync(p(tmpdir(), "trace-test-"))
  dir = p(root, "dirExport")
  mkdirSync(p(dir, "shots"), { recursive: true })
  for (const [name, data] of Object.entries(files)) writeFileSync(p(dir, name), data)
  zip = p(root, "zipExport.zip")
  writeFileSync(zip, zipSync(files))
})

describe.each([["directory", () => dir], ["zip", () => zip]])("%s export", (_name, input) => {
  it("join writes steps.jsonl and tasks.json", () => {
    const out = p(root, `join-${_name}`)
    run("join", input(), "--out", out)
    const steps = readFileSync(p(out, "steps.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    expect(steps).toHaveLength(3)
    expect(steps[1].calls[0].rx.res).toBe(10)
    expect(JSON.parse(readFileSync(p(out, "tasks.json"), "utf8"))).toEqual([{ label: "buy rams", steps: [1, 2] }])
  })

  it("view writes a self-contained page with the shots beside it", () => {
    const out = p(root, `view-${_name}`)
    run("view", input(), "--out", out)
    const html = readFileSync(p(out, "view.html"), "utf8")
    expect(html).toContain("sbp")
    expect(html).toContain("C2SBuyEventPackageVO")
    expect(html).toContain("NOT_ENOUGH_CURRENCY1")
    expect(html).toContain("buy rams")
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3)/)
    expect(existsSync(p(out, "shots", "p1.jpg"))).toBe(true)
    expect(existsSync(p(out, "shots", "q1.jpg"))).toBe(true)
  })

  it("fixture keeps answered calls of the asked commands", () => {
    const out = p(root, `fixture-${_name}.json`)
    run("fixture", input(), "--cmd", "sbp,pin", "--out", out)
    const data = JSON.parse(readFileSync(out, "utf8"))
    expect(data._label).toBe("CAPTURED from recorder session s1 (2026-11-20, client 166), redacted")
    expect(data.sbp_1).toEqual({ cmd: "sbp", payload: { PID: 32 }, reply: { res: 10, payload: { error: "x" } } })
    expect(data.pin_1.reply.res).toBe(0)
  })
})

describe("usage errors", () => {
  it("exits non-zero without a command, and warns on a schema mismatch", () => {
    expect(spawnSync("node", [cli]).status).toBe(2)
    const odd = p(root, "odd")
    mkdirSync(odd)
    writeFileSync(p(odd, "session.json"), JSON.stringify({ ...session, schema: 9 }))
    writeFileSync(p(odd, "events.jsonl"), "")
    const r = spawnSync("node", [cli, "join", odd, "--out", p(root, "odd-out")], { encoding: "utf8" })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain("schema")
  })
})
