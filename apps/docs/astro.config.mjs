import { defineConfig } from "astro/config"
import starlight from "@astrojs/starlight"
import markdoc from "@astrojs/markdoc"
import { starlightLocales } from "./src/theme/locales.ts"
import { themeCss } from "./src/theme/css.ts"
import { trimSitemapIntegration } from "./src/seo/sitemap.ts"
import { sidebar } from "./src/theme/sidebar.ts"

export default defineConfig({
    site: "https://docs.neisesolutions.com",
    // Moved pages go here as "/old/": "/new/". Phase 8 turns each entry into a Caddy 301.
    redirects: {},
    vite: { ssr: { external: ["canvaskit-wasm"] } },
    integrations: [
        starlight({
            title: "GGE Command",
            logo: { src: "./src/assets/crest.svg", alt: "" },
            favicon: "/crest.svg",
            disable404Route: true,
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
            sidebar,
            routeMiddleware: "./src/seo/middleware.ts",
        }),
        markdoc(),
        trimSitemapIntegration(),
    ],
})
