import domains from "disposable-email-domains" with { type: "json" }

const disposable = new Set<string>(domains)

/** True when the address's domain, or any parent domain of it, is a known throwaway provider. */
export function isDisposable(email: string) {
    const labels = email.slice(email.lastIndexOf("@") + 1).toLowerCase().split(".")
    return labels.some((_, i) => disposable.has(labels.slice(i).join(".")))
}

export const DISPOSABLE_MESSAGE = "Please use a permanent email address"
