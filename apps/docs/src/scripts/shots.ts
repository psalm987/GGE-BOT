for (const opener of document.querySelectorAll<HTMLButtonElement>(".gge-shot__open")) {
    const dialog = document.getElementById(opener.dataset.dialog ?? "") as HTMLDialogElement | null
    if (!dialog) continue
    opener.addEventListener("click", () => dialog.showModal())
    dialog.addEventListener("click", event => {
        if (event.target === dialog || (event.target as HTMLElement).closest("[data-close]")) dialog.close()
    })
    dialog.addEventListener("close", () => opener.focus())
}

for (const group of document.querySelectorAll<HTMLElement>("[data-hotspots]")) {
    const spots = [...group.querySelectorAll<HTMLButtonElement>(".gge-spot")]
    const entries = [...group.querySelectorAll<HTMLElement>(".gge-legend > li")]
    const pair = (n: string | undefined, on: boolean) => {
        spots.find(spot => spot.dataset.spot === n)?.classList.toggle("is-paired", on)
        entries.find(entry => entry.dataset.spot === n)?.classList.toggle("is-paired", on)
    }
    for (const el of [...spots, ...entries]) {
        el.addEventListener("pointerenter", () => pair(el.dataset.spot, true))
        el.addEventListener("pointerleave", () => pair(el.dataset.spot, false))
        el.addEventListener("focusin", () => pair(el.dataset.spot, true))
        el.addEventListener("focusout", () => pair(el.dataset.spot, false))
    }
    for (const spot of spots) {
        spot.addEventListener("click", () => {
            const entry = document.getElementById(spot.getAttribute("aria-controls") ?? "")
            if (!entry) return
            for (const other of entries) other.classList.remove("is-target")
            void entry.offsetWidth
            entry.classList.add("is-target")
            entry.focus()
            entry.addEventListener("blur", () => entry.classList.remove("is-target"), { once: true })
        })
    }
    const layer = group.querySelector<HTMLElement>(".gge-spots")
    if (layer && "IntersectionObserver" in window) {
        const watch = new IntersectionObserver(seen => {
            if (!seen.some(entry => entry.isIntersecting)) return
            layer.dataset.seen = ""
            watch.disconnect()
        }, { threshold: 0.5 })
        watch.observe(layer)
    }
}
