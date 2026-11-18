// Edits to the head array Starlight builds for each page. Pure, so they test without Astro.
import type { StarlightRouteData } from "@astrojs/starlight/route-data"

export type HeadTag = StarlightRouteData["head"][number]

const isCanonical = (entry: HeadTag) => entry.tag === "link" && entry.attrs?.rel === "canonical"
const isAlternate = (entry: HeadTag) => entry.tag === "link" && entry.attrs?.rel === "alternate" && typeof entry.attrs.hreflang === "string"
const isRobots = (entry: HeadTag) => entry.tag === "meta" && entry.attrs?.name === "robots"

/** Point the canonical link at another URL. Starlight points a fallback page at itself. */
export function setCanonical(head: HeadTag[], href: string) {
    for (const entry of head.filter(isCanonical)) entry.attrs = { ...entry.attrs, href }
}

export function addNoindex(head: HeadTag[]) {
    if (!head.some(isRobots)) head.push({ tag: "meta", attrs: { name: "robots", content: "noindex" } })
}

/** Keep hreflang alternates only for languages with a real page, plus `x-default`. */
export function keepAlternates(head: HeadTag[], langs: ReadonlySet<string>): HeadTag[] {
    return head.filter(entry => !isAlternate(entry) || entry.attrs?.hreflang === "x-default" || langs.has(String(entry.attrs?.hreflang)))
}

export function addImage(head: HeadTag[], image: { url: string; alt: string; width: number; height: number }) {
    head.push(
        { tag: "meta", attrs: { property: "og:image", content: image.url } },
        { tag: "meta", attrs: { property: "og:image:width", content: String(image.width) } },
        { tag: "meta", attrs: { property: "og:image:height", content: String(image.height) } },
        { tag: "meta", attrs: { property: "og:image:alt", content: image.alt } },
        { tag: "meta", attrs: { name: "twitter:image", content: image.url } },
        { tag: "meta", attrs: { name: "twitter:image:alt", content: image.alt } },
    )
}
