import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The admin API is mounted at /admin/rpc and must list this origin in ADMIN_ORIGINS.
export default defineConfig({
    plugins: [react()],
    server: { port: 5174, proxy: { "/admin/rpc": { target: "http://localhost:3000" } } },
    build: { chunkSizeWarningLimit: 1500 },
})
