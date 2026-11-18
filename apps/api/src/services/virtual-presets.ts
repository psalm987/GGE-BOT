import type * as z from "zod"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { gameAccounts, pluginSettings, virtualPresets, type Db } from "@gge/db"
import {
    CreateVirtualPreset, MAX_VIRTUAL_PRESETS, ManualPlan, UpdateVirtualPreset,
    type VirtualPreset,
} from "@gge/contracts"
import { isUniqueViolation } from "../context.ts"
import { fail } from "../errors.ts"

/** The stored plan is read back through `ManualPlan`, never trusted: a row that no longer parses is a server fault, not a player's plan. */
export const toVirtualPreset = (row: typeof virtualPresets.$inferSelect): VirtualPreset => ({ ...row, plan: ManualPlan.parse(row.plan) })

const duplicate = (error: unknown) => {
    if (isUniqueViolation(error, "virtual_presets_account_name"))
        throw fail("CONFLICT", "VIRTUAL_PRESET_DUPLICATE")
    throw error
}

const ownedAccount = (ownerId: string, accountId: string) =>
    and(eq(gameAccounts.ownerId, ownerId), eq(gameAccounts.id, accountId))

/** One preset, only if it belongs to one of this owner's accounts. */
const ownedPreset = (ownerId: string, id: string) =>
    and(eq(virtualPresets.id, id), inArray(virtualPresets.accountId, sql`(select ${gameAccounts.id} from ${gameAccounts} where ${gameAccounts.ownerId} = ${ownerId})`))

export async function listVirtualPresets(db: Db, ownerId: string, accountId: string) {
    const [account] = await db.select({ id: gameAccounts.id }).from(gameAccounts).where(ownedAccount(ownerId, accountId))
    if (!account)
        throw fail("NOT_FOUND", "ACCOUNT_NOT_FOUND")
    const rows = await db.select().from(virtualPresets).where(eq(virtualPresets.accountId, accountId)).orderBy(asc(virtualPresets.createdAt), asc(virtualPresets.id))
    return rows.map(toVirtualPreset)
}

export async function createVirtualPreset(db: Db, ownerId: string, input: z.infer<typeof CreateVirtualPreset>) {
    const row = await db.transaction(async tx => {
        // The account row is the lock, so two creates at the limit take turns instead of both counting one short.
        const [account] = await tx.select({ id: gameAccounts.id }).from(gameAccounts).where(ownedAccount(ownerId, input.accountId)).for("update")
        if (!account)
            throw fail("NOT_FOUND", "ACCOUNT_NOT_FOUND")
        const kept = await tx.select({ id: virtualPresets.id }).from(virtualPresets).where(eq(virtualPresets.accountId, input.accountId))
        if (kept.length >= MAX_VIRTUAL_PRESETS)
            throw fail("FORBIDDEN", "VIRTUAL_PRESET_LIMIT", { max: MAX_VIRTUAL_PRESETS })
        const [created] = await tx.insert(virtualPresets).values({ accountId: input.accountId, name: input.name, plan: input.plan }).returning()
        return created!
    }).catch(duplicate)
    return toVirtualPreset(row)
}

export async function updateVirtualPreset(db: Db, ownerId: string, input: z.infer<typeof UpdateVirtualPreset>) {
    const [row] = await db.update(virtualPresets).set({ name: input.name, plan: input.plan, updatedAt: new Date() })
        .where(ownedPreset(ownerId, input.id)).returning().catch(duplicate)
    if (!row)
        throw fail("NOT_FOUND", "VIRTUAL_PRESET_NOT_FOUND")
    return toVirtualPreset(row)
}

/** Refused with VIRTUAL_PRESET_IN_USE while any plugin of the account stores this preset as its waves, so no plugin is left naming a preset that is gone. */
export async function removeVirtualPreset(db: Db, ownerId: string, id: string) {
    await db.transaction(async tx => {
        const [preset] = await tx.select({ accountId: virtualPresets.accountId }).from(virtualPresets).where(ownedPreset(ownerId, id)).for("update")
        if (!preset)
            throw fail("NOT_FOUND", "VIRTUAL_PRESET_NOT_FOUND")
        const settings = await tx.select({ options: pluginSettings.options }).from(pluginSettings).where(eq(pluginSettings.accountId, preset.accountId))
        const sent = settings.some(row => Object.values(row.options as Record<string, unknown>).some(value =>
            typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "virtual" && (value as { presetId?: unknown }).presetId === id))
        if (sent)
            throw fail("CONFLICT", "VIRTUAL_PRESET_IN_USE")
        await tx.delete(virtualPresets).where(eq(virtualPresets.id, id))
    })
}
