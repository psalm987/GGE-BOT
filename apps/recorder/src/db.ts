import type { Session, TraceEvent } from "./format.ts"

export interface Stats { events: number; shots: number; bytes: number }
export interface StoredSession { id: string; session: Session; stats: Stats; endedAt?: number }
interface EventRow { sid: string; e: TraceEvent }
interface ShotRow { id: string; sid: string; blob: Blob }

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

let opened: Promise<IDBDatabase> | undefined
function open(): Promise<IDBDatabase> {
  if (opened) return opened
  const request = indexedDB.open("gge-recorder", 1)
  request.onupgradeneeded = () => {
    const db = request.result
    db.createObjectStore("sessions", { keyPath: "id" })
    db.createObjectStore("events", { autoIncrement: true }).createIndex("sid", "sid")
    db.createObjectStore("shots", { keyPath: "id" }).createIndex("sid", "sid")
  }
  return (opened = done(request))
}

type StoreName = "sessions" | "events" | "shots"
const store = async (name: StoreName, mode: IDBTransactionMode = "readonly") =>
  (await open()).transaction(name, mode).objectStore(name)

export const eventBytes = (e: TraceEvent) => JSON.stringify(e).length + 1

export const saveSession = async (session: StoredSession) => void await done((await store("sessions", "readwrite")).put(session))
export const sessions = async (): Promise<StoredSession[]> => done((await store("sessions")).getAll())
export const addEvent = async (sid: string, e: TraceEvent) => void await done((await store("events", "readwrite")).add({ sid, e } satisfies EventRow))
export const addShot = async (sid: string, id: string, blob: Blob) => void await done((await store("shots", "readwrite")).put({ id, sid, blob } satisfies ShotRow))

/** In arrival order. The export sorts by time. */
export const eventsOf = async (sid: string): Promise<TraceEvent[]> =>
  (await done<EventRow[]>((await store("events")).index("sid").getAll(sid))).map(row => row.e)
export const shotsOf = async (sid: string): Promise<ShotRow[]> => done((await store("shots")).index("sid").getAll(sid))

/** Recounts a session from its rows, for when the in-memory counters died with the service worker. */
export async function measure(sid: string): Promise<Stats> {
  const [events, shots] = await Promise.all([eventsOf(sid), shotsOf(sid)])
  const bytes = events.reduce((sum, e) => sum + eventBytes(e), 0) + shots.reduce((sum, shot) => sum + shot.blob.size, 0)
  return { events: events.length, shots: shots.length, bytes }
}

export async function deleteSession(sid: string) {
  const tx = (await open()).transaction(["sessions", "events", "shots"], "readwrite")
  tx.objectStore("sessions").delete(sid)
  for (const name of ["events", "shots"] as const) {
    const rows = tx.objectStore(name)
    for (const key of await done(rows.index("sid").getAllKeys(sid))) rows.delete(key)
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
