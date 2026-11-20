import type { Stats } from "./db.ts"
import type { InputEvent, LifeWhat, Ms, Session } from "./format.ts"

/** Sent by the popup. Only extension pages may send these. */
export type ControlMsg =
  | { type: "status" }
  | { type: "start"; tabId: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop" }
  | { type: "mark"; note: string }
  | { type: "reload" }
  | { type: "delete"; id: string }

/** Sent by the content script in a page frame. */
export type PageMsg =
  | { type: "hello" }
  | { type: "in"; e: InputEvent }
  | { type: "life"; what: Extract<LifeWhat, "focus" | "blur" | "hidden" | "visible">; t: Ms }

/** Sent by the service worker to content scripts. */
export type FrameMsg = { type: "rec"; on: boolean } | { type: "viewport" }
export interface Viewport { w: number; h: number; dpr: number }

export interface SessionSummary { id: string; startedAt: number; game: Session["game"]; stats: Stats; live: boolean }
export interface Status {
  phase: "idle" | "recording" | "paused"
  version: string
  tabId?: number
  tabTitle?: string
  sessions: SessionSummary[]
}
export type Reply<T> = T | { error: string }
