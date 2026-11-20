/**
 * What the event camp plugins (Nomads, Samurai) share: which camps a plugin attacks, in what order, and how many time
 * skips it may spend on them. Nothing here talks to the game; a plugin hands in what it read from it.
 */
const { RollingWindow, DAY } = require("./towers.js")
const { choice } = require("./army.js")

/**
 * How a plugin picks its camps, by the choice of the `targetMode` Select. "cycleSkips" is what the plugins always did:
 * every camp near the castle in turn, skipping each camp's wait. "cycle" spends no skips and takes the camps that are
 * ready. "single" attacks the one camp at `targetX`, `targetY` and skips its wait.
 */
const TARGET_MODES = ["cycleSkips", "cycle", "single"]
const TARGET_MODE_CHOICES = ["Every camp, with time skips", "Every camp, no time skips", "One camp, with time skips"]
const SINGLE = TARGET_MODES.indexOf("single")
const MAP_MAX = 1286

/** The target options of an event camp plugin. The skip budget starts at 0, which keeps a plugin to the Skips settings alone. */
const campTargetOptions = () => [
    { type: "Select", key: "targetMode", selection: TARGET_MODE_CHOICES, default: 0 },
    { type: "Number", key: "targetX", min: 0, max: MAP_MAX, showWhen: { key: "targetMode", in: [SINGLE] } },
    { type: "Number", key: "targetY", min: 0, max: MAP_MAX, showWhen: { key: "targetMode", in: [SINGLE] } },
    { type: "Number", key: "skipBudgetPerDay", min: 0, max: 5000, default: 0, advanced: true },
]

const coordinate = value => Number.isInteger(value) && value >= 0 && value <= MAP_MAX ? value : undefined

/** A plugin's target, read from its stored options. `at` is the one camp of "single", or undefined while X or Y is unset. */
function parseTarget(options) {
    const mode = choice(TARGET_MODES, options.targetMode, "cycleSkips")
    const x = coordinate(options.targetX), y = coordinate(options.targetY)
    return {
        mode,
        skips: mode != "cycle",
        at: mode == "single" && x !== undefined && y !== undefined ? { x, y } : undefined,
        skipBudget: Math.max(0, Number(options.skipBudgetPerDay) || 0),
    }
}

/** When a camp can be attacked again, in epoch milliseconds: its wait counts from when the game last described it. */
const readyAt = area => (area.timeSinceRequest ?? 0) + (Number(area.extraData[2]) || 0) * 1000

/**
 * The camps of one event and the order they are attacked in. `target` is parseTarget's. A camp that was attacked goes
 * to the back of the line.
 */
function campQueue(target, areas = []) {
    const spent = new RollingWindow(DAY)
    const queue = {
        areas,
        /** Whether one more skip fits the plugin's budget of skips in any 24 hours. */
        maySkip: (now = Date.now()) => target.skips && (target.skipBudget == 0 || spent.total(now) < target.skipBudget),
        skipped: (now = Date.now()) => spent.add(now),
        /**
         * The next camp to attack, or undefined when none can be attacked now. While skips may be spent it is the camp at
         * the front, whatever its wait. Otherwise it is the first camp whose wait is over and that no march of `movements`
         * is heading for.
         */
        pick(movements = [], now = Date.now()) {
            const marchingTo = area => movements.some(march => march.targetAttack?.x == area.x && march.targetAttack?.y == area.y)
            if (areas.length == 0)
                return undefined
            const index = queue.maySkip(now) ? 0 : areas.findIndex(area => readyAt(area) <= now && !marchingTo(area))
            if (index < 0)
                return undefined
            const [area] = areas.splice(index, 1)
            areas.push(area)
            return area
        },
        /** Takes over what the game said about a camp when a march came home from it, so its new wait is known. */
        update(seen) {
            const area = areas.find(area => area.x == seen.x && area.y == seen.y)
            if (area && area !== seen)
                Object.assign(area, { extraData: seen.extraData, timeSinceRequest: seen.timeSinceRequest ?? Date.now() })
        },
        /** The earliest time a camp is ready, or Infinity with no camps. */
        nextReadyAt: () => Math.min(Infinity, ...areas.map(readyAt)),
    }
    return queue
}

/**
 * The camp of `type` at (x, y), or undefined when that tile holds none. It asks for the map box the game client
 * would ask for around that tile.
 */
async function campAt(getAreaInfo, gridBoxes, kingdomID, { x, y }, type) {
    const [box] = gridBoxes(x, y, 0)
    const { areaInfo } = await getAreaInfo(kingdomID, box.x, box.y, box.w, box.h)
    return (areaInfo ?? []).find(area => area.type == type && area.x == x && area.y == y)
}

/**
 * What sets one event's camps apart from another's. `areaType` names the camp in protocols.js' AreaType, `kingdom` is
 * where the camps stand, and `booster` is the field an event tool carries its point bonus in. A camp of the classic
 * difficulty is looked up in the `classicCamps` item file. In the first wave a slot takes `plainToolCount` tools
 * while the castle holds no point boosters, and with `splitToolRoom` the slots of a side share its room equally.
 */
const EVENT_PROFILES = {
    nomad: {
        eventID: 72, areaType: "nomadCamp", kingdom: 0, booster: "khanTabletBooster", classicCamps: "nomadCamps",
        plainToolCount: 40, splitToolRoom: true,
        isEventTool: info => info.khanTabletBooster != undefined && info.ragePointBonus == undefined,
        isTroop: (info, options) => info.fightType == 0 && !info.beefSupply && !(info.foodSupply && !options.useFood),
        classicCamp: (camps, extraData) => camps.find(camp => extraData[1] == camp.id),
        classicLevel: camp => 80 + camp.countVictory,
    },
    samurai: {
        eventID: 80, areaType: "samCamp", kingdom: 0, booster: "samuraiTokenBooster", classicCamps: "samuraiCamps",
        plainToolCount: 20, splitToolRoom: false,
        isEventTool: info => info.samuraiTokenBooster != undefined,
        isTroop: info => info.fightType == 0,
        classicCamp: (camps, extraData) => camps.find(camp => extraData[1] + 1 == Number(camp.countVictory)),
        classicLevel: camp => 80 + Number(camp.countVictory),
    },
}

module.exports = { EVENT_PROFILES, TARGET_MODES, campTargetOptions, parseTarget, readyAt, campQueue, campAt }
