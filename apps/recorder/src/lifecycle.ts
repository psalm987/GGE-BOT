export interface Active { phase: "recording" | "paused"; sessionId: string; tabId: number; salt: string }
export type Rec = { phase: "idle" } | Active
export type Action =
  | { type: "start"; sessionId: string; tabId: number; salt: string }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop" }

export const IDLE: Rec = { phase: "idle" }

/** The next state, or undefined when the action is not legal in this phase (a double click, a stale popup). */
export function transition(state: Rec, action: Action): Rec | undefined {
  switch (action.type) {
    case "start":
      return state.phase === "idle"
        ? { phase: "recording", sessionId: action.sessionId, tabId: action.tabId, salt: action.salt }
        : undefined
    case "pause":
      return state.phase === "recording" ? { ...state, phase: "paused" } : undefined
    case "resume":
      return state.phase === "paused" ? { ...state, phase: "recording" } : undefined
    case "stop":
      return state.phase === "idle" ? undefined : IDLE
  }
}
