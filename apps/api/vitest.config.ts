import { defineConfig } from "vitest/config"

export default defineConfig({
    test: {
        globalSetup: ["./test/global-setup.ts"],
        // One shared database, truncated per file.
        fileParallelism: false,
        testTimeout: 20_000,
    },
})
