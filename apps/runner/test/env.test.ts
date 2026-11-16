import { describe, expect, test } from "vitest"
import { parseEnv } from "../src/env.ts"

const required = { DATABASE_URL: "postgres://x", SEAL_PRIVATE_KEY: "k" }

describe("parseEnv", () => {
    test("empty optional variables from compose count as unset", () => {
        const env = parseEnv({ ...required, GAME_CLIENT_VERSION: "", DISCORD_TOKEN: "", DISCORD_CLIENT_ID: "", FONT_PATH: "" })
        expect(env).toMatchObject({ GAME_CLIENT_VERSION: undefined, DISCORD_TOKEN: undefined, DISCORD_CLIENT_ID: undefined, FONT_PATH: undefined })
    })

    test("a set client version is read as a number", () => {
        expect(parseEnv({ ...required, GAME_CLIENT_VERSION: "1342" }).GAME_CLIENT_VERSION).toBe(1342)
    })

    test("a client version that is not a positive integer is refused", () => {
        for (const value of ["0", "-3", "1.5", "abc"])
            expect(() => parseEnv({ ...required, GAME_CLIENT_VERSION: value }), value).toThrow()
    })

    test("the inbound silence limit is off unless set", () => {
        expect(parseEnv({ ...required, INBOUND_STALE_MS: "" }).INBOUND_STALE_MS).toBeUndefined()
        expect(parseEnv({ ...required, INBOUND_STALE_MS: "600000" }).INBOUND_STALE_MS).toBe(600000)
    })

    test("workers are capped at 512 MB unless configured", () => {
        expect(parseEnv(required).WORKER_MAX_OLD_MB).toBe(512)
        expect(parseEnv({ ...required, WORKER_MAX_OLD_MB: "1024" }).WORKER_MAX_OLD_MB).toBe(1024)
    })

    test("audit entries are kept 365 days unless configured", () => {
        expect(parseEnv(required).AUDIT_RETENTION_DAYS).toBe(365)
        expect(parseEnv({ ...required, AUDIT_RETENTION_DAYS: "" }).AUDIT_RETENTION_DAYS).toBe(365)
        expect(parseEnv({ ...required, AUDIT_RETENTION_DAYS: "30" }).AUDIT_RETENTION_DAYS).toBe(30)
    })

    test("a proxy is optional unless PROXY_REQUIRED is on", () => {
        expect(parseEnv(required).PROXY_REQUIRED).toBe(false)
        expect(parseEnv({ ...required, PROXY_REQUIRED: "" }).PROXY_REQUIRED).toBe(false)
        expect(parseEnv({ ...required, PROXY_REQUIRED: "true" }).PROXY_REQUIRED).toBe(true)
        expect(() => parseEnv({ ...required, PROXY_REQUIRED: "maybe" })).toThrow()
    })

    test("an audit retention that is not a positive integer is refused", () => {
        for (const value of ["0", "-1", "1.5", "abc"])
            expect(() => parseEnv({ ...required, AUDIT_RETENTION_DAYS: value }), value).toThrow()
    })
})
