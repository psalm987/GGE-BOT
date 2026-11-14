import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// In development the API runs on :3000; the proxy keeps the browser's Origin
// (http://localhost:5173), which the API must list in CLIENT_ORIGINS.
export default defineConfig({
    plugins: [react()],
    server: { port: 5173, proxy: { "/rpc": { target: "http://localhost:3000" } } },
    build: { chunkSizeWarningLimit: 1500 },
})
