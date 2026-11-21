import type { RxEvent, SysEvent, TxEvent } from "./format.ts"
import type { Dir, Frame } from "./wire.ts"

const MASK = "<redacted>"
const EMAIL = /[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
/** A shorter password would be scrubbed out of unrelated numbers and words in every frame. */
const MIN_SECRET = 4

type Fields = { mask: readonly string[]; hash?: readonly string[]; secrets?: readonly string[]; inner?: Readonly<Record<string, Fields>> }
type Rule = { drop: "chat" } | Fields

const CHAT: Rule = { drop: "chat" }
const CHAT_CMDS = { acm: CHAT, acl: CHAT, wcm: CHAT, wcl: CHAT, sms: CHAT }

const GPI: Fields = { mask: ["E"], hash: ["UID", "PID"] }

/**
 * `mask` fields become "<redacted>", `hash` fields a per-session hash, `secrets` name the fields whose values are
 * scrubbed from every later frame, and `inner` applies another rule to the object under that key only.
 */
export const RULES: Record<Dir, Record<string, Rule>> = {
  tx: {
    // The login name is also the player's name, which the game repeats in castle, map and ranking replies.
    lli: { mask: ["PW", "LT", "RCT", "NOM", "AID", "DID", "KID"], secrets: ["PW", "LT", "RCT", "NOM"] },
    tlep: { mask: ["TLT"] },
    vln: { mask: ["NOM"] },
    ...CHAT_CMDS,
  },
  rx: {
    glt: { mask: ["TLT"] },
    gpi: GPI,
    // Castle and commander names are typed by the player and often repeat parts of the login name the scrub misses.
    gbd: { mask: ["N"], inner: { gpi: GPI } },
    gli: { mask: ["N"] },
    // A ranking page lists other players: their names, alliances, ids and where their castles stand.
    hgh: { mask: ["N", "AN", "AP"], hash: ["OID", "AID"] },
    ...CHAT_CMDS,
  },
}

type Stored<E> = E extends unknown ? Omit<E, "t" | "sock"> : never
/** A trace event minus the fields only the capture layer knows. */
export type Redacted = Stored<TxEvent | RxEvent | SysEvent>
export type Redactor = (frame: Frame) => Promise<Redacted>

function parseJson(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) }
  } catch {
    return undefined
  }
}

async function digest(salt: string, value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${JSON.stringify(value)}`)
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return "#" + Array.from(hash.subarray(0, 8), b => b.toString(16).padStart(2, "0")).join("")
}

/**
 * One redactor per recording session. It remembers the login secrets in
 * memory so it can scrub them from later frames, and `salt` keeps hashed ids
 * stable within the session and unlinkable across sessions.
 */
export function createRedactor(salt: string): Redactor {
  const secrets = new Set<string>()

  const scrub = (text: string) => {
    for (const secret of secrets) text = text.replaceAll(secret, MASK)
    return text.replace(EMAIL, "<email>")
  }

  const remember = (value: unknown) => {
    if (typeof value !== "string" || value.length < MIN_SECRET) return
    secrets.add(value)
    // Inside a JSON frame the password appears with its quotes and backslashes escaped.
    secrets.add(JSON.stringify(value).slice(1, -1))
  }

  async function apply(rule: Fields, value: unknown): Promise<unknown> {
    if (Array.isArray(value)) return Promise.all(value.map(item => apply(rule, item)))
    if (value === null || typeof value !== "object") return value
    const out: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(value)) {
      if (rule.mask.includes(key)) out[key] = MASK
      else if (rule.hash?.includes(key)) out[key] = await digest(salt, field)
      else if (rule.inner?.[key]) out[key] = await apply(rule.inner[key], field)
      else out[key] = await apply(rule, field)
    }
    return out
  }

  async function redactBody(frame: Extract<Frame, { kind: "xt" }>): Promise<string> {
    const rule = RULES[frame.dir][frame.cmd]
    if (!rule) return frame.body
    const dropped = (why: string) => JSON.stringify({ dropped: why, length: frame.body.length })
    if ("drop" in rule) return dropped(rule.drop)
    const parsed = parseJson(frame.body)
    // A rule that cannot find its fields must not let the payload through.
    if (!parsed) return dropped("unparsed")
    if (parsed.value && typeof parsed.value === "object")
      for (const field of rule.secrets ?? []) remember((parsed.value as Record<string, unknown>)[field])
    return JSON.stringify(await apply(rule, parsed.value))
  }

  return async frame => {
    if (frame.kind === "sys") return { k: "sys", dir: frame.dir, raw: scrub(frame.raw) }
    const body = scrub(await redactBody(frame))
    const payload = parseJson(body)?.value ?? body
    const raw = frame.head + body + frame.tail
    return frame.dir === "tx"
      ? { k: "tx", cmd: frame.cmd, payload, raw }
      : { k: "rx", cmd: frame.cmd, res: frame.res, payload, raw }
  }
}
