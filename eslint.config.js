const js = require("@eslint/js")
const globals = require("globals")

module.exports = [
    {
        ignores: [
            "website/**",
            "plugins-extra/**",
            "plugins-personal/**",
            "screenshots/**",
            ".verify-evidence/**",
            ".claude/**",
            ".context-mem/**",
            "**/verification/**/out/**",
            "**/dist/**",
            "**/.astro/**",
            "**/.turbo/**",
        ],
    },
    {
        files: ["**/*.js", "**/*.cjs"],
        languageOptions: {
            sourceType: "commonjs",
            ecmaVersion: "latest",
            globals: { ...globals.node },
        },
        rules: {
            "no-undef": "error",
        },
    },
    {
        files: ["**/*.mjs"],
        languageOptions: { sourceType: "module", ecmaVersion: "latest", globals: { ...globals.node } },
        rules: { "no-undef": "error" },
    },
    {
        // Functions passed to page.evaluate run inside the browser and the extension.
        files: ["apps/recorder/test/e2e.mjs"],
        languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.webextensions } },
    },
]
