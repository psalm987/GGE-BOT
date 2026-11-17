import * as z from "zod"

/** Compose passes unset optional variables as empty strings. */
const optional = z.string().transform(s => s || undefined).optional()

/** Each makes one part of a bot's traffic look less mechanical. All are off unless named in BOT_HUMANIZE. */
export const HUMANIZE_FLAGS = ["pin_jitter", "measured_timing", "lognormal_delays", "map_grid", "nch", "login_sequence", "attack_dialog"] as const
export type Humanize = Record<typeof HUMANIZE_FLAGS[number], boolean>

const commaList = z.string().optional().transform(s => (s ?? "").split(",").map(part => part.trim()).filter(Boolean))

const Env = z.object({
    DATABASE_URL: z.string().min(1),
    /** @gge/crypto private key; only the runner can open stored game passwords. */
    SEAL_PRIVATE_KEY: z.string().min(1),
    MAX_ACCOUNTS: z.coerce.number().int().positive().default(50),
    /** Gap between two bot logins, so a restart doesn't log every account in at once. */
    START_GAP_MS: z.coerce.number().int().nonnegative().default(2000),
    GAME_CLIENT_VERSION: optional.pipe(z.coerce.number<string>().int().positive().optional()),
    /** The HTML5 client build the bot announces at login; set it with GAME_CLIENT_VERSION after a game update. */
    GAME_CLIENT_BUILD: optional.pipe(z.coerce.number<string>().int().positive().optional()),
    TIMEOUT_MULTIPLIER: z.coerce.number().positive().default(1),
    /** Logs the runner's one Discord client in. Workers never see it. */
    DISCORD_TOKEN: optional,
    FONT_PATH: optional,
    DEBUG: z.stringbool().default(false),
    /** Download items, language and server list at boot; off only for offline development. */
    REFRESH_GAME_DATA: z.stringbool().default(true),
    /** Prometheus scrape port, internal network only. */
    METRICS_PORT: z.coerce.number().int().default(9464),
    /** V8 old-space cap per bot worker; a leaking bot dies alone instead of taking the runner with it. */
    WORKER_MAX_OLD_MB: z.coerce.number().int().positive().default(512),
    /** Inbound silence after which a logged-in bot reconnects. Unset: never; pick it from bot_inbound_gap_seconds. */
    /** Audit entries older than this many days are deleted hourly. */
    AUDIT_RETENTION_DAYS: optional.pipe(z.coerce.number<string>().int().positive().default(365)),
    INBOUND_STALE_MS: optional.pipe(z.coerce.number<string>().int().positive().optional()),
    /** An account with no proxy to use doesn't start, instead of connecting from the runner's own address. */
    PROXY_REQUIRED: optional.pipe(z.stringbool().default(false)),
    BOT_HUMANIZE: commaList.pipe(z.array(z.enum(HUMANIZE_FLAGS))),
    /** Account ids the BOT_HUMANIZE flags are limited to. Empty: every account. */
    BOT_HUMANIZE_ACCOUNTS: commaList,
})

export type Env = z.infer<typeof Env>

export const parseEnv = (source: Record<string, string | undefined> = process.env): Env => Env.parse(source)

/** The humanize flags one account runs with. */
export const humanizeFor = (env: Pick<Env, "BOT_HUMANIZE" | "BOT_HUMANIZE_ACCOUNTS">) => (accountId: string): Humanize => {
    const chosen = env.BOT_HUMANIZE_ACCOUNTS.length === 0 || env.BOT_HUMANIZE_ACCOUNTS.includes(accountId)
    return Object.fromEntries(HUMANIZE_FLAGS.map(flag => [flag, chosen && env.BOT_HUMANIZE.includes(flag)])) as Humanize
}

/** The ggeConfig every bot worker receives. */
export const workerConfig = (env: Env) => ({
    timeoutMultiplier: env.TIMEOUT_MULTIPLIER,
    gameClientVersion: env.GAME_CLIENT_VERSION,
    gameClientBuild: env.GAME_CLIENT_BUILD,
    /** Whether the runner holds a Discord connection for the Discord plugins to use. */
    discordHub: Boolean(env.DISCORD_TOKEN),
    fontPath: env.FONT_PATH,
    debug: env.DEBUG,
    inboundStaleMs: env.INBOUND_STALE_MS,
    exitOnFatal: true,
})
