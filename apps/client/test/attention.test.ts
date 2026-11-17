import { expect, test } from "vitest"
import type { PublicAccount } from "@gge/contracts"
import { needsAttention } from "../src/attention.ts"

type Status = NonNullable<PublicAccount["status"]>
const withState = (actualState: Status["actualState"], sleepingUntil: Date | null = null): Pick<PublicAccount, "status" | "sleepingUntil"> =>
    ({ status: { actualState, lastError: null, heartbeatAt: null, bannedUntil: null, pluginStates: {}, castles: [], resources: null }, sleepingUntil })

test.each(["error", "crash_loop", "banned", "auth_failed"] as const)("an account in state %s needs attention", state => {
    expect(needsAttention(withState(state))).toBe(true)
})

test.each(["running", "starting", "stopped"] as const)("an account in state %s doesn't", state => {
    expect(needsAttention(withState(state))).toBe(false)
})

test("an account that never ran doesn't", () => {
    expect(needsAttention({ status: null, sleepingUntil: null })).toBe(false)
})

test("a sleeping account doesn't, even with an error left from its last window", () => {
    expect(needsAttention(withState("error", new Date("2031-02-03T08:00:00Z")))).toBe(false)
})
