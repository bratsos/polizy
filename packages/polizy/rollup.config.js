import { readFileSync } from "node:fs";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import dts from "rollup-plugin-dts";

const packageJson = JSON.parse(readFileSync("./package.json", "utf8"));

const external = [
  ...Object.keys(packageJson.dependencies || {}),
  ...Object.keys(packageJson.peerDependencies || {}),
];

const tsPlugin = (options = {}) =>
  typescript({
    ...options,
    tsconfig: "./tsconfig.json",
    declaration: false,
    declarationDir: undefined,
    declarationMap: false,
    allowImportingTsExtensions: true,
  });

export default [
  {
    input: "src/index.ts",
    output: {
      file: packageJson.main,
      format: "cjs",
      sourcemap: true,
      exports: "named",
    },
    plugins: [resolve(), tsPlugin()],
    external: external,
  },
  {
    input: "src/index.ts",
    output: {
      file: packageJson.module,
      format: "esm",
      sourcemap: true,
    },
    plugins: [resolve(), tsPlugin()],
    external: external,
  },
  {
    input: "./dist/types/index.d.ts",
    output: [{ file: packageJson.types, format: "esm" }],
    plugins: [dts()],
  },
  {
    input: "./src/polizy.prisma.storage.ts",
    output: {
      file: "dist/prisma-storage.cjs",
      format: "cjs",
      sourcemap: true,
      exports: "named",
    },
    plugins: [resolve(), tsPlugin()],
    external: external,
  },
  {
    input: "./src/polizy.prisma.storage.ts",
    output: {
      file: "dist/prisma-storage.mjs",
      format: "esm",
      sourcemap: true,
    },
    plugins: [resolve(), tsPlugin()],
    external: external,
  },
  {
    input: "./dist/types/polizy.prisma.storage.d.ts",
    output: [{ file: "dist/prisma-storage.d.ts", format: "esm" }],
    plugins: [dts()],
    external: [/@prisma\/client/],
  },
];
