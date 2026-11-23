import type { GameItem, GameItemBonus, GameItemVariant } from "@gge/contracts"

type Translate = (key: string, params: Record<string, string | number>) => string

/** The plain word each bonus field is shown as; the two attack fields and the two defence fields read alike. */
const BONUS_WORD: Record<GameItemBonus, string> = {
    ragePointBonus: "rage", khanTabletBooster: "tablets", samuraiTokenBooster: "tokens", fameBonus: "glory", wallBonus: "wall", gateBonus: "gate",
    defRangeBonus: "rangedDefence", moatBonus: "moat", meleeAttack: "attack", rangeAttack: "attack", meleeDefence: "defence", rangeDefence: "defence",
}

function variantText(variant: GameItemVariant, t: Translate) {
    switch (variant.kind) {
        case "jade": return t("plugins.variant.jade", { tier: variant.tier })
        case "battleground": return t("plugins.variant.battleground", {})
        case "bonus": return t(`plugins.variant.${BONUS_WORD[variant.bonus]}`, { value: variant.value })
        case "version": return t("plugins.variant.version", { step: variant.step })
    }
}

/** An item's name with its level, then its variant in brackets, so no two items of a picker read the same. */
export function itemLabel(name: string, item: Pick<GameItem, "level" | "variant">, t: Translate) {
    const named = item.level ? `${name} ${t("plugins.item.level", { level: item.level })}` : name
    return item.variant ? `${named} (${variantText(item.variant, t)})` : named
}

/** The code a player reads off a list and types into a search: the game's own id for the item, which no other item shares. */
export const itemCode = (id: number) => `#${id}`

/** A picker option's label: the item's label, then its code, so the option's accessible name and its search text carry both. */
export const itemOptionLabel = (label: string, id: number) => `${label} ${itemCode(id)}`

/** Search over an option's label. Every word typed must appear, so "war 3", "#403" and "403" all find what they name. */
export function itemOptionFilter(input: string, option?: { label?: unknown }) {
    const text = typeof option?.label === "string" ? option.label.toLowerCase() : ""
    return input.toLowerCase().split(/\s+/).filter(Boolean).every(word => text.includes(word))
}
