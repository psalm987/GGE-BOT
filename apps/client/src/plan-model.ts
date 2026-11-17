import type { LicenseCode, PaymentOutcome } from "@gge/contracts"

const CODE_BODY = 12

/**
 * What the code field shows as the player types or pastes: upper case, grouped as GGE-XXXX-XXXX-XXXX. The server
 * normalises again, so this only has to help the eye. A typed GGE prefix is kept out of the body.
 */
export function maskCode(input: string) {
    const raw = input.toUpperCase().replace(/[^0-9A-Z]/g, "")
    if ("GGE".startsWith(raw))
        return raw
    // Twelve characters are a whole code typed without its prefix, even one that starts with GGE.
    const body = (raw.startsWith("GGE") && raw.length !== CODE_BODY ? raw.slice(3) : raw).slice(0, CODE_BODY)
    return `GGE-${body.match(/.{1,4}/g)!.join("-")}`
}

/** Whether the field holds a whole code, so the Redeem button can wake up. */
export const codeComplete = (masked: string) => masked.replace(/[^0-9A-Z]/g, "").length === 3 + CODE_BODY

export type PointsStanding =
    | { canRedeem: true; toward: number }
    | { canRedeem: false; toward: number; why: "negative" | "short"; needed: number }

/** Where the player's balance stands against the redeem cost. `toward` is how far into the next redemption they are, for the bar. */
export function pointsStanding(balance: number, cost: number): PointsStanding {
    if (balance >= cost)
        return { canRedeem: true, toward: cost }
    return { canRedeem: false, toward: Math.max(0, balance), why: balance < 0 ? "negative" : "short", needed: cost - balance }
}

/** The Team codes as a spreadsheet: one row per code, quoted so a comma in a username can't split a row. */
export function codesCsv(codes: LicenseCode[], header: string[]) {
    const quote = (value: string) => `"${value.replace(/"/g, "\"\"")}"`
    const rows = codes.map(c => [c.code, c.status, c.redeemedBy ?? "", c.redeemedAt?.toISOString() ?? "", c.createdAt.toISOString()])
    return [header, ...rows].map(row => row.map(quote).join(",")).join("\r\n") + "\r\n"
}

/** What the return page tells the buyer, from what Paystack last said. */
export type ReturnState = "delivered" | "waiting" | "failed" | "refunded"

export function returnState(outcome: PaymentOutcome): ReturnState {
    if (outcome.status === "refunded")
        return "refunded"
    if (outcome.status === "failed")
        return "failed"
    return outcome.status === "paid" && outcome.delivered ? "delivered" : "waiting"
}

const PENDING_CODE_KEY = "gge.redeemCode"
const PENDING_CODE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * A code from a /redeem?code= link, kept in this browser until the player is signed in with a confirmed email,
 * so it survives signing up and opening the confirmation link in another tab.
 */
export function savePendingCode(code: string, now = Date.now()) {
    try {
        localStorage.setItem(PENDING_CODE_KEY, JSON.stringify({ code, at: now }))
    } catch {
        // Storage can be off, as in some private windows; the link then only works when already signed in.
    }
}

export function pendingCode(now = Date.now()): string | null {
    try {
        const saved = JSON.parse(localStorage.getItem(PENDING_CODE_KEY) ?? "null") as { code?: unknown; at?: unknown } | null
        if (typeof saved?.code === "string" && typeof saved.at === "number" && now - saved.at < PENDING_CODE_MAX_AGE_MS)
            return saved.code
    } catch {
        // Unreadable or blocked storage holds no code.
    }
    return null
}

export function clearPendingCode() {
    try {
        localStorage.removeItem(PENDING_CODE_KEY)
    } catch {
        // Nothing to clear when storage is blocked.
    }
}
