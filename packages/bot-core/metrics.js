const { isMainThread, parentPort } = require("node:worker_threads")

// Counters and timings a bot worker collects, flushed to the host as one
// [Metrics, batch] message every few seconds. The host owns the Prometheus
// registry; labels never include the account.
const counters = new Map()
const observations = new Map()
const keyOf = (name, labels) => JSON.stringify([name, labels])

function count(name, labels = {}, n = 1) {
    const key = keyOf(name, labels)
    counters.set(key, (counters.get(key) ?? 0) + n)
}

function observe(name, labels, seconds) {
    const key = keyOf(name, labels)
    const values = observations.get(key) ?? []
    values.push(seconds)
    observations.set(key, values)
}

/** Times a promise and records its duration in seconds under name/labels. */
async function time(name, labels, promise) {
    const started = performance.now()
    try {
        return await promise
    } finally {
        observe(name, labels, (performance.now() - started) / 1000)
    }
}

function flush(post) {
    if (!counters.size && !observations.size)
        return
    const batch = {
        counters: [...counters].map(([key, value]) => [...JSON.parse(key), value]),
        observations: [...observations].map(([key, values]) => [...JSON.parse(key), values]),
    }
    counters.clear()
    observations.clear()
    post(batch)
}

function startFlushing(actionType, intervalMs = 10_000) {
    if (isMainThread)
        return
    setInterval(() => flush(batch => parentPort.postMessage([actionType, batch])), intervalMs).unref()
}

module.exports = { count, observe, time, flush, startFlushing }
