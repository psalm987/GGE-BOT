import * as z from "zod"

export const PROXY_SCHEMES = ["http", "https", "socks5", "socks5h"] as const
export type ProxyScheme = typeof PROXY_SCHEMES[number]

/** A proxy URL's parts that are safe to show: no username, no password. */
export type ProxyEndpoint = { scheme: ProxyScheme; host: string; port: number }

/**
 * Reads a proxy URL such as `socks5h://user:pass@10.0.0.5:1080`. Null unless it has an allowed scheme,
 * a host and an explicit port, and nothing after them.
 */
export function parseProxyUrl(raw: string): ProxyEndpoint | null {
    const scheme = /^([a-z0-9]+):\/\//i.exec(raw)?.[1]?.toLowerCase() as ProxyScheme | undefined
    if (!scheme || !PROXY_SCHEMES.includes(scheme))
        return null
    let url: URL
    try {
        // Parsed under a scheme with no default port, so `http://host:80` keeps its port and `http://host` has none.
        url = new URL(`proxy${raw.slice(scheme.length)}`)
    } catch {
        return null
    }
    const port = Number(url.port)
    if (!url.hostname || !url.port || port < 1 || (url.pathname !== "" && url.pathname !== "/") || url.search || url.hash)
        return null
    return { scheme, host: url.hostname, port }
}

/** `scheme://host:port`, the only form of a proxy URL that is stored readable or sent to a browser. */
export function proxyHostHint(url: string) {
    const endpoint = parseProxyUrl(url)
    if (!endpoint)
        throw new Error("not a proxy URL")
    return `${endpoint.scheme}://${endpoint.host}:${endpoint.port}`
}

/** Write-only: the API seals it for the runner and never returns it. */
export const ProxyUrl = z.string().trim().max(2048)
    .refine(url => parseProxyUrl(url) !== null, "Enter a proxy URL like socks5h://user:password@host:1080. The scheme must be http, https, socks5 or socks5h, and the port is required.")

const ProxyLabel = z.string().trim().min(1).max(64)
const MaxAccounts = z.number().int().min(1).max(1000)

export const AdminProxy = z.object({
    id: z.uuid(),
    label: z.string(),
    /** `scheme://host:port`. The credentials never leave the database. */
    hostHint: z.string(),
    enabled: z.boolean(),
    /** How many accounts the runner assigns to this proxy on its own. A manual pin may go over it. */
    maxAccounts: z.number().int(),
    /** Accounts assigned to this proxy, running or not. Event twins use their main's proxy and aren't counted. */
    accountCount: z.number().int(),
    consecutiveFailures: z.number().int(),
    lastOkAt: z.date().nullable(),
    lastErrorAt: z.date().nullable(),
    lastError: z.string().nullable(),
    /** Set when the runner turned the proxy off after repeated failures; null when an admin did, or it is on. */
    disabledReason: z.string().nullable(),
})
export type AdminProxy = z.infer<typeof AdminProxy>

export const CreateProxy = z.object({ label: ProxyLabel, url: ProxyUrl, maxAccounts: MaxAccounts.default(3) })

/** Omit `url` to keep the stored one. `enabled: true` also clears the failure count and the disabled reason. */
export const UpdateProxy = z.object({
    id: z.uuid(),
    label: ProxyLabel.optional(),
    url: ProxyUrl.optional(),
    maxAccounts: MaxAccounts.optional(),
    enabled: z.boolean().optional(),
})

/** How many failures in a row turn a proxy off. */
export const PROXY_MAX_FAILURES = 5
/** The status of an account that can't start because PROXY_REQUIRED is on and no proxy has room. */
export const NO_PROXY_FREE = "No proxy is free"
