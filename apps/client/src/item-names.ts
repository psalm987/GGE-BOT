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
    const named = item.level ? `${name} ${item.level}` : name
    return item.variant ? `${named} (${variantText(item.variant, t)})` : named
}
