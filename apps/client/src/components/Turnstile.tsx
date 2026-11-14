import { useEffect, useRef } from "react"

export const TURNSTILE_SITE_KEY: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY || undefined

type Widget = { render(el: HTMLElement, options: object): string; remove(id: string): void }
declare global { interface Window { turnstile?: Widget } }

let script: Promise<Widget> | undefined
const loadTurnstile = () => script ??= new Promise<Widget>((resolve, reject) => {
    const el = document.createElement("script")
    el.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    el.async = true
    el.onload = () => resolve(window.turnstile!)
    el.onerror = () => { script = undefined; reject(new Error("Captcha failed to load")) }
    document.head.append(el)
})

/** A Turnstile widget as a form control: `onChange` gets the token, or undefined once it expires. Remount it to get a fresh token. */
export function Turnstile({ onChange }: { onChange?: (token: string | undefined) => void }) {
    const host = useRef<HTMLDivElement>(null)
    const change = useRef(onChange)
    change.current = onChange
    useEffect(() => {
        let id: string | undefined
        let widget: Widget | undefined
        let cancelled = false
        void loadTurnstile().then(w => {
            if (cancelled || !host.current)
                return
            widget = w
            id = w.render(host.current, {
                sitekey: TURNSTILE_SITE_KEY,
                callback: (token: string) => change.current?.(token),
                "expired-callback": () => change.current?.(undefined),
                "error-callback": () => change.current?.(undefined),
            })
        }, () => undefined)
        return () => {
            cancelled = true
            if (id)
                widget?.remove(id)
        }
    }, [])
    return <div ref={host} />
}
