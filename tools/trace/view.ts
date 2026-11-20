import type { RxEvent, Session, TxEvent } from "@gge/recorder/format"
import errNames from "../../packages/bot-core/err.json" with { type: "json" }
import cmdNames from "./cmd-names.json" with { type: "json" }
import type { Call, Joined, Step } from "./model.ts"

const errors = errNames as Record<string, string>
const names = cmdNames as Record<string, { c2s?: string; s2c?: string }>

const esc = (s: unknown) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const json = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 1))
const body = (v: unknown) => (v === "" || v == null ? "" : `<pre>${esc(json(v))}</pre>`)

/** gbd bundles several commands in one frame, so show its keys. */
function rxName(rx: RxEvent): string {
  const keys = rx.cmd === "gbd" && rx.payload && typeof rx.payload === "object" ? Object.keys(rx.payload) : []
  return keys.length ? `gbd [${keys.join(", ")}]` : rx.cmd
}

const resultBadge = (res: number) =>
  res === 0
    ? `<span class="ok">result 0 ${esc(errors["0"] ?? "OK")}</span>`
    : `<span class="err">result ${res} ${esc(errors[String(res)] ?? "unknown error")}</span>`

function request(tx: TxEvent): string {
  const vo = names[tx.cmd]?.c2s
  return `<div class="line"><b class="cmd">${esc(tx.cmd)}</b>${vo ? ` <span class="vo">${esc(vo)}</span>` : ""}</div>${body(tx.payload)}`
}

function reply(call: Call): string {
  const { rx } = call
  if (!rx) return `<div class="line"><span class="warn">no reply</span></div>`
  const s2c = names[rx.cmd]?.s2c
  return `<div class="line"><b class="cmd">${esc(rxName(rx))}</b> ${resultBadge(rx.res)} <span class="ms">${Math.round(call.ms ?? 0)} ms</span>${s2c ? ` <span class="vo">${esc(s2c)}</span>` : ""}</div>${body(rx.payload)}`
}

function call(c: Call): string {
  return `<div class="call" data-cmd="${esc(c.tx.cmd)} ${esc(c.rx?.cmd ?? "")}"><div class="req">${request(c.tx)}</div><div class="rep">${reply(c)}</div></div>`
}

function push(rx: RxEvent): string {
  const s2c = names[rx.cmd]?.s2c
  return `<div class="push" data-cmd="${esc(rx.cmd)}"><div class="line"><b class="cmd">${esc(rxName(rx))}</b> ${resultBadge(rx.res)}${s2c ? ` <span class="vo">${esc(s2c)}</span>` : ""}</div>${body(rx.payload)}</div>`
}

function thumb(id: string | undefined, label: string): string {
  if (!id) return `<div class="shot empty">no ${label}</div>`
  const src = `shots/${esc(id)}.jpg`
  return `<figure class="shot"><img loading="lazy" src="${src}" alt="${label}" data-full="${src}"><figcaption>${label}</figcaption></figure>`
}

function input(step: Step): string {
  const e = step.input
  if (!e) return step.system ? "system handshake" : "background traffic"
  const at = e.type === "key" ? esc(e.key ?? "") : `${Math.round(e.x)},${Math.round(e.y)}`
  const drag = step.drag ? ` drag ${Math.round(step.drag.dx)},${Math.round(step.drag.dy)}` : ""
  return `${e.type} ${at}${drag}`
}

function row(step: Step): string {
  const cmds = [...step.calls.flatMap((c) => [c.tx.cmd, c.rx?.cmd ?? ""]), ...step.pushes.map((p) => p.cmd)]
  const kind = step.input ? "action" : step.system ? "bg system" : "bg"
  const pushes = step.pushes.length
    ? `<details class="pushes"><summary>${step.pushes.length} push${step.pushes.length > 1 ? "es" : ""}: ${esc([...new Set(step.pushes.map(rxName))].join(", "))}</summary>${step.pushes.map(push).join("")}</details>`
    : ""
  const sys = step.sys?.length
    ? `<details class="pushes"><summary>${step.sys.length} xml frames</summary>${step.sys.map((s) => `<pre>${esc(s.dir)} ${esc(s.raw)}</pre>`).join("")}</details>`
    : ""
  const shots = step.input ? `<div class="shots">${thumb(step.pre, "pre")}${thumb(step.post, "post")}</div>` : ""
  return `<section class="step ${kind}" data-cmds="${esc([...new Set(cmds)].join(" "))}"><header><span class="idx">#${step.i}</span> <span class="in">${input(step)}</span> <span class="t">${new Date(step.t).toISOString().slice(11, 23)}</span></header>${shots}<div class="calls">${step.calls.map(call).join("")}</div>${pushes}${sys}</section>`
}

const CSS = `
:root{--bg:#fafafa;--fg:#1c1c1e;--mut:#6b6b73;--card:#fff;--line:#dcdce0;--ok:#1a7f37;--err:#c62828;--accent:#2457c5;--on:#fff;--code:#f1f1f4}
@media(prefers-color-scheme:dark){:root{--bg:#141416;--fg:#e8e8ec;--mut:#9a9aa5;--card:#1d1d21;--line:#34343b;--ok:#4cc26a;--err:#ff7b72;--accent:#7aa2ff;--on:#0d1b3a;--code:#26262b}}
*{box-sizing:border-box}body{margin:0;padding:0 16px 48px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto}h1{font-size:18px;margin:16px 0 4px}.meta{color:var(--mut);margin:0 0 12px}
.bar{position:sticky;top:0;background:var(--bg);padding:8px 0;display:flex;gap:12px;flex-wrap:wrap;align-items:center;z-index:2;border-bottom:1px solid var(--line)}
.bar input[type=search]{flex:1 1 180px;min-width:0;padding:6px 8px;font:inherit;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:6px}
h2.task{margin:24px 0 8px;font-size:15px;padding:6px 10px;background:var(--accent);color:var(--on);border-radius:6px}
.step{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px;margin:8px 0}
.step.bg{opacity:.6}.step.bg header .in{font-style:italic}
body.hide-bg .step.bg{display:none}.step.filtered{display:none}
header{display:flex;gap:10px;flex-wrap:wrap;align-items:baseline;margin-bottom:6px}.idx{font-weight:700}.in{font-weight:600}.t{color:var(--mut);margin-left:auto;font-size:12px}
.shots{display:flex;gap:8px;margin-bottom:8px;max-width:760px}.shot{flex:1 1 0;min-width:0;margin:0}.shot img{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:4px;cursor:zoom-in}
.shot figcaption{font-size:11px;color:var(--mut)}.shot.empty{display:flex;align-items:center;justify-content:center;min-height:60px;border:1px dashed var(--line);border-radius:4px;color:var(--mut);font-size:12px}
.call{display:grid;grid-template-columns:1fr 1fr;gap:8px;border-top:1px solid var(--line);padding:6px 0}
@media(max-width:640px){.call{grid-template-columns:1fr}.t{margin-left:0}}
.line{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}.cmd{font-family:ui-monospace,monospace}.vo,.ms{color:var(--mut);font-size:12px}
.ok{color:var(--ok)}.err{color:var(--err);font-weight:700}.warn{color:var(--mut);font-style:italic}
pre{margin:4px 0 0;padding:6px;background:var(--code);border-radius:4px;overflow:auto;max-height:200px;font-size:12px;white-space:pre-wrap;word-break:break-word}
details.pushes{border-top:1px solid var(--line);padding-top:6px}summary{cursor:pointer;color:var(--mut)}.push{margin:6px 0}
#lb{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;z-index:10;cursor:zoom-out}#lb.on{display:flex}#lb img{max-width:96vw;max-height:96vh}
`

const JS = `
const q=document.getElementById('q'),bg=document.getElementById('bg'),lb=document.getElementById('lb')
function apply(){const t=q.value.trim().toLowerCase().split(/[\\s,]+/).filter(Boolean)
document.body.classList.toggle('hide-bg',bg.checked)
for(const s of document.querySelectorAll('.step')){const c=' '+s.dataset.cmds.toLowerCase()+' '
s.classList.toggle('filtered',t.length>0&&!t.some(x=>c.includes(' '+x+' ')))}}
q.addEventListener('input',apply);bg.addEventListener('change',apply)
document.addEventListener('click',e=>{const i=e.target.closest('img[data-full]');if(i){lb.firstChild.src=i.dataset.full;lb.classList.add('on')}else if(lb.contains(e.target))lb.classList.remove('on')})
`

export function view(session: Session, { steps, tasks }: Joined): string {
  const taskStart = new Map(tasks.flatMap((t) => (t.steps[0] === undefined ? [] : [[t.steps[0], t.label] as const])))
  const rows = steps.map((s) => {
    const label = taskStart.get(s.i)
    return `${label === undefined ? "" : `<h2 class="task">${esc(label || "(unlabelled mark)")}</h2>`}${row(s)}`
  })
  const when = new Date(session.startedAt).toISOString()
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trace ${esc(session.id)}</title><style>${CSS}</style></head><body><main><h1>Session ${esc(session.id)}</h1><p class="meta">${esc(when)} · client ${esc(session.game.clientBuild ?? "unknown")} · ${steps.length} steps · ${tasks.length} tasks</p><div class="bar"><input id="q" type="search" placeholder="filter by cmd, e.g. sbp gcu" aria-label="filter by cmd"><label><input id="bg" type="checkbox"> hide background</label></div>${rows.join("")}</main><div id="lb"><img alt=""></div><script>${JS}</script></body></html>`
}
