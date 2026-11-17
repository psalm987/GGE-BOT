import * as z from "zod"

/**
 * What a game item is to the plugins. A tool with a glory bonus is a banner, an offence support tool goes in `AST`,
 * and soldiers are troops.
 */
export const GameItemKind = z.enum(["banner", "tool", "supportTool", "troop"])
export type GameItemKind = z.infer<typeof GameItemKind>

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
    image: z.string().nullable(),
})
export type GameItem = z.infer<typeof GameItem>
