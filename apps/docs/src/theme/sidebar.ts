type Group = { label: string; translations: Record<string, string>; items: { slug: string }[] }

/** The sidebar, also read by the breadcrumbs and the social images so a page names its section the same way everywhere. */
export const sidebar: Group[] = [
    { label: "Start here", translations: { de: "Hier starten", ar: "ابدأ من هنا" }, items: [{ slug: "quick-start" }, { slug: "how-your-bot-runs" }, { slug: "playing-it-safe" }, { slug: "glossary" }] },
    // Labels without a translation yet stay English in every locale, so the keys are in place for the translation pass.
    { label: "Your war room", translations: { de: "Your war room", ar: "Your war room" }, items: [{ slug: "war-room/dashboard" }, { slug: "war-room/logs" }, { slug: "war-room/alerts-and-emails" }, { slug: "war-room/settings" }] },
    // Module groups follow the app's sidebar (modules.group.* in the client catalogs).
    { label: "Modules", translations: { de: "Modules", ar: "Modules" }, items: [{ slug: "modules" }, { slug: "modules/live-view" }] },
    { label: "Account manager", translations: { de: "Kontoverwaltung", ar: "إدارة الحسابات" }, items: [{ slug: "modules/wheel-spin" }, { slug: "modules/messages" }] },
    {
        label: "Attacks and gear",
        translations: { de: "Angriffe und Ausrüstung", ar: "الهجمات والعتاد" },
        items: [
            { slug: "modules/towers" },
            { slug: "modules/fortress" },
            { slug: "modules/nom-sam-daimyo" },
            { slug: "modules/storms" },
            { slug: "modules/khan" },
            { slug: "modules/green-berimond" },
            { slug: "modules/invasion-events" },
            { slug: "modules/virtual-presets" },
            { slug: "modules/armourer" },
        ],
    },
    {
        label: "Utilities",
        translations: { de: "Hilfsmittel", ar: "أدوات مساعدة" },
        items: [{ slug: "modules/recruit-tools-heal" }, { slug: "modules/refinery-toolsmith" }, { slug: "modules/auto-feast" }, { slug: "modules/equip-sell" }, { slug: "modules/daily-chores" }],
    },
    { label: "PvP", translations: { de: "PvP", ar: "PvP" }, items: [{ slug: "modules/alert-autostation" }] },
    { label: "Discord", translations: { de: "Discord", ar: "Discord" }, items: [{ slug: "modules/discord-attacks" }, { slug: "modules/discord-events" }] },
    { label: "Plans", translations: { de: "Plans", ar: "Plans" }, items: [{ slug: "plans" }] },
    { label: "Help", translations: { de: "Hilfe", ar: "مساعدة" }, items: [{ slug: "troubleshooting" }, { slug: "faq" }, { slug: "errors" }, { slug: "alerts" }, { slug: "contact" }] },
    { label: "Legal", translations: { de: "Rechtliches", ar: "قانوني" }, items: [{ slug: "disclaimer" }, { slug: "credits" }] },
]

/** The group a page sits in, with its label in a locale and the first page of the group. */
export function sectionOf(slug: string, lang: string): { label: string; firstSlug: string } | undefined {
    const group = sidebar.find(g => g.items.some(item => item.slug === slug))
    return group && { label: group.translations[lang] ?? group.label, firstSlug: group.items[0]!.slug }
}
