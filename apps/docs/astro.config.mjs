import { defineConfig } from "astro/config"
import starlight from "@astrojs/starlight"
import markdoc from "@astrojs/markdoc"
import { starlightLocales } from "./src/theme/locales.ts"
import { themeCss } from "./src/theme/css.ts"

export default defineConfig({
    site: "https://docs.neisesolutions.com",
    integrations: [
        starlight({
            title: "GGE Command",
            logo: { src: "./src/assets/crest.svg", alt: "" },
            favicon: "/crest.svg",
            defaultLocale: "root",
            locales: starlightLocales,
            head: [
                { tag: "style", content: themeCss() },
                { tag: "script", content: "document.documentElement.classList.add('gge-js')" },
            ],
            customCss: [
                "@fontsource/alegreya/400.css",
                "@fontsource/alegreya/700.css",
                "@fontsource/alegreya-sans/400.css",
                "@fontsource/alegreya-sans/400-italic.css",
                "@fontsource/alegreya-sans/700.css",
                "@fontsource/cinzel/700.css",
                "@fontsource/ibm-plex-mono/400.css",
                "@fontsource/ibm-plex-sans-arabic/400.css",
                "@fontsource/ibm-plex-sans-arabic/700.css",
                "./src/styles/docs.css",
            ],
            components: { Footer: "./src/components/Footer.astro" },
            sidebar: [
                { label: "Start here", translations: { de: "Hier starten", ar: "ابدأ من هنا" }, items: [{ slug: "quick-start" }, { slug: "glossary" }] },
                { label: "Plugins", translations: { de: "Plugins", ar: "الإضافات" }, items: [{ slug: "plugins/attack-khan" }] },
                { label: "Help", translations: { de: "Hilfe", ar: "مساعدة" }, items: [{ slug: "errors" }, { slug: "alerts" }] },
            ],
        }),
        markdoc(),
    ],
})
