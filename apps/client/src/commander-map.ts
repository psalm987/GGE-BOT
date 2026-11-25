import { MAX_COMMANDERS, MODULES, sendsCommanders, type CommanderBucket, type CommanderMap, type PluginCatalogEntry, type PluginSettings } from "@gge/contracts"

/** Owns no commander: the choice that takes commanders away from their owner. */
export const NOBODY = ""

/** Who owns commander `position`, counted from 1. */
export const ownerOf = (map: CommanderMap, position: number): string => map[position - 1] ?? NOBODY

/** Whether any commander has an owner. A map with none is no map: every plugin keeps its own commander list. */
export const isMapSet = (map: CommanderMap): boolean => map.some(owner => owner !== NOBODY)

/**
 * Whether the map decides the commanders of `plugins`, which then ignore their own lists. It doesn't for a plugin in
 * `keepsOwnList` that the map gives nothing, directly or through a bucket.
 */
export function mapDecides(map: CommanderMap, buckets: CommanderBucket[], keepsOwnList: readonly string[], plugins: readonly string[]): boolean {
    if (!isMapSet(map))
        return false
    const given = (plugin: string) => map.includes(plugin) || buckets.some(bucket => bucket.members.includes(plugin) && map.includes(bucket.key))
    return plugins.some(plugin => !keepsOwnList.includes(plugin) || given(plugin))
}

/** The map as it is stored: no unowned commanders at its end, so a cleared map is the empty default. */
const stored = (map: CommanderMap): CommanderMap => map.slice(0, map.findLastIndex(owner => owner !== NOBODY) + 1)

/** The map with commanders `from` to `to` given to `owner`, whoever had them. Numbers outside 1 to 50 are left out. */
export function assignRange(map: CommanderMap, owner: string, from: number, to: number): CommanderMap {
    const next = Array.from({ length: MAX_COMMANDERS }, (_, i) => map[i] ?? NOBODY)
    for (let position = Math.max(1, from); position <= Math.min(MAX_COMMANDERS, to); position++)
        next[position - 1] = owner
    return stored(next)
}

/** The map after a click on a commander's tile: it goes to `owner`, or to nobody when `owner` has it already. */
export const toggleOwner = (map: CommanderMap, owner: string, position: number): CommanderMap =>
    assignRange(map, ownerOf(map, position) === owner ? NOBODY : owner, position, position)

/** Commander numbers as the page writes them: "3", "5-9", "1-4, 12". */
export function writeRanges(positions: readonly number[]): string {
    const sorted = [...positions].sort((a, b) => a - b)
    const parts: string[] = []
    for (let i = 0; i < sorted.length;) {
        let end = i
        while (sorted[end + 1] === sorted[end]! + 1)
            end++
        parts.push(end > i ? `${sorted[i]}-${sorted[end]}` : String(sorted[i]))
        i = end + 1
    }
    return parts.join(", ")
}

/**
 * One owner on the commander map's page. `enabled` is whether the player switched the plugin on, and null for a
 * bucket. `starved` is a plugin that is on while the map gives it no commander, of its own or of a bucket, so it sends nothing.
 */
export type OwnerRow = { key: string; shared: boolean; positions: number[]; enabled: boolean | null; starved: boolean }

/** Every owner a commander may go to: the plugins that send commanders, in the sidebar's order, then the shared buckets. */
export function ownerRows(catalog: PluginCatalogEntry[], buckets: CommanderBucket[], map: CommanderMap, plugins: PluginSettings, keepsOwnList: readonly string[] = []): OwnerRow[] {
    const order = MODULES.flatMap(module => module.plugins)
    const place = (key: string) => order.includes(key) ? order.indexOf(key) : order.length
    const positionsOf = (owner: string) => map.flatMap((o, i) => o === owner ? [i + 1] : [])
    const set = isMapSet(map)
    const senders = catalog.filter(sendsCommanders).sort((a, b) => place(a.key) - place(b.key)).map((entry): OwnerRow => {
        const positions = positionsOf(entry.key)
        const enabled = entry.force || Boolean(plugins[entry.key]?.enabled)
        const fromBuckets = buckets.some(bucket => bucket.members.includes(entry.key) && map.includes(bucket.key))
        return { key: entry.key, shared: false, positions, enabled, starved: set && enabled && positions.length === 0 && !fromBuckets && !keepsOwnList.includes(entry.key) }
    })
    return [...senders, ...buckets.map((bucket): OwnerRow => ({ key: bucket.key, shared: true, positions: positionsOf(bucket.key), enabled: null, starved: false }))]
}
