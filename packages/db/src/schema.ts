import { sql } from "drizzle-orm"
import {
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
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core"

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" })
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()

export const role = pgEnum("role", ["user", "admin"])
export const userStatus = pgEnum("user_status", ["active", "disabled"])
export const passwordAlgo = pgEnum("password_algo", ["argon2id", "pbkdf2-legacy"])
export const audience = pgEnum("audience", ["client", "admin"])
export const desiredState = pgEnum("desired_state", ["running", "stopped"])
export const emailTokenPurpose = pgEnum("email_token_purpose", ["verify_email", "reset_password"])
export const actualState = pgEnum("actual_state", ["starting", "running", "stopped", "auth_failed", "banned", "error"])

export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    email: text("email"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    passwordHash: text("password_hash").notNull(),
    /** Only for imported PBKDF2 hashes; cleared when the hash is upgraded. */
    passwordSalt: bytea("password_salt"),
    passwordAlgo: passwordAlgo("password_algo").notNull().default("argon2id"),
    role: role("role").notNull().default("user"),
    status: userStatus("status").notNull().default("active"),
    /** Game accounts the user may own; admins are exempt. Admin-adjustable. */
    maxBots: integer("max_bots").notNull().default(1),
    /** Users.uuid in the legacy user.db, so the importer can re-run. */
    legacyUuid: text("legacy_uuid").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
}, t => [
    uniqueIndex("users_username_lower").on(sql`lower(${t.username})`),
    uniqueIndex("users_email_lower").on(sql`lower(${t.email})`),
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
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
}, t => [index("email_tokens_user").on(t.userId)])

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
    legacyId: integer("legacy_id").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
}, t => [
    // A player may pair an account with its external-event twin (same name, same server).
    uniqueIndex("game_accounts_server_name").on(t.serverId, sql`lower(${t.name})`, t.externalEvent),
    index("game_accounts_owner").on(t.ownerId),
])

export const pluginSettings = pgTable("plugin_settings", {
    accountId: uuid("account_id").notNull().references(() => gameAccounts.id, { onDelete: "cascade" }),
    pluginKey: text("plugin_key").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    options: jsonb("options").notNull().default({}),
}, t => [primaryKey({ columns: [t.accountId, t.pluginKey] })])

/** Published by the runner at boot from bot-core's plugin registry. */
export const pluginCatalog = pgTable("plugin_catalog", {
    key: text("key").primaryKey(),
    force: boolean("force").notNull().default(false),
    hidden: boolean("hidden").notNull().default(false),
    options: jsonb("options").notNull().default([]),
    updatedAt: updatedAt(),
})

export const botStatus = pgTable("bot_status", {
    accountId: uuid("account_id").primaryKey().references(() => gameAccounts.id, { onDelete: "cascade" }),
    actualState: actualState("actual_state").notNull().default("stopped"),
    bannedUntil: timestamp("banned_until", { withTimezone: true }),
    lastError: text("last_error"),
    resources: jsonb("resources"),
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
}, t => [index("bot_logs_account").on(t.accountId, t.id)])

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
