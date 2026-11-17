import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { auditLog, emailTokens, users } from "@gge/db"
import { hashPassword } from "../src/auth/passwords.ts"
import { PASSWORD, startApi, type Api } from "./harness.ts"

let api: Api
beforeAll(async () => {
    api = await startApi()
    await api.signedInAdmin()
})
afterAll(() => api.close())

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const NEW_PASSWORD = "a brand new passphrase"
const userRow = async (username: string) => (await api.db.select().from(users).where(eq(users.username, username)))[0]!
const mailsTo = (email: string) => api.sent.filter(m => m.to === email)
const loggedIn = async (login: string, password = PASSWORD) => {
    const c = api.client()
    await c.api.auth.login({ login, password })
    return c
}

describe("email verification", () => {
    test("signup emails a link, and opening it verifies the address", async () => {
        const player = await api.signup("vera")
        expect(await player.api.auth.me()).toMatchObject({ email: "vera@example.test", emailVerified: false })
        expect(mailsTo("vera@example.test")).toHaveLength(1)
        expect(mailsTo("vera@example.test")[0]).toMatchObject({ tag: "verify_email" })

        await api.client().api.auth.verifyEmail({ token: api.lastToken("vera@example.test")! })
        expect(await player.api.auth.me()).toMatchObject({ emailVerified: true })
    })

    test("a token works once", async () => {
        await api.signup("walt")
        const token = api.lastToken("walt@example.test")!
        expect(await codeOf(api.client().api.auth.verifyEmail({ token }))).toBe("ok")
        expect(await codeOf(api.client().api.auth.verifyEmail({ token }))).toBe("BAD_REQUEST")
    })

    test("an expired token is rejected and leaves the address unverified", async () => {
        const player = await api.signup("xena")
        const token = api.lastToken("xena@example.test")!
        await api.db.update(emailTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(emailTokens.userId, (await userRow("xena")).id))
        expect(await codeOf(api.client().api.auth.verifyEmail({ token }))).toBe("BAD_REQUEST")
        expect(await player.api.auth.me()).toMatchObject({ emailVerified: false })
    })

    test("a token stops working once the user's email is different", async () => {
        const player = await api.signup("yuri")
        const token = api.lastToken("yuri@example.test")!
        await api.db.update(users).set({ email: "yuri2@example.test" }).where(eq(users.username, "yuri"))
        expect(await codeOf(api.client().api.auth.verifyEmail({ token }))).toBe("BAD_REQUEST")
        expect(await player.api.auth.me()).toMatchObject({ emailVerified: false })
        expect(await api.db.select().from(emailTokens).where(and(eq(emailTokens.userId, (await userRow("yuri")).id)))).toMatchObject([{ usedAt: null }])
    })

    test("a verification token is not a reset token", async () => {
        await api.signup("zane")
        const token = api.lastToken("zane@example.test")!
        expect(await codeOf(api.client().api.auth.resetPassword({ token, password: NEW_PASSWORD }))).toBe("BAD_REQUEST")
    })

    test("resending replaces the earlier link, and is rate limited", async () => {
        const player = await api.signup("ada")
        const first = api.lastToken("ada@example.test")!
        await player.api.account.resendVerification()
        const second = api.lastToken("ada@example.test")!
        expect(second).not.toBe(first)
        expect(await codeOf(api.client().api.auth.verifyEmail({ token: first }))).toBe("BAD_REQUEST")
        expect(await codeOf(api.client().api.auth.verifyEmail({ token: second }))).toBe("ok")
        await player.api.account.resendVerification()
        expect(mailsTo("ada@example.test")).toHaveLength(2)

        const other = await api.signup("ben")
        const codes = []
        for (let i = 0; i < 4; i++) codes.push(await codeOf(other.api.account.resendVerification()))
        expect(codes).toEqual(["ok", "ok", "ok", "TOO_MANY_REQUESTS"])
    })
})

describe("signup with an email", () => {
    test("an email already in use (any case) is a conflict", async () => {
        await api.signup("cleo", "cleo@example.test")
        expect(await codeOf(api.client().api.auth.signup({ username: "cleo2", email: "CLEO@example.test", password: PASSWORD }))).toBe("CONFLICT")
    })

    test("a failed verification email is audited and the signup still goes through", async () => {
        api.failMail(true)
        try {
            expect(await api.client().api.auth.signup({ username: "lost", email: "lost@example.test", password: PASSWORD })).toMatchObject({ emailVerified: false })
        } finally {
            api.failMail(false)
        }
        expect((await api.db.select().from(auditLog).where(eq(auditLog.action, "email.send_failed"))).length).toBeGreaterThan(0)
    })
})

describe("password reset", () => {
    const requestReset = (email: string) => api.client().api.auth.requestPasswordReset({ email })
    const resetToken = async (email: string) => {
        await requestReset(email)
        return await vi.waitFor(() => {
            const link = api.sent.findLast(m => m.to === email && m.tag === "reset_password")?.text.match(/https?:\/\/\S+/)?.[0]
            if (!link)
                throw new Error(`no reset mail for ${email} yet`)
            return new URL(link).searchParams.get("token")!
        })
    }

    test("every address gets the same answer, and only a verified one gets mail", async () => {
        await api.signup("dora")
        await api.signup("eli")
        await api.client().api.auth.verifyEmail({ token: api.lastToken("eli@example.test")! })
        const before = api.sent.length

        const answers = [await requestReset("nobody@example.test"), await requestReset("dora@example.test"), await requestReset("eli@example.test")]
        expect(answers).toEqual([{ ok: true }, { ok: true }, { ok: true }])
        await vi.waitFor(() => expect(api.sent.slice(before)).toMatchObject([{ to: "eli@example.test", tag: "reset_password" }]))
    })

    test("resetting signs every session out, replaces the password, and sends a notice", async () => {
        await api.signup("fay")
        await api.client().api.auth.verifyEmail({ token: api.lastToken("fay@example.test")! })
        const phone = await loggedIn("fay")
        const laptop = await loggedIn("fay@example.test")
        const token = await resetToken("fay@example.test")

        await api.client().api.auth.resetPassword({ token, password: NEW_PASSWORD })
        expect(await phone.api.auth.me()).toBeNull()
        expect(await laptop.api.auth.me()).toBeNull()
        expect(await codeOf(api.client().api.auth.login({ login: "fay", password: PASSWORD }))).toBe("UNAUTHORIZED")
        expect(await codeOf(api.client().api.auth.login({ login: "fay", password: NEW_PASSWORD }))).toBe("ok")
        expect(mailsTo("fay@example.test").at(-1)).toMatchObject({ tag: "password_changed" })
        expect(await codeOf(api.client().api.auth.resetPassword({ token, password: NEW_PASSWORD }))).toBe("BAD_REQUEST")
    })

    test("a weak new password is refused and the link still works", async () => {
        await api.signup("gus")
        await api.client().api.auth.verifyEmail({ token: api.lastToken("gus@example.test")! })
        const token = await resetToken("gus@example.test")
        expect(await codeOf(api.client().api.auth.resetPassword({ token, password: "short" }))).toBe("BAD_REQUEST")
        expect(await codeOf(api.client().api.auth.resetPassword({ token, password: NEW_PASSWORD }))).toBe("ok")
    })

    test("a link dies when the account's email has changed since it was sent", async () => {
        await api.signup("hal")
        await api.client().api.auth.verifyEmail({ token: api.lastToken("hal@example.test")! })
        const token = await resetToken("hal@example.test")
        await api.db.update(users).set({ email: "hal2@example.test" }).where(eq(users.username, "hal"))
        expect(await codeOf(api.client().api.auth.resetPassword({ token, password: NEW_PASSWORD }))).toBe("BAD_REQUEST")
        expect(await codeOf(api.client().api.auth.login({ login: "hal", password: PASSWORD }))).toBe("ok")
    })

    test("requests for one address are limited, whether or not it has an account", async () => {
        const codes = []
        for (let i = 0; i < 4; i++) codes.push(await codeOf(requestReset("spam@example.test")))
        expect(codes).toEqual(["ok", "ok", "ok", "TOO_MANY_REQUESTS"])
    })

    test("a mail provider outage looks the same to the caller", async () => {
        await api.signup("ivy")
        await api.client().api.auth.verifyEmail({ token: api.lastToken("ivy@example.test")! })
        const failuresBefore = (await api.db.select().from(auditLog).where(eq(auditLog.action, "email.send_failed"))).length
        api.failMail(true)
        try {
            expect(await requestReset("ivy@example.test")).toEqual({ ok: true })
            await vi.waitFor(async () => expect((await api.db.select().from(auditLog).where(eq(auditLog.action, "email.send_failed"))).length).toBeGreaterThan(failuresBefore))
        } finally {
            api.failMail(false)
        }
    })
})

describe("login by username or email", () => {
    test("either works, in any case", async () => {
        await api.signup("joan")
        expect(await codeOf(api.client().api.auth.login({ login: "JOAN@Example.test", password: PASSWORD }))).toBe("ok")
        expect(await codeOf(api.client().api.auth.login({ login: "joan", password: PASSWORD }))).toBe("ok")
    })

    test("an unknown email fails exactly like a wrong password", async () => {
        await api.signup("kai")
        const wrong = await api.client().api.auth.login({ login: "kai@example.test", password: "wrong password!" }).catch(e => e)
        const nobody = await api.client().api.auth.login({ login: "nobody@example.test", password: "wrong password!" }).catch(e => e)
        expect([nobody.code, nobody.message]).toEqual([wrong.code, wrong.message])
    })

    test("a username can't contain an @", async () => {
        expect(await codeOf(api.client().api.auth.signup({ username: "a@b.c", email: "ab@example.test", password: PASSWORD }))).toBe("BAD_REQUEST")
    })
})

describe("change password", () => {
    test("a wrong current password is rejected", async () => {
        const player = await api.signup("lou")
        expect(await codeOf(player.api.account.changePassword({ current: "not my password", next: NEW_PASSWORD }))).toBe("BAD_REQUEST")
        expect(await codeOf(api.client().api.auth.login({ login: "lou", password: PASSWORD }))).toBe("ok")
    })

    test("other sessions are signed out and this one survives", async () => {
        const here = await api.signup("max")
        const elsewhere = await loggedIn("max")
        await here.api.account.changePassword({ current: PASSWORD, next: NEW_PASSWORD })
        expect(await here.api.auth.me()).toMatchObject({ username: "max" })
        expect(await elsewhere.api.auth.me()).toBeNull()
        expect(await codeOf(api.client().api.auth.login({ login: "max", password: PASSWORD }))).toBe("UNAUTHORIZED")
        expect(await codeOf(api.client().api.auth.login({ login: "max", password: NEW_PASSWORD }))).toBe("ok")
        expect(mailsTo("max@example.test").at(-1)).toMatchObject({ tag: "password_changed" })
    })

    test("signed-out callers can't use it", async () => {
        expect(await codeOf(api.client().api.account.changePassword({ current: PASSWORD, next: NEW_PASSWORD }))).toBe("UNAUTHORIZED")
    })
})

describe("adding an email", () => {
    test("an account without one can add it once, then must verify it", async () => {
        await api.db.insert(users).values({ username: "legacy-ned", passwordHash: await hashPassword(PASSWORD) })
        const ned = await loggedIn("legacy-ned")
        expect(await ned.api.auth.me()).toMatchObject({ email: null, emailVerified: false })

        await ned.api.account.addEmail({ email: "ned@example.test" })
        expect(await ned.api.auth.me()).toMatchObject({ email: "ned@example.test", emailVerified: false })
        await api.client().api.auth.verifyEmail({ token: api.lastToken("ned@example.test")! })
        expect(await ned.api.auth.me()).toMatchObject({ emailVerified: true })
        expect(await codeOf(ned.api.account.addEmail({ email: "ned2@example.test" }))).toBe("CONFLICT")
    })

    test("an address that belongs to someone else is a conflict", async () => {
        await api.db.insert(users).values({ username: "legacy-opal", passwordHash: await hashPassword(PASSWORD) })
        const opal = await loggedIn("legacy-opal")
        expect(await codeOf(opal.api.account.addEmail({ email: "ned@example.test" }))).toBe("CONFLICT")
    })

    test("a mistyped address can be fixed before it is confirmed, and the old link stops working", async () => {
        const pia = await api.signup("pia", "pia@exmaple.test")
        const oldToken = api.lastToken("pia@exmaple.test")!

        await pia.api.account.addEmail({ email: "pia@example.test" })
        expect(await pia.api.auth.me()).toMatchObject({ email: "pia@example.test", emailVerified: false })
        expect(await codeOf(api.client().api.auth.verifyEmail({ token: oldToken }))).toBe("BAD_REQUEST")

        await api.client().api.auth.verifyEmail({ token: api.lastToken("pia@example.test")! })
        expect(await pia.api.auth.me()).toMatchObject({ email: "pia@example.test", emailVerified: true })
    })

    test("a confirmed address can't be swapped this way", async () => {
        const quinn = await api.player("quinn")
        expect(await codeOf(quinn.api.account.addEmail({ email: "quinn2@example.test" }))).toBe("CONFLICT")
        expect(await quinn.api.auth.me()).toMatchObject({ email: "quinn@example.test" })
    })
})

describe("the language an email is written in", () => {
    test("a player's chosen language sets the page language and direction, with English text until it is translated", async () => {
        const player = await api.signup("hana")
        await api.db.update(users).set({ locale: "ar" }).where(eq(users.username, "hana"))
        await player.api.account.resendVerification()
        const [mail] = mailsTo("hana@example.test").slice(-1)
        expect(mail!.html).toContain('lang="ar" dir="rtl"')
        expect(mail!.subject).toBe("Verify your email")
        expect(mail!.text).toContain("Verify email:")
    })

    test("the language detected at signup is used until the player chooses one", async () => {
        await api.signup("ines")
        await api.db.update(users).set({ detectedLocale: "de" }).where(eq(users.username, "ines"))
        const player = await loggedIn("ines")
        await player.api.account.resendVerification()
        expect(mailsTo("ines@example.test").at(-1)!.html).toContain('lang="de" dir="ltr"')
    })

    test("a deleted account's farewell still goes out in its owner's language", async () => {
        const player = await api.player("jana")
        await api.db.update(users).set({ locale: "ar" }).where(eq(users.username, "jana"))
        await player.api.account.deleteMe({ password: PASSWORD, confirmUsername: "jana" })
        const mail = mailsTo("jana@example.test").at(-1)!
        expect(mail.tag).toBe("account_deleted")
        expect(mail.html).toContain('lang="ar" dir="rtl"')
        expect(mail.text).toContain("Your GGE Bot account jana was deleted")
    })
})
