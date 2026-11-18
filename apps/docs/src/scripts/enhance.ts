const WIDE = matchMedia("(min-width: 90rem)")
const live = document.querySelector<HTMLElement>("[data-gge-live]")

type Note = { wrap: HTMLElement; mark: HTMLButtonElement; body: HTMLElement; open: boolean }

const notes: Note[] = [...document.querySelectorAll<HTMLElement>(".gge-sidenote")].flatMap((wrap, index) => {
    const mark = wrap.querySelector<HTMLButtonElement>(".gge-sidenote__mark")
    const body = wrap.querySelector<HTMLElement>(".gge-sidenote__body")
    if (!mark || !body) return []
    mark.dataset.n = body.dataset.n = String(index + 1)
    mark.textContent = String(index + 1)
    mark.setAttribute("aria-label", `${mark.getAttribute("aria-label")} ${index + 1}`)
    mark.hidden = false
    return [{ wrap, mark, body, open: false }]
})

function setOpen(note: Note, open: boolean) {
    note.open = open
    note.body.classList.toggle("is-open", open)
    if (WIDE.matches) note.mark.removeAttribute("aria-expanded")
    else note.mark.setAttribute("aria-expanded", String(open))
}

/** Below the margin-column width a note sits under its paragraph, in the order its markers appear. */
function placeNotes() {
    const lastInBlock = new Map<Element, Element>()
    for (const note of notes) {
        const block = note.wrap.closest("p")
        if (WIDE.matches || !block) {
            if (note.body.parentElement !== note.wrap) note.wrap.append(note.body)
        } else {
            const after = lastInBlock.get(block) ?? block
            if (after.nextElementSibling !== note.body) after.after(note.body)
            lastInBlock.set(block, note.body)
        }
        setOpen(note, note.open)
    }
}

for (const note of notes) {
    const pair = (on: boolean) => {
        note.mark.classList.toggle("is-paired", on)
        note.body.classList.toggle("is-paired", on)
    }
    for (const el of [note.mark, note.body]) {
        el.addEventListener("pointerenter", () => pair(true))
        el.addEventListener("pointerleave", () => pair(false))
        el.addEventListener("focusin", () => pair(true))
        el.addEventListener("focusout", () => pair(false))
    }
    note.mark.addEventListener("click", () => {
        if (WIDE.matches) arriveAt(note.body)
        else setOpen(note, !note.open)
    })
}
WIDE.addEventListener("change", placeNotes)
placeNotes()

function announce(message: string) {
    if (!live) return
    live.textContent = ""
    requestAnimationFrame(() => {
        live.textContent = message
    })
    setTimeout(() => {
        if (live.textContent === message) live.textContent = ""
    }, 4000)
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".gge-aside__copy")) {
    button.addEventListener("click", async () => {
        const url = `${location.origin}${location.pathname}#${button.dataset.copyId}`
        try {
            await navigator.clipboard.writeText(url)
        } catch {
            return
        }
        button.dataset.state = "copied"
        announce(button.dataset.copied ?? "")
        setTimeout(() => delete button.dataset.state, 1800)
    })
}

let highlighted: HTMLElement | null = null

function arriveAt(target: HTMLElement) {
    const note = notes.find(n => n.body === target)
    if (note && !WIDE.matches) setOpen(note, true)
    const frame = target.closest<HTMLElement>(".sl-heading-wrapper") ?? target
    highlighted?.classList.remove("gge-arrival")
    void frame.offsetWidth
    frame.classList.add("gge-arrival")
    highlighted = frame
    if (!target.hasAttribute("tabindex")) target.tabIndex = -1
    target.focus()
    target.addEventListener("blur", () => frame.classList.remove("gge-arrival"), { once: true })
}

function arrive() {
    if (!location.hash.length) return
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)))
    if (target) arriveAt(target)
}

addEventListener("hashchange", arrive)
arrive()
