const root = document.querySelector<HTMLElement>(".gge-glossary")

if (root) {
    const buttons = [...root.querySelectorAll<HTMLButtonElement>(".gge-filter")]
    const entries = [...root.querySelectorAll<HTMLElement>(".gge-gloss")]
    const sections = [...root.querySelectorAll<HTMLElement>(".gge-letter")]
    const letters = [...root.querySelectorAll<HTMLAnchorElement>(".gge-letters a")]
    const count = root.querySelector<HTMLElement>(".gge-glossary__count")
    const total = root.dataset.total ?? String(entries.length)
    const template = count?.textContent ?? ""

    const apply = (category: string) => {
        let shown = 0
        for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.category === category))
        for (const entry of entries) {
            const visible = category === "all" || entry.dataset.category === category
            entry.hidden = !visible
            if (visible) shown++
        }
        for (const section of sections) section.hidden = section.querySelectorAll(".gge-gloss:not([hidden])").length === 0
        for (const link of letters) link.hidden = root.querySelector<HTMLElement>(`.gge-letter[data-letter="${link.dataset.letter}"]`)?.hidden ?? false
        if (count) count.textContent = template.replace(total, String(shown))
    }

    for (const button of buttons) button.addEventListener("click", () => apply(button.dataset.category ?? "all"))

    addEventListener("hashchange", () => {
        const target = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null
        if (!target?.closest("[hidden]")) return
        apply("all")
        target.focus()
    })
}
