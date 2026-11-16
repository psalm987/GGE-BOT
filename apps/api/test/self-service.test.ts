import { eq, sql } from "drizzle-orm"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest"
import { auditLog, botLogs, botRuns, centrifugoOutbox, emailTokens, gameAccounts, insertNotification, sessions, users } from "@gge/db"
import { PASSWORD, allStrings, startApi, type Api } from "./harness.ts"

let api: Api
beforeAll(async () => { api = await startApi() })
afterAll(() => api.close())

type Player = Awaited<ReturnType<Api["player"]>>
const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const messageOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { message: string }) => e.message)
const userRow = async (username: string) => (await api.db.select().from(users).where(eq(users.username, username)))[0]
const mailsTo = (email: string) => api.sent.filter(m => m.to === email)
const tags = (email: string) => mailsTo(email).map(m => m.tag)
const newAccount = (name: string, password = "pw") => ({ name, serverId: 26, password, externalEvent: false, plugins: {} })
const BAD_LINK = "This link is invalid or has expired"

/** Asks to change a player's email and returns the token mailed to the new address. */
async function requestChange(player: Player, email: string) {
    await player.api.account.changeEmail({ email, password: PASSWORD })
    return api.lastToken(email)!
}

describe("changing a verified email", () => {
    test("the new address confirms, the old one is told twice, and every session ends", async () => {
        const player = await api.player("cora")
        const otherDevice = api.client()
        await otherDevice.api.auth.login({ login: "cora", password: PASSWORD })

        await player.api.account.changeEmail({ email: "cora-new@example.test", password: PASSWORD })

        expect(tags("cora-new@example.test")).toEqual(["change_email"])
        expect(api.lastLink("cora-new@example.test")!.pathname).toBe("/confirm-email-change")
        const token = api.lastToken("cora-new@example.test")!
        const notice = mailsTo("cora@example.test").at(-1)!
        expect(notice.tag).toBe("email_change_requested")
        expect(notice.text + notice.html).not.toContain(token)
        expect(notice.text + notice.html).not.toMatch(/https?:\/\//)
        expect(await player.api.auth.me()).toMatchObject({ email: "cora@example.test", emailVerified: true })

        await api.client().api.account.confirmEmailChange({ token })

        const row = (await userRow("cora"))!
        expect(row.email).toBe("cora-new@example.test")
        expect(row.emailVerifiedAt).not.toBeNull()
        expect(await api.db.select().from(sessions).where(eq(sessions.userId, row.id))).toEqual([])
        expect(await player.api.auth.me()).toBeNull()
        expect(await otherDevice.api.auth.me()).toBeNull()
        expect(mailsTo("cora@example.test").at(-1)).toMatchObject({ tag: "email_changed" })
        expect(mailsTo("cora@example.test").at(-1)!.text).toContain("cora-new@example.test")
        const actions = (await api.db.select().from(auditLog).where(eq(auditLog.actorId, row.id))).map(entry => entry.action)
        expect(actions).toEqual(expect.arrayContaining(["account.email.change_requested", "account.email.changed"]))

        expect(await codeOf(api.client().api.auth.login({ login: "cora-new@example.test", password: PASSWORD }))).toBe("ok")
        expect(await codeOf(api.client().api.auth.login({ login: "cora@example.test", password: PASSWORD }))).toBe("UNAUTHORIZED")
    })

    test("a wrong password is refused, sends nothing, and the tenth wrong guess locks the form", async () => {
        const player = await api.player("dana")
        const attempt = (password: string) => codeOf(player.api.account.changeEmail({ email: "dana-new@example.test", password }))
        for (let i = 0; i < 10; i++)
            expect(await attempt("not my password")).toBe("BAD_REQUEST")
        expect(await attempt(PASSWORD)).toBe("TOO_MANY_REQUESTS")
        expect(mailsTo("dana-new@example.test")).toEqual([])
        expect(await api.db.select().from(emailTokens).where(eq(emailTokens.purpose, "change_email"))
            .then(rows => rows.filter(row => row.email === "dana-new@example.test"))).toEqual([])
        expect(await codeOf(player.api.account.changePassword({ current: PASSWORD, next: "a brand new passphrase" })), "the password form has its own count").toBe("ok")
    })

    test("a disposable address, another player's address in any spelling, and the current address are refused", async () => {
        await api.player("gmailer", "some.one@gmail.com")
        const player = await api.player("eli")
        const change = (email: string) => player.api.account.changeEmail({ email, password: PASSWORD })

        expect(await messageOf(change("eli@mailinator.com"))).toBe("Please use a permanent email address")
        expect(await codeOf(change("someone+bots@googlemail.com"))).toBe("CONFLICT")
        expect(await messageOf(change("someone+bots@googlemail.com"))).toBe("That email is already in use")
        expect(await messageOf(change("eli@example.test"))).toBe("That is already your email")
        expect(api.sent.filter(m => m.tag === "change_email" && /eli|someone/.test(m.to))).toEqual([])
    })

    test("a link works once", async () => {
        const token = await requestChange(await api.player("finn"), "finn-new@example.test")
        expect(await codeOf(api.client().api.account.confirmEmailChange({ token }))).toBe("ok")
        expect(await messageOf(api.client().api.account.confirmEmailChange({ token }))).toBe(BAD_LINK)
    })

    test("an older link is dead once a later change went through", async () => {
        const player = await api.player("gina")
        const first = await requestChange(player, "gina-first@example.test")
        const second = await requestChange(player, "gina-second@example.test")
        await api.client().api.account.confirmEmailChange({ token: second })

        expect(await messageOf(api.client().api.account.confirmEmailChange({ token: first }))).toBe(BAD_LINK)
        expect((await userRow("gina"))!.email).toBe("gina-second@example.test")
    })

    test("a link issued against an address the account no longer has changes nothing", async () => {
        const token = await requestChange(await api.player("hugo"), "hugo-new@example.test")
        await api.db.update(users).set({ email: "hugo-moved@example.test" }).where(eq(users.username, "hugo"))

        expect(await messageOf(api.client().api.account.confirmEmailChange({ token }))).toBe(BAD_LINK)
        expect((await userRow("hugo"))!.email).toBe("hugo-moved@example.test")
        expect(await api.db.select().from(emailTokens).where(eq(emailTokens.email, "hugo-new@example.test"))).toMatchObject([{ usedAt: null }])
    })

    test("an address someone else took before the confirm is refused, and the account keeps its email and sessions", async () => {
        const player = await api.player("iris")
        const token = await requestChange(player, "wanted@example.test")
        await api.signup("jack", "wanted@example.test")

        const confirm = api.client().api.account.confirmEmailChange({ token })
        expect(await codeOf(confirm)).toBe("CONFLICT")
        expect(await messageOf(api.client().api.account.confirmEmailChange({ token }))).toBe("That email is already in use")
        expect(await player.api.auth.me()).toMatchObject({ email: "iris@example.test", emailVerified: true })
        expect(tags("iris@example.test")).not.toContain("email_changed")
    })

    test("an unverified account is told to verify first, and one with no email to add one; neither gets a link", async () => {
        const unverified = await api.signup("kira")
        expect(await messageOf(unverified.api.account.changeEmail({ email: "kira-new@example.test", password: PASSWORD })))
            .toBe("Verify your current email before you change it")
        expect((await userRow("kira"))!.email).toBe("kira@example.test")

        await api.newAdmin("noemail")
        const bare = api.client()
        await bare.api.auth.login({ login: "noemail", password: PASSWORD })
        expect(await messageOf(bare.api.account.changeEmail({ email: "noemail-new@example.test", password: PASSWORD }))).toBe("Add an email address first")
        expect(await codeOf(bare.api.account.addEmail({ email: "noemail-new@example.test" })), "addEmail is still the way in").toBe("ok")
        expect(api.sent.filter(m => m.tag === "change_email" && /kira|noemail/.test(m.to))).toEqual([])
    })
})

describe("adding an email", () => {
    test("a failure to store the token leaves the account without the address, so a retry succeeds", async () => {
        await api.newAdmin("halfway")
        const c = api.client()
        await c.api.auth.login({ login: "halfway", password: PASSWORD })
        await api.db.execute(sql.raw(`
            create function test_refuse_add() returns trigger language plpgsql as $$ begin raise exception 'token store down'; end $$;
            create trigger test_refuse_add before insert on email_tokens for each row when (new.email = 'halfway@example.test') execute function test_refuse_add();
        `))
        try {
            expect(await codeOf(c.api.account.addEmail({ email: "halfway@example.test" }))).toBe("INTERNAL_SERVER_ERROR")
        } finally {
            await api.db.execute(sql.raw("drop trigger test_refuse_add on email_tokens; drop function test_refuse_add()"))
        }
        const row = (await userRow("halfway"))!
        expect(row.email).toBeNull()
        expect(await api.db.select().from(auditLog).where(eq(auditLog.actorId, row.id)).then(rows => rows.map(r => r.action))).not.toContain("account.email.add")

        expect(await codeOf(c.api.account.addEmail({ email: "halfway@example.test" }))).toBe("ok")
        expect(tags("halfway@example.test")).toEqual(["verify_email"])
    })
})

describe("downloading your data", () => {
    const GAME_PASSWORD = "the-game-password-9471"

    /** A player with one account that has a plugin setting, a run, a log line and a notification. */
    async function playerWithHistory(username: string, accountName: string) {
        const player = await api.player(username)
        const userId = (await player.api.auth.me())!.id
        const account = await player.api.accounts.create({ ...newAccount(accountName, GAME_PASSWORD), plugins: { attackNomads: { enabled: true, options: {} } } })
        await api.db.insert(botRuns).values({ accountId: account.id, endedAt: new Date(), endReason: "stopped" })
        await api.db.insert(botLogs).values({ accountId: account.id, level: 1, message: `${accountName} logged in` })
        await insertNotification(api.db, { userId, accountId: account.id, dedupKey: `ban-${account.id}`, kind: "banned", data: { accountName, serverLabel: "India 1", bannedUntil: null } })
        return { player, userId, account }
    }

    test("the export has every section, and no password in any form", async () => {
        const { player, userId, account } = await playerWithHistory("lena", "LenaKeep")
        const [stored] = await api.db.select().from(gameAccounts).where(eq(gameAccounts.id, account.id))
        const row = (await userRow("lena"))!

        const data = await player.api.account.exportData()

        expect(data.profile).toMatchObject({ username: "lena", email: "lena@example.test", emailVerified: true, role: "user", notificationPrefs: { banned: true, shutoff: false } })
        expect(data.accounts).toMatchObject([{ id: account.id, name: "LenaKeep", server: "India 1", desiredState: "stopped", externalEvent: false, schedule: null }])
        expect(data.pluginSettings).toContainEqual(expect.objectContaining({ accountId: account.id, pluginKey: "attackNomads", enabled: true }))
        expect(data.runs).toMatchObject([{ accountId: account.id, endReason: "stopped" }])
        expect(data.logs).toMatchObject([{ accountId: account.id, message: "LenaKeep logged in" }])
        expect(data.notifications).toMatchObject([{ kind: "banned", accountId: account.id }])
        expect(data.audit.map(entry => entry.action)).toEqual(expect.arrayContaining(["auth.signup", "account.create"]))

        const strings = allStrings(data)
        const text = JSON.stringify(data)
        expect(strings.filter(s => /password|sealed|hash|salt/i.test(s))).toEqual([])
        for (const secret of [GAME_PASSWORD, row.passwordHash, stored!.passwordSealed.toString("base64"), stored!.passwordSealed.toString("hex"), PASSWORD])
            expect(text).not.toContain(secret)
        expect(text, "no session ids").not.toContain((await api.db.select().from(sessions).where(eq(sessions.userId, userId)))[0]!.id)
    })

    test("a second download within 10 minutes is refused", async () => {
        const player = await api.player("milo")
        expect(await codeOf(player.api.account.exportData())).toBe("ok")
        expect(await codeOf(player.api.account.exportData())).toBe("TOO_MANY_REQUESTS")
        expect(await codeOf((await api.player("nina")).api.account.exportData()), "the limit is per player").toBe("ok")
    })

    test("another player's accounts, logs, notifications and audit entries never appear", async () => {
        const mine = await playerWithHistory("otto", "OttoKeep")
        const theirs = await playerWithHistory("petra", "PetraKeep")

        const data = await mine.player.api.account.exportData()

        expect(data.accounts.map(a => a.name)).toEqual(["OttoKeep"])
        const text = JSON.stringify(data)
        for (const foreign of [theirs.account.id, theirs.userId, "PetraKeep", "petra"])
            expect(text).not.toContain(foreign)
    })

    test("signed out, there is nothing to download", async () => {
        expect(await codeOf(api.client().api.account.exportData())).toBe("UNAUTHORIZED")
    })
})

describe("deleting your own account", () => {
    const outbox = (userId: string) => api.db.select().from(centrifugoOutbox)
        .where(sql`${centrifugoOutbox.method} = 'disconnect' and ${centrifugoOutbox.payload}->>'user' = ${userId}`)

    test("a wrong password or a username that doesn't match deletes nothing", async () => {
        const player = await api.player("quin")
        expect(await messageOf(player.api.account.deleteMe({ password: "not my password", confirmUsername: "quin" }))).toBe("Your current password is wrong")
        expect(await messageOf(player.api.account.deleteMe({ password: PASSWORD, confirmUsername: "quinn" }))).toBe("Type your username to confirm")
        expect(await player.api.auth.me()).toMatchObject({ username: "quin" })
    })

    test("wrong passwords are counted, and the tenth locks deletion", async () => {
        const player = await api.player("rhea")
        for (let i = 0; i < 10; i++)
            expect(await codeOf(player.api.account.deleteMe({ password: "not my password", confirmUsername: "rhea" }))).toBe("BAD_REQUEST")
        expect(await codeOf(player.api.account.deleteMe({ password: PASSWORD, confirmUsername: "rhea" }))).toBe("TOO_MANY_REQUESTS")
        expect(await userRow("rhea")).toBeDefined()
    })

    test("the only admin can't delete themselves; with a second admin, one can", async () => {
        await api.db.update(users).set({ role: "user" }).where(eq(users.role, "admin"))
        await api.newAdmin("solo", "solo@example.test")
        const solo = api.client()
        await solo.api.auth.login({ login: "solo", password: PASSWORD })
        const remove = () => solo.api.account.deleteMe({ password: PASSWORD, confirmUsername: "solo" })

        expect(await codeOf(remove())).toBe("CONFLICT")
        const spareId = await api.newAdmin("spare")
        await api.db.update(users).set({ status: "disabled" }).where(eq(users.id, spareId))
        expect(await codeOf(remove()), "a disabled admin doesn't count").toBe("CONFLICT")
        expect(await userRow("solo")).toBeDefined()

        await api.db.update(users).set({ status: "active" }).where(eq(users.id, spareId))
        expect(await codeOf(remove())).toBe("ok")
        expect(await userRow("solo")).toBeUndefined()
    })

    test("everything goes: the account, its bots, its sessions and the personal details in the audit log", async () => {
        const player = await api.player("Tess")
        const userId = (await player.api.auth.me())!.id
        const account = await player.api.accounts.create(newAccount("TessKeep"))
        await player.api.accounts.setDesiredState({ ids: [account.id], state: "running" })
        const before = await api.db.select().from(auditLog).where(eq(auditLog.actorId, userId))
        expect(before.find(entry => entry.action === "auth.signup")!.meta).toMatchObject({ ip: expect.any(String), emailCanonical: "tess@example.test" })
        const lastAuditId = Math.max(...before.map(entry => entry.id))

        const listener = new pg.Client({ connectionString: inject("databaseUrl") })
        await listener.connect()
        let reconciles = 0
        listener.on("notification", n => { if (n.channel === "gge_desired") reconciles++ })
        await listener.query("listen gge_desired")
        try {
            await player.api.account.deleteMe({ password: PASSWORD, confirmUsername: "tess" })
            await listener.query("select 1")
            expect(reconciles, "the cascade to game_accounts tells the runner to reconcile").toBeGreaterThan(0)
        } finally {
            await listener.end()
        }

        expect(await userRow("Tess")).toBeUndefined()
        expect(await api.db.select().from(gameAccounts).where(eq(gameAccounts.id, account.id))).toEqual([])
        expect(player.jar.has("gge_session"), "the cookie is cleared").toBe(false)
        expect(await codeOf(player.api.accounts.list())).toBe("UNAUTHORIZED")
        expect(await codeOf(api.client().api.auth.login({ login: "Tess", password: PASSWORD }))).toBe("UNAUTHORIZED")

        const kept = await api.db.select().from(auditLog).where(sql`${auditLog.id} <= ${lastAuditId} and ${auditLog.id} in ${before.map(entry => entry.id)}`)
        expect(kept).toHaveLength(before.length)
        expect(kept.every(entry => entry.actorId === null && entry.meta === null)).toBe(true)
        const everything = JSON.stringify(await api.db.select().from(auditLog))
        expect(everything).not.toContain("tess@example.test")

        const [deleted] = await api.db.select().from(auditLog).where(eq(auditLog.action, "account.deleted")).then(rows => rows.filter(r => (r.meta as { userId: string }).userId === userId))
        expect(deleted).toMatchObject({ actorId: null, meta: { userId } })
        expect(await outbox(userId)).not.toEqual([])
        expect(tags("tess@example.test").at(-1)).toBe("account_deleted")
    })

    test("the username can be signed up again", async () => {
        const player = await api.player("uma")
        await player.api.account.deleteMe({ password: PASSWORD, confirmUsername: "UMA" })
        const again = await api.signup("uma")
        expect(await again.api.auth.me()).toMatchObject({ username: "uma", emailVerified: false })
    })

    test("an account whose email was never verified gets no confirmation email", async () => {
        const player = await api.signup("vito")
        const sentBefore = mailsTo("vito@example.test").length
        await player.api.account.deleteMe({ password: PASSWORD, confirmUsername: "vito" })
        expect(mailsTo("vito@example.test")).toHaveLength(sentBefore)
    })
})
