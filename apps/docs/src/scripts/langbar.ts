import { pickLocale } from "../seo/pick-locale.ts"

const KEY = "gge-langbar-dismissed"
const bar = document.querySelector<HTMLElement>("[data-gge-langbar]")

type Option = { name: string; href: string; prompt: string; close: string }

function dismissed(): boolean {
    try {
        return localStorage.getItem(KEY) === "1"
    } catch {
        return false
    }
}

function remember() {
    try {
        localStorage.setItem(KEY, "1")
    } catch {}
}

if (bar && !dismissed()) {
    const options: Record<string, Option> = JSON.parse(bar.dataset.options ?? "{}")
    const pick = pickLocale(navigator.languages?.length ? navigator.languages : [navigator.language], bar.dataset.current ?? "", Object.keys(options))
    const option = pick && options[pick]
    if (option && pick) {
        const text = document.createElement("p")
        text.lang = pick
        text.textContent = option.prompt
        const link = document.createElement("a")
        link.href = option.href
        link.lang = pick
        link.hreflang = pick
        link.textContent = option.name
        const close = document.createElement("button")
        close.type = "button"
        close.setAttribute("aria-label", option.close)
        close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
        close.addEventListener("click", () => {
            remember()
            const hadFocus = bar.contains(document.activeElement)
            bar.replaceChildren()
            if (hadFocus) {
                const main = document.querySelector<HTMLElement>("main")
                main?.setAttribute("tabindex", "-1")
                main?.focus({ preventScroll: true })
            }
        })
        bar.dir = document.documentElement.dir
        bar.append(text, link, close)
    }
}
