import { describe, expect, test } from "vitest"
import { humanizeFor, parseEnv } from "../src/env.ts"

const required = { DATABASE_URL: "postgres://x", SEAL_PRIVATE_KEY: "k" }

describe("parseEnv", () => {
    test("empty optional variables from compose count as unset", () => {
        const env = parseEnv({ ...required, GAME_CLIENT_VERSION: "", DISCORD_TOKEN: "", DISCORD_CLIENT_ID: "", FONT_PATH: "" })
        expect(env).toMatchObject({ GAME_CLIENT_VERSION: undefined, DISCORD_TOKEN: undefined, DISCORD_CLIENT_ID: undefined, FONT_PATH: undefined })
    })

    test("the client build is unset by default and read as a number when set", () => {
        expect(parseEnv({ ...required, GAME_CLIENT_BUILD: "" }).GAME_CLIENT_BUILD).toBeUndefined()
        expect(parseEnv({ ...required, GAME_CLIENT_BUILD: "1180000" }).GAME_CLIENT_BUILD).toBe(1180000)
        expect(() => parseEnv({ ...required, GAME_CLIENT_BUILD: "abc" })).toThrow()
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

    test("no humanize flag is on unless BOT_HUMANIZE names it", () => {
        for (const env of [parseEnv(required), parseEnv({ ...required, BOT_HUMANIZE: "", BOT_HUMANIZE_ACCOUNTS: "" })]) {
            expect(env).toMatchObject({ BOT_HUMANIZE: [], BOT_HUMANIZE_ACCOUNTS: [] })
            expect(humanizeFor(env)("a1")).toEqual({ pin_jitter: false, measured_timing: false, lognormal_delays: false, map_grid: false, nch: false, login_sequence: false, attack_dialog: false })
        }
    })

    test("BOT_HUMANIZE is a comma list of flag names, and an unknown name is refused", () => {
        expect(parseEnv({ ...required, BOT_HUMANIZE: "pin_jitter, map_grid," }).BOT_HUMANIZE).toEqual(["pin_jitter", "map_grid"])
        expect(() => parseEnv({ ...required, BOT_HUMANIZE: "pin_jitter,pin-jitter" })).toThrow()
        expect(() => parseEnv({ ...required, BOT_HUMANIZE: "everything" })).toThrow()
    })

    test("the protocol flags nch, login_sequence and attack_dialog are accepted, each on its own", () => {
        const env = parseEnv({ ...required, BOT_HUMANIZE: "nch,login_sequence,attack_dialog" })
        expect(env.BOT_HUMANIZE).toEqual(["nch", "login_sequence", "attack_dialog"])
        expect(humanizeFor(env)("a1")).toEqual({ pin_jitter: false, measured_timing: false, lognormal_delays: false, map_grid: false, nch: true, login_sequence: true, attack_dialog: true })
        expect(humanizeFor(parseEnv({ ...required, BOT_HUMANIZE: "nch" }))("a1")).toMatchObject({ nch: true, login_sequence: false, attack_dialog: false })
    })

    test("the flags apply to every account, or only to the ones BOT_HUMANIZE_ACCOUNTS lists", () => {
        const everyone = humanizeFor(parseEnv({ ...required, BOT_HUMANIZE: "pin_jitter,lognormal_delays" }))
        expect(everyone("a1")).toEqual({ pin_jitter: true, measured_timing: false, lognormal_delays: true, map_grid: false, nch: false, login_sequence: false, attack_dialog: false })

        const some = humanizeFor(parseEnv({ ...required, BOT_HUMANIZE: "pin_jitter,lognormal_delays", BOT_HUMANIZE_ACCOUNTS: "a1, a2" }))
        expect(some("a2")).toEqual({ pin_jitter: true, measured_timing: false, lognormal_delays: true, map_grid: false, nch: false, login_sequence: false, attack_dialog: false })
        expect(some("a3")).toEqual({ pin_jitter: false, measured_timing: false, lognormal_delays: false, map_grid: false, nch: false, login_sequence: false, attack_dialog: false })
    })

    test("an audit retention that is not a positive integer is refused", () => {
        for (const value of ["0", "-1", "1.5", "abc"])
            expect(() => parseEnv({ ...required, AUDIT_RETENTION_DAYS: value }), value).toThrow()
    })
})
