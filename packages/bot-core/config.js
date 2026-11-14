const { isMainThread, workerData } = require("node:worker_threads")

// The host's ggeConfig. A worker receives it as workerData.ggeConfig; in the
// main thread the host fills this object before requiring plugins.
module.exports = isMainThread ? {} : { ...workerData?.ggeConfig }
