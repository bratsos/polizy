import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3002 },
  // PGlite ships a WASM Postgres; Vite must not pre-bundle it.
  optimizeDeps: {
    exclude: ["@electric-sql/pglite"],
  },
  // Excluding a dep from optimization can leave Vite with two React copies
  // ("Invalid hook call"). Force a single copy.
  resolve: {
    dedupe: ["react", "react-dom"],
  },
});
