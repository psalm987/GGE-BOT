import type { Session } from "@gge/recorder/format"
import type { Step } from "./model.ts"

/** Captured frames in the shape of packages/bot-core/test/fixtures/protocol/*.json. */
export function fixture(session: Session, steps: readonly Step[], cmds: readonly string[]): Record<string, unknown> {
  const date = new Date(session.startedAt).toISOString().slice(0, 10)
  const out: Record<string, unknown> = {
    _label: `CAPTURED from recorder session ${session.id} (${date}, client ${session.game.clientBuild ?? "unknown"}), redacted`,
  }
  const counts = new Map<string, number>()
  for (const step of steps) {
    for (const { tx, rx } of step.calls) {
      if (!rx || !cmds.includes(tx.cmd)) continue
      const n = (counts.get(tx.cmd) ?? 0) + 1
      counts.set(tx.cmd, n)
      out[`${tx.cmd}_${n}`] = { cmd: tx.cmd, payload: tx.payload, reply: { res: rx.res, payload: rx.payload } }
    }
  }
  return out
}
