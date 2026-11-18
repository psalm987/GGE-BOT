import { defineCollection } from "astro:content"
import { glob } from "astro/loaders"
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders"
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema"
import { z } from "astro/zod"
import { FixFile } from "./data/fixes.ts"
import { TermFile } from "./data/terms.ts"
import { GGE_KEYS } from "./data/ui-keys.ts"

const yamlFiles = (base: string) => glob({ pattern: "*.yaml", base })

export const collections = {
    docs: defineCollection({
        loader: docsLoader(),
        schema: docsSchema({ extend: z.object({ description: z.string().min(1).max(160) }) }),
    }),
    i18n: defineCollection({
        loader: i18nLoader(),
        schema: i18nSchema({ extend: z.object(Object.fromEntries(GGE_KEYS.map(key => [key, z.string().optional()]))) }),
    }),
    terms: defineCollection({ loader: yamlFiles("./src/content/terms"), schema: TermFile }),
    errors: defineCollection({ loader: yamlFiles("./src/content/errors"), schema: FixFile }),
    alerts: defineCollection({ loader: yamlFiles("./src/content/alerts"), schema: FixFile }),
}
