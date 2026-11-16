import * as z from "zod"

/** Compose passes unset optional variables as empty strings. */
const optional = z.string().transform(s => s || undefined).optional()

const Env = z.object({
    DATABASE_URL: z.string().min(1),
    /** @gge/crypto private key; only the runner can open stored game passwords. */
    SEAL_PRIVATE_KEY: z.string().min(1),
    MAX_ACCOUNTS: z.coerce.number().int().positive().default(50),
    /** Gap between two bot logins, so a restart doesn't log every account in at once. */
    START_GAP_MS: z.coerce.number().int().nonnegative().default(2000),
    GAME_CLIENT_VERSION: optional.pipe(z.coerce.number<string>().int().positive().optional()),
    TIMEOUT_MULTIPLIER: z.coerce.number().positive().default(1),
    DISCORD_TOKEN: optional,
    DISCORD_CLIENT_ID: optional,
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
})

export type Env = z.infer<typeof Env>

export const parseEnv = (source: Record<string, string | undefined> = process.env): Env => Env.parse(source)

/** The ggeConfig every bot worker receives. */
export const workerConfig = (env: Env) => ({
    timeoutMultiplier: env.TIMEOUT_MULTIPLIER,
    gameClientVersion: env.GAME_CLIENT_VERSION,
    discordToken: env.DISCORD_TOKEN,
    discordClientId: env.DISCORD_CLIENT_ID,
    fontPath: env.FONT_PATH,
    debug: env.DEBUG,
    inboundStaleMs: env.INBOUND_STALE_MS,
    exitOnFatal: true,
})
