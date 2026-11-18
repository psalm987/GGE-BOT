// Typed builders for the schema.org structured data each page carries. Pure, so they test without Astro.
export const SITE_URL = "https://docs.neisesolutions.com"
export const ORG_NAME = "Neise Solutions"
export const ORG_URL = "https://neisesolutions.com"
export const APP_NAME = "GGE Command"

export type Crumb = { name: string; url: string }

type Organization = {
    "@type": "Organization"
    "@id": string
    name: string
    url: string
    logo: string
}

export type TechArticle = {
    "@type": "TechArticle"
    headline: string
    description: string
    inLanguage: string
    url: string
    mainEntityOfPage: string
    image?: string[]
    dateModified?: string
    publisher: { "@id": string }
}

export type BreadcrumbList = {
    "@type": "BreadcrumbList"
    inLanguage: string
    itemListElement: { "@type": "ListItem"; position: number; name: string; item: string }[]
}

export type DefinedTermSet = {
    "@type": "DefinedTermSet"
    name: string
    url: string
    inLanguage: string
    hasDefinedTerm: { "@type": "DefinedTerm"; name: string; description: string; url: string; termCode: string; inLanguage: string; alternateName?: string[] }[]
}

export type SoftwareApplication = {
    "@type": "SoftwareApplication"
    name: string
    description: string
    url: string
    applicationCategory: string
    operatingSystem: string
    inLanguage: string
    publisher: { "@id": string }
}

export type JsonLd = Organization | TechArticle | BreadcrumbList | DefinedTermSet | SoftwareApplication
export type JsonLdDocument = JsonLd & { "@context": "https://schema.org" }

const ORG_ID = `${ORG_URL}/#organization`

/** `headline` on TechArticle should stay short; Google truncates beyond about 110 characters. */
const HEADLINE_MAX = 110

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`)

export function organization(): Organization {
    return { "@type": "Organization", "@id": ORG_ID, name: ORG_NAME, url: ORG_URL, logo: `${SITE_URL}/crest.svg` }
}

export function techArticle(page: { title: string; description: string; lang: string; url: string; image?: string; updated?: Date }): TechArticle {
    return {
        "@type": "TechArticle",
        headline: clip(page.title, HEADLINE_MAX),
        description: page.description,
        inLanguage: page.lang,
        url: page.url,
        mainEntityOfPage: page.url,
        ...(page.image ? { image: [page.image] } : {}),
        ...(page.updated ? { dateModified: page.updated.toISOString().slice(0, 10) } : {}),
        publisher: { "@id": ORG_ID },
    }
}

export function breadcrumbList(crumbs: Crumb[], lang: string): BreadcrumbList {
    return {
        "@type": "BreadcrumbList",
        inLanguage: lang,
        itemListElement: crumbs.map((crumb, index) => ({ "@type": "ListItem", position: index + 1, name: crumb.name, item: crumb.url })),
    }
}

export type GlossaryTerm = { id: string; term: string; aliases: string[]; short: string }

export function definedTermSet(page: { name: string; url: string; lang: string; terms: GlossaryTerm[] }): DefinedTermSet {
    return {
        "@type": "DefinedTermSet",
        name: page.name,
        url: page.url,
        inLanguage: page.lang,
        hasDefinedTerm: page.terms.map(term => ({
            "@type": "DefinedTerm",
            name: term.term,
            description: term.short,
            url: `${page.url}#${term.id}`,
            termCode: term.id,
            inLanguage: page.lang,
            ...(term.aliases.length ? { alternateName: term.aliases } : {}),
        })),
    }
}

export function softwareApplication(page: { description: string; url: string; lang: string }): SoftwareApplication {
    return {
        "@type": "SoftwareApplication",
        name: APP_NAME,
        description: page.description,
        url: page.url,
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Web",
        inLanguage: page.lang,
        publisher: { "@id": ORG_ID },
    }
}

export type PageKind = "article" | "glossary" | "home"

/** Everything one page emits, in order. The home page also describes the publisher and the product. */
export function pageJsonLd(input: {
    kind: PageKind
    title: string
    description: string
    lang: string
    url: string
    image?: string
    updated?: Date
    crumbs: Crumb[]
    terms?: GlossaryTerm[]
}): JsonLdDocument[] {
    const nodes: JsonLd[] = [
        techArticle(input),
        breadcrumbList(input.crumbs, input.lang),
    ]
    if (input.kind === "glossary") nodes.push(definedTermSet({ name: input.title, url: input.url, lang: input.lang, terms: input.terms ?? [] }))
    if (input.kind === "home") nodes.push(organization(), softwareApplication(input))
    return nodes.map(node => ({ "@context": "https://schema.org", ...node }))
}

/** A script body that cannot close its own tag. */
export const serialize = (doc: JsonLdDocument) => JSON.stringify(doc).replace(/</g, "\\u003c")
