import { sql } from "drizzle-orm"
import {
    bigint,
    bigserial,
    boolean,
    check,
    customType,
    index,
    integer,
    jsonb,
    pgEnum,
    pgTable,
    primaryKey,
    smallint,
    text,
    timestamp,
    unique,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core"
import { ANNOUNCEMENT_SEVERITIES, CURRENCIES, PERIOD_SOURCES, PLAN_IDS, POINTS_REASONS, PURCHASE_PROVIDERS, PURCHASE_STATUSES } from "@gge/contracts"
import { LOCALE_CODES } from "@gge/i18n"

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" })
const localeCodes = sql.raw(LOCALE_CODES.map(code => `'${code}'`).join(", "))
const quoted = (values: readonly string[]) => sql.raw(values.map(value => `'${value}'`).join(", "))
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()

export const role = pgEnum("role", ["user", "admin"])
export const userStatus = pgEnum("user_status", ["active", "disabled"])
export const passwordAlgo = pgEnum("password_algo", ["argon2id", "pbkdf2-legacy"])
export const audience = pgEnum("audience", ["client", "admin"])
export const desiredState = pgEnum("desired_state", ["running", "stopped"])
export const emailTokenPurpose = pgEnum("email_token_purpose", ["verify_email", "reset_password", "change_email"])
/** How many attack plugins one account may run at once; "none" means no limit. */
export const attackPluginCap = pgEnum("attack_plugin_cap", ["4", "6", "none"])
export const actualState = pgEnum("actual_state", ["starting", "running", "stopped", "auth_failed", "banned", "error", "crash_loop"])

export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    email: text("email"),
    /** canonical_email(email): one value per real mailbox, so a+1@ and a.b@gmail.com can't register twice. Defined in migration 0007. */
    emailCanonical: text("email_canonical").generatedAlwaysAs(sql`canonical_email(email)`),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    passwordHash: text("password_hash").notNull(),
    /** Only for imported PBKDF2 hashes; cleared when the hash is upgraded. */
    passwordSalt: bytea("password_salt"),
    passwordAlgo: passwordAlgo("password_algo").notNull().default("argon2id"),
    role: role("role").notNull().default("user"),
    status: userStatus("status").notNull().default("active"),
    /** Game accounts the user may own; admins are exempt. Admin-adjustable. */
    maxBots: integer("max_bots").notNull().default(1),
    /** Replaces the plan's max_accounts for this user. Read only while app_settings.billing_live is on. */
    maxBotsOverride: integer("max_bots_override"),
    /** When the player last closed the "redeem your points" banner. It shows again once they earn more. */
    pointsNudgeDismissedAt: timestamp("points_nudge_dismissed_at", { withTimezone: true }),
    /** Overrides app_settings.attack_plugin_cap for this user; null uses the default. Admin-adjustable. */
    attackPluginCap: attackPluginCap("attack_plugin_cap"),
    /** Users.uuid in the legacy user.db, so the importer can re-run. */
    legacyUuid: text("legacy_uuid").unique(),
    /** Which notification kinds are also emailed. A missing kind takes its default; read it with notificationPrefs() from @gge/contracts. */
    notificationPrefs: jsonb("notification_prefs").notNull().default({}),
    /** The language the user picked; null is Automatic. */
    locale: text("locale", { enum: LOCALE_CODES }),
    /** What Automatic last resolved to for this user, so emails can be localised without a request. Never the IP itself. */
    detectedLocale: text("detected_locale", { enum: LOCALE_CODES }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
}, t => [
    check("users_locale_valid", sql`${t.locale} in (${localeCodes})`),
    check("users_detected_locale_valid", sql`${t.detectedLocale} in (${localeCodes})`),
    check("users_max_bots_override_valid", sql`${t.maxBotsOverride} >= 0`),
    uniqueIndex("users_username_lower").on(sql`lower(${t.username})`),
    uniqueIndex("users_email_canonical").on(t.emailCanonical),
])

export const sessions = pgTable("sessions", {
    /** sha256 of the cookie token, hex. The token itself is never stored. */
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    audience: audience("audience").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
}, t => [index("sessions_user").on(t.userId)])

export const emailTokens = pgTable("email_tokens", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    purpose: emailTokenPurpose("purpose").notNull(),
    /** sha256 of the emailed token, hex. The token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    /** The address the token was issued for; a token dies when the user's email no longer matches. */
    email: text("email").notNull(),
    /** Only for change_email: the address being replaced. The change applies only while the user still has it. */
    currentEmail: text("current_email"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
}, t => [index("email_tokens_user").on(t.userId)])

/** An admin's authenticator secret. `confirmedAt` null: enrollment started, no code proven yet. */
export const userTotp = pgTable("user_totp", {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    /** Encrypted with TOTP_ENCRYPTION_KEY (@gge/crypto encryptWithKey), bound to this user. */
    secretEnc: bytea("secret_enc").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    /** The newest 30-second step a code was accepted for; a code for this step or an older one is a replay. */
    lastStep: bigint("last_step", { mode: "number" }).notNull().default(0),
    createdAt: createdAt(),
})

export const recoveryCodes = pgTable("recovery_codes", {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** sha256 of the code without dashes, hex. The code itself is never stored. */
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
}, t => [index("recovery_codes_user").on(t.userId)])

/** An admin who passed the password step and still owes a second factor. */
export const loginChallenges = pgTable("login_challenges", {
    /** sha256 of the cookie token, hex. The token itself is never stored. */
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    ip: text("ip"),
})

/** Game servers from the GGE network file (1.xml), refreshed by the runner. */
export const servers = pgTable("servers", {
    /** gameID in 1.xml. */
    id: integer("id").primaryKey(),
    label: text("label").notNull(),
    wsHost: text("ws_host").notNull(),
    /** SmartFox zone, e.g. EmpireEx_26. */
    zone: text("zone").notNull(),
    updatedAt: updatedAt(),
})

/**
 * The pool of proxies bots connect to the game through. The runner assigns accounts (./apps/runner/src/proxies.ts),
 * counts failures, and turns a proxy off after PROXY_MAX_FAILURES in a row.
 */
export const proxies = pgTable("proxies", {
    id: uuid("id").primaryKey().defaultRandom(),
    label: text("label").notNull(),
    /** The full URL with its credentials, sealed with @gge/crypto; only the runner holds the key that opens it. */
    urlSealed: bytea("url_sealed").notNull(),
    /** `scheme://host:port`, the only readable part of the URL. */
    hostHint: text("host_hint").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** How many accounts the runner assigns on its own; an admin's manual pin may go over it. */
    maxAccounts: integer("max_accounts").notNull().default(3),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastError: text("last_error"),
    /** Why the runner turned the proxy off; null when an admin did, or it is on. */
    disabledReason: text("disabled_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
})

export const gameAccounts = pgTable("game_accounts", {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    serverId: integer("server_id").notNull().references(() => servers.id),
    /** Sealed with @gge/crypto; only the runner holds the key that opens it. */
    passwordSealed: bytea("password_sealed").notNull(),
    desiredState: desiredState("desired_state").notNull().default("stopped"),
    externalEvent: boolean("external_event").notNull().default(false),
    /** User-set run windows (Phase 4b); null runs whenever desired. */
    schedule: jsonb("schedule"),
    /** The proxy this account connects through; null connects directly. Always null for an event twin, which uses its main's. */
    proxyId: uuid("proxy_id").references(() => proxies.id, { onDelete: "set null" }),
    legacyId: integer("legacy_id").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
}, t => [
    // A player may pair an account with its external-event twin (same name, same server).
    uniqueIndex("game_accounts_server_name").on(t.serverId, sql`lower(${t.name})`, t.externalEvent),
    index("game_accounts_owner").on(t.ownerId),
    index("game_accounts_proxy").on(t.proxyId),
])

export const pluginSettings = pgTable("plugin_settings", {
    accountId: uuid("account_id").notNull().references(() => gameAccounts.id, { onDelete: "cascade" }),
    pluginKey: text("plugin_key").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    options: jsonb("options").notNull().default({}),
}, t => [primaryKey({ columns: [t.accountId, t.pluginKey] })])

/** A named wave plan an account's attack plugins can pick by id; `plan` is a `ManualPlan`, parsed again on every read. */
export const virtualPresets = pgTable("virtual_presets", {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => gameAccounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    plan: jsonb("waves").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
}, t => [uniqueIndex("virtual_presets_account_name").on(t.accountId, sql`lower(${t.name})`)])

/** Published by the runner at boot from bot-core's plugin registry. */
export const pluginCatalog = pgTable("plugin_catalog", {
    key: text("key").primaryKey(),
    force: boolean("force").notNull().default(false),
    hidden: boolean("hidden").notNull().default(false),
    options: jsonb("options").notNull().default([]),
    /** "attack" for plugins under plugins/attack/, which count toward the attack plugin cap. */
    category: text("category"),
    /** Marks the plugin commander list option, as `PluginCheckDef`s. */
    checks: jsonb("checks").notNull().default([]),
    /** Running it ends the account's beginner or peace protection. */
    breaksPeace: boolean("breaks_peace").notNull().default(false),
    updatedAt: updatedAt(),
})

/** Published by the runner at boot from the game's items file; `kind` is a `GameItemKind`. */
export const gameItems = pgTable("game_items", {
    /** The item's wodID. */
    id: integer("id").primaryKey(),
    kind: text("kind").notNull(),
    nameKey: text("name_key").notNull(),
    name: text("name").notNull(),
    level: integer("level"),
    /** The glory bonus in whole percent. */
    fameBonus: integer("fame_bonus"),
    /** The production list a plugin orders the item from with coins or resources, 0 or 1; null when it can't be ordered that way. */
    orderList: integer("order_list"),
    /** The game CDN asset path, without the extension. */
    image: text("image"),
    updatedAt: updatedAt(),
})

export const botStatus = pgTable("bot_status", {
    accountId: uuid("account_id").primaryKey().references(() => gameAccounts.id, { onDelete: "cascade" }),
    actualState: actualState("actual_state").notNull().default("stopped"),
    bannedUntil: timestamp("banned_until", { withTimezone: true }),
    lastError: text("last_error"),
    resources: jsonb("resources"),
    /** What each plugin last reported during the current run, by plugin key. */
    pluginStates: jsonb("plugin_states").notNull().default({}),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
})

export const botLogs = pgTable("bot_logs", {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    accountId: uuid("account_id").notNull().references(() => gameAccounts.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    level: smallint("level").notNull(),
    /** English rendering, for admins and search. */
    message: text("message").notNull(),
    /** The worker's raw parts (translation keys and values), so the UI can render it in the viewer's language. */
    parts: jsonb("parts"),
    /** Who wrote the line: a plugin key or a core script name, taken from the raw parts, so a feed can filter by it. */
    plugin: text("plugin"),
}, t => [index("bot_logs_account").on(t.accountId, t.id), index("bot_logs_account_plugin").on(t.accountId, t.plugin, t.id)])

export const botRuns = pgTable("bot_runs", {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    accountId: uuid("account_id").notNull().references(() => gameAccounts.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: text("end_reason"),
    restarts: integer("restarts").notNull().default(0),
    error: text("error"),
}, t => [index("bot_runs_account").on(t.accountId, t.startedAt)])

/** One row, written by the runner every few seconds while it holds the lock. */
export const runnerHeartbeat = pgTable("runner_heartbeat", {
    id: smallint("id").primaryKey().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    beatAt: timestamp("beat_at", { withTimezone: true }).notNull(),
    version: text("version").notNull(),
    running: integer("running").notNull().default(0),
}, t => [check("runner_heartbeat_single_row", sql`${t.id} = 1`)])

export const discordLinks = pgTable("discord_links", {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    discordUserId: text("discord_user_id").notNull(),
    guildId: text("guild_id"),
})

export const auditLog = pgTable("audit_log", {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    meta: jsonb("meta"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("audit_log_ts").on(t.ts)])

/** What a player can be on. `max_accounts` is how many accounts the plan runs. */
export const plans = pgTable("plans", {
    id: text("id", { enum: PLAN_IDS }).primaryKey(),
    name: text("name").notNull(),
    maxAccounts: integer("max_accounts").notNull(),
    updatedAt: updatedAt(),
}, t => [check("plans_max_accounts_valid", sql`${t.maxAccounts} >= 0`)])

/**
 * Time a user has on a plan. Add rows only with appendPeriod (apps/api/src/services/plans.ts), which queues each
 * one behind the user's last, so one user's periods never overlap.
 */
export const planPeriods = pgTable("plan_periods", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id", { enum: PLAN_IDS }).notNull().references(() => plans.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    source: text("source", { enum: PERIOD_SOURCES }).notNull(),
    purchaseId: uuid("purchase_id").references(() => purchases.id, { onDelete: "set null" }),
    codeId: uuid("code_id").references(() => licenseCodes.id, { onDelete: "set null" }),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAt(),
}, t => [
    check("plan_periods_ends_after_start", sql`${t.endsAt} > ${t.startsAt}`),
    check("plan_periods_source_valid", sql`${t.source} in (${quoted(PERIOD_SOURCES)})`),
    index("plan_periods_user_ends").on(t.userId, t.endsAt),
    uniqueIndex("plan_periods_one_trial").on(t.userId).where(sql`${t.source} = 'trial'`),
])

/**
 * Every change to a player's points; the balance is the sum of `delta`. Rows are only added, never changed, and points
 * don't expire. A refund can take the balance below zero.
 */
export const pointsLedger = pgTable("points_ledger", {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: text("reason", { enum: POINTS_REASONS }).notNull(),
    purchaseId: uuid("purchase_id").references(() => purchases.id, { onDelete: "set null" }),
    /** The period a redemption paid for. */
    periodId: uuid("period_id").references(() => planPeriods.id, { onDelete: "set null" }),
    /** The caller's key for a redemption, so a repeated request spends once. */
    idempotencyKey: text("idempotency_key").unique(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
}, t => [
    check("points_ledger_delta_nonzero", sql`${t.delta} <> 0`),
    check("points_ledger_reason_valid", sql`${t.reason} in (${quoted(POINTS_REASONS)})`),
    index("points_ledger_user").on(t.userId, t.id),
    // A purchase earns once and is taken back once.
    uniqueIndex("points_ledger_purchase_reason").on(t.purchaseId, t.reason).where(sql`${t.purchaseId} is not null`),
])

/** What is for sale. A null price is a package only an admin can record a purchase of. */
export const packages = pgTable("packages", {
    id: text("id").primaryKey(),
    planId: text("plan_id", { enum: PLAN_IDS }).notNull().references(() => plans.id),
    /** Players covered: 1 for the buyer alone, or how many single-use codes a Team purchase mints. */
    seats: integer("seats").notNull(),
    days: integer("days").notNull().default(28),
    /** In the currency's smallest unit. */
    priceMinor: integer("price_minor"),
    currency: text("currency", { enum: CURRENCIES }),
    /** Points a purchase earns the buyer. */
    points: integer("points").notNull(),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
}, t => [
    check("packages_seats_valid", sql`${t.seats} >= 1`),
    check("packages_days_valid", sql`${t.days} >= 1`),
    check("packages_price_valid", sql`${t.priceMinor} >= 0`),
    check("packages_currency_valid", sql`${t.currency} in (${quoted(CURRENCIES)})`),
    check("packages_price_has_currency", sql`(${t.priceMinor} is null) = (${t.currency} is null)`),
    check("packages_points_valid", sql`${t.points} >= 0`),
])

/**
 * A sale. `seats`, `days` and `points` are copied from the package when it is made, so later edits to the package
 * don't change what was bought. Deliver it only with fulfil (apps/api/src/services/purchases.ts).
 */
export const purchases = pgTable("purchases", {
    id: uuid("id").primaryKey().defaultRandom(),
    buyerId: uuid("buyer_id").references(() => users.id, { onDelete: "set null" }),
    packageId: text("package_id").notNull().references(() => packages.id),
    seats: integer("seats").notNull(),
    days: integer("days").notNull(),
    points: integer("points").notNull(),
    amountMinor: integer("amount_minor"),
    currency: text("currency", { enum: CURRENCIES }),
    provider: text("provider", { enum: PURCHASE_PROVIDERS }).notNull(),
    /** The provider's reference for the payment. */
    providerRef: text("provider_ref"),
    status: text("status", { enum: PURCHASE_STATUSES }).notNull(),
    /** The admin who recorded a manual purchase. */
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAt(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** Set once the period or codes and the points are written; fulfil does nothing after that. */
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
}, t => [
    check("purchases_provider_valid", sql`${t.provider} in (${quoted(PURCHASE_PROVIDERS)})`),
    check("purchases_status_valid", sql`${t.status} in (${quoted(PURCHASE_STATUSES)})`),
    unique("purchases_provider_ref").on(t.provider, t.providerRef),
    index("purchases_buyer").on(t.buyerId, t.createdAt),
])

/**
 * Single-use codes minted by a Team purchase, one per seat. Redeeming one gives the redeemer `days` on the plan.
 * `redeemed_at` is what marks a code used: `redeemed_by` goes null when that user is deleted.
 */
export const licenseCodes = pgTable("license_codes", {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseId: uuid("purchase_id").notNull().references(() => purchases.id, { onDelete: "cascade" }),
    planId: text("plan_id", { enum: PLAN_IDS }).notNull().references(() => plans.id),
    days: integer("days").notNull(),
    /** `GGE-XXXX-XXXX-XXXX`, as normalizeCode from @gge/contracts returns it. */
    code: text("code").notNull().unique(),
    redeemedBy: uuid("redeemed_by").references(() => users.id, { onDelete: "set null" }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
}, t => [index("license_codes_purchase").on(t.purchaseId)])

/**
 * Game accounts that have run on a free trial, so one game account gets one trial however many users add it.
 * Written only while billing is live.
 */
export const trialGameAccounts = pgTable("trial_game_accounts", {
    /** Hex SHA-256 of `<server_id>:<lower(game name)>`. */
    accountHash: text("account_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
})

/** A banner an admin shows every player between `starts_at` and `ends_at` (null: until ended). English only. */
export const announcements = pgTable("announcements", {
    id: uuid("id").primaryKey().defaultRandom(),
    severity: text("severity", { enum: ANNOUNCEMENT_SEVERITIES }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    linkUrl: text("link_url"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    dismissible: boolean("dismissible").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
}, t => [
    check("announcements_severity_valid", sql`${t.severity} in (${quoted(ANNOUNCEMENT_SEVERITIES)})`),
    check("announcements_ends_after_start", sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
    index("announcements_live").on(t.startsAt, t.endsAt),
])

/** An announcement one player closed. It stays closed for them on every device. */
export const announcementDismissals = pgTable("announcement_dismissals", {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    announcementId: uuid("announcement_id").notNull().references(() => announcements.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.userId, t.announcementId] })])

/** Deployment-wide settings an admin can change. One row. */
export const appSettings = pgTable("app_settings", {
    id: smallint("id").primaryKey().default(1),
    attackPluginCap: attackPluginCap("attack_plugin_cap").notNull().default("4"),
    /** Off: every player's limit is users.max_bots and plans restrict nobody. On: the limit comes from the player's plan. */
    billingLive: boolean("billing_live").notNull().default(false),
    trialDays: integer("trial_days").notNull().default(7),
    pointsRedeemCost: integer("points_redeem_cost").notNull().default(8),
    pointsRedeemDays: integer("points_redeem_days").notNull().default(28),
    pointsRedeemPlan: text("points_redeem_plan", { enum: PLAN_IDS }).notNull().default("basic").references(() => plans.id),
    updatedAt: updatedAt(),
}, t => [check("app_settings_single_row", sql`${t.id} = 1`)])

/**
 * Commands for Centrifugo's PostgreSQL consumer, which reads them in id order and deletes each once processed.
 * The columns are the ones it requires. Write rows with publish() from ./outbox.ts, in the transaction that changed the data.
 */
export const centrifugoOutbox = pgTable("centrifugo_outbox", {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    method: text("method").notNull(),
    payload: jsonb("payload").notNull(),
    /** Always 0: one partition keeps every event in one order. */
    partition: bigint("partition", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("centrifugo_outbox_partition_id").on(t.partition, t.id)])

/**
 * Something that stopped a bot until its owner acts. Write rows with insertNotification() from ./notifications.ts.
 * The API's notification mailer sends each one once, which the email_* columns track.
 */
export const notifications = pgTable("notifications", {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** null once the account is removed; `data` keeps its name. */
    accountId: uuid("account_id").references(() => gameAccounts.id, { onDelete: "set null" }),
    /** A NotificationKind from @gge/contracts. */
    kind: text("kind").notNull(),
    /** That kind's details and a snapshot of the account, as NotificationContent describes. */
    data: jsonb("data").notNull(),
    /** One per event, so reporting it twice makes one row. */
    dedupKey: text("dedup_key").notNull(),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true }),
    /** An EmailState from @gge/contracts. */
    emailState: text("email_state").notNull().default("pending"),
    /** Set while a mailer is sending this row; a claim older than the lease is taken over. */
    emailClaimedAt: timestamp("email_claimed_at", { withTimezone: true }),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    emailAttempts: integer("email_attempts").notNull().default(0),
    /** Why the row was skipped, or the last delivery failure. */
    emailError: text("email_error"),
}, t => [
    unique("notifications_user_dedup").on(t.userId, t.dedupKey),
    index("notifications_user_id").on(t.userId, t.id.desc()),
    index("notifications_email_pending").on(t.createdAt).where(sql`${t.emailState} = 'pending'`),
])
