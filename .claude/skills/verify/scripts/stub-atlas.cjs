// A stand-in for the alisinabh/atlas GeoIP service, for driving IP language detection without a MaxMind account.
// Usage: node stub-atlas.cjs [port]   (default 8089)   then: GEOIP_URL=http://127.0.0.1:8089 pnpm dev
// Every 93.x.x.x address is in Italy; anything else answers 400 like atlas does for an address it has no country for.
const http = require("node:http")
const port = Number(process.argv[2] ?? 8089)
http.createServer((req, res) => {
    const ip = decodeURIComponent(req.url.split("/").pop())
    res.setHeader("content-type", "application/json")
    if (!ip.startsWith("93.")) return res.writeHead(400).end(JSON.stringify({ error: "SPECIAL_IP" }))
    res.end(JSON.stringify({ results: { [ip]: { country: { iso_code: "IT" } } }, database_build_epoch: 0 }))
}).listen(port, "127.0.0.1", () => console.log(`stub atlas on :${port}`))
