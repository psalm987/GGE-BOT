import credits from "./icons/credits.json" with { type: "json" }

export type IconCredit = { id: string; author: string; source: string; licence: string; licenceUrl: string }

/** Who drew each glyph behind the module badges, as tools/icons wrote it. */
export const iconCredits: { set: string; setUrl: string; licence: string; licenceUrl: string; icons: readonly IconCredit[] } = credits
