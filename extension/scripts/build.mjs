import { build } from "esbuild";

const shared = {
  bundle: true,
  sourcemap: false,
  target: "chrome96",
  logLevel: "info",
  legalComments: "none"
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/background/index.js"],
    outfile: "dist/background.js",
    format: "esm"
  }),
  build({
    ...shared,
    entryPoints: ["src/content/index.js"],
    outfile: "dist/content.js",
    format: "iife"
  }),
  build({
    ...shared,
    entryPoints: ["src/options/index.js"],
    outfile: "dist/options.js",
    format: "iife"
  })
]);
