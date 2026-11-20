import type { Session } from "./format.ts"

export type Dir = "tx" | "rx"

/**
 * One websocket text frame. An xt frame is `%xt%<a>%<b>%<c>%<body>%`: outbound
 * a=zone, b=cmd; inbound a=cmd, c=result. `head` keeps the five-`%` prefix and
 * `tail` the closing `%` (absent when a command has no payload), so a frame can
 * be rebuilt around a changed body.
 */
export type Frame =
  | { kind: "xt"; dir: Dir; head: string; zone?: string; cmd: string; res: number; body: string; tail: string }
  | { kind: "sys"; dir: Dir; raw: string }

export function parseFrame(dir: Dir, raw: string): Frame {
  const sys: Frame = { kind: "sys", dir, raw }
  if (!raw.startsWith("%xt%")) return sys
  let end = 0
  for (let i = 0; i < 5; i++) {
    end = raw.indexOf("%", end) + 1
    if (end === 0) return sys
  }
  const head = raw.slice(0, end)
  const [, , a = "", b = "", c = ""] = head.split("%")
  const rest = raw.slice(end)
  const tail = rest.endsWith("%") ? "%" : ""
  const body = rest.slice(0, rest.length - tail.length)
  return dir === "tx"
    ? { kind: "xt", dir, head, zone: a, cmd: b, res: 0, body, tail }
    : { kind: "xt", dir, head, cmd: a, res: Number(c), body, tail }
}

/** What an outbound frame reveals about the game server: the zone, or the client build inside the XML login's `pword`. */
export function gameInfo(frame: Frame): Pick<Session["game"], "zone" | "clientBuild"> {
  if (frame.dir !== "tx") return {}
  if (frame.kind === "xt") return frame.zone ? { zone: frame.zone } : {}
  const build = /action=["']login["'][\s\S]*?<pword><!\[CDATA\[([^%\]]+)/.exec(frame.raw)?.[1]
  return build ? { clientBuild: build } : {}
}
