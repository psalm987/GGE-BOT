import { MAX_COMMANDERS, commanderPicks, writeCommanderPicks } from "@gge/contracts"

/**
 * One tile of the commander picker. `order` is its place in the order the bot sends commanders, from 1, or null when
 * it isn't picked. `beyond` is a tile past the commanders the account has, which the bot skips until it has that many.
 */
export type CommanderTile = { position: number; order: number | null; beyond: boolean }

/** The picker's 50 tiles for a stored commander list, on an account with `owned` commanders (null until the bot has counted). */
export function commanderTiles(list: string, owned: number | null): CommanderTile[] {
    const order = new Map(commanderPicks(list).map((position, i) => [position, i + 1]))
    return Array.from({ length: MAX_COMMANDERS }, (_, i) => i + 1).map(position =>
        ({ position, order: order.get(position) ?? null, beyond: owned !== null && position > owned }))
}

/** The list after a click on a tile: a picked tile leaves the order, any other joins it last. */
export function toggleTile(list: string, position: number): string {
    const picks = commanderPicks(list)
    return writeCommanderPicks(picks.includes(position) ? picks.filter(p => p !== position) : [...picks, position])
}

/** Every tile in order: the default list. */
export const ALL_TILES = writeCommanderPicks(Array.from({ length: MAX_COMMANDERS }, (_, i) => i + 1))
