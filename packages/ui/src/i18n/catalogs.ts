type Catalog = Record<string, string>

const app = import.meta.glob<Catalog>("../../../i18n/catalogs/*/*.json", { import: "default" })
const bot = import.meta.glob<Catalog>("../../../bot-core/locales/*.json", { import: "default" })

/** A missing locale or namespace is an empty catalog, so i18next falls back to English. */
export async function loadCatalog(locale: string, namespace: string): Promise<Catalog> {
    const load = namespace === "bot"
        ? bot[`../../../bot-core/locales/${locale}.json`]
        : app[`../../../i18n/catalogs/${locale}/${namespace}.json`]
    return load ? await load() : {}
}
