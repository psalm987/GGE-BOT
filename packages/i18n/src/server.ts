import { fileURLToPath } from "node:url"
import i18next from "i18next"
import type { Catalogs } from "./catalogs.ts"
import { loadCatalogDir } from "./node.ts"
import type { Translate } from "./translate.ts"

export function createServerI18n(catalogs: Catalogs) {
    const instance = i18next.createInstance()
    void instance.init({
        lng: "en",
        fallbackLng: "en",
        resources: catalogs,
        ns: Object.keys(catalogs.en ?? {}),
        defaultNS: "common",
        keySeparator: false,
        nsSeparator: false,
        interpolation: { escapeValue: false },
        initAsync: false,
    })
    return instance
}

let shared: ReturnType<typeof createServerI18n> | undefined

/** Every shipped catalog, read from disk once. A locale with no catalog, or a key it lacks, reads in English. */
export const serverI18n = () => shared ??= createServerI18n(loadCatalogDir(fileURLToPath(new URL("../catalogs", import.meta.url))))

export const serverT = (locale: string): Translate => serverI18n().getFixedT(locale) as unknown as Translate
