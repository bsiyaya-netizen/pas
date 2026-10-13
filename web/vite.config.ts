import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the portal calls the API through /api, proxied to the local server.
export default defineConfig({
  plugins: [react()],
  server: {
    // GitHub Codespaces serves the dev server on *.app.github.dev.
    allowedHosts: process.env.CODESPACES ? [".app.github.dev"] : undefined,
    proxy: {
      "/api": {
        target: process.env.API_URL ?? "http://localhost:3000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
