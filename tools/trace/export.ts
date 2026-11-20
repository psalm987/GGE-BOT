import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join as pathJoin } from "node:path"
import { unzipSync } from "fflate"
import { SCHEMA } from "@gge/recorder/format"
import type { Session, TraceEvent } from "@gge/recorder/format"

export interface Export {
  session: Session
  events: TraceEvent[]
  /** Copies every shots/<id>.jpg into <dir>/shots/. */
  copyShots(dir: string): void
}

const decoder = new TextDecoder()

export function parseEvents(text: string): TraceEvent[] {
  return text.split("\n").filter((line) => line.trim()).map((line, n) => {
    try {
      return JSON.parse(line) as TraceEvent
    } catch {
      throw new Error(`events.jsonl line ${n + 1} is not JSON`)
    }
  })
}

function build(session: Session, eventsText: string, copyShots: Export["copyShots"]): Export {
  if (session.schema !== SCHEMA) {
    console.error(`warning: session.schema is ${String(session.schema)}, this tool reads schema ${SCHEMA}`)
  }
  return { session, events: parseEvents(eventsText), copyShots }
}

/** Reads an export that is a zip file or an unzipped directory. */
export function readExport(path: string): Export {
  if (!existsSync(path)) throw new Error(`no such export: ${path}`)
  if (statSync(path).isDirectory()) {
    const shots = pathJoin(path, "shots")
    return build(
      JSON.parse(readFileSync(pathJoin(path, "session.json"), "utf8")) as Session,
      readFileSync(pathJoin(path, "events.jsonl"), "utf8"),
      (dir) => {
        if (existsSync(shots)) cpSync(shots, pathJoin(dir, "shots"), { recursive: true })
      },
    )
  }
  const files = unzipSync(new Uint8Array(readFileSync(path)))
  const sessionName = Object.keys(files).find((name) => name === "session.json" || name.endsWith("/session.json"))
  if (!sessionName) throw new Error(`${path} has no session.json`)
  const prefix = sessionName.slice(0, -"session.json".length)
  const events = files[`${prefix}events.jsonl`]
  if (!events) throw new Error(`${path} has no events.jsonl`)
  return build(
    JSON.parse(decoder.decode(files[sessionName])) as Session,
    decoder.decode(events),
    (dir) => {
      for (const [name, data] of Object.entries(files)) {
        if (!name.startsWith(`${prefix}shots/`) || name.endsWith("/")) continue
        const target = pathJoin(dir, name.slice(prefix.length))
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, data)
      }
    },
  )
}
