const INPUT = "#starlight__search .pagefind-ui__search-input"

/** Open Starlight's search dialog and type a query into it. Pagefind mounts its input after the dialog opens. */
function openSearch(query: string) {
    document.querySelector<HTMLButtonElement>("button[data-open-modal]")?.click()
    const started = performance.now()
    const timer = setInterval(() => {
        const input = document.querySelector<HTMLInputElement>(INPUT)
        if (input) {
            input.value = query
            input.dispatchEvent(new Event("input", { bubbles: true }))
            input.focus()
        }
        if (input || performance.now() - started > 5000) clearInterval(timer)
    }, 50)
}

const form = document.querySelector<HTMLFormElement>("[data-gge-search-form]")
form?.addEventListener("submit", event => {
    event.preventDefault()
    openSearch(form.querySelector("input")?.value ?? "")
})

const query = new URLSearchParams(location.search).get("q")
if (query) openSearch(query)
