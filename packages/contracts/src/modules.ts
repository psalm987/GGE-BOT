/** A key of packages/bot-core/assets.json, the game's art. */
export type GameArtKey = string
/** A bot-core plugin's file name without the extension. */
export type PluginKey = string

/** The sidebar's sections, in the order they appear. */
export const MODULE_GROUPS = ["overview", "account", "attacks", "bth", "utility", "pvp", "discord", "settings"] as const
export type ModuleGroup = (typeof MODULE_GROUPS)[number]

export type ModuleDef = {
    /** The page's address: /m/<id>. */
    id: string
    group: ModuleGroup
    /** Position in the sidebar, within and across groups. */
    order: number
    icon: GameArtKey
    /** "soon" is a page that says what the module will do and holds no settings. */
    status: "live" | "soon"
    /** The plugins whose settings the page edits. Empty for a module that is "soon". */
    plugins: readonly PluginKey[]
    /** How a page with several plugins lays them out: a tab for each, or all of them one below another. */
    tabs?: "per-plugin" | "sections"
}

const live = (id: string, group: ModuleGroup, icon: GameArtKey, plugins: readonly PluginKey[], tabs?: ModuleDef["tabs"]) =>
    ({ id, group, icon, status: "live" as const, plugins, ...(tabs && { tabs }) })
const soon = (id: string, group: ModuleGroup, icon: GameArtKey) => ({ id, group, icon, status: "soon" as const, plugins: [] })

/**
 * Every module page, in sidebar order, and what each one edits. The sidebar, the routes, the icons and the coverage test all
 * read this list. Names and texts are the `modules.<id>.*` keys of the client catalog. A plugin belongs to exactly one live module.
 */
export const MODULES: readonly ModuleDef[] = [
    soon("live-view", "overview", "Collectable_Currency_PearlRelic"),
    soon("castle-manager", "account", "Btn_Architect"),
    soon("offer-buyer", "account", "Btn_ShoppingCart"),
    soon("wheel-spin", "account", "Collectable_Currency_LuckyWheelTicket"),
    soon("overseers", "account", "CharOverseerIcon"),
    soon("food-manager", "account", "Collectable_Currency_SoldierBiscuit"),
    live("messages", "account", "Btn_email", ["chat"]),
    soon("rift-raid", "attacks", "Collectable_Currency_CastlePassageToken"),
    soon("berimond", "attacks", "Btn_PaymentReward_Berimond_Hub"),
    live("towers", "attacks", "Collectable_Currency_LegendaryToken",
        ["attackBarronsGreatEmpire", "attackBarronsEverWinterGlacier", "attackBarronsBurningSands", "attackBarronsFirePeaks"], "per-plugin"),
    soon("leveller", "attacks", "Collectable_Currency_VigorDoubloon"),
    live("armourer", "attacks", "Collectable_Currency_Steel", ["buyTools"]),
    soon("blacksmith-event-shops", "attacks", "Btn_EquipmentEnhancerPrimeSale"),
    live("nom-sam-daimyo", "attacks", "Collectable_Currency_NomadAdvisorToken", ["attackNomads", "attackSamurai"], "per-plugin"),
    live("storms", "attacks", "Collectable_Currency_Essence", ["attackStormForts", "meadReplaceStorm"], "per-plugin"),
    live("fortress", "attacks", "Collectable_Currency_RampartDoubloon",
        ["attackFortressesBurningSands", "attackFortressesEverWinterGlacier", "attackFortressesFirePeaks"], "per-plugin"),
    live("khan", "attacks", "Collectable_Currency_KhanMedal", ["attackKhan"]),
    live("green-berimond", "attacks", "Btn_LMS_Blue", ["attackBerimondInvasion"]),
    live("invasion-events", "attacks", "Btn_FactionInvasionBooster", ["attackForeign", "attackBloodcrows"], "per-plugin"),
    soon("virtual-presets", "attacks", "Collectable_Currency_GeneralsSkillsResetToken"),
    soon("coin-farmer", "bth", "Collectable_Currency_ImperialDucat"),
    soon("bth-blacksmith", "bth", "Collectable_Currency_Component1"),
    soon("influence-farming", "bth", "Collectable_Currency_Influence"),
    soon("recruiter", "bth", "Collectable_Currency_ResourceVillageToken"),
    soon("castle-builder", "bth", "Collectable_Currency_Plaster"),
    soon("equipment-manager", "bth", "Collectable_Currency_EpicPreciousmetals"),
    soon("or-storms", "bth", "Collectable_Currency_TimeDoubloon"),
    soon("mp-builder", "bth", "Collectable_Currency_CommonBricks"),
    soon("recruit-tools-heal", "utility", "CharNurseIcon"),
    live("refinery-toolsmith", "utility", "Collectable_Currency_RefinedStone", ["toolsmith"]),
    live("auto-feast", "utility", "Collectable_Currency_Tea", ["feast"]),
    live("equip-sell", "utility", "Btn_RelicEnchanterPrimeSale", ["sellStoredEquipment"]),
    live("daily-chores", "utility", "CharTaxes", ["loginBonus", "taxCollector", "helpRequests"], "sections"),
    live("alert-autostation", "pvp", "Btn_AttackWarning", ["autoStation"]),
    soon("asset-monitor", "pvp", "Collectable_Currency_RelicFragment"),
    live("discord-attacks", "discord", "Collectable_Currency_GoldToken", ["incomingAttacks", "outgoingAttacks"], "per-plugin"),
    live("discord-events", "discord", "Collectable_Currency_RoyalCapitalCoin", ["fortress", "aquaIsland", "aquaTower"], "per-plugin"),
    live("account-settings", "settings", "Collectable_Currency_SilverToken", ["attack", "skips", "shutoffTimer"], "sections"),
].map((module, index) => ({ ...module, order: (index + 1) * 10 }))
