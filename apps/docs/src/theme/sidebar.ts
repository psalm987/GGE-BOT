type Group = { label: string; translations: Record<string, string>; items: { slug: string }[] }

/** The sidebar, also read by the breadcrumbs and the social images so a page names its section the same way everywhere. */
export const sidebar: Group[] = [
    { label: "Start here", translations: { de: "Hier starten", ar: "ابدأ من هنا" }, items: [{ slug: "quick-start" }, { slug: "glossary" }] },
    { label: "Plugins", translations: { de: "Plugins", ar: "الإضافات" }, items: [{ slug: "plugins/attack-khan" }] },
    { label: "Legal", translations: { de: "Rechtliches", ar: "قانوني" }, items: [{ slug: "credits" }] },
    { label: "Help", translations: { de: "Hilfe", ar: "مساعدة" }, items: [{ slug: "errors" }, { slug: "alerts" }] },
]

/** The group a page sits in, with its label in a locale and the first page of the group. */
export function sectionOf(slug: string, lang: string): { label: string; firstSlug: string } | undefined {
    const group = sidebar.find(g => g.items.some(item => item.slug === slug))
    return group && { label: group.translations[lang] ?? group.label, firstSlug: group.items[0]!.slug }
}
