const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

/** Checks a Cloudflare Turnstile token. Without a secret there is no captcha, so everything passes. */
export async function verifyTurnstile(secret: string | undefined, token: string | undefined, ip: string): Promise<boolean> {
    if (!secret)
        return true
    if (!token)
        return false
    try {
        const response = await fetch(SITEVERIFY, {
            method: "POST",
            body: new URLSearchParams({ secret, response: token, remoteip: ip }),
            signal: AbortSignal.timeout(5_000),
        })
        return response.ok && (await response.json() as { success?: boolean }).success === true
    } catch {
        return false
    }
}
