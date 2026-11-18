import type { APIRoute } from "astro"
import { llmsFull } from "../seo/llms.ts"
import { englishLlmsPages } from "../seo/llms-pages.ts"

export const GET: APIRoute = async () => new Response(llmsFull(await englishLlmsPages()), { headers: { "content-type": "text/plain; charset=utf-8" } })
