import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
await mkdir(dist, { recursive: true });
await mkdir(path.join(dist, "assets"), { recursive: true });

await Promise.all([
  build({
    entryPoints: [path.join(root, "src/preload/app.cjs")],
    outfile: path.join(dist, "app-preload.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    sourcemap: false
  }),
  build({
    entryPoints: [path.join(root, "src/site/preload.cjs")],
    outfile: path.join(dist, "site-preload.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    sourcemap: false
  }),
  cp(path.join(root, "src/renderer/index.html"), path.join(dist, "index.html")),
  cp(path.join(root, "src/renderer/styles.css"), path.join(dist, "styles.css")),
  cp(path.join(root, "src/renderer/app.js"), path.join(dist, "app.js")),
  cp(path.join(root, "src/renderer/assets/study-companion.png"), path.join(dist, "assets/study-companion.png"))
]);
