// Authenticator codes for the admin that `pnpm dev` seeds, and an API sign-in that uses them.
const { createHmac } = require("node:crypto")

// The seeded admin's secret; tools/dev/dev.ts holds the same value as DEV_ADMIN_TOTP_SECRET.
const DEV_ADMIN_TOTP_SECRET = "GGEBOTDEVADMINTOTPSECRET23456767"

function base32Decode(text) {
    const bits = [...text].map(c => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c).toString(2).padStart(5, "0")).join("")
    return Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)))
}

/** RFC 6238: HMAC-SHA-1, 30-second steps, 6 digits. */
function totpCode(secretBase32, step) {
    const counter = Buffer.alloc(8)
    counter.writeBigUInt64BE(BigInt(step))
    const mac = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest()
    const offset = mac[mac.length - 1] & 0x0f
    return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, "0")
}

const stepNow = () => Math.floor(Date.now() / 30_000)
let lastStep = 0

/**
 * A code the API hasn't seen from this process. The API refuses a code for a step it already
 * accepted and takes one step ahead of the clock, so the second code in a 30-second window is
 * the next step's, and a third waits for the clock.
 */
async function nextCode(secretBase32 = DEV_ADMIN_TOTP_SECRET) {
    const step = Math.max(stepNow(), lastStep + 1)
    while (step > stepNow() + 1)
        await new Promise(resolve => setTimeout(resolve, 500))
    lastStep = step
    return totpCode(secretBase32, step)
}

/** Signs the seeded admin in through the admin API (password, then code) and returns the session cookie. */
async function adminSessionCookie({ apiUrl, adminUrl }) {
    const call = async (path, body, cookie) => {
        const res = await fetch(`${apiUrl}/admin/rpc/${path}`, { method: "POST", headers: { origin: adminUrl, "content-type": "application/json", ...(cookie && { cookie }) }, body: JSON.stringify({ json: body }) })
        return { ok: res.ok, json: (await res.json()).json, cookies: res.headers.getSetCookie().map(c => c.split(";")[0]) }
    }
    const password = await call("auth/login", { login: "admin", password: "demo-password" })
    if (password.json?.step !== "totp")
        throw new Error(`admin password step answered ${JSON.stringify(password.json)}; expected the seeded admin to be asked for a code`)
    const challenge = password.cookies.find(c => c.startsWith("gge_admin_mfa="))
    // Another run may have spent this step's code moments ago; the next code then works.
    for (let attempt = 0; attempt < 3; attempt++) {
        const verified = await call("auth/verifyTotp", { code: await nextCode() }, challenge)
        if (verified.ok)
            return verified.cookies.find(c => c.startsWith("gge_admin="))
    }
    throw new Error("the seeded admin's authenticator codes were refused three times")
}

module.exports = { DEV_ADMIN_TOTP_SECRET, totpCode, stepNow, nextCode, adminSessionCookie }
