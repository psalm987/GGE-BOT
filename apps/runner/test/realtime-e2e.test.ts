// The whole path through a real Centrifugo: store -> outbox -> consumer -> websocket.
// Skipped unless CENTRIFUGO_BIN names the binary (docs/development.md says where to get it).
import { spawn, type ChildProcess } from "node:child_process"
import { createHmac, randomUUID } from "node:crypto"
import { createServer } from "node:net"
import { fileURLToPath } from "node:url"
import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest"
import { BotChannelEvent, UserEvent, botChannel, userChannel } from "@gge/contracts"
import { createDb, gameAccounts, runMigrations, servers, users, type Db } from "@gge/db"
import { createStore } from "../src/store.ts"

const SECRET = "e2e-centrifugo-secret-0123456789abcdef"
const ORIGIN = "http://app.test"
const config = fileURLToPath(new URL("../../../infra/centrifugo/config.json", import.meta.url))

const freePort = () => new Promise<number>(resolve => {
    const server = createServer().listen(0, "127.0.0.1", () => {
        const { port } = server.address() as { port: number }
        server.close(() => resolve(port))
    })
})

function jwt(claims: object) {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
    const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ ...claims, exp: Math.floor(Date.now() / 1000) + 60 })}`
    return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`
}

type Reply = { id?: number; error?: { code: number; message: string }; push?: { channel: string; pub?: { data: unknown } } }

/** A browser stand-in speaking Centrifugo's JSON protocol. */
async function connect(port: number, userId: string) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/connection/websocket`, { headers: { origin: ORIGIN } } as never)
    const replies = new Map<number, (reply: Reply) => void>()
    const received: { channel: string; data: unknown }[] = []
    socket.addEventListener("message", event => {
        for (const line of String(event.data).split("\n")) {
            const reply = JSON.parse(line) as Reply
            if (reply.id)
                replies.get(reply.id)?.(reply)
            else if (reply.push?.pub)
                received.push({ channel: reply.push.channel, data: reply.push.pub.data })
            else if (!reply.push)
                socket.send("{}")
        }
    })
    socket.addEventListener("close", event => {
        for (const resolve of replies.values())
            resolve({ error: { code: event.code, message: `disconnected: ${event.reason}` } })
    })
    await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve)
        socket.addEventListener("error", () => reject(new Error("websocket refused")))
    })
    let nextId = 0
    const command = (body: object) => new Promise<Reply>(resolve => {
        const id = ++nextId
        replies.set(id, resolve)
        socket.send(JSON.stringify({ id, ...body }))
    })
    const connected = await command({ connect: { token: jwt({ sub: userId }) } })
    if (connected.error)
        throw new Error(connected.error.message)
    return {
        received,
        subscribe: async (channel: string, token?: string) => (await command({ subscribe: { channel, ...(token && { token }) } })).error?.message ?? "ok",
        close: () => socket.close(),
    }
}

describe.skipIf(!process.env.CENTRIFUGO_BIN)("through a real Centrifugo", () => {
    let admin: Db
    let db: Db
    let centrifugo: ChildProcess
    let port: number
    const database = `rt_e2e_${randomUUID().replaceAll("-", "")}`

    beforeAll(async () => {
        // Its own database: Centrifugo deletes outbox rows as it reads them, which would break tests that count them.
        admin = createDb(inject("databaseUrl"))
        await admin.execute(sql.raw(`create database ${database}`))
        const url = new URL(inject("databaseUrl"))
        url.pathname = `/${database}`
        db = createDb(url.href)
        await runMigrations(db)
        await db.insert(servers).values({ id: 26, label: "India 1", wsHost: "in1.test", zone: "EmpireEx_26" })

        port = await freePort()
        centrifugo = spawn(process.env.CENTRIFUGO_BIN!, ["--config", config], {
            stdio: "ignore",
            env: {
                PATH: process.env.PATH,
                CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY: SECRET,
                CENTRIFUGO_CLIENT_ALLOWED_ORIGINS: ORIGIN,
                // No user in the URL: it comes from PGUSER, the way production passes PGPASSWORD.
                CENTRIFUGO_CONSUMERS_OUTBOX_POSTGRESQL_DSN: `postgres://${url.host}/${database}`,
                PGUSER: url.username,
                CENTRIFUGO_HTTP_SERVER_ADDRESS: "127.0.0.1",
                CENTRIFUGO_HTTP_SERVER_PORT: String(port),
            },
        })
        for (let tries = 0; !await fetch(`http://127.0.0.1:${port}/health`).then(r => r.ok, () => false); tries++) {
            if (tries > 100)
                throw new Error("Centrifugo did not become healthy")
            await new Promise(r => setTimeout(r, 100))
        }
    }, 30_000)

    afterAll(async () => {
        centrifugo?.kill("SIGKILL")
        await db?.$pool.end()
        await admin.execute(sql.raw(`drop database if exists ${database} with (force)`))
        await admin.$pool.end()
    })

    async function player() {
        const name = `e2e-${randomUUID()}`
        const [owner] = await db.insert(users).values({ username: name, passwordHash: "x" }).returning()
        const [account] = await db.insert(gameAccounts).values({ ownerId: owner!.id, name, serverId: 26, passwordSealed: Buffer.from("x") }).returning()
        return { userId: owner!.id, accountId: account!.id }
    }

    test("a status change and a log line reach their subscribers, and the delivered rows are deleted", async () => {
        const { userId, accountId } = await player()
        const browser = await connect(port, userId)
        expect(await browser.subscribe(userChannel(userId))).toBe("ok")
        expect(await browser.subscribe(botChannel(accountId), jwt({ sub: userId, channel: botChannel(accountId) }))).toBe("ok")

        const store = createStore(db, { flushMs: 5 })
        await store.setStatus(accountId, { actualState: "running", heartbeat: true })
        store.log(accountId, 0, ["attackNomads", " started"], "Attack Nomads started")
        await store.flush()

        await expect.poll(() => browser.received.length, { timeout: 5000 }).toBe(2)
        browser.close()
        const status = browser.received.find(m => m.channel === userChannel(userId))!
        expect(UserEvent.parse(status.data)).toMatchObject({ kind: "status", accountId, status: { actualState: "running", heartbeatAt: expect.any(Date) } })
        const log = browser.received.find(m => m.channel === botChannel(accountId))!
        expect(BotChannelEvent.parse(log.data).line).toMatchObject({ message: "Attack Nomads started", parts: ["attackNomads", " started"] })
        await expect.poll(async () => (await db.execute(sql`select 1 from centrifugo_outbox`)).rowCount, { timeout: 5000 }).toBe(0)
    })

    test("nobody else can subscribe to a player's channels", async () => {
        const alice = await player()
        const mallory = await player()
        // A fresh socket each time: Centrifugo drops one that shows a token it rejects.
        const asMallory = async (channel: string, token?: string) => {
            const browser = await connect(port, mallory.userId)
            const answer = await browser.subscribe(channel, token)
            browser.close()
            return answer
        }
        const aliceBot = botChannel(alice.accountId)

        expect(await asMallory(userChannel(alice.userId))).toBe("permission denied")
        expect(await asMallory(aliceBot)).toBe("permission denied")
        expect(await asMallory(aliceBot, jwt({ sub: mallory.userId, channel: botChannel(mallory.accountId) }))).toBe("disconnected: invalid token")
        expect(await asMallory(aliceBot, jwt({ sub: alice.userId, channel: aliceBot }))).toBe("disconnected: invalid token")
    })

    test("a socket from an origin that isn't allowed is refused", async () => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/connection/websocket`, { headers: { origin: "http://evil.test" } } as never)
        const outcome = await new Promise(resolve => {
            socket.addEventListener("open", () => resolve("open"))
            socket.addEventListener("error", () => resolve("refused"))
        })
        expect(outcome).toBe("refused")
    })
})
