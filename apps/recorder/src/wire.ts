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

const utf8 = new TextDecoder("utf-8", { fatal: true })

/**
 * The text of a CDP websocket frame. The game server sends its replies as UTF-8 text in binary frames, which CDP hands
 * over base64-encoded. A binary frame that is not text keeps only its size.
 */
export function frameText({ opcode, payloadData }: { opcode: number; payloadData: string }): string {
  if (opcode === 1) return payloadData
  const bytes = Uint8Array.from(atob(payloadData), c => c.charCodeAt(0))
  try {
    return utf8.decode(bytes).replace(/\0+$/, "")
  } catch {
    return `<binary ${bytes.length} bytes>`
  }
}

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

/**
 * The session's game info after `frame`. The first value seen for each field stays, except that the login message
 * replaces the zone and host: the start page connects to a default world before the player picks theirs.
 */
export function learnGame(game: Session["game"], frame: Frame, url?: string): Session["game"] {
  const info = gameInfo(frame)
  const found = info.zone && url ? { ...info, host: new URL(url).host } : info
  return frame.kind === "xt" && frame.cmd === "lli" ? { ...game, ...found } : { ...found, ...game }
}
