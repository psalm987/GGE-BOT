import { defineMarkdocConfig, component } from "@astrojs/markdoc/config"
import Markdoc from "@markdoc/markdoc"
import starlightMarkdoc from "@astrojs/starlight-markdoc"
import { knownPlugin, knownTerm, knownUiKey } from "./src/data/markdoc-checks.ts"

const anchorId = /^[a-z][a-z0-9-]*$/
const termId = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** `terms_on_page` can't see the rest of the page, so the document hands it the ids of every term tag. */
function termsOfPage(node) {
    const ids = []
    for (const child of node.walk()) if (child.type === "tag" && child.tag === "term") ids.push(child.attributes.id)
    return [...new Set(ids)]
}

export default defineMarkdocConfig({
    extends: [starlightMarkdoc()],
    nodes: {
        document: {
            transform(node, config) {
                const ids = termsOfPage(node)
                for (const child of node.walk()) if (child.type === "tag" && child.tag === "terms_on_page") child.attributes.ids = ids
                return new Markdoc.Tag("article", {}, node.transformChildren(config))
            },
        },
    },
    tags: {
        aside: {
            render: component("./src/components/Aside.astro"),
            attributes: {
                type: { type: String, required: true, matches: ["tip", "caution", "danger", "note"] },
                id: { type: String, required: true, matches: anchorId },
            },
        },
        sidenote: {
            inline: true,
            render: component("./src/components/Sidenote.astro"),
            attributes: {
                id: { type: String, required: true, matches: anchorId },
            },
        },
        term: {
            inline: true,
            render: component("./src/components/Term.astro"),
            attributes: { id: { type: String, required: true, matches: termId } },
            validate: knownTerm,
        },
        terms_on_page: {
            selfClosing: true,
            render: component("./src/components/TermsOnPage.astro"),
            attributes: { ids: { type: Array } },
        },
        glossary: {
            selfClosing: true,
            render: component("./src/components/Glossary.astro"),
        },
        ui: {
            inline: true,
            selfClosing: true,
            render: component("./src/components/Ui.astro"),
            attributes: { key: { type: String, required: true, matches: /^(client|common|ui):.+$/ } },
            validate: knownUiKey,
        },
        settings: {
            selfClosing: true,
            render: component("./src/components/Settings.astro"),
            attributes: { plugin: { type: String, required: true } },
            validate: knownPlugin,
        },
        errors: {
            selfClosing: true,
            render: component("./src/components/Errors.astro"),
            attributes: { source: { type: String, matches: ["app", "bot"] } },
        },
        alerts: {
            selfClosing: true,
            render: component("./src/components/Alerts.astro"),
        },
        status: {
            inline: true,
            selfClosing: true,
            render: component("./src/components/Status.astro"),
            attributes: { kind: { type: String, required: true, matches: ["beta", "planned"] } },
        },
        plan_gate: {
            render: component("./src/components/PlanGate.astro"),
        },
    },
})
