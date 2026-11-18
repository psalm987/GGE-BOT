import { z } from "astro/zod"

/** What to do about an error code or a notification kind. `src/content/{errors,alerts}/<locale>.yaml` map each code to one of these. */
export const Fix = z.object({
    fix: z.string().min(1).refine(text => !/\{%|%\}|\{\{|\}\}/.test(text), "no tags or placeholders"),
})
export type Fix = z.infer<typeof Fix>

export const FixFile = z.record(z.string().min(1), Fix)
export type FixFile = z.infer<typeof FixFile>
