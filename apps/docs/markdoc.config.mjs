import { defineMarkdocConfig, component } from "@astrojs/markdoc/config"
import starlightMarkdoc from "@astrojs/starlight-markdoc"

const anchorId = /^[a-z][a-z0-9-]*$/

export default defineMarkdocConfig({
    extends: [starlightMarkdoc()],
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
    },
})
