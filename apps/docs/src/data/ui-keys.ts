/** Every `gge.*` string the docs components print. English holds all of them; a locale file may translate any. */
export const GGE_KEYS = [
    "gge.aside.tip", "gge.aside.caution", "gge.aside.danger", "gge.aside.note", "gge.aside.copyLink", "gge.aside.linkCopied",
    "gge.sidenote.label",
    "gge.term.readMore", "gge.term.close", "gge.term.definition",
    "gge.term.cat.game", "gge.term.cat.bot", "gge.term.cat.account", "gge.term.cat.tech",
    "gge.termsOnPage.title",
    "gge.glossary.filter", "gge.glossary.all", "gge.glossary.shown", "gge.glossary.alsoCalled", "gge.glossary.seeAlso", "gge.glossary.usedOn", "gge.glossary.letters",
    "gge.ref.link", "gge.ref.code", "gge.ref.says", "gge.ref.fix",
    "gge.settings.label", "gge.settings.type", "gge.settings.default", "gge.settings.values",
    "gge.settings.on", "gge.settings.off", "gge.settings.range", "gge.settings.step", "gge.settings.picksFrom", "gge.settings.empty",
    "gge.settings.kind.text", "gge.settings.kind.number", "gge.settings.kind.toggle", "gge.settings.kind.choice",
    "gge.settings.kind.list", "gge.settings.kind.table", "gge.settings.kind.castle", "gge.settings.kind.channel",
    "gge.settings.unit.seconds", "gge.settings.unit.minutes", "gge.settings.unit.hours", "gge.settings.unit.percent",
    "gge.settings.unit.attacks", "gge.settings.unit.troops", "gge.settings.unit.rubies", "gge.settings.unit.coins",
    "gge.settings.catalog.banners", "gge.settings.catalog.tools", "gge.settings.catalog.troops", "gge.settings.catalog.supportTools",
    "gge.status.label", "gge.status.beta", "gge.status.planned",
    "gge.planGate.off",
] as const
export type GgeKey = (typeof GGE_KEYS)[number]
