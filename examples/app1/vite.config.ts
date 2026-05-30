import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  server: {
    port: 3001,
  },
  // PGlite ships a WASM Postgres; Vite must not pre-bundle it.
  optimizeDeps: {
    exclude: ["@electric-sql/pglite"],
  },
  // Excluding a dep from optimization can leave Vite's dev server with two
  // React instances ("Invalid hook call"). Force a single copy.
  resolve: {
    dedupe: ["react", "react-dom", "react-router"],
  },
});
