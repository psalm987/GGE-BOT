// The house icon set (game-icons.net glyphs in the app's badge), shared with the app through @gge/ui.
import { iconCredits, type IconCredit } from "@gge/ui/icon-credits"

export const ICONS: readonly IconCredit[] = iconCredits.icons
export const ICON_SET = iconCredits
export const iconIds = new Set(ICONS.map(icon => icon.id))
export const isIcon = (id: string) => iconIds.has(id)
