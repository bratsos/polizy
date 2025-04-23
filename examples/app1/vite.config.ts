import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { symbiosisUIPlugin } from "@synopsisapp/symbiosis-ui/plugin";

export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    reactRouter(),
    symbiosisUIPlugin({
      iconsDir: "./assets/icons",
      publicDir: "./public",
    }),
    tsconfigPaths(),
  ],
  server: {
    port: 3001,
  },
  resolve: {
    alias: {
      "@prisma/client": "@prisma/client/index.js",
    },
  },
  ssr: {
    noExternal: command === "build" ? true : undefined,
    optimizeDeps: {
      include: ["@prisma/client-generated"],
    },
  },
  build: {
    rollupOptions: {
      external: ["@prisma/client-generated"],
      output: {
        globals: {
          "react-dom": "ReactDom",
          react: "React",
        },
      },
    },
  },
}));
