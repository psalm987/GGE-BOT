import type { InputEvent, LifeEvent, RxEvent, Session, ShotEvent, SysEvent, TxEvent } from "@gge/recorder/format"

export const session: Session = {
  schema: 1,
  id: "s1",
  startedAt: Date.UTC(2026, 10, 20, 12),
  extVersion: "0.1.0",
  browser: "Chrome",
  viewport: { w: 1280, h: 720 },
  dpr: 1,
  game: { host: "example", zone: "EmpireEx_2", clientBuild: "166" },
}

export const T0 = session.startedAt

export const down = (t: number, x = 100, y = 100): InputEvent => ({ t, k: "in", type: "down", x, y, w: 1000, h: 600 })
export const up = (t: number, x = 100, y = 100): InputEvent => ({ t, k: "in", type: "up", x, y, w: 1000, h: 600 })
export const tx = (t: number, cmd: string, payload: unknown = {}, sock = "a"): TxEvent => ({
  t, k: "tx", sock, cmd, payload, raw: `%xt%EmpireEx_2%${cmd}%1%${JSON.stringify(payload)}%`,
})
export const rx = (t: number, cmd: string, res = 0, payload: unknown = {}, sock = "a"): RxEvent => ({
  t, k: "rx", sock, cmd, res, payload, raw: `%xt%${cmd}%1%${res}%${JSON.stringify(payload)}%`,
})
export const sys = (t: number, raw: string, dir: "tx" | "rx" = "tx", sock = "a"): SysEvent => ({ t, k: "sys", sock, dir, raw })
export const shot = (t: number, id: string, why: ShotEvent["why"]): ShotEvent => ({ t, k: "shot", id, why, file: `shots/${id}.jpg` })
export const life = (t: number, what: LifeEvent["what"], extra: { sock?: string; note?: string } = {}): LifeEvent => ({ t, k: "life", what, ...extra })
