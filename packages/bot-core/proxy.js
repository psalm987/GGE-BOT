const { HttpsProxyAgent } = require("https-proxy-agent")
const { SocksProxyAgent } = require("socks-proxy-agent")

/**
 * Connects a bot to the game through a proxy.
 *
 * `agent` goes to `new WebSocket(url, { agent })`. A `socks5:` or `socks5h:` URL gets a SOCKS agent, and with
 * `socks5h` the proxy resolves the game's hostname. An `http:` or `https:` URL gets a CONNECT tunnel.
 *
 * `failureOf(error)` names a connection error the proxy caused as `PROXY_<code>`, and returns null for one it
 * didn't. The runner counts `PROXY_` failures against the proxy and turns it off after several, so only what is
 * surely the proxy's doing gets the name: it couldn't be reached, it refused the credentials, or it never answered.
 * Once the proxy has connected the bot to the game, or has answered that it couldn't, the failure is the game's or
 * the network's and stays a plain socket error.
 *
 * Nothing here logs or reports the URL: it carries the proxy's credentials.
 *
 * @param {string} proxyUrl
 * @param {string} gameHost
 * @param {number} timeoutMs How long the proxy has to connect the bot to the game, or to say that it can't.
 */
function connectVia(proxyUrl, gameHost, timeoutMs) {
    const socks = new URL(proxyUrl).protocol.startsWith("socks")
    const agent = socks ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl)
    let tunnelled = false
    /** An HTTP proxy's answer to CONNECT. */
    let connectStatus

    agent.on("proxyConnect", response => { connectStatus = response.statusCode })
    const connect = agent.connect.bind(agent)
    agent.connect = async (request, options) => {
        // The WebSocket's own handshake timeout starts only once it has a socket, which is after this.
        let timer
        const silent = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The proxy timed out")), timeoutMs) })
        try {
            const socket = await Promise.race([connect(request, options), silent])
            tunnelled = socks || connectStatus === 200
            return socket
        } finally {
            clearTimeout(timer)
        }
    }

    function failureOf(error) {
        if (tunnelled)
            return null
        if (connectStatus === 407)
            return "PROXY_AUTH"
        if (connectStatus !== undefined)
            return null
        const message = String(error?.message ?? "")
        // A SOCKS reply code: the proxy took the request and couldn't reach the game.
        if (/rejected connection/i.test(message))
            return null
        // With socks5: the game's hostname is resolved here, before the proxy is contacted.
        if (error?.hostname === gameHost)
            return null
        if (/authentication/i.test(message))
            return "PROXY_AUTH"
        if (/timed out/i.test(message))
            return "PROXY_TIMEOUT"
        // The SOCKS client keeps only the message of a socket error, such as "connect ECONNREFUSED 10.0.0.5:1080".
        return `PROXY_${error?.code ?? message.match(/\bE[A-Z]{4,}\b/)?.[0] ?? "FAILED"}`
    }

    return { agent, failureOf }
}

module.exports = { connectVia }
