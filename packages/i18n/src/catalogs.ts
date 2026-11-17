export type Catalogs = Record<string, Record<string, Record<string, string>>>

export type CatalogProblem = {
    locale: string
    namespace: string
    key: string
    kind: "missing" | "extra" | "placeholders" | "empty" | "plural"
}

const PLURAL_KEY = /^(.+)_(zero|one|two|few|many|other)$/

const placeholders = (text: string): string =>
    [...new Set([...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))].sort().join(",")

type Split = { plain: Record<string, string>; families: Map<string, Map<string, string>> }

function split(messages: Record<string, string>): Split {
    const plain: Record<string, string> = {}
    const families = new Map<string, Map<string, string>>()
    for (const [key, text] of Object.entries(messages)) {
        const m = PLURAL_KEY.exec(key)
        if (!m) {
            plain[key] = text
            continue
        }
        const family = families.get(m[1]!) ?? new Map<string, string>()
        family.set(m[2]!, text)
        families.set(m[1]!, family)
    }
    return { plain, families }
}

function pluralCategories(locale: string): string[] {
    try {
        return [...new Intl.PluralRules(locale).resolvedOptions().pluralCategories]
    } catch {
        return ["one", "other"]
    }
}

export function checkCatalogs(catalogs: Catalogs, base = "en"): CatalogProblem[] {
    const problems: CatalogProblem[] = []
    const baseCatalog = catalogs[base]
    if (!baseCatalog) return [{ locale: base, namespace: "*", key: "*", kind: "missing" }]

    for (const [locale, namespaces] of Object.entries(catalogs)) {
        const add = (namespace: string, key: string, kind: CatalogProblem["kind"]) =>
            problems.push({ locale, namespace, key, kind })

        for (const namespace of Object.keys(namespaces)) {
            if (!(namespace in baseCatalog)) add(namespace, "*", "extra")
        }

        for (const [namespace, baseMessages] of Object.entries(baseCatalog)) {
            const messages = namespaces[namespace]
            if (!messages) {
                add(namespace, "*", "missing")
                continue
            }
            for (const [key, text] of Object.entries(messages)) {
                if (text.trim() === "") add(namespace, key, "empty")
            }

            const b = split(baseMessages)
            const t = split(messages)

            for (const [key, baseText] of Object.entries(b.plain)) {
                const text = t.plain[key]
                if (text === undefined) add(namespace, key, "missing")
                else if (text.trim() !== "" && placeholders(text) !== placeholders(baseText)) add(namespace, key, "placeholders")
            }
            for (const key of Object.keys(t.plain)) {
                if (!(key in b.plain)) add(namespace, key, "extra")
            }

            const expected = pluralCategories(locale).sort().join(",")
            for (const [prefix, baseFamily] of b.families) {
                const family = t.families.get(prefix)
                if (!family) {
                    add(namespace, prefix, "missing")
                    continue
                }
                if ([...family.keys()].sort().join(",") !== expected) {
                    add(namespace, prefix, "plural")
                    continue
                }
                const reference = placeholders(baseFamily.get("other") ?? [...baseFamily.values()][0] ?? "")
                for (const text of family.values()) {
                    if (text.trim() !== "" && placeholders(text) !== reference) {
                        add(namespace, prefix, "placeholders")
                        break
                    }
                }
            }
            for (const prefix of t.families.keys()) {
                if (!b.families.has(prefix)) add(namespace, prefix, "extra")
            }
        }
    }
    return problems
}
