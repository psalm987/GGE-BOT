const popovers = [...document.querySelectorAll<HTMLElement>(".gge-term__pop")]
const HOVER_DELAY = 300
const LEAVE_DELAY = 250
const GAP = 8
const SHEET = matchMedia("(max-width: 39.99rem)")

function place(button: HTMLElement, pop: HTMLElement) {
    if (SHEET.matches) {
        pop.style.removeProperty("inset")
        return
    }
    const rtl = getComputedStyle(button).direction === "rtl"
    const from = button.getBoundingClientRect()
    const width = pop.offsetWidth
    const height = pop.offsetHeight
    const edge = rtl ? from.right - width : from.left
    const left = Math.min(Math.max(edge, GAP), innerWidth - width - GAP)
    const below = from.bottom + GAP
    const top = below + height > innerHeight - GAP && from.top - GAP - height > GAP ? from.top - GAP - height : below
    pop.style.inset = `${Math.max(top, GAP)}px auto auto ${Math.max(left, GAP)}px`
}

for (const pop of popovers) {
    const button = pop.parentElement?.querySelector<HTMLElement>(".gge-term__btn")
    if (!button) continue
    let timer: ReturnType<typeof setTimeout> | undefined
    let byHover = false

    const clear = () => clearTimeout(timer)
    const open = (viaHover: boolean) => {
        clear()
        if (pop.matches(":popover-open")) return
        byHover = viaHover
        pop.showPopover()
    }
    const close = () => {
        clear()
        if (pop.matches(":popover-open")) pop.hidePopover()
    }

    pop.addEventListener("beforetoggle", event => {
        const closing = (event as ToggleEvent).newState === "closed"
        if (closing && pop.contains(document.activeElement)) button.focus()
        if (!closing) requestAnimationFrame(() => place(button, pop))
    })
    pop.addEventListener("toggle", event => {
        const opened = (event as ToggleEvent).newState === "open"
        button.setAttribute("aria-expanded", String(opened))
        if (opened) place(button, pop)
        else byHover = false
    })
    button.addEventListener("click", () => {
        byHover = false
    })

    const enter = (event: PointerEvent) => {
        if (event.pointerType !== "mouse") return
        clear()
        if (!pop.matches(":popover-open")) timer = setTimeout(() => open(true), HOVER_DELAY)
    }
    const leave = (event: PointerEvent) => {
        if (event.pointerType !== "mouse") return
        clear()
        if (byHover) timer = setTimeout(close, LEAVE_DELAY)
    }
    for (const el of [button, pop]) {
        el.addEventListener("pointerenter", enter)
        el.addEventListener("pointerleave", leave)
    }
    const reposition = () => {
        if (pop.matches(":popover-open")) place(button, pop)
    }
    addEventListener("scroll", reposition, { passive: true })
    addEventListener("resize", reposition)
}
