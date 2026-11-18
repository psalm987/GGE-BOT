export const OG_WIDTH = 1200
export const OG_HEIGHT = 630
export const OG_FORMAT = "jpeg"

/** The image key of a page. The library drops a trailing `index`, so the home page is `home`. */
export const ogKey = (lang: string, slug: string) => `${lang}/${slug === "index" ? "home" : slug}`

/** Where a page's image is served: its own locale when it has a real translation, else English. */
export const ogPath = (lang: string, slug: string) => `/og/${ogKey(lang, slug)}.${OG_FORMAT}`
