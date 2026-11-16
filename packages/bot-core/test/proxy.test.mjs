import http from "node:http"
import { createRequire } from "node:module"
import net from "node:net"
import { afterEach, describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { WebSocket, WebSocketServer } = require("ws")
const { connectVia } = require("../proxy.js")
const { startBot } = require("./harness/bot-session.cjs")

const USER = "bot-user"
const SECRET = "s3cret-proxy-pw"
/** A name only the test proxies know, so a connection to it proves the proxy did the lookup. */
const GAME = "game.test"

const closers = []
afterEach(async () => {
    for (const close of closers.splice(0).reverse())
        await close()
})

const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => {
    closers.push(() => new Promise(done => { server.closeAllConnections?.(); server.close(done) }))
    resolve(server.address().port)
}))

async function closedPort() {
    const server = net.createServer()
    const port = await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))
    await new Promise(done => server.close(done))
    return port
}

/** A game stand-in that answers each message with "echo:<message>". */
async function gameServer() {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" })
    await new Promise(resolve => wss.once("listening", resolve))
    wss.on("connection", socket => socket.on("message", data => socket.send(`echo:${data}`)))
    closers.push(() => new Promise(done => { for (const c of wss.clients) c.terminate(); wss.close(done) }))
    return wss.address().port
}

const upstreamFor = (host, port) => net.connect(port, host === GAME ? "127.0.0.1" : host)

/** A SOCKS5 proxy that wants USER and SECRET. `requests` lists what it was asked to connect to. */
async function socksProxy() {
    const requests = []
    const sockets = new Set()
    const reply = code => Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0])
    const server = net.createServer(client => {
        sockets.add(client)
        client.on("error", () => {})
        client.once("data", () => {
            client.write(Buffer.from([5, 2]))
            client.once("data", auth => {
                const user = auth.subarray(2, 2 + auth[1]).toString()
                const pass = auth.subarray(3 + auth[1], 3 + auth[1] + auth[2 + auth[1]]).toString()
                if (user !== USER || pass !== SECRET)
                    return client.end(Buffer.from([1, 1]))
                client.write(Buffer.from([1, 0]))
                client.once("data", request => {
                    const byName = request[3] === 3
                    const end = byName ? 5 + request[4] : 8
                    const host = byName ? request.subarray(5, end).toString() : request.subarray(4, end).join(".")
                    const port = request.readUInt16BE(end)
                    requests.push({ host, port, byName })
                    const upstream = upstreamFor(host, port)
                    sockets.add(upstream)
                    upstream.once("connect", () => { client.write(reply(0)); client.pipe(upstream).pipe(client) })
                    upstream.once("error", () => client.end(reply(5)))
                })
            })
        })
    })
    const port = await listen(server)
    closers.push(() => { for (const s of sockets) s.destroy() })
    return { port, requests }
}

/** An HTTP proxy that tunnels CONNECT for USER and SECRET. `requests` lists the targets it was asked for. */
async function httpProxy() {
    const requests = []
    const sockets = new Set()
    const server = http.createServer()
    server.on("connect", (request, client, head) => {
        sockets.add(client)
        client.on("error", () => {})
        requests.push(request.url)
        if (request.headers["proxy-authorization"] !== `Basic ${Buffer.from(`${USER}:${SECRET}`).toString("base64")}`)
            return client.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
        const [host, port] = request.url.split(":")
        const upstream = upstreamFor(host, Number(port))
        sockets.add(upstream)
        upstream.once("connect", () => {
            client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
            upstream.write(head)
            client.pipe(upstream).pipe(client)
        })
        upstream.once("error", () => client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"))
    })
    const port = await listen(server)
    closers.push(() => { for (const s of sockets) s.destroy() })
    return { port, requests }
}

/** Opens a real WebSocket to the game stand-in through the proxy and says how it went. */
function connect(proxyUrl, gamePort) {
    const via = connectVia(proxyUrl, GAME, 500)
    const socket = new WebSocket(`ws://${GAME}:${gamePort}/`, { agent: via.agent })
    closers.push(() => socket.terminate())
    return new Promise(resolve => {
        socket.once("open", () => resolve({ socket }))
        socket.once("error", error => resolve({ error, failure: via.failureOf(error) }))
    })
}

const echo = socket => new Promise(resolve => {
    socket.once("message", data => resolve(String(data)))
    socket.send("ping")
})

describe("which agent a bot connects with", () => {
    let bot
    afterEach(() => bot?.stop())

    test.each([
        ["socks5h://u:p@127.0.0.1:1080", "SocksProxyAgent"],
        ["socks5://u:p@127.0.0.1:1080", "SocksProxyAgent"],
        ["http://u:p@127.0.0.1:8080", "HttpsProxyAgent"],
        ["https://u:p@127.0.0.1:8443", "HttpsProxyAgent"],
    ])("a bot given %s builds its game socket with a %s", async (proxyUrl, agent) => {
        bot = startBot({ proxyUrl })
        await bot.until(() => bot.socket)
        expect(bot.socket).toEqual({ url: "wss://fake.invalid/", agent })
    })

    test("a bot given no proxy connects directly", async () => {
        bot = startBot()
        await bot.until(() => bot.socket)
        expect(bot.socket).toEqual({ url: "wss://fake.invalid/", agent: null })
    })
})

describe("a real connection through a local proxy", () => {
    test("socks5h: the socket reaches the game through the proxy, which resolves the game's name", async () => {
        const gamePort = await gameServer()
        const proxy = await socksProxy()
        const { socket } = await connect(`socks5h://${USER}:${SECRET}@127.0.0.1:${proxy.port}`, gamePort)
        expect(await echo(socket)).toBe("echo:ping")
        expect(proxy.requests).toEqual([{ host: GAME, port: gamePort, byName: true }])
    })

    test("http: the socket reaches the game through a CONNECT tunnel", async () => {
        const gamePort = await gameServer()
        const proxy = await httpProxy()
        const { socket } = await connect(`http://${USER}:${SECRET}@127.0.0.1:${proxy.port}`, gamePort)
        expect(await echo(socket)).toBe("echo:ping")
        expect(proxy.requests).toEqual([`${GAME}:${gamePort}`])
    })
})

describe("whose failure it is", () => {
    test.each(["socks5h", "http"])("%s: wrong credentials are PROXY_AUTH", async scheme => {
        const gamePort = await gameServer()
        const proxy = await (scheme === "http" ? httpProxy() : socksProxy())
        const { failure } = await connect(`${scheme}://${USER}:wrong@127.0.0.1:${proxy.port}`, gamePort)
        expect(failure).toBe("PROXY_AUTH")
    })

    test.each(["socks5h", "http"])("%s: a proxy nothing listens on is PROXY_ECONNREFUSED", async scheme => {
        const { failure } = await connect(`${scheme}://${USER}:${SECRET}@127.0.0.1:${await closedPort()}`, 443)
        expect(failure).toBe("PROXY_ECONNREFUSED")
    })

    test.each(["socks5h", "http"])("%s: a proxy that accepts the connection and never answers is PROXY_TIMEOUT", async scheme => {
        const silent = net.createServer(client => { client.on("error", () => {}); closers.push(() => client.destroy()) })
        const { failure } = await connect(`${scheme}://${USER}:${SECRET}@127.0.0.1:${await listen(silent)}`, 443)
        expect(failure).toBe("PROXY_TIMEOUT")
    })

    test.each(["socks5h", "http"])("%s: a working proxy that can't reach the game is not the proxy's failure", async scheme => {
        const proxy = await (scheme === "http" ? httpProxy() : socksProxy())
        const { error, failure } = await connect(`${scheme}://${USER}:${SECRET}@127.0.0.1:${proxy.port}`, await closedPort())
        expect(error).toBeInstanceOf(Error)
        expect(failure).toBeNull()
    })

    test("socks5: a game hostname that doesn't resolve here is not the proxy's failure", async () => {
        const proxy = await socksProxy()
        const { error, failure } = await connect(`socks5://${USER}:${SECRET}@127.0.0.1:${proxy.port}`, 443)
        expect(error.code).toBe("ENOTFOUND")
        expect(failure).toBeNull()
        expect(proxy.requests).toEqual([])
    })
})

describe("a bot whose proxy is unreachable", () => {
    let bot
    afterEach(() => bot?.stop())

    test.each(["socks5h", "http"])("%s: stops with PROXY_ECONNREFUSED and never prints the credentials", async scheme => {
        bot = startBot({ realSocket: true, proxyUrl: `${scheme}://${USER}:${SECRET}@127.0.0.1:${await closedPort()}` })
        await bot.until(() => bot.exited, 5000)
        expect(bot.botStates()).toEqual([{ state: "error", reason: "PROXY_ECONNREFUSED" }])
        expect(bot.output + JSON.stringify(bot.toParent)).not.toContain(SECRET)
        expect(bot.output).toContain("PROXY_ECONNREFUSED")
    })
})
