import * as z from "zod"

const origins = z.string().transform(s => s.split(",").map(o => o.trim()).filter(Boolean))

const Env = z.object({
    DATABASE_URL: z.string().min(1),
    /** @gge/crypto public key. The API seals game passwords; it cannot open them. */
    SEAL_PUBLIC_KEY: z.string().min(1),
    /** Origins allowed to call /rpc and /admin/rpc, e.g. https://app.example.com. */
    CLIENT_ORIGINS: origins,
    ADMIN_ORIGINS: origins,
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().default(3000),
    /** Secure cookies need HTTPS; only turn off for local http development. */
    COOKIE_SECURE: z.stringbool().default(true),
})

export type Env = z.infer<typeof Env>

export const parseEnv = (source: Record<string, string | undefined> = process.env): Env => Env.parse(source)
