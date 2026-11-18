import { defineCollection } from "astro:content"
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders"
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema"
import { z } from "astro/zod"

export const collections = {
    docs: defineCollection({
        loader: docsLoader(),
        schema: docsSchema({ extend: z.object({ description: z.string().min(1).max(160) }) }),
    }),
    i18n: defineCollection({
        loader: i18nLoader(),
        schema: i18nSchema({
            extend: z.object({
                "gge.aside.tip": z.string().optional(),
                "gge.aside.caution": z.string().optional(),
                "gge.aside.danger": z.string().optional(),
                "gge.aside.note": z.string().optional(),
                "gge.aside.copyLink": z.string().optional(),
                "gge.aside.linkCopied": z.string().optional(),
                "gge.sidenote.label": z.string().optional(),
            }),
        }),
    }),
}
