import { z } from "astro/zod"

/** What every page says about itself. `sources` are repo globs the drift job watches; `related` are page slugs. */
export const PageFrontmatter = z.object({
    description: z.string().min(1).max(160),
    appRoute: z.string().startsWith("/").optional(),
    plugin: z.string().min(1).optional(),
    sources: z.array(z.string().min(1)).optional(),
    status: z.enum(["stable", "beta", "deprecated"]).optional(),
    related: z.array(z.string().min(1)).optional(),
    updated: z.coerce.date().optional(),
})
