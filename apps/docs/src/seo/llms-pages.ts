import { getCollection } from "astro:content"
import { slugOf } from "./site.ts"
import type { LlmsPage } from "./llms.ts"

/** The English pages, with their Markdoc bodies. */
export async function englishLlmsPages(): Promise<LlmsPage[]> {
    const entries = await getCollection("docs", entry => !/^[a-z]{2}\//.test(entry.id))
    return entries.map(entry => ({ slug: slugOf(entry.id), title: entry.data.title, description: entry.data.description, body: entry.body ?? "" }))
}
