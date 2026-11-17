import * as z from "zod"
import { isEncryptionKey } from "@gge/crypto"

const origins = z.string().transform(s => s.split(",").map(o => o.trim()).filter(Boolean))

/** Compose passes unset optional variables as empty strings. */
const optional = z.string().transform(s => s || undefined).optional()

const Env = z.object({
    DATABASE_URL: z.string().min(1),
    /** @gge/crypto public key. The API seals game passwords; it cannot open them. */
    SEAL_PUBLIC_KEY: z.string().min(1),
    /** Encrypts admins' authenticator secrets at rest. Base64 of exactly 32 bytes. */
    TOTP_ENCRYPTION_KEY: z.string().refine(isEncryptionKey, "must be base64 of exactly 32 bytes (openssl rand -base64 32)"),
    /** Origins allowed to call /rpc and /admin/rpc, e.g. https://app.example.com. Links in emails point at the first client origin. */
    CLIENT_ORIGINS: origins.pipe(z.array(z.url()).min(1)),
    ADMIN_ORIGINS: origins,
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().default(3000),
    /** Secure cookies need HTTPS; only turn off for local http development. */
    COOKIE_SECURE: z.stringbool().default(true),
    /** Without a key, emails are logged instead of sent. */
    RESEND_API_KEY: optional,
    /** Cloudflare Turnstile secret. Without it, signup asks for no captcha. */
    TURNSTILE_SECRET_KEY: optional,
    /** Sender, e.g. "GGE Bot <noreply@example.com>"; the domain must be verified in Resend. */
    EMAIL_FROM: optional,
    /** Paystack secret key (sk_test_ or sk_live_). Without it, billing can't go live. */
    PAYSTACK_SECRET_KEY: optional,
    /** Base URL of the atlas GeoIP service, e.g. http://geoip:8080. Without it, "Automatic" language falls back to the browser's Accept-Language. */
    GEOIP_URL: optional.pipe(z.url().optional()),
    /** Signs the tokens browsers show Centrifugo; the same value as its CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY. Without it, the apps poll instead of getting live updates. */
    CENTRIFUGO_TOKEN_SECRET: optional.pipe(z.string().min(32, "at least 32 characters (openssl rand -hex 32)").optional()),
}).refine(env => !env.RESEND_API_KEY || env.EMAIL_FROM, { path: ["EMAIL_FROM"], message: "required when RESEND_API_KEY is set" })

export type Env = z.infer<typeof Env>

export const parseEnv = (source: Record<string, string | undefined> = process.env): Env => Env.parse(source)
