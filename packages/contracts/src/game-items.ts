import * as z from "zod"

/**
 * What a game item is to the plugins. A tool with a glory bonus is a banner, an offence support tool goes in `AST`,
 * and soldiers are troops.
 */
export const GameItemKind = z.enum(["banner", "tool", "supportTool", "troop"])
export type GameItemKind = z.infer<typeof GameItemKind>

/** The bonus fields that can tell apart items sharing a name and level, in the order they are tried. */
export const GameItemBonus = z.enum([
    "ragePointBonus", "khanTabletBooster", "samuraiTokenBooster", "fameBonus", "wallBonus", "gateBonus", "defRangeBonus", "moatBonus",
    "meleeAttack", "rangeAttack", "meleeDefence", "rangeDefence",
])
export type GameItemBonus = z.infer<typeof GameItemBonus>

/**
 * What sets an item apart from others of the same kind, name and level. A Jade tool has a tier; a battleground tool is the
 * Maya copy of a workshop defence tool; a bonus is the one field that differs across the group; a version is the item's place
 * along its upgrade chain, the last resort.
 */
export const GameItemVariant = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("jade"), tier: z.number().int() }),
    z.object({ kind: z.literal("battleground") }),
    z.object({ kind: z.literal("bonus"), bonus: GameItemBonus, value: z.number() }),
    z.object({ kind: z.literal("version"), step: z.number().int() }),
])
export type GameItemVariant = z.infer<typeof GameItemVariant>

/**
 * One item from the game's items file. `nameKey` is the game's own language-file key, rendered through the `game`
 * namespace; `name` is its English text, the fallback until that namespace has catalogs.
 * `image` is the game CDN asset path, without the extension.
 */
export const GameItem = z.object({
    id: z.number().int(),
    kind: GameItemKind,
    nameKey: z.string(),
    name: z.string(),
    level: z.number().int().nullable(),
    /** The glory bonus in whole percent; null for none. */
    fameBonus: z.number().int().nullable(),
    /** The production list a plugin orders it from with coins or resources: 0 for the barracks, 1 for the workshops. Null when it costs rubies, tokens or anything else a plugin must not spend. */
    orderList: z.union([z.literal(0), z.literal(1)]).nullable(),
    image: z.string().nullable(),
    /** Null when the item's kind, name and level are already unique. */
    variant: GameItemVariant.nullable(),
})
export type GameItem = z.infer<typeof GameItem>
