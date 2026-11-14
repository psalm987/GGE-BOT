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

    test("workers are capped at 512 MB unless configured", () => {
        expect(parseEnv(required).WORKER_MAX_OLD_MB).toBe(512)
        expect(parseEnv({ ...required, WORKER_MAX_OLD_MB: "1024" }).WORKER_MAX_OLD_MB).toBe(1024)
    })
})
