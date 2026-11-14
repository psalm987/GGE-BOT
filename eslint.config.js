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
            "verification/**/out/**",
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
]
