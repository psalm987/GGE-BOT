/**
 * The robber baron kingdoms of one account, coordinated, after Lazy Lord's baronCoordinator.js (MIT). It decides two
 * things and sends nothing to the game:
 * - which kingdom a commander goes to when several kingdoms may send it: the one with a clearly shorter round trip to
 *   a tower it can attack now;
 * - which kingdom widens its search when no kingdom has a tower to attack while commanders sit at home.
 * One instance per worker (one worker per account), which every baron plugin of the account shares.
 */

/** Another kingdom's trip must be under this share of this kingdom's to get the commander instead. Learned speeds are rough, so a few percent decide nothing. */
const SHORTER_BY = 0.85
/** The travel time per tile, in milliseconds, before any kingdom has learned its own. */
const DEFAULT_MS_PER_TILE = 60_000
/** Every kingdom has had nothing to attack while commanders were free for this long before one widens. */
const IDLE_FOR_MS = 5 * 60_000
/** How often the kingdoms are looked at for widening. */
const CHECK_EVERY_MS = 30_000

/** The speed after one more attack: `seconds` one way over `tiles`, counting a quarter against what was learned before. */
function learnedSpeed(before, tiles, seconds) {
    if (!(tiles > 0) || !(seconds > 0))
        return before
    const measured = seconds * 1000 / tiles
    return before === undefined ? measured : (before * 3 + measured) / 4
}

/** The speed of a kingdom that has learned none: the average of `learned` (undefined where unknown), else DEFAULT_MS_PER_TILE. */
function defaultMsPerTile(learned) {
    const known = learned.filter(ms => ms !== undefined)
    return known.length ? known.reduce((sum, ms) => sum + ms, 0) / known.length : DEFAULT_MS_PER_TILE
}

/**
 * The kingdom a commander should go to instead of this one: the shortest of `others` ({ key, tripMs }), when it is
 * clearly shorter than `mineMs`. Undefined keeps the commander here, as when this kingdom has nothing to attack.
 */
function handOverTo(mineMs, others) {
    if (mineMs === undefined)
        return undefined
    const best = others.reduce((best, other) => other.tripMs < (best?.tripMs ?? Infinity) ? other : best, undefined)
    return best && best.tripMs < mineMs * SHORTER_BY ? best.key : undefined
}

/**
 * One look at the kingdoms ({ key, tripMs, freeCommanders, canWiden, radius, msPerTile }). They are idle while none
 * has a trip and a commander is free. After IDLE_FOR_MS idle, one kingdom widens: of those that can, the smallest
 * search, then the fastest trips. Returns when the idle time began, and the kingdom to widen now.
 */
function widenStep(kingdoms, idleSince, now) {
    const idle = kingdoms.length > 0 && kingdoms.every(k => k.tripMs === undefined) && kingdoms.some(k => k.freeCommanders > 0)
    if (!idle)
        return { idleSince: undefined }
    const since = idleSince ?? now
    if (now - since < IDLE_FOR_MS)
        return { idleSince: since }
    const pick = kingdoms.filter(k => k.canWiden).sort((a, b) => a.radius - b.radius || a.msPerTile - b.msPerTile)[0]
    return pick ? { idleSince: undefined, widen: pick.key } : { idleSince: since }
}

/**
 * The coordinator. Each kingdom registers under its plugin key with what only it knows:
 * - `nearestReady()`: the tiles to its nearest tower it can attack now, or undefined (none, or a limit or troops hold it);
 * - `mayUse(lord)`: whether it may send that commander;
 * - `freeCommanders()`: how many commanders it may send are at home;
 * - `radius()`, `canWiden()` and `widen()`: its search, and one step wider.
 */
function createBaronCoordinator() {
    /** key -> { hooks, msPerTile, wake } */
    const kingdoms = new Map()
    let idleSince
    let timer

    const msPerTile = key => kingdoms.get(key)?.msPerTile ?? defaultMsPerTile([...kingdoms.values()].map(k => k.msPerTile))
    const tripOf = key => {
        const tiles = kingdoms.get(key)?.hooks.nearestReady()
        return tiles === undefined ? undefined : 2 * tiles * msPerTile(key)
    }
    const wake = key => kingdoms.get(key)?.wake?.()

    function check() {
        const look = [...kingdoms].map(([key, { hooks }]) => ({
            key, tripMs: tripOf(key), freeCommanders: hooks.freeCommanders(), canWiden: hooks.canWiden(), radius: hooks.radius(), msPerTile: msPerTile(key),
        }))
        const step = widenStep(look, idleSince, Date.now())
        idleSince = step.idleSince
        if (step.widen === undefined)
            return
        kingdoms.get(step.widen).hooks.widen()
        wake(step.widen)
    }

    return {
        register(key, hooks) {
            kingdoms.set(key, { hooks, msPerTile: undefined, wake: undefined })
            timer ??= setInterval(() => {
                try {
                    check()
                } catch (error) {
                    console.debug("baronCoordinatorCheckFailed", String(error?.message ?? error))
                }
            }, CHECK_EVERY_MS)
            timer.unref?.()
        },
        unregister(key) {
            kingdoms.delete(key)
            if (kingdoms.size == 0) {
                clearInterval(timer)
                timer = undefined
                idleSince = undefined
            }
        },
        /** Learns from an accepted attack: `seconds` one way to a tower `tiles` away. */
        learnSpeed(key, tiles, seconds) {
            const kingdom = kingdoms.get(key)
            if (kingdom)
                kingdom.msPerTile = learnedSpeed(kingdom.msPerTile, tiles, seconds)
        },
        /** The kingdom's travel time per tile: learned, else the others' average, else DEFAULT_MS_PER_TILE. */
        msPerTile,
        /** The kingdom that should get `lord` instead of `key`, or undefined when `key` keeps it. */
        handOverTo(key, lord) {
            const others = [...kingdoms].filter(([other, { hooks }]) => other != key && hooks.mayUse(lord))
                .map(([other]) => ({ key: other, tripMs: tripOf(other) })).filter(other => other.tripMs !== undefined)
            return handOverTo(tripOf(key), others)
        },
        /** Waits `ms`, or less when another kingdom hands this one a commander or its search widens. */
        sleep(key, ms) {
            return new Promise(resolve => {
                const kingdom = kingdoms.get(key)
                const done = () => {
                    clearTimeout(sleeping)
                    if (kingdom?.wake === done)
                        kingdom.wake = undefined
                    resolve()
                }
                const sleeping = setTimeout(done, Math.max(0, ms))
                sleeping.unref?.()
                if (kingdom)
                    kingdom.wake = done
            })
        },
        wake,
    }
}

module.exports = { baronCoordinator: createBaronCoordinator(), createBaronCoordinator, learnedSpeed, defaultMsPerTile, handOverTo, widenStep, SHORTER_BY, IDLE_FOR_MS }
