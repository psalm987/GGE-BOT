// Writes into the dev Postgres what only a running bot would, so the drivers can see it arrive live:
// - log: one bot log line, the way apps/runner/src/store.ts writes it: the bot_logs row and its
//   centrifugo_outbox publish in one transaction, so Centrifugo delivers it to every open log view.
// - notify: a crash-loop (or, with a kind, an incoming-attack) notification for an account's owner, the way
//   insertNotification in packages/db does, marked as already emailed so the dev mailer leaves it alone.
// Usage: node dev-db.cjs log <account name> <level 0|1|2> <plugin> <part>...   e.g. log Ironhold 1 feast notEnoughFoodToFeast
//        node dev-db.cjs notify <account name> [crash_loop|incoming_attack]
// Or require it for insertLogLine({ accountName, level, plugin, parts }) and insertNotification({ accountName, kind }).
// The Postgres URL comes from DATABASE_URL, else from the `pnpm dev` banner in DEV_LOG (default /tmp/gge-dev.log).
const fs = require("node:fs")
const path = require("node:path")
const { Client } = require(path.join(__dirname, "../../../../packages/db/node_modules/pg"))
const en = require(path.join(__dirname, "../../../../packages/bot-core/locales/en.json"))

function databaseUrl() {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL
    const log = fs.readFileSync(process.env.DEV_LOG ?? "/tmp/gge-dev.log", "utf8")
    const match = [...log.matchAll(/Postgres\s+(postgres(?:ql)?:\/\/\S+)/g)].at(-1)
    if (!match) throw new Error("no Postgres URL in the dev log; set DATABASE_URL")
    return match[1]
}

/** Runs `work` in one transaction against the account named `accountName`. */
async function withAccount(accountName, work) {
    const db = new Client({ connectionString: databaseUrl() })
    await db.connect()
    try {
        const { rows: [account] } = await db.query(
            "select a.id, a.owner_id, a.name, s.label from game_accounts a join servers s on s.id = a.server_id where a.name = $1 order by a.created_at limit 1",
            [accountName])
        if (!account) throw new Error(`no game account named ${accountName}`)
        await db.query("begin")
        const result = await work(db, account)
        await db.query("commit")
        return result
    } catch (error) {
        await db.query("rollback").catch(() => {})
        throw error
    } finally {
        await db.end()
    }
}

const publish = (db, channel, data) =>
    db.query("insert into centrifugo_outbox (method, payload) values ('publish', $1)", [JSON.stringify({ channel, data })])
const pad = n => String(n).padStart(2, "0")

function insertLogLine({ accountName, level, plugin, parts: rest }) {
    return withAccount(accountName, async (db, account) => {
        const now = new Date()
        const parts = [`[${pad(now.getHours())}:${pad(now.getMinutes())}] `, "[", plugin, "] ", ...rest]
        const message = parts.map(part => typeof part === "string" ? en[part] ?? part : String(part)).join("")
        const { rows: [row] } = await db.query(
            "insert into bot_logs (account_id, level, message, parts, plugin) values ($1, $2, $3, $4, $5) returning id, ts",
            [account.id, level, message, JSON.stringify(parts), plugin])
        const line = { id: Number(row.id), ts: row.ts, level, message, parts, plugin }
        await publish(db, `bot:${account.id}`, { v: 1, kind: "log", accountId: account.id, line })
        return { ...line, accountId: account.id }
    })
}

/** The details of each kind `notify` can write, beside the account snapshot. */
const DETAILS = {
    crash_loop: () => ({ failures: 8, lastError: "The bot stopped responding" }),
    incoming_attack: account => ({ attacker: "Raider", castle: `${account.name} Keep`, arrival: new Date(Date.now() + 10 * 60_000).toISOString() }),
}

function insertNotification({ accountName, kind = "crash_loop" }) {
    return withAccount(accountName, async (db, account) => {
        const data = { accountName: account.name, serverLabel: account.label, ...DETAILS[kind](account) }
        const { rows: [row] } = await db.query(
            `insert into notifications (user_id, account_id, kind, data, dedup_key, email_state)
             values ($1, $2, $3, $4, $5, 'skipped') returning id, created_at`,
            [account.owner_id, account.id, kind, JSON.stringify(data), `verify:${Date.now()}`])
        const notification = { id: Number(row.id), kind, data, accountId: account.id, createdAt: row.created_at, readAt: null }
        await publish(db, `personal:user#${account.owner_id}`, { v: 1, kind: "notification", notification })
        return notification
    })
}

/** Stores a worker report for the account, as the runner's store does, and publishes the status event with it. `resources: null` clears the report. */
function insertResources({ accountName, resources }) {
    return withAccount(accountName, async (db, account) => {
        const stored = resources && { ...resources, reportedAt: new Date().toISOString() }
        const { rows: [row] } = await db.query(
            `insert into bot_status (account_id, resources, heartbeat_at) values ($1, $2, now())
             on conflict (account_id) do update set resources = $2, heartbeat_at = now() returning *`,
            [account.id, stored && JSON.stringify(stored)])
        const figure = value => typeof value === "number" ? value : null
        const status = {
            actualState: row.actual_state, heartbeatAt: row.heartbeat_at, lastError: row.last_error, bannedUntil: row.banned_until,
            pluginStates: row.plugin_states, castles: stored?.castles ?? [],
            resources: stored && {
                food: figure(stored.food), mead: figure(stored.mead), cash: figure(stored.cash), gold: figure(stored.gold),
                aquamarine: figure(stored.aquamarin_name), attackDailyCount: figure(stored.attackDailyCount), reportedAt: stored.reportedAt,
            },
        }
        await publish(db, `personal:user#${account.owner_id}`, { v: 1, kind: "status", accountId: account.id, status })
        return status
    })
}

/** Stores one plugin's settings as given, the way a record written before an option changed sits in the table. The API would bring it up to date on the way in. */
function storePluginSettings({ accountName, plugin, enabled, options }) {
    return withAccount(accountName, db => db.query(
        `insert into plugin_settings (account_id, plugin_key, enabled, options) values ((select id from game_accounts where name = $1 order by created_at limit 1), $2, $3, $4)
         on conflict (account_id, plugin_key) do update set enabled = $3, options = $4`,
        [accountName, plugin, enabled, JSON.stringify(options)]))
}

module.exports = { insertLogLine, insertNotification, insertResources, storePluginSettings }

if (require.main === module) {
    const [command, accountName, level, plugin, ...parts] = process.argv.slice(2)
    const run = command === "log" && accountName && ["0", "1", "2"].includes(level) && plugin
        ? insertLogLine({ accountName, level: Number(level), plugin, parts: parts.map(p => /^\d+$/.test(p) ? Number(p) : p) })
        : command === "notify" && accountName && (!level || level in DETAILS) ? insertNotification({ accountName, kind: level }) : undefined
    if (!run) {
        console.error("usage: node dev-db.cjs log <account name> <level 0|1|2> <plugin> <part>...\n       node dev-db.cjs notify <account name> [crash_loop|incoming_attack]")
        process.exit(2)
    }
    run.then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exit(1) })
}
