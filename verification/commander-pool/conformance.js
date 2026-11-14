// Runs the real plugins/commander.js with the game connection stubbed out and
// checks the behaviours CommanderPool.tla assumes about it. Each check prints
// what it observed; check.sh compares that with what the model expects.
//
// Usage: node verification/commander-pool/conformance.js   (prints JSON)

const path = require("node:path")
const Module = require("node:module")
const { EventEmitter } = require("node:events")

const commanderPath = path.join(__dirname, "..", "..", "plugins", "commander.js")

// Fresh copy of commander.js with two commanders loaded and nothing in use.
function loadPool(lordIDs = [1, 2]) {
    const xtHandler = new EventEmitter()
    const stubBot = {
        xtHandler,
        playerInfo: { playerID: 7 },
        waitForResult: () => new Promise(() => {}),
    }
    class Lord {
        constructor(e) {
            this.lordID = e.ID
            this.lordPosition = e.VIS
        }
    }
    const stubProtocols = { ClassTypes: { Lord }, movementEvents: new EventEmitter() }

    const originalLoad = Module._load
    Module._load = function (request, parent, isMain) {
        if (request === "node:worker_threads") return { isMainThread: false }
        if (/ggeBot(\.js)?$/.test(request)) return stubBot
        if (/protocols(\.js)?$/.test(request)) return stubProtocols
        return originalLoad.call(this, request, parent, isMain)
    }
    try {
        delete require.cache[require.resolve(commanderPath)]
        const pool = require(commanderPath)
        xtHandler.emit("gli", { C: lordIDs.map((ID, i) => ({ ID, VIS: i })) }, 0)
        return { pool, movementEvents: stubProtocols.movementEvents }
    } finally {
        Module._load = originalLoad
    }
}

const settled = async (promise, ticks = 20) => {
    let done = false
    promise.then(() => (done = true))
    for (let i = 0; i < ticks; i++) await Promise.resolve()
    return done
}

// The promise's value, or undefined if it has not settled after `ticks`
// microtasks. No check may wait on a promise that never settles: Node would
// exit without printing anything.
const valueOf = async (promise, ticks = 20) => {
    let value
    promise.then(v => (value = v))
    for (let i = 0; i < ticks; i++) await Promise.resolve()
    return value
}

async function main() {
    const results = {}

    // A1: the fast path marks the commander used before it returns, so a
    // second caller never gets the same one (model: Start/Acquire is atomic).
    {
        const { pool } = loadPool()
        const a = pool.waitForCommanderAvailable()
        const b = pool.waitForCommanderAvailable()
        const [la, lb] = await Promise.all([valueOf(a), valueOf(b)])
        results.fastPathMarksUsed = !!la && !!lb && la.lordID !== lb.lordID
    }

    // A2: with every commander in use, the caller waits (model: "waiting").
    {
        const { pool } = loadPool()
        await pool.waitForCommanderAvailable()
        await pool.waitForCommanderAvailable()
        results.waitsWhenAllUsed = !(await settled(pool.waitForCommanderAvailable()))
    }

    // A3: freeCommander wakes only the first waiter that registered (model:
    // FreeState wakes Head(waiters)).
    {
        const { pool } = loadPool()
        const a = await pool.waitForCommanderAvailable()
        await pool.waitForCommanderAvailable()
        const first = pool.waitForCommanderAvailable()
        const second = pool.waitForCommanderAvailable()
        pool.freeCommander(a.lordID)
        const firstWoke = await settled(first)
        const secondWoke = await settled(second)
        results.freeWakesFirstWaiterOnly = firstWoke && !secondWoke
    }

    // A4: freeing a commander that is not in use wakes nobody (model:
    // FreeState returns the pool unchanged when l \notin used).
    {
        const { pool } = loadPool()
        await pool.waitForCommanderAvailable()
        await pool.waitForCommanderAvailable()
        const waiter = pool.waitForCommanderAvailable()
        pool.freeCommander(99)
        results.freeUnusedIsNoop = !(await settled(waiter))
    }

    // A5: a commander's return movement frees it (commander.js:40-47, model:
    // MarchReturns).
    {
        const { pool, movementEvents } = loadPool()
        const a = await pool.waitForCommanderAvailable()
        await pool.waitForCommanderAvailable()
        const waiter = pool.waitForCommanderAvailable()
        movementEvents.emit("return", { targetOwner: { ownerID: 7 }, lord: { lordID: a.lordID } })
        results.returnFrees = await settled(waiter)
    }

    // A6: the woken waiter marks the commander used one microtask after the
    // free, not during it. Code that calls waitForCommanderAvailable in the
    // same synchronous run as freeCommander gets the same commander. This is
    // what attackKhan/Nomads/Samurai/BerimondInvasion do: freeCommander(...)
    // then `continue`/`break` back to the top of `while (!quit)`.
    // (model: Resume is a separate step; LoopPlugins re-acquire inside React)
    {
        const { pool } = loadPool()
        const khanLord = await pool.waitForCommanderAvailable()
        await pool.waitForCommanderAvailable()
        const waiter = pool.waitForCommanderAvailable()
        await Promise.resolve()
        pool.freeCommander(khanLord.lordID)
        const khanAgain = pool.waitForCommanderAvailable() // `continue`
        const [w, k] = await Promise.all([valueOf(waiter), valueOf(khanAgain)])
        results.sameRunReacquireGetsWokenCommander = !!w && !!k && w.lordID === k.lordID
    }

    // A7: code that re-enters one microtask or more after the free (the
    // sendHit loops in sharedBarron/sharedFortress/attackStormForts:
    // `return true` then `while (await sendHit())`) waits instead.
    {
        const { pool } = loadPool()
        const lord = await pool.waitForCommanderAvailable()
        await pool.waitForCommanderAvailable()
        const waiter = pool.waitForCommanderAvailable()
        await Promise.resolve()
        pool.freeCommander(lord.lordID)
        await Promise.resolve()
        const again = pool.waitForCommanderAvailable()
        await settled(waiter)
        results.laterReacquireWaits = !(await settled(again))
    }

    console.log(JSON.stringify(results))
}

main().catch(e => {
    console.error(e)
    process.exit(2)
})
