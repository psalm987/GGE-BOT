import { exportZip } from "./export.ts"
import type { ControlMsg, Reply, SessionSummary, Status } from "./messages.ts"

const POLL_MS = 500
const CONFIRM_MS = 4000

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(2)} MB`

function showError(message: string) {
  $("error").textContent = message
  $("error").hidden = !message
}

async function ask<T = void>(msg: ControlMsg): Promise<T | undefined> {
  const reply: Reply<T> | undefined = await chrome.runtime.sendMessage(msg)
  if (reply && typeof reply === "object" && "error" in reply) {
    showError(reply.error)
    return undefined
  }
  return reply
}

const act = (msg: ControlMsg) => async () => {
  showError("")
  await ask(msg)
  await refresh()
}

async function activeGameTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  // Chrome reveals a tab's url only on hosts the extension may access, which are the game's hosts.
  return tab?.url?.startsWith("http") ? tab : undefined
}

function download(blob: Blob, name: string) {
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
}

function sessionRow(session: SessionSummary): HTMLLIElement {
  const row = document.createElement("li")
  row.dataset.id = session.id
  const what = document.createElement("div")
  what.className = "what"
  const started = new Date(session.startedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
  what.append(session.live ? `${started} (recording)` : started)
  const meta = document.createElement("div")
  meta.className = "meta"
  what.append(meta)

  const exportButton = document.createElement("button")
  exportButton.textContent = "Export"
  exportButton.dataset.do = "export"
  exportButton.onclick = async () => {
    exportButton.disabled = true
    exportButton.textContent = "Zipping"
    try {
      download(await exportZip(session.id), `gge-trace-${session.id}.zip`)
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    }
    exportButton.disabled = false
    exportButton.textContent = "Export"
  }

  const deleteButton = document.createElement("button")
  deleteButton.textContent = "Delete"
  deleteButton.dataset.do = "delete"
  deleteButton.disabled = session.live
  deleteButton.onclick = () => {
    if (deleteButton.dataset.armed) return act({ type: "delete", id: session.id })()
    deleteButton.dataset.armed = "1"
    deleteButton.textContent = "Really delete?"
    setTimeout(() => {
      delete deleteButton.dataset.armed
      deleteButton.textContent = "Delete"
    }, CONFIRM_MS)
  }
  row.append(what, exportButton, deleteButton)
  return row
}

function renderSessions(sessions: SessionSummary[]) {
  const list = $("sessions")
  $("sessions-title").hidden = sessions.length === 0
  const rows = new Map(Array.from(list.children, row => [(row as HTMLElement).dataset.id, row as HTMLLIElement]))
  // Rows are reused across polls so a half-confirmed delete or a running export keeps its button state.
  const key = (s: SessionSummary) => `${s.id}:${s.live}`
  list.replaceChildren(...sessions.map(session => {
    const row = rows.get(session.id)?.dataset.key === key(session) ? rows.get(session.id)! : sessionRow(session)
    row.dataset.key = key(session)
    const { events, shots, bytes } = session.stats
    row.querySelector(".meta")!.textContent = `${session.game.host ?? session.game.zone ?? "no game traffic"} · ${events} events · ${shots} shots · ${megabytes(bytes)}`
    return row
  }))
}

async function refresh() {
  const status = await ask<Status>({ type: "status" })
  if (!status) return
  const { phase } = status
  const tab = await activeGameTab()
  document.body.dataset.phase = phase
  $("version").textContent = `v${status.version}`
  $("phase").textContent = { idle: "Not recording", recording: "Recording", paused: "Paused" }[phase]
  $("tab").textContent = phase === "idle"
    ? (tab ? "" : "Open the game tab, then press Record.")
    : `${status.tabTitle ?? "Game tab"}${tab && tab.id !== status.tabId ? " (another tab, not this one)" : ""}`

  $("record").hidden = phase !== "idle"
  $<HTMLButtonElement>("record").disabled = !tab
  $("pause").hidden = phase !== "recording"
  $("resume").hidden = phase !== "paused"
  $("stop").hidden = phase === "idle"
  const marker = $("marker")
  const markerAppears = marker.hidden && phase === "recording"
  marker.hidden = phase !== "recording"
  // Alt+M opens this popup, so a recording player can type the marker at once.
  if (markerAppears) $("note").focus()
  $("counters").hidden = phase === "idle"

  const live = status.sessions.find(s => s.live)
  // Frames of a connection that was already open are recorded, but its login, with the client build, has passed.
  $("hint").hidden = phase !== "recording" || Boolean(live?.game.clientBuild)
  if (live) {
    $("events").textContent = String(live.stats.events)
    $("shots").textContent = String(live.stats.shots)
    $("size").textContent = megabytes(live.stats.bytes)
  }
  renderSessions(status.sessions)
}

$("record").onclick = async () => {
  const tab = await activeGameTab()
  if (tab?.id !== undefined) await act({ type: "start", tabId: tab.id })()
}
$("pause").onclick = act({ type: "pause" })
$("resume").onclick = act({ type: "resume" })
$("stop").onclick = act({ type: "stop" })
$("reload").onclick = act({ type: "reload" })
$("marker").onsubmit = async event => {
  event.preventDefault()
  const note = $<HTMLInputElement>("note")
  await ask({ type: "mark", note: note.value.trim() })
  note.value = ""
  // Alt+M, type, Enter. Closing the popup puts the player back in the game.
  window.close()
}

void refresh()
setInterval(refresh, POLL_MS)
