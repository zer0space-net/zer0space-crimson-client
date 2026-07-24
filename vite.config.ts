import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Served under zer0space.com/crimson (the dashboard gates and reverse-proxies
// this path), so every emitted asset URL and the router basename share the
// same /crimson/ prefix. Change here and in <BrowserRouter basename> together.
export default defineConfig({
  base: "/crimson/",
  plugins: [react()],
  resolve: {
    alias: {
      // The Crimson Haven scrape/resolve engine, vendored as a git submodule and
      // transpiled inline by Vite — no separate build step. See vendor/.
      "crimson-sources": fileURLToPath(
        new URL("./vendor/crimson-sources/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5199,
    // In local dev we talk to a running backend directly; in production the
    // dashboard proxies /crimson/api → backend, so the app only ever uses the
    // relative /crimson/api base (see src/lib/config.ts).
    proxy: {
      "/crimson/api": {
        target: process.env.CRIMSON_API_ORIGIN || "http://localhost:8080",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/crimson\/api/, ""),
      },
    },
  },
});
