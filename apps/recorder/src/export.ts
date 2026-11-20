import { zipSync, type Zippable } from "fflate"
import * as db from "./db.ts"

/** The trace zip: session.json, events.jsonl sorted by time, shots/<id>.jpg. */
export async function exportZip(sessionId: string): Promise<Blob> {
  const stored = (await db.sessions()).find(s => s.id === sessionId)
  if (!stored) throw new Error(`No session ${sessionId}`)
  const events = (await db.eventsOf(sessionId)).sort((a, b) => a.t - b.t)
  const text = new TextEncoder()
  const files: Zippable = {
    "session.json": text.encode(JSON.stringify(stored.session, null, 2)),
    "events.jsonl": text.encode(events.map(e => JSON.stringify(e) + "\n").join("")),
  }
  // JPEG does not compress further, so the shots are stored as they are.
  for (const shot of await db.shotsOf(sessionId))
    files[`shots/${shot.id}.jpg`] = [new Uint8Array(await shot.blob.arrayBuffer()), { level: 0 }]
  return new Blob([zipSync(files)], { type: "application/zip" })
}
