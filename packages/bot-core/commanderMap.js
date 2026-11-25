/**
 * The account's commander map: which plugin, or which shared bucket of plugins, owns each commander. It is a list of
 * owners by commander number, so `map[0]` owns commander 1, and "" owns nothing. An owner is a plugin's key or a
 * bucket's key. A list with no owner in it is no map at all, and every plugin then keeps its own commander list.
 */
const BARONS = ["attackBarronsGreatEmpire", "attackBarronsBurningSands", "attackBarronsEverWinterGlacier", "attackBarronsFirePeaks"]
const FORTRESSES = ["attackFortressesBurningSands", "attackFortressesEverWinterGlacier", "attackFortressesFirePeaks"]

/**
 * The shared buckets: every member plugin may send a bucket's commanders. `first` members are served first when
 * several members wait for the same commander.
 */
const BUCKETS = [
    { key: "commanderBucketBarons", members: BARONS },
    { key: "commanderBucketBaronsFortresses", members: [...BARONS, ...FORTRESSES], first: FORTRESSES },
    { key: "commanderBucketKhanNomads", members: ["attackKhan", "attackNomads"] },
    { key: "commanderBucketSamuraiDaimyo", members: ["attackSamurai", "attackDaimyo"] },
]

/**
 * Defence plugins the map leaves with nothing keep their own commander list, so a map drawn for attacks never stops
 * troops leaving a castle that is about to be hit.
 */
const KEEPS_OWN_LIST_WHEN_UNMAPPED = ["autoStation"]

const commanderMapOption = () => ({ type: "CommanderMap", key: "commanderMap", default: [], buckets: BUCKETS, keepsOwnList: KEEPS_OWN_LIST_WHEN_UNMAPPED })

const isSet = map => Array.isArray(map) && map.some(Boolean)

/**
 * The commanders the map gives `plugin`, as 0-based positions: its `own` and the `shared` ones of its buckets, and
 * whether it is served `first` among the plugins waiting for one. Undefined when no map is set, and for a defence
 * plugin the map gives nothing, which then keeps its own commander list.
 */
function assignedTo(map, plugin) {
    if (!isSet(map))
        return undefined
    const buckets = BUCKETS.filter(bucket => bucket.members.includes(plugin))
    const positionsOf = owners => map.flatMap((owner, position) => owners.includes(owner) ? [position] : [])
    const own = positionsOf([plugin]), shared = positionsOf(buckets.map(bucket => bucket.key))
    if (own.length + shared.length == 0 && KEEPS_OWN_LIST_WHEN_UNMAPPED.includes(plugin))
        return undefined
    return { own, shared, first: buckets.some(bucket => bucket.first?.includes(plugin)) }
}

/** Commander numbers as the settings page writes them: "3", "5-9", "1-4, 12". */
function writeRanges(numbers) {
    const sorted = [...numbers].sort((a, b) => a - b)
    const parts = []
    for (let i = 0; i < sorted.length;) {
        let end = i
        while (sorted[end + 1] === sorted[end] + 1)
            end++
        parts.push(end > i ? `${sorted[i]}-${sorted[end]}` : String(sorted[i]))
        i = end + 1
    }
    return parts.join(", ")
}

module.exports = { BUCKETS, commanderMapOption, isSet, assignedTo, writeRanges }
