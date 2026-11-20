/**
 * The on-disk contract between the recorder extension and tools/trace.
 * One export is a zip holding session.json, events.jsonl (one TraceEvent per
 * line, sorted by t) and shots/<id>.jpg. Bump SCHEMA on any breaking change.
 */
export const SCHEMA = 1

export interface Session {
  schema: typeof SCHEMA
  id: string
  startedAt: number
  extVersion: string
  browser: string
  viewport: { w: number; h: number }
  dpr: number
  game: { host?: string; zone?: string; clientBuild?: string }
}

/** Epoch milliseconds, fractional. Every event shares this clock. */
export type Ms = number

export type InputType = "down" | "up" | "key" | "wheel"
export type ShotWhy = "pre" | "post" | "mark"
export type LifeWhat = "open" | "close" | "focus" | "blur" | "hidden" | "visible" | "pause" | "resume" | "mark"

/** x, y are CSS pixels relative to the game canvas; w, h are the canvas size. */
export interface InputEvent { t: Ms; k: "in"; type: InputType; x: number; y: number; w: number; h: number; btn?: number; key?: string }
/** payload is parsed JSON when the frame carries JSON, else the raw text after the command (vck sends `%`-separated fields). */
export interface TxEvent { t: Ms; k: "tx"; sock: string; cmd: string; payload: unknown; raw: string }
export interface RxEvent { t: Ms; k: "rx"; sock: string; cmd: string; res: number; payload: unknown; raw: string }
export interface SysEvent { t: Ms; k: "sys"; sock: string; dir: "tx" | "rx"; raw: string }
export interface ShotEvent { t: Ms; k: "shot"; id: string; why: ShotWhy; file: string }
export interface LifeEvent { t: Ms; k: "life"; what: LifeWhat; sock?: string; note?: string }

export type TraceEvent = InputEvent | TxEvent | RxEvent | SysEvent | ShotEvent | LifeEvent
