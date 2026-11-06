import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { apiMiddleware } from "./server/api.ts";

export default defineConfig({
  plugins: [{
    name: "mah-api-middleware",
    configureServer(server) { server.middlewares.use(apiMiddleware); },
    configurePreviewServer(server) { server.middlewares.use(apiMiddleware); },
  }, react()],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
});
