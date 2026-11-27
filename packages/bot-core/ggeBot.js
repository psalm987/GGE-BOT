const { isMainThread, workerData : botConfig, parentPort } = require("node:worker_threads")
if (isMainThread)
    throw new Error("Run as worker")

process.on("uncaughtException", console.error)

const { getCallSites } = require("node:util")
const EventEmitter = require("node:events")
const path = require("node:path")
const { RateLimiter } = require("limiter")
const WebSocket = require("ws")
const { I18n } = require("i18n")
const ggeConfig = require("./config.js")
const ActionType = require("./actions.json")
const err = require("./err.json")
const { errorClass } = require("./errClass.js")
const metrics = require("./metrics.js")
const { jittered, loginTiming } = require("./timing.js")
const { pause } = require("./pacing.js")

const timeoutMultiplier = ggeConfig.timeoutMultiplier ?? 1
const humanize = ggeConfig.humanize ?? {}
/**
 * The HTML5 client's build number, which it sends at login and in `vck`. The runner reads the live one
 * from the game's CDN; this fallback is client 1.173.9. Sending `undefined` there marked every bot.
 */
const clientBuild = ggeConfig.gameClientBuild ?? 1173009
/** The real client sends one random `vck` number per session, in JavaScript's own exponent form, and reuses it. */
const versionCheckNonce = String(Math.random() * Number.MAX_VALUE)
/** A pause a person would leave, scaled like every other wait so that it stays inside the login deadline. */
const humanPause = (minMs, maxMs) => pause(minMs * timeoutMultiplier, maxMs * timeoutMultiplier)
const limiter = new RateLimiter({ tokensPerInterval: 5, interval: "sec" })
const events = new EventEmitter()
const xtHandler = new EventEmitter()
const i18n = new I18n({
    locales: require("./paths.js").localeCodes(),
    directory: require("./paths.js").locales,
    updateFiles: false
})
const _console = console

function mngLog(logLevel, msg) {
    let callSites = getCallSites(6)
    let scriptName = path.basename(callSites[2]?.scriptName).slice(0, -3)
    
    let now = new Date()
    let hours = now.getHours()
    let minutes = now.getMinutes()

    hours = hours < 10 ? '0' + hours : hours
    minutes = minutes < 10 ? '0' + minutes : minutes

    let message = [`[${hours + ':' + minutes}] `, '[', `${scriptName}`, '] ']

    message.push(...msg)

    message = message.map(msg => {
        if(msg instanceof Error)
            return msg.message

        return msg
    })

    _console.log(`[${botConfig.name}] ${message.map(i18n.__).join("")}`)
    parentPort.postMessage([ActionType.GetLogs, logLevel, message])
}

if (!botConfig.internalWorker) {
    console = {}
    console.log = (...msg) => mngLog(0, msg)
    console.info = (...msg) => mngLog(0, msg)
    console.warn = (...msg) => mngLog(1, msg)
    console.error = (...msg) => mngLog(2, msg)
    // Level 3: the game said "not now" and it will pass, so it stays out of the warnings and errors.
    console.notNow = (...msg) => mngLog(3, msg)
    console.debug = ggeConfig.debug ? _console.debug : _ => { }
    console.trace = _console.trace
}
/** The script that called into ggeBot.js, such as a plugin's file name; "ggeBot" for the bot's own requests. */
function callerScript() {
    const site = getCallSites(8).find(site => site.scriptName && path.basename(site.scriptName) != "ggeBot.js")
    return site ? path.basename(site.scriptName).replace(/\.[cm]?js$/, "") : "ggeBot"
}

/** Each command's last send: when, and by which script, which a refusal of it is put down to. */
const lastSent = new Map()
/** The game answers within seconds, so an error coming later than this answers something else, such as its own push. */
const REFUSAL_WINDOW_MS = 2 * 60_000
/** Logging in and staying connected report their own failures. */
const UNREPORTED_COMMANDS = new Set(["pin", "vck", "lli", "vln", "tlep", "rlu", "core_pol", "nch"])
/** Refusals the bot answers on its own: the game forgot the castle, and the bot joins it again and retries. */
const SELF_HANDLED_ERRORS = new Set(["NOT_IN_OWNED_CASTLE"])
/** The inbound frame a waiting plugin said it expects and handles, which leaves its refusal off the player's Problems list. */
let expectedFrame

/** Tells the runner the game refused a request this bot sent, for the account's Problems list. */
function reportRefusal(cmd, result) {
    const sent = lastSent.get(cmd)
    const error = err[result] ?? String(result)
    if (!sent || Date.now() - sent.at > REFUSAL_WINDOW_MS || UNREPORTED_COMMANDS.has(cmd) || SELF_HANDLED_ERRORS.has(error) || expectedFrame === inboundFrame)
        return
    parentPort.postMessage([ActionType.GameRefusal, { plugin: sent.plugin, command: cmd, error, at: Date.now() }])
}

let requestCount = 0
async function sendXT(cmdName, paramObj) {
    lastSent.set(cmdName, { at: Date.now(), plugin: callerScript() })
    try {
    console.debug(cmdName, JSON.parse(paramObj))
    } catch {}
    await metrics.time("bot_send_wait_seconds", {}, limiter.removeTokens(1))
    requestCount++
    metrics.count("bot_messages_total", { direction: "out", command: cmdName })
    send(`%xt%${botConfig.gameServer}%${cmdName}%1%${paramObj === undefined ? "" : `${paramObj}%`}`)
}

const liveness = { phase: "connecting", lastInbound: Date.now(), lastOutbound: Date.now(), longestGap: 0 }

function send(frame) {
    liveness.lastOutbound = Date.now()
    webSocket.send(frame)
}

/** The real client writes its XML frames with single quotes and a space before `/>`. */
const sendSys = frame => send(humanize.login_sequence ? frame.replaceAll('"', "'").replace("'/>", "' />") : frame)

function heartbeat() {
    const now = Date.now()
    const inboundAgeMs = now - liveness.lastInbound
    parentPort.postMessage([ActionType.Heartbeat, {
        phase: liveness.phase,
        ws: webSocket.readyState,
        inboundAgeMs,
        outboundAgeMs: now - liveness.lastOutbound,
    }])
    if (liveness.phase != "running")
        return
    metrics.observe("bot_inbound_gap_seconds", {}, Math.max(liveness.longestGap, inboundAgeMs) / 1000)
    liveness.longestGap = 0
    // A dead connection doesn't always close the socket, so silence is the only
    // sign. Off until the operator sets a limit from bot_inbound_gap_seconds: a
    // guessed one would reconnect healthy bots that are merely quiet. A bot that
    // has already said why it is stopping is left to stop on its own schedule.
    if (!stopReason && ggeConfig.inboundStaleMs && inboundAgeMs > ggeConfig.inboundStaleMs)
        exitWorker("CONNECTION_STALE")
}

let importantErrors = 0
let timedOut = 0

let stopReason
/**
 * Tells the host why this bot is stopping: "banned", "auth_failed" or "error".
 * Only the first report is sent: whatever fails after it (the socket closing
 * after a ban, say) is a consequence and would hide the real reason.
 */
const reportState = (state, reason, extra) => {
    if (stopReason)
        return
    stopReason = reason
    parentPort.postMessage([ActionType.BotState, { state, reason, ...extra }])
}
/** True once the bot has told the host why it is stopping. Nothing new should be sent after that. */
const stopping = () => Boolean(stopReason)

function exitWorker(reason) {
    if (!stopReason)
        console.error("closedReason", reason)
    reportState("error", reason)
    events.emit("unload")
    process.exit(0)
}

function fatal(reason) {
    console.error("closedReason", reason)
    reportState("error", reason)
    // The runner restarts with backoff; the legacy host would restart every few seconds.
    return ggeConfig.exitOnFatal ? webSocket.close() : webSocket.pause()
}
/**
 * 
 * @param {string} key 
 * @param {number} timeout 
 * @param {function(object,number)} func 
 * @returns {Promise<[obj: object, result: Number]>}
 */
const waitForResult = (key, timeout, func, quietErrors) => metrics.time("bot_game_rtt_seconds", { command: key }, waitForReply(key, timeout, func, quietErrors))

/** A refusal from the game, at the level its class says: severe is an error, "not now" has its own level, anything else a warning. */
function logRefusal(key, msg) {
    const log = { severe: console.error, notNow: console.notNow }[errorClass(msg)] ?? console.warn
    log(key, msg)
}

/** Counts inbound game frames, so a reply that several waiting plugins hear is judged once. */
let inboundFrame = 0
let lastJudgedFrame
function checkForIssues(result) {
    if (lastJudgedFrame === inboundFrame)
        return
    lastJudgedFrame = inboundFrame
    if (["LORD_IS_USED", "ATTACK_TOO_MANY_UNITS"].includes(err[result]))
        importantErrors++
    if (importantErrors == 8)
        return fatal("tooManyImportantErrors")
    if (err[result] == "MOVEMENT_HAS_NO_UNITS")
        return fatal("MOVEMENT_HAS_NO_UNITS")
    if (err[result] == "CANT_START_NEW_ARMIES")
        return fatal("CANT_START_NEW_ARMIES")
}

/** `quietErrors` names the refusals the caller expects and handles itself, which are not logged. */
const waitForReply = (key, timeout, func, quietErrors = []) => new Promise((resolve, reject) => {
    if (timeout == undefined)
        return reject(`waitForResult: No timeout specified`)

    func ??= _ => true

    let timer
    let result

    if (timeout > 0) {
        timer = setTimeout(() => {
            xtHandler.removeListener(key, helperFunction)
            const msg = (result == undefined || result == 0) ? "TIMED_OUT" : !err[result] ? result : err[result]
            result = -1

            if (msg == "TIMED_OUT" && timedOut++ == 5)
                exitWorker("TOO_MANY_TIMEOUTS")

            if (!quietErrors.includes(msg))
                logRefusal(key, msg)

            reject(msg)
        }, timeout * timeoutMultiplier * 5)
    }

    const helperFunction = (data, _result) => {
        if (result != 0)
            result = _result

        const msg = (_result == undefined || _result == 0) ? "TIMED_OUT" : !err[_result] ? _result : err[_result]
        if(result != 0)
            checkForIssues(result)
        if (!func(Object(data), Number(_result)))
            return
        if (_result != 0 && quietErrors.includes(msg))
            expectedFrame = inboundFrame
        if (_result != 0 && !quietErrors.includes(msg))
            logRefusal(key, msg)

        xtHandler.removeListener(key, helperFunction)
        clearInterval(timer)
        if (Number(_result) == 0)
            importantErrors = timedOut = 0
        resolve([Object(data), Number(_result)])
    }

    xtHandler.addListener(key, helperFunction)
})

const proxy = botConfig.proxyUrl ? require("./proxy.js").connectVia(botConfig.proxyUrl, botConfig.gameURL, 30 * 1000 * timeoutMultiplier) : undefined
const measured = { connectMs: undefined, roundTripMs: undefined }
const socketCreatedAt = performance.now()
let roundTripSentAt
const webSocket = new WebSocket(`wss://${botConfig.gameURL}/`, {
    skipUTF8Validation: ggeConfig.skipUTF8Validation ? true : false,
    ...(proxy && { agent: proxy.agent })
  })

/**
 * `wheelSpins` is the day's wheel spins as the last run reported them (plugins/wheelSpin.js). It is carried here, not by
 * the plugin, so a run with the wheel switched off still passes it on to the next run of the day.
 */
const status = { wheelSpins: botConfig.wheelSpins }
const playerInfo = {
    level: NaN,
    userID: NaN,
    playerID: NaN,
    email: String(),
    acceptedTOS: Boolean(),
    verifiedEmail: Boolean(),
    isCheater: Boolean(),
    name: String(),
    alliance: {
        id: NaN,
        rank: Number(),
        name: String(),
        fame: Number(),
        searchingForPlayers: Boolean()
    }
}

metrics.startFlushing(ActionType.Metrics, ggeConfig.metricsFlushMs)
setInterval(heartbeat, 30 * 1000 * timeoutMultiplier).unref()

module.exports = {
    sendXT,
    waitForResult,
    xtHandler,
    webSocket,
    events,
    stopping,
    botConfig,
    playerInfo,
    status,
    i18n
}

webSocket.onopen = () => {
    measured.connectMs = performance.now() - socketCreatedAt
    liveness.phase = "login"
    sendSys(`<msg t="sys"><body action="verChk" r="0"><ver v="${ggeConfig.gameClientVersion ?? 166}"/></body></msg>`)
    // The client's pin loop runs from the moment it connects, so a slow login has a pin before its `lli`.
    if (humanize.login_sequence)
        startPinging()
}
let errorCount = 0
let versionRejected = false
/** The game's error for "this account was opened on another device" (CoreErrorIdConstants in the client). */
const KICKED_BY_OTHER_CLIENT = 10020

webSocket.onmessage = ({data : message}) => {
    message = message.toString()
    const now = Date.now()
    liveness.longestGap = Math.max(liveness.longestGap, now - liveness.lastInbound)
    liveness.lastInbound = now
    if (message.charAt(0) == "%") {
        let [,,cmd,, r, obj] = message.split("%")
        const result = Number(r)
        inboundFrame++
        metrics.count("bot_messages_total", { direction: "in", command: cmd })
        // The player logged in themselves. Leave at once; the runner waits before logging back in.
        if (result == KICKED_BY_OTHER_CLIENT) {
            console.warn("kickedByOtherClient")
            return exitWorker("KICKED")
        }
        try { obj = JSON.parse(obj) }
        catch(e) {
            console.debug(e)
        }
        // The game forgot which castle the player is in. Said before the reply goes out, so a retry joins again.
        if (err[result] == "NOT_IN_OWNED_CASTLE")
            xtHandler.emit("notInOwnedCastle", cmd)

        switch (cmd) {
            case "gbd":
                for (const [key, value] of Object.entries(obj))
                    xtHandler.emit(key, value, 0)
                break
            case "vck":
                versionRejected = result != 0
                xtHandler.emit(cmd, obj, result)
                break
            case "gfl":
                xtHandler.emit(cmd, obj, result)
                break
            default:
                console.debug(err[result] ?? result, cmd)
            case "core_pol":
            case "rlu":
            case "lli":
                xtHandler.emit(cmd, obj, result)
        }
        if (result != 0)
            reportRefusal(cmd, result)
    }

    else if (message[0] == "<") {
        switch (message.match(/action='(\w+)'/)?.[1]) {
            case "apiOK":
                sendSys(`<msg t="sys"><body action="login" r="0"><login z="${botConfig.gameServer}"><nick><![CDATA[]]></nick><pword><![CDATA[${clientBuild}%en%0]]></pword></login></body></msg>`)
                break
            case "apiKO":
                exitWorker("CLIENT_VERSION_REJECTED")
                break
            case "joinOK":
                roundTripSentAt = performance.now()
                sendSys('<msg t="sys"><body action="roundTrip" r="1"></body></msg>')
                sendXT("vck", `${clientBuild}%web-html5%<RoundHouseKick>%${versionCheckNonce}`)
                break
            case "roundTripRes":
                measured.roundTripMs = performance.now() - roundTripSentAt
                break
            default:
                console.debug("unknown system message", message)
        }
    }
}
webSocket.onerror = event => exitWorker(proxy?.failureOf(event.error) ?? `SOCKET_ERROR:${event.error?.code ?? event.message}`)
// An out-of-date build gets a refused `vck` and then the socket drops without a close frame (1006).
webSocket.onclose = event => exitWorker(versionRejected && liveness.phase == "login" ? "CLIENT_VERSION_REJECTED" : `SOCKET_ERROR:${event.code}`)

const loginTimedOut = () => {
    // A ban or rejected login already reported why, and exits on its own schedule.
    if (!stopReason)
        exitWorker("LOGIN_TIMEOUT")
}
let loginWatchdog = setTimeout(loginTimedOut, 90 * 1000 * timeoutMultiplier)

events.on("configModified", () => console.log("botConfigReloaded"))

/** How many commanders the account has, which the settings check a commander list against. */
xtHandler.on("gli", (obj, result) => {
    if (result || !obj?.C)
        return
    const commanders = Array.from(obj.C).length
    if (status.commanders === commanders)
        return
    status.commanders = commanders
    parentPort.postMessage([ActionType.StatusUser, status])
})

/** The account's castles as the settings' castle pickers list them. */
events.once("load", () => {
    const { castles } = require("./protocols.js")
    status.castles = castles.filter(castle => castle.areaInfo).map(({ kingdomID, id, areaInfo }) => ({
        kingdom: kingdomID, id, x: areaInfo.x, y: areaInfo.y, type: areaInfo.type,
        name: String(areaInfo.extraData[7] || `${areaInfo.x}:${areaInfo.y}`),
    }))
    parentPort.postMessage([ActionType.StatusUser, status])
})

events.once("load", async () => {
    const { KingdomID, castles } = require("./protocols.js")
    const castle = castles.find(e => e.kingdomID == KingdomID.stormIslands)
    function getStormStats() {
        Object.assign(status, {
            aquamarin_name: castle.aqua != 0 ? Math.floor(castle.aqua) : undefined,
            food: castle.food != 0 ? Math.floor(castle.food) : undefined,
            mead: Math.floor(castle.mead != 0 ? Math.floor(castle.mead) : undefined)
        })
        parentPort.postMessage([ActionType.StatusUser, status])
    }
    if(!castle)
        return

    castle.on("resourceUpdate", getStormStats)
    getStormStats()
})

xtHandler.on("rlu", () => sendSys('<msg t="sys"><body action="autoJoin" r="-1"></body></msg>'))
xtHandler.on("gal", obj => {
    playerInfo.alliance.id = Number(obj.AID)
    playerInfo.alliance.rank = Number(obj.R)
    playerInfo.alliance.name = String(obj.N)
    playerInfo.alliance.fame = Number(obj.ACF)
    playerInfo.alliance.searchingForPlayers = Boolean(obj.SA)
})
xtHandler.on("gxp", obj => {
    playerInfo.level = obj.LVL + obj.LL

    if (!botConfig.externalEvent)
        return

    Object.assign(status, { level: playerInfo.level })
    parentPort.postMessage([ActionType.StatusUser, status])
})
xtHandler.on("gpi", obj => {
    playerInfo.userID = Number(obj.UID)
    playerInfo.playerID = Number(obj.PID)
    playerInfo.name = String(obj.PN)
    playerInfo.email = String(obj.E)
    playerInfo.verifiedEmail = Boolean(obj.V)
    playerInfo.acceptedTOS = Boolean(obj.CTAC)
    playerInfo.isCheater = Boolean(obj.CL)
})
xtHandler.on("gcu", obj => {
    Object.assign(status, {
        cash: obj.C1 != 0 ? Math.floor(playerInfo.coin = obj.C1) : undefined,
        gold: obj.C2 != 0 ? Math.floor(playerInfo.rubies = obj.C2) : undefined,
        requestCount,
        errorCount
    })
    parentPort.postMessage([ActionType.StatusUser, status])
})
/** Each event's points total as the game last reported it (`pep`), by event id, which the runner keeps in the session. */
xtHandler.on("pep", (obj, result) => {
    const points = Number(obj?.OP?.[0])
    if (result != 0 || !Number.isInteger(Number(obj?.EID)) || !Number.isInteger(points) || points < 0)
        return
    status.eventPoints = { ...status.eventPoints, [obj.EID]: points }
    parentPort.postMessage([ActionType.StatusUser, status])
})
xtHandler.on("gai", obj => {
    Object.assign(status, {
        attackDailyCount: obj.AC != 0 ? Math.floor(playerInfo.attackDailyCount = obj.AC) : undefined,
    })
    parentPort.postMessage([ActionType.StatusUser, status])
})
const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"])
/**
 * Each plugin's options become the new set as a whole: an option left out is gone, and an object option is taken as it is.
 * They go into the object the plugin read at load, which it keeps.
 */
function applyPluginOptions(plugins) {
    for (const [name, options] of Object.entries(plugins ?? {})) {
        if (PROTOTYPE_KEYS.has(name) || typeof options !== "object" || options === null)
            continue
        const current = Object.hasOwn(botConfig.plugins, name) ? botConfig.plugins[name] : botConfig.plugins[name] = {}
        for (const key of Object.keys(current))
            if (!Object.hasOwn(options, key))
                delete current[key]
        for (const [key, value] of Object.entries(options))
            if (!PROTOTYPE_KEYS.has(key))
                current[key] = value
    }
}

parentPort.on("message", async obj => {
    switch (obj[0]) {
        case ActionType.SetPluginOptions:
            applyPluginOptions(obj[1]?.plugins)
            events.emit("configModified")
            break
        case ActionType.StatusUser:
            parentPort.postMessage([ActionType.StatusUser, status])
            break
        case ActionType.GetExternalEvent:
            await sendXT("sei", JSON.stringify({}))
            let [sei, _] = await waitForResult("sei", 1000 * 10)
            if (sei.E.find(e => e.EID == 113))
                await sendXT("glt", JSON.stringify({ GST: 3 }))
            else
                await sendXT("glt", JSON.stringify({ GST: 2 }))
            let [glt, _2] = await waitForResult("glt", 1000 * 10)
            parentPort.postMessage([ActionType.GetExternalEvent, { sei: sei, glt: glt }])
            break

    }
})

async function retry() {
    if (botConfig.externalEvent) {
        sendXT("tlep", JSON.stringify({ TLT: botConfig.tempServerData.glt.TLT }))
    }
    sendXT("lli", JSON.stringify({
        ...loginTiming(humanize.measured_timing ? measured : undefined),
        ID: 0,
        PL: 1,
        NOM: botConfig.name,
        PW: botConfig.pass,
        LT: null,
        LANG: "en",
        DID: "0",
        AID: "1745592024940879420",
        KID: "",
        REF: "https://empire.goodgamestudios.com",
        GCI: "",
        SID: 9,
        PLFID: 1
    }))
    events.emit("sentLLI")
}

/**
 * The login form as a person fills it in: the client checks the name once it
 * is typed (`vln`) and logs in when the button is pressed. Nothing waits for
 * the `vln` answer, which the 2026-11-13 capture does not hold.
 */
async function typedLogin() {
    await humanPause(6000, 12000)
    await sendXT("vln", JSON.stringify({ NOM: botConfig.name }))
    await humanPause(8000, 16000)
    retry()
}
xtHandler.on("vck", humanize.login_sequence ? typedLogin : retry)

let pinging = false
function startPinging() {
    if (pinging)
        return
    pinging = true
    const pin = () => sendXT("pin", "<RoundHouseKick>")
    const everyMs = ggeConfig.pinIntervalMs ?? 60_000
    if (humanize.pin_jitter)
        jittered(pin, everyMs, everyMs / 10)
    else
        setInterval(pin, everyMs).unref()
}

let stopNch = () => {}
let nchStarted = false
/**
 * The client's second heartbeat: an `nch` with no payload about every 32 s
 * (78 gaps in the 2026-11-13 capture: mean 32.0 s, sd 4.1 s). Nothing waits
 * for an answer, so a server that sends none costs no timeout.
 */
function startNch() {
    if (nchStarted)
        return
    nchStarted = true
    const everyMs = ggeConfig.nchIntervalMs ?? 32_000
    stopNch = jittered(() => sendXT("nch"), everyMs, everyMs / 8)
    return sendXT("nch")
}
events.on("unload", () => stopNch())

/** What the client asks for once it is logged in, in its order. No payload holds anything of the account's. */
const LOGIN_BURST = [
    ["gbl", {}], ["jca", { CID: -1, KID: 0 }], ["alb", {}], ["sli", {}], ["gie", {}],
    ["asc", {}], ["sie", {}], ["ffi", { FIDS: [1] }], ["kli", {}],
]
let greeted = false
/**
 * The first `nch` and the burst leave together, as in the capture, and `gcs` a little later. Nothing waits for a reply.
 * Without the burst, the general inventory (`gie`) is still asked for, since commander bonuses are read from it.
 */
async function afterLogin() {
    if (greeted)
        return
    greeted = true
    if (!humanize.login_sequence)
        sendXT("gie", JSON.stringify({}))
    await humanPause(2000, 4000)
    if (humanize.nch)
        await startNch()
    if (!humanize.login_sequence)
        return
    for (const [cmd, params] of LOGIN_BURST)
        await sendXT(cmd, JSON.stringify(params))
    await humanPause(6000, 12000)
    await sendXT("gcs", JSON.stringify({}))
}

let loginAttempts = 0
xtHandler.on("lli", async (obj, r) => {
    if (r == 453) {
        // A missing CD once meant logging in again at once. A person also takes a moment before trying again.
        const seconds = Math.max(Number(obj?.CD) || 0, 5) + 5 + Math.random() * 25
        console.log("retryLogin", Math.round(seconds), "retryLoginSeconds")
        setTimeout(retry, seconds * 1000 * timeoutMultiplier)
        clearTimeout(loginWatchdog)
        loginWatchdog = setTimeout(loginTimedOut, (seconds + 60) * 1000 * timeoutMultiplier)
        return
    }

    if (err[r] == "IS_BANNED") {
        console.error("IS_BANNED", (obj.RS / 60 / 60).toFixed(2), "retryLoginHours")
        reportState("banned", "IS_BANNED", { bannedUntil: Date.now() + Number(obj.RS) * 1000 })
        status.hasError = true
        parentPort.postMessage([ActionType.StatusUser, status])
        setTimeout(() => parentPort.postMessage([ActionType.KillBot]), 1000 * 8)
        return
    }

    if (r == 0) {
        clearTimeout(loginWatchdog)
        liveness.phase = "running"
        let started = false
        const start = loadDelay => {
            if (started)
                return
            started = true
            clearTimeout(timer)
            parentPort.postMessage([ActionType.Started])
            setTimeout(() => events.emit("load"), loadDelay)
        }
        //Due to exploits that can break the client this is to give limited access again.
        const timer = setTimeout(() => {
            console.warn("loggedIn", "loggedInWithoutEventData")
            console.warn("featuresMightNotWork")
            start(0)
        }, 30 * 1000 * timeoutMultiplier)

        xtHandler.once("sei", () => {
            console.log("loggedIn")
            start(4500)
        })
        events.emit("earlyLoad")
        startPinging()
        afterLogin()
        return
    }

    if (err[r] === "INVALID_LOGIN_TOKEN" && loginAttempts < 3) {
        const seconds = 30 * 2 ** loginAttempts++ * (0.8 + Math.random() * 0.4)
        setTimeout(retry, seconds * 1000 * timeoutMultiplier)
        clearTimeout(loginWatchdog)
        loginWatchdog = setTimeout(loginTimedOut, (seconds + 60) * 1000 * timeoutMultiplier)
        return
    }
    if (botConfig.internalWorker)
        process.exit(0)

    status.hasError = true
    parentPort.postMessage([ActionType.StatusUser, status])
    console.error(err[r])
    reportState("auth_failed", err[r] ?? String(r))
    setTimeout(() => parentPort.postMessage([ActionType.KillBot]), 1000 * 8)
})

// Keeps the in-game presets listed for the wave editor and the attack plugins.
require("./gamePresets.js")

try {
    require("./plugins/misc.js")
}
catch(e) {
    console.debug(e)
}

for (const [, val] of Object.entries(botConfig.plugins)) {
    if (!val.state)
        continue
    try {
        // plugins-extra and plugins-personal live beside the host, not in this package.
        require(val.filename.startsWith("plugins/") ? `./${val.filename}` : path.join(require("./paths.js").root, val.filename))
    }
    catch (e) {
        console.warn(e)
    }
}

require("./eventPlugins.js")
