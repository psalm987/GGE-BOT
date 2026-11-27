/**
 * Every icon of the game-icons.net set (npm @iconify-json/game-icons) that a module or a docs term picture uses. tools/icons
 * draws each one into the house badge and deletes any other badge.
 */
export const ICON_IDS = [
    "all-seeing-eye",
    "castle",
    "shopping-cart",
    "tarot-10-wheel-of-fortune",
    "overlord-helm",
    "bread",
    "envelope",
    "magic-portal",
    "crossed-axes",
    "stone-tower",
    "rank-3",
    "anvil",
    "sword-smithing",
    "cloaked-figure-on-horseback",
    "sinking-ship",
    "locked-fortress",
    "wolf-head",
    "viking-helmet",
    "raven",
    "battle-gear",
    "coins-pile",
    "gear-hammer",
    "imperial-crown",
    "swordman",
    "stone-wall",
    "mail-shirt",
    "tornado",
    "tower-bridge",
    "healing-shield",
    "stone-crafting",
    "steak",
    "banknote",
    "calendar",
    "siren",
    "open-treasure-chest",
    "sword-clash",
    "trumpet-flag",
    "cog",
    "erlenmeyer",
    "kraken-tentacle",
    "caravan",
    "shaking-hands",
    "huts-village",
    "wheelbarrow",
] as const
export type IconId = (typeof ICON_IDS)[number]

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
    icon: IconId
    /** "soon" is a page that says what the module will do and holds no settings. */
    status: "live" | "soon"
    /** The plugins whose settings the page edits. Empty for a module that is "soon". */
    plugins: readonly PluginKey[]
    /**
     * How a page with several plugins lays them out: a tab for each, all of them one below another, or a panel for each
     * kingdom that opens and closes, with the kingdom's switch in its header.
     */
    tabs?: "per-plugin" | "sections" | "kingdoms"
    /** With `tabs` "kingdoms": the kingdom id of each plugin, in the order of `plugins`. */
    kingdoms?: readonly number[]
    /** A card of what holds for every plugin of the page: the account's daily attack cap, and settings that are still to come. */
    global?: {
        accountCap: true
        /** What each plugin of the page stands for, which the card's title and "Apply to all" name. */
        each: "kingdoms" | "events"
        /** The Number option that caps one plugin's attacks a day. The card warns when the plugins that are on ask for more between them than the account's cap. */
        dailyCapOption?: string
        soon: readonly string[]
    }
    /** What the page lists as still to come, below its settings. Each is `modules.<id>.soon.<item>.name` and `.description`. */
    soon?: readonly string[]
    /** Shown only where the catalog holds its plugin, which is a development stack's preview plugin. */
    devOnly?: true
    /** A live module whose page is its own screen instead of plugin settings. It has no plugins. */
    page?: "virtualPresets" | "liveView"
}

const live = (id: string, group: ModuleGroup, icon: IconId, plugins: readonly PluginKey[], tabs?: ModuleDef["tabs"]) =>
    ({ id, group, icon, status: "live" as const, plugins, ...(tabs && { tabs }) })
const dev = (id: string, group: ModuleGroup, icon: IconId, plugins: readonly PluginKey[]) => ({ ...live(id, group, icon, plugins), devOnly: true as const })
const page = (id: string, group: ModuleGroup, icon: IconId, screen: NonNullable<ModuleDef["page"]>) =>
    ({ id, group, icon, status: "live" as const, plugins: [], page: screen })
const soon = (id: string, group: ModuleGroup, icon: IconId) => ({ id, group, icon, status: "soon" as const, plugins: [] })

/**
 * Every module page, in sidebar order, and what each one edits. The sidebar, the routes, the icons and the coverage test all
 * read this list. Names and texts are the `modules.<id>.*` keys of the client catalog. A plugin belongs to exactly one live module.
 */
export const MODULES: readonly ModuleDef[] = [
    page("live-view", "overview", "all-seeing-eye", "liveView"),
    soon("castle-manager", "account", "castle"),
    soon("offer-buyer", "account", "shopping-cart"),
    live("wheel-spin", "account", "tarot-10-wheel-of-fortune", ["wheelSpin"]),
    soon("overseers", "account", "overlord-helm"),
    soon("food-manager", "account", "bread"),
    live("messages", "account", "envelope", ["chat"]),
    soon("rift-raid", "attacks", "magic-portal"),
    live("berimond", "attacks", "crossed-axes", ["berimondKingdom"]),
    {
        ...live("towers", "attacks", "stone-tower",
            ["attackBarronsGreatEmpire", "attackBarronsBurningSands", "attackBarronsEverWinterGlacier", "attackBarronsFirePeaks"], "kingdoms"),
        kingdoms: [0, 1, 2, 3],
        global: { accountCap: true as const, each: "kingdoms" as const, dailyCapOption: "maxPerDay", soon: ["lootPriority", "stopAfterDefeat", "speedBonus"] },
    },
    soon("leveller", "attacks", "rank-3"),
    live("armourer", "attacks", "anvil", ["buyTools"]),
    soon("blacksmith-event-shops", "attacks", "sword-smithing"),
    {
        ...live("nom-sam-daimyo", "attacks", "cloaked-figure-on-horseback", ["attackNomads", "attackSamurai", "attackDaimyo"], "per-plugin"),
        global: { accountCap: true as const, each: "events" as const, soon: ["stopAfterDefeat", "nomadAdvisor"] },
    },
    live("storms", "attacks", "sinking-ship", ["attackStormForts", "meadReplaceStorm"], "per-plugin"),
    live("fortress", "attacks", "locked-fortress",
        ["attackFortressesBurningSands", "attackFortressesEverWinterGlacier", "attackFortressesFirePeaks"], "per-plugin"),
    live("khan", "attacks", "wolf-head", ["attackKhan"]),
    live("green-berimond", "attacks", "viking-helmet", ["attackBerimondInvasion"]),
    live("invasion-events", "attacks", "raven", ["attackForeign", "attackBloodcrows"], "per-plugin"),
    live("blade-coast", "attacks", "kraken-tentacle", ["bladeCoast"]),
    page("virtual-presets", "attacks", "battle-gear", "virtualPresets"),
    soon("coin-farmer", "bth", "coins-pile"),
    soon("bth-blacksmith", "bth", "gear-hammer"),
    soon("influence-farming", "bth", "imperial-crown"),
    soon("recruiter", "bth", "swordman"),
    soon("castle-builder", "bth", "stone-wall"),
    soon("equipment-manager", "bth", "mail-shirt"),
    soon("or-storms", "bth", "tornado"),
    soon("mp-builder", "bth", "tower-bridge"),
    live("recruit-tools-heal", "utility", "healing-shield", ["recruitTools", "healTroops"], "per-plugin"),
    live("refinery-toolsmith", "utility", "stone-crafting", ["toolsmith", "refineryToolsmith"], "per-plugin"),
    live("auto-feast", "utility", "steak", ["feast"]),
    live("equip-sell", "utility", "banknote", ["sellStoredEquipment"]),
    live("daily-chores", "utility", "calendar", ["loginBonus", "taxCollector", "helpRequests"], "sections"),
    live("troop-transfer", "utility", "caravan", ["troopTransfer"]),
    live("alliance-donations", "utility", "shaking-hands", ["allianceDonation", "colossusEventDonate"], "per-plugin"),
    live("native-village", "utility", "huts-village", ["nativeVillage"]),
    live("send-resources", "utility", "wheelbarrow", ["sendResources"]),
    live("alert-autostation", "pvp", "siren", ["autoStation"]),
    soon("asset-monitor", "pvp", "open-treasure-chest"),
    live("discord-attacks", "discord", "sword-clash", ["incomingAttacks", "outgoingAttacks"], "per-plugin"),
    live("discord-events", "discord", "trumpet-flag", ["fortress", "aquaIsland", "aquaTower"], "per-plugin"),
    dev("dev-preview", "settings", "erlenmeyer", ["devSettingsPreview"]),
].map((module, index) => ({ ...module, order: (index + 1) * 10 }))

/**
 * The plugins that hold an account's own settings: the pause between attacks, the daily cap, the time skips, the shutoff timer
 * and the commander map.
 * They belong to no module. The account's side panel edits them on its Account settings tab.
 */
export const ACCOUNT_SETTINGS_PLUGINS: readonly PluginKey[] = ["attack", "skips", "shutoffTimer", "commander"]

/** The module whose page edits a plugin, if any. */
export const moduleOfPlugin = (key: PluginKey): ModuleDef | undefined => MODULES.find(module => module.plugins.includes(key))
