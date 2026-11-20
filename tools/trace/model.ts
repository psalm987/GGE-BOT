import type { InputEvent, RxEvent, SysEvent, TxEvent } from "@gge/recorder/format"

/** One request and the reply that answered it. ms = rx.t - tx.t. */
export interface Call { tx: TxEvent; rx?: RxEvent; ms?: number }

/**
 * One human action (input !== null) or one stretch of traffic nobody caused
 * (input === null). pre and post are shot ids, files live at shots/<id>.jpg.
 */
export interface Step {
  i: number
  t: number
  input: InputEvent | null
  drag?: { dx: number; dy: number }
  pre?: string
  post?: string
  calls: Call[]
  pushes: RxEvent[]
  mark?: string
  system?: true
  sys?: SysEvent[]
}

/** The steps between one life:mark event and the next. */
export interface Task { label: string; steps: number[] }

export interface Joined { steps: Step[]; tasks: Task[] }
