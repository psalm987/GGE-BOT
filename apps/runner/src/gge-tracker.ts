import {
    FORTRESS_KINGDOMS, GGE_TRACKER_CONSENT, GgeTrackerRequest,
    type GgeTrackerReply, type TrackerFortress, type TrackerStormFort,
} from "@gge/contracts"

/**
 * Timetables from gge-tracker.com, an unofficial community site, read for the accounts whose players opted in. One cache
 * per game server serves every account on it, so the fleet asks the site once, not once per account. Only GETs leave,
 * and they name the game server and, when the player ticked the second box, the player. Nothing of ours is ever sent.
 * Ported from Lazy Lord's be/fortressTracker.js and be/stormTracker.js (MIT). See docs/protocol/gge-tracker.md.
 */

export const TRACKER_API = "https://api.gge-tracker.com/api/v1/"
/** A browser's generic User-Agent: nothing about the account, the player or this bot. */
const USER_AGENT = "Mozilla/5.0 (compatible)"
const REQUEST_TIMEOUT_MS = 10_000
const MINUTE = 60_000

export const TRACKER_WINDOWS = {
    /** A fortress list holds each fortress's next free moment for the coming day, so it is fetched once a day. */
    fortressListMs: 24 * 60 * MINUTE,
    fortressRetryMs: 30 * MINUTE,
    /** The fort list is fetched again when its last fort comes free within this long. */
    stormNearEndMs: 30 * MINUTE,
    /** ...but never sooner than this after the last fetch, which is also the wait after a failure. */
    stormMinGapMs: 15 * MINUTE,
    catalogRetryMs: 30 * MINUTE,
}

/** A kingdom has from about 60 fortresses to over 2,000, read 100 a page as the site's own page reads them. */
const FORTRESS_PAGE = 100
const MAX_FORTRESS_PAGES = 40
/** One page holds a server's whole fort list, about 250 forts. */
const STORM_PAGE = 500
const MAX_STORM_PAGES = 5

/** The account as the tracker needs it: whose consent, which game server, and the name the player gave us. */
export type TrackerAccount = { name: string; serverId: number; plugins: Record<string, Record<string, unknown> | undefined> }
/** A game server as 1.xml names it: `generic_country_IN` and `1`. */
export type ServerNames = { locaId: string; instanceName: string }

type Feature = "fortress" | "storm"
type Catalog = Record<Feature, Set<string>>

/** One cached fetch: the value, when it came, and when the last fetch failed. Callers that ask meanwhile share one fetch. */
type Entry<T> = { value?: T; fetchedAt: number; failedAt: number; pending?: Promise<void> }

class TimedCache<T> {
    private readonly entries = new Map<string, Entry<T>>()
    private readonly now: () => number
    private readonly retryMs: number
    private readonly fresh: (value: T, fetchedAt: number, now: number) => boolean
    private readonly onError: (key: string, error: unknown) => void

    constructor(now: () => number, retryMs: number, fresh: (value: T, fetchedAt: number, now: number) => boolean, onError: (key: string, error: unknown) => void) {
        this.now = now
        this.retryMs = retryMs
        this.fresh = fresh
        this.onError = onError
    }

    /** The value for `key`, fetched with `load` unless it is fresh or a fetch failed within retryMs. */
    async get(key: string, load: () => Promise<T>): Promise<{ value: T; fetchedAt: number } | undefined> {
        let entry = this.entries.get(key)
        if (!entry)
            this.entries.set(key, entry = { fetchedAt: 0, failedAt: 0 })
        const now = this.now()
        const settled = entry.value !== undefined && this.fresh(entry.value, entry.fetchedAt, now)
        if (!entry.pending && !settled && now - entry.failedAt >= this.retryMs) {
            const it = entry
            it.pending = load().then(
                value => { it.value = value; it.fetchedAt = this.now() },
                error => { it.failedAt = this.now(); this.onError(key, error) },
            ).finally(() => { it.pending = undefined })
        }
        await entry.pending
        return entry.value === undefined ? undefined : { value: entry.value, fetchedAt: entry.fetchedAt }
    }
}

/** The site's catalog: which of its servers are on and have fortress or storm data. */
export function parseCatalog(xml: string): Catalog {
    const catalog: Catalog = { fortress: new Set(), storm: new Set() }
    for (const [, block] of xml.matchAll(/<server>([\s\S]*?)<\/server>/g)) {
        const field = (tag: string) => block!.match(new RegExp(`<${tag}>(.*?)</${tag}>`))?.[1]?.trim()
        const name = field("name")
        if (!name || field("enabled") !== "true")
            continue
        for (const feature of ["fortress", "storm"] as const)
            if (field(feature) === "true")
                catalog[feature].add(name)
    }
    return catalog
}

/** The names the site might use for a game server, best first: generic_country_IN + 1 is "IN1", generic_country_ASIA + 1 falls back to "ASIA". */
export function trackerNames({ locaId, instanceName }: ServerNames): string[] {
    const code = locaId.match(/^generic_(?:country|language)_(.+)$/i)?.[1]?.toUpperCase()
    if (!code)
        return []
    const prefix = code === "INTERNATIONAL" ? "INT" : code
    return [prefix + instanceName, prefix]
}

const fortressFrom = (raw: Record<string, unknown>, kingdom: number): TrackerFortress | undefined => {
    const fortress = {
        x: Number(raw.position_x), y: Number(raw.position_y),
        // When this player can attack it next; the time for everyone when the site has none for the player.
        availableAt: Date.parse(String(raw.effective_cooldown_until ?? raw.global_available_at)),
    }
    return Number(raw.kid) === kingdom && Object.values(fortress).every(Number.isFinite) ? fortress : undefined
}

const fortFrom = (raw: Record<string, unknown>): TrackerStormFort | undefined => {
    const fort = {
        x: Number(raw.position_x), y: Number(raw.position_y), isleID: Number(raw.isle_id), victories: Number(raw.victory_count),
        visible: raw.is_visible === true, availableAt: Date.parse(String(raw.available_at)), updatedAt: Date.parse(String(raw.updated_at)),
    }
    return Object.values(fort).every(value => typeof value === "boolean" || Number.isFinite(value)) ? fort : undefined
}

export class GgeTracker {
    private readonly fetch: typeof globalThis.fetch
    private readonly now: () => number
    private readonly serverNames: (serverId: number) => ServerNames | undefined
    private readonly log: Pick<Console, "warn">
    private readonly pageGapMs: number
    private readonly catalog: TimedCache<Catalog>
    private readonly fortressLists: TimedCache<{ fortresses: TrackerFortress[]; withName: boolean }>
    private readonly fortLists: TimedCache<TrackerStormFort[]>

    constructor({ fetch = globalThis.fetch, now = Date.now, serverNames, logger = console, pageGapMs = 500 }: {
        fetch?: typeof globalThis.fetch
        now?: () => number
        /** 1.xml's names for a game server id, from which the site's name is found. */
        serverNames: (serverId: number) => ServerNames | undefined
        logger?: Pick<Console, "warn">
        /** The pause between two pages of one list, as a person paging through the site would leave. */
        pageGapMs?: number
    }) {
        this.fetch = fetch
        this.now = now
        this.serverNames = serverNames
        this.log = logger
        this.pageGapMs = pageGapMs
        const warn = (what: string) => (key: string, error: unknown) => this.log.warn(`gge-tracker ${what} ${key}: ${error instanceof Error ? error.message : String(error)}`)
        this.catalog = new TimedCache(now, TRACKER_WINDOWS.catalogRetryMs, () => true, warn("catalog"))
        this.fortressLists = new TimedCache(now, TRACKER_WINDOWS.fortressRetryMs,
            (_, fetchedAt, at) => at - fetchedAt < TRACKER_WINDOWS.fortressListMs, warn("fortresses"))
        this.fortLists = new TimedCache(now, TRACKER_WINDOWS.stormMinGapMs, (forts, fetchedAt, at) =>
            at - fetchedAt < TRACKER_WINDOWS.stormMinGapMs || Math.max(0, ...forts.map(fort => fort.availableAt)) - at >= TRACKER_WINDOWS.stormNearEndMs, warn("storm forts"))
    }

    /**
     * Answers one worker's GgeTracker message for its account. Undefined when the message has no id to answer to. The
     * consent is read here, from the account's own settings, so a worker can't fetch for an account that hasn't opted in.
     */
    async answer(account: TrackerAccount, payload: unknown): Promise<GgeTrackerReply | undefined> {
        const parsed = GgeTrackerRequest.safeParse(payload)
        if (!parsed.success) {
            const id = (payload as { id?: unknown } | null)?.id
            return Number.isInteger(id) ? { id: id as number, ok: false, error: "badRequest" } : undefined
        }
        const request = parsed.data
        const consent = account.plugins[GGE_TRACKER_CONSENT.plugin]
        if (consent?.[GGE_TRACKER_CONSENT.timetables] !== true)
            return { id: request.id, ok: false, error: "off" }
        const playerName = consent[GGE_TRACKER_CONSENT.playerName] === true ? account.name : undefined

        const server = await this.serverFor(account.serverId, request.kind === "fortresses" ? "fortress" : "storm")
        if (server === "unavailable" || server === undefined)
            return { id: request.id, ok: false, error: server ?? "noServer" }

        if (request.kind === "fortresses") {
            if (!(FORTRESS_KINGDOMS as readonly number[]).includes(request.kingdom))
                return { id: request.id, ok: false, error: "badRequest" }
            const list = await this.fortressLists.get(`${server}|${request.kingdom}|${playerName ?? ""}`, () => this.dayList(server, request.kingdom, playerName))
            return list ? { id: request.id, ok: true, kind: "fortresses", server, fetchedAt: list.fetchedAt, ...list.value } : { id: request.id, ok: false, error: "unavailable" }
        }
        const forts = await this.fortLists.get(server, () => this.fetchForts(server))
        return forts ? { id: request.id, ok: true, kind: "stormForts", server, fetchedAt: forts.fetchedAt, forts: forts.value } : { id: request.id, ok: false, error: "unavailable" }
    }

    private async serverFor(serverId: number, feature: Feature): Promise<string | undefined | "unavailable"> {
        const names = this.serverNames(serverId)
        if (!names)
            return undefined
        const catalog = await this.catalog.get("servers", async () => parseCatalog(await this.get("servers/catalog", undefined, response => response.text())))
        if (!catalog)
            return "unavailable"
        return trackerNames(names).find(name => catalog.value[feature].has(name))
    }

    private async get<T>(path: string, server: string | undefined, read: (response: Response) => Promise<T>): Promise<T> {
        const response = await this.fetch(TRACKER_API + path, {
            method: "GET",
            headers: { "user-agent": USER_AGENT, ...(server && { "gge-server": server }) },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        if (!response.ok)
            throw new Error(`answered ${response.status} for ${path.split("?")[0]}`)
        return read(response)
    }

    private async pages<T>(path: (page: number) => string, server: string, maxPages: number, listKey: string, parse: (raw: Record<string, unknown>) => T | undefined) {
        const items: T[] = []
        for (let page = 1; page <= maxPages; page++) {
            if (page > 1 && this.pageGapMs > 0)
                await new Promise(resolve => setTimeout(resolve, this.pageGapMs))
            const data = await this.get(path(page), server, response => response.json()) as { pagination?: { total_pages?: unknown } } & Record<string, unknown>
            const list = data[listKey]
            if (!Array.isArray(list))
                throw new Error(`sent no ${listKey} list`)
            items.push(...list.flatMap(raw => parse(Object(raw)) ?? []))
            if (!(Number(data.pagination?.total_pages) > page))
                break
        }
        return items
    }

    private fetchFortresses(server: string, kingdom: number, playerName: string | undefined) {
        const filter = `&filterByKid=${encodeURIComponent(JSON.stringify([String(kingdom)]))}` + (playerName ? `&filterByPlayerName=${encodeURIComponent(playerName)}` : "")
        return this.pages(page => `dungeons?page=${page}&size=${FORTRESS_PAGE}${filter}`, server, MAX_FORTRESS_PAGES, "dungeons", raw => fortressFrom(raw, kingdom))
    }

    /**
     * The kingdom's fortresses that come free within the coming day. A name the site doesn't know, such as a new
     * account's, gets an empty list: then the list for everyone, without the player's own cooldowns.
     */
    private async dayList(server: string, kingdom: number, playerName: string | undefined) {
        let withName = playerName !== undefined
        let fortresses = await this.fetchFortresses(server, kingdom, playerName)
        if (withName && fortresses.length === 0) {
            withName = false
            fortresses = await this.fetchFortresses(server, kingdom, undefined)
        }
        const until = this.now() + TRACKER_WINDOWS.fortressListMs
        return { fortresses: fortresses.filter(fortress => fortress.availableAt <= until), withName }
    }

    private fetchForts(server: string) {
        return this.pages(page => `storms/forts?page=${page}&size=${STORM_PAGE}`, server, MAX_STORM_PAGES, "forts", fortFrom)
    }
}
