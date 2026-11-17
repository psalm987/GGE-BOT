// A stand-in for Paystack's two endpoints, so the drivers can buy a package end to end without the internet.
// POST /transaction/initialize answers with a checkout URL on this stub; opening it marks the transaction paid
// and redirects to the callback_url with ?reference=, as Paystack's hosted checkout does. GET /transaction/verify/:ref
// reports it. Start the stack with PAYSTACK_SECRET_KEY=sk_test_dummy PAYSTACK_BASE_URL=http://127.0.0.1:<port>.
// Usage: node stub-paystack.cjs [port]   (default 8090)
const http = require("node:http")

const port = Number(process.argv[2] ?? 8090)
const transactions = new Map()

const send = (res, status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body))
async function read(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}
}

http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`)
    if (req.method === "POST" && url.pathname === "/transaction/initialize") {
        if (!req.headers.authorization?.startsWith("Bearer sk_")) return send(res, 401, { status: false, message: "Invalid key" })
        const body = await read(req)
        transactions.set(body.reference, { status: "abandoned", amount: body.amount, currency: body.currency, callbackUrl: body.callback_url })
        console.log(`initialize ${body.reference} ${body.amount} ${body.currency}`)
        return send(res, 200, { status: true, message: "Authorization URL created", data: { authorization_url: `http://127.0.0.1:${port}/checkout/${body.reference}`, access_code: "stub", reference: body.reference } })
    }
    const checkout = req.method === "GET" && url.pathname.match(/^\/checkout\/(.+)$/)
    if (checkout) {
        const reference = decodeURIComponent(checkout[1])
        const transaction = transactions.get(reference)
        if (!transaction) return send(res, 404, { status: false, message: "No such checkout" })
        transaction.status = "success"
        const back = new URL(transaction.callbackUrl)
        back.searchParams.set("reference", reference)
        console.log(`paid ${reference}`)
        return res.writeHead(302, { location: back.toString() }).end()
    }
    const verify = req.method === "GET" && url.pathname.match(/^\/transaction\/verify\/(.+)$/)
    const transaction = verify && transactions.get(decodeURIComponent(verify[1]))
    if (transaction)
        return send(res, 200, { status: true, message: "Verification successful", data: { id: 1, status: transaction.status, amount: transaction.amount, currency: transaction.currency, reference: decodeURIComponent(verify[1]) } })
    send(res, 400, { status: false, message: "Transaction reference not found" })
}).listen(port, "127.0.0.1", () => console.log(`stub paystack on http://127.0.0.1:${port}`))
