import * as z from "zod"

const origins = z.string().transform(s => s.split(",").map(o => o.trim()).filter(Boolean))

/** Compose passes unset optional variables as empty strings. */
const optional = z.string().transform(s => s || undefined).optional()

const Env = z.object({
    DATABASE_URL: z.string().min(1),
    /** @gge/crypto public key. The API seals game passwords; it cannot open them. */
    SEAL_PUBLIC_KEY: z.string().min(1),
    /** Origins allowed to call /rpc and /admin/rpc, e.g. https://app.example.com. Links in emails point at the first client origin. */
    CLIENT_ORIGINS: origins.pipe(z.array(z.url()).min(1)),
    ADMIN_ORIGINS: origins,
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().default(3000),
    /** Secure cookies need HTTPS; only turn off for local http development. */
    COOKIE_SECURE: z.stringbool().default(true),
    /** Without a key, emails are logged instead of sent. */
    RESEND_API_KEY: optional,
    /** Sender, e.g. "GGE Bot <noreply@example.com>"; the domain must be verified in Resend. */
    EMAIL_FROM: optional,
}).refine(env => !env.RESEND_API_KEY || env.EMAIL_FROM, { path: ["EMAIL_FROM"], message: "required when RESEND_API_KEY is set" })

export type Env = z.infer<typeof Env>

export const parseEnv = (source: Record<string, string | undefined> = process.env): Env => Env.parse(source)
