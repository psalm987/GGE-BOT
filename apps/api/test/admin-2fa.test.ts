import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest"
import { loginChallenges } from "@gge/db"
import { base32Decode } from "../src/auth/totp.ts"
import { PASSWORD, codeFor, currentStep, startApi, type Api } from "./harness.ts"

let api: Api
let boss: Awaited<ReturnType<Api["signedInAdmin"]>>
beforeAll(async () => {
    api = await startApi()
    boss = await api.signedInAdmin()
})
afterAll(() => api.close())

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const MFA_COOKIE = "gge_admin_mfa"

/** A code the authenticator won't show anywhere near now. */
function wrongCode(secret: Uint8Array) {
    const near = new Set([-2, -1, 0, 1, 2].map(offset => codeFor(secret, currentStep() + offset)))
    return ["000000", "111111", "222222", "333333", "444444", "555555"].find(code => !near.has(code))!
}

/** A browser that has passed the password step for `username`. */
async function pastPassword(username: string) {
    const browser = api.admin()
    const { step } = await browser.api.auth.login({ login: username, password: PASSWORD })
    return { ...browser, step }
}

/** A brand-new admin who enrolls through the sign-in flow. */
async function enrollThroughSignIn(username: string, email?: string) {
    await api.newAdmin(username, email)
    const browser = await pastPassword(username)
    const { secret, otpauthUri } = await browser.api.auth.enrollStart()
    const enrolled = await browser.api.auth.enrollConfirm({ code: codeFor(base32Decode(secret)) })
    return { ...browser, secret: base32Decode(secret), otpauthUri, ...enrolled }
}

const auditActions = async () => (await boss.api.audit.list({ limit: 500 })).map(e => `${e.actor}:${e.action}`)

describe("the password step", () => {
    test("a correct admin password alone gives no session", async () => {
        const browser = await pastPassword("boss")
        expect(browser.step).toBe("totp")
        expect(browser.jar.has(MFA_COOKIE)).toBe(true)
        expect(browser.jar.has("gge_admin")).toBe(false)
        expect(await browser.api.auth.me()).toBeNull()
        expect(await codeOf(browser.api.overview())).toBe("UNAUTHORIZED")
        expect(await codeOf(browser.api.security.regenerateRecoveryCodes({ code: codeFor(boss.secret, currentStep() + 1) }))).toBe("UNAUTHORIZED")
    })

    test("the second step needs the cookie the password step set", async () => {
        const { secret } = await api.enrolledAdmin("nocookie")
        expect(await codeOf(api.admin().api.auth.verifyTotp({ code: codeFor(secret) }))).toBe("UNAUTHORIZED")
        expect(await codeOf(api.admin().api.auth.enrollStart())).toBe("UNAUTHORIZED")
    })

    test("a newer sign-in attempt replaces the older challenge", async () => {
        const { secret } = await api.enrolledAdmin("twotabs")
        const first = await pastPassword("twotabs")
        const second = await pastPassword("twotabs")
        expect(await codeOf(first.api.auth.verifyTotp({ code: codeFor(secret) }))).toBe("UNAUTHORIZED")
        expect(await codeOf(second.api.auth.verifyTotp({ code: codeFor(secret) }))).toBe("ok")
    })

    test("signing in to the player app still takes only the password", async () => {
        const client = api.client()
        expect(await client.api.auth.login({ login: "boss", password: PASSWORD })).toMatchObject({ username: "boss", role: "admin" })
        expect(await client.api.auth.me()).toMatchObject({ username: "boss" })
    })
})

describe("setting up an authenticator at first sign-in", () => {
    test("a new admin enrolls, gets ten recovery codes once and is signed in", async () => {
        const fresh = await enrollThroughSignIn("fresh")

        const uri = new URL(fresh.otpauthUri)
        expect(decodeURIComponent(uri.pathname)).toBe("/GGE Bot Admin:fresh")
        expect(base32Decode(uri.searchParams.get("secret")!).equals(fresh.secret)).toBe(true)
        expect(fresh.user).toMatchObject({ username: "fresh", role: "admin" })
        expect(new Set(fresh.recoveryCodes).size).toBe(10)
        for (const code of fresh.recoveryCodes)
            expect(code).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/)
        expect(await fresh.api.auth.me()).toMatchObject({ username: "fresh" })
        expect(fresh.jar.has(MFA_COOKIE)).toBe(false)
        expect(await auditActions()).toEqual(expect.arrayContaining(["fresh:auth.totp.enrolled", "fresh:auth.login.admin"]))

        const again = await pastPassword("fresh")
        expect(again.step).toBe("totp")
        expect(await again.api.auth.verifyTotp({ code: codeFor(fresh.secret, currentStep() + 1) })).toMatchObject({ username: "fresh" })
    })

    test("a wrong first code confirms nothing", async () => {
        await api.newAdmin("fumble")
        const browser = await pastPassword("fumble")
        const { secret } = await browser.api.auth.enrollStart()
        expect(await codeOf(browser.api.auth.enrollConfirm({ code: wrongCode(base32Decode(secret)) }))).toBe("BAD_REQUEST")
        expect(await browser.api.auth.me()).toBeNull()
        expect((await pastPassword("fumble")).step).toBe("enroll")
    })

    test("enrolling is refused once an authenticator is confirmed, so a password can't replace it", async () => {
        const { secret } = await api.enrolledAdmin("settled")
        const browser = await pastPassword("settled")
        expect(await codeOf(browser.api.auth.enrollStart())).toBe("FORBIDDEN")
        expect(await codeOf(browser.api.auth.enrollConfirm({ code: codeFor(secret) }))).toBe("FORBIDDEN")
        expect(await codeOf(browser.api.auth.verifyTotp({ code: codeFor(secret) }))).toBe("ok")
    })

    test("a code is refused for an admin who hasn't finished enrolling", async () => {
        await api.player("halfway")
        await boss.api.users.setRole({ id: (await boss.api.users.list({ search: "halfway" }))[0]!.id, role: "admin" })
        const browser = await pastPassword("halfway")
        expect(browser.step).toBe("enroll")
        expect(await codeOf(browser.api.auth.verifyTotp({ code: "123456" }))).toBe("FORBIDDEN")
        const { secret } = await browser.api.auth.enrollStart()
        expect(await codeOf(browser.api.auth.verifyTotp({ code: codeFor(base32Decode(secret)) }))).toBe("FORBIDDEN")
        expect(await browser.api.auth.me()).toBeNull()
    })
})

describe("codes", () => {
    test("a code that already signed someone in is refused the second time", async () => {
        const { secret } = await api.enrolledAdmin("replay")
        const code = codeFor(secret)
        expect(await codeOf((await pastPassword("replay")).api.auth.verifyTotp({ code }))).toBe("ok")

        const thief = await pastPassword("replay")
        expect(await codeOf(thief.api.auth.verifyTotp({ code }))).toBe("BAD_REQUEST")
        expect(await thief.api.auth.me()).toBeNull()
        expect(await codeOf(thief.api.auth.verifyTotp({ code: codeFor(secret, currentStep() + 1) }))).toBe("ok")
    })

    test("a code typed with spaces is accepted; anything but six digits is rejected as input", async () => {
        const { secret } = await api.enrolledAdmin("spaces")
        const browser = await pastPassword("spaces")
        expect(await codeOf(browser.api.auth.verifyTotp({ code: "12345" }))).toBe("BAD_REQUEST")
        expect(await codeOf(browser.api.auth.verifyTotp({ code: "abcdef" }))).toBe("BAD_REQUEST")
        const code = codeFor(secret)
        expect(await codeOf(browser.api.auth.verifyTotp({ code: ` ${code.slice(0, 3)} ${code.slice(3)} ` }))).toBe("ok")
    })

    test("five wrong codes end the sign-in attempt, even for the right code afterwards", async () => {
        const { id, secret } = await api.enrolledAdmin("guessed")
        const browser = await pastPassword("guessed")
        const outcomes = []
        for (let i = 0; i < 5; i++)
            outcomes.push(await codeOf(browser.api.auth.verifyTotp({ code: wrongCode(secret) })))
        expect(outcomes).toEqual(["BAD_REQUEST", "BAD_REQUEST", "BAD_REQUEST", "BAD_REQUEST", "UNAUTHORIZED"])
        expect(browser.jar.has(MFA_COOKIE)).toBe(false)
        expect(await api.db.$count(loginChallenges, eq(loginChallenges.userId, id))).toBe(0)

        expect(await codeOf(browser.api.auth.verifyTotp({ code: codeFor(secret) }))).toBe("UNAUTHORIZED")
        expect(await browser.api.auth.me()).toBeNull()
    })

    test("ten wrong codes in a row lock the admin's code step, however many times the password is re-entered", async () => {
        const { secret } = await api.enrolledAdmin("hammered")
        for (let attempt = 0; attempt < 2; attempt++) {
            const browser = await pastPassword("hammered")
            for (let i = 0; i < 5; i++)
                await browser.api.auth.verifyTotp({ code: wrongCode(secret) }).catch(() => {})
        }
        const browser = await pastPassword("hammered")
        expect(await codeOf(browser.api.auth.verifyTotp({ code: codeFor(secret) }))).toBe("TOO_MANY_REQUESTS")
        expect(await browser.api.auth.me()).toBeNull()
    })

    test("a challenge stops working once it expires", async () => {
        const { id, secret } = await api.enrolledAdmin("slow")
        const browser = await pastPassword("slow")
        await api.db.update(loginChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(loginChallenges.userId, id))
        expect(await codeOf(browser.api.auth.verifyTotp({ code: codeFor(secret) }))).toBe("UNAUTHORIZED")
        expect(await browser.api.auth.me()).toBeNull()
    })
})

describe("recovery codes", () => {
    test("a recovery code signs in once, however it is typed, and the admin is emailed", async () => {
        const owner = await enrollThroughSignIn("lostphone", "lostphone@example.test")
        const [first] = owner.recoveryCodes as [string]

        const browser = await pastPassword("lostphone")
        expect(await browser.api.auth.verifyTotp({ recoveryCode: ` ${first.toUpperCase().replace("-", " ")} ` })).toMatchObject({ username: "lostphone" })
        expect(await browser.api.auth.me()).toMatchObject({ username: "lostphone" })

        const mail = api.sent.findLast(m => m.to === "lostphone@example.test")
        expect(mail).toMatchObject({ tag: "recovery_code_used", subject: "A recovery code was used to sign in" })
        expect(mail!.text).toContain("9 recovery codes left")
        expect(mail!.text).not.toContain(first)
        expect(await auditActions()).toContain("lostphone:auth.recovery_code.used")

        const second = await pastPassword("lostphone")
        expect(await codeOf(second.api.auth.verifyTotp({ recoveryCode: first }))).toBe("BAD_REQUEST")
        expect(await codeOf(second.api.auth.verifyTotp({ recoveryCode: "aaaaa-aaaaa" }))).toBe("BAD_REQUEST")
        expect(await second.api.auth.me()).toBeNull()
        expect(await codeOf(second.api.auth.verifyTotp({ recoveryCode: owner.recoveryCodes[1]! }))).toBe("ok")
    })

    test("one admin's recovery code doesn't work for another", async () => {
        const owner = await enrollThroughSignIn("codeowner")
        await api.enrolledAdmin("borrower")
        const browser = await pastPassword("borrower")
        expect(await codeOf(browser.api.auth.verifyTotp({ recoveryCode: owner.recoveryCodes[0]! }))).toBe("BAD_REQUEST")
    })

    test("regenerating needs a current code and retires the old set", async () => {
        const owner = await enrollThroughSignIn("regen")
        expect(await codeOf(owner.api.security.regenerateRecoveryCodes({ code: wrongCode(owner.secret) }))).toBe("BAD_REQUEST")
        // The code that enrolled them is spent, like any used code.
        expect(await codeOf(owner.api.security.regenerateRecoveryCodes({ code: codeFor(owner.secret, currentStep() - 1) }))).toBe("BAD_REQUEST")

        const fresh = await owner.api.security.regenerateRecoveryCodes({ code: codeFor(owner.secret, currentStep() + 1) })
        expect(fresh).toHaveLength(10)
        expect(fresh.filter(code => owner.recoveryCodes.includes(code))).toEqual([])
        expect(await auditActions()).toContain("regen:auth.recovery_codes.regenerated")

        const browser = await pastPassword("regen")
        expect(await codeOf(browser.api.auth.verifyTotp({ recoveryCode: owner.recoveryCodes[0]! }))).toBe("BAD_REQUEST")
        expect(await codeOf(browser.api.auth.verifyTotp({ recoveryCode: fresh[0]! }))).toBe("ok")
    })
})

describe("resetting an admin's two-factor sign-in", () => {
    test("another admin's reset forces re-enrollment and ends only their admin sessions", async () => {
        const target = await enrollThroughSignIn("locked")
        const asPlayer = api.client()
        await asPlayer.api.auth.login({ login: "locked", password: PASSWORD })
        const row = async () => (await boss.api.users.list({ search: "locked" }))[0]!
        expect(await row()).toMatchObject({ totpEnabled: true })

        await boss.api.users.resetTotp({ id: target.user.id })

        expect(await target.api.auth.me()).toBeNull()
        expect(await asPlayer.api.auth.me()).toMatchObject({ username: "locked" })
        expect(await row()).toMatchObject({ totpEnabled: false })
        const entry = (await boss.api.audit.list({ limit: 50 })).find(e => e.action === "admin.user.totp_reset")
        expect(entry).toMatchObject({ actor: "boss", targetType: "user", targetId: target.user.id })

        const browser = await pastPassword("locked")
        expect(browser.step).toBe("enroll")
        expect(await codeOf(browser.api.auth.verifyTotp({ recoveryCode: target.recoveryCodes[0]! }))).toBe("FORBIDDEN")
        const { secret } = await browser.api.auth.enrollStart()
        expect(base32Decode(secret).equals(target.secret)).toBe(false)
    })

    test("an admin can't reset their own, and a missing user is reported", async () => {
        const me = (await boss.api.auth.me())!.id
        expect(await codeOf(boss.api.users.resetTotp({ id: me }))).toBe("BAD_REQUEST")
        expect((await boss.api.users.list({ search: "boss" }))[0]).toMatchObject({ totpEnabled: true })
        expect(await codeOf(boss.api.users.resetTotp({ id: crypto.randomUUID() }))).toBe("NOT_FOUND")
    })

    test("the reset-2fa command does the same from the server and records itself", async () => {
        const target = await enrollThroughSignIn("stranded")
        const cli = fileURLToPath(new URL("../src/cli/reset-2fa.ts", import.meta.url))
        const { stdout } = await promisify(execFile)(process.execPath, [cli, "--username", "Stranded"], { env: { ...process.env, DATABASE_URL: inject("databaseUrl") } })

        expect(stdout).toContain("Two-factor sign-in reset for Stranded")
        expect(await target.api.auth.me()).toBeNull()
        expect((await pastPassword("stranded")).step).toBe("enroll")
        const entry = (await boss.api.audit.list({ limit: 50 })).find(e => e.action === "admin.user.totp_reset" && e.targetId === target.user.id)
        expect(entry).toMatchObject({ actor: null, meta: { via: "cli" } })
    })
})
