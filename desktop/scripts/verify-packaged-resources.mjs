import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPackage } from "@electron/asar";

const execFile = promisify(execFileCallback);

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(desktopRoot, "..");
const sourcePath = path.join(projectRoot, "patch_rules.jsonc");
const appRoot = path.join(
  desktopRoot,
  "out",
  "HDU-SNAP-darwin-arm64",
  "HDU-SNAP.app"
);
const resourcesRoot = path.join(appRoot, "Contents", "Resources");
const packagedPath = path.join(
  resourcesRoot,
  "prepared",
  "core-resources",
  "patch_rules.jsonc"
);
const sourceLexiconPath = path.join(projectRoot, "CET", "Data.lexicon.cache.json");
const packagedLexiconPath = path.join(
  resourcesRoot,
  "prepared",
  "core-resources",
  "CET",
  "Data.lexicon.cache.json"
);
const sidecarPath = path.join(
  resourcesRoot,
  "prepared",
  "sidecar",
  "hdu-snap-sidecar",
  "hdu-snap-sidecar"
);
const asarPath = path.join(resourcesRoot, "app.asar");

async function walk(relativeRoot, absoluteRoot = relativeRoot) {
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const absolutePath = path.join(absoluteRoot, entry.name);
    const relativePath = path.relative(relativeRoot, absolutePath);
    results.push(relativePath);
    if (entry.isDirectory()) {
      results.push(...await walk(relativeRoot, absolutePath));
    }
  }
  return results;
}

function assertNoRetiredResources(paths, label) {
  const forbidden = /(^|[\\/._-])(extension|fastapi|starlette|uvicorn|uvloop|websockets?|torch|sentence[-_]?transformers?|transformers?|sklearn|m3e|\.models)([\\/._-]|$)/i;
  const found = paths.filter((entry) => forbidden.test(entry));
  if (found.length > 0) {
    throw new Error(`${label} 包含已退场资源：${found.slice(0, 10).join(", ")}`);
  }
}

const [source, packaged, sourceLexicon, packagedLexicon] = await Promise.all([
  readFile(sourcePath),
  readFile(packagedPath),
  readFile(sourceLexiconPath),
  readFile(packagedLexiconPath)
]);
if (!source.equals(packaged)) {
  throw new Error(`打包补丁与仓库基线不一致：${packagedPath}`);
}
if (!sourceLexicon.equals(packagedLexicon)) {
  throw new Error(`打包词典与仓库基线不一致：${packagedLexiconPath}`);
}

const digest = createHash("sha256").update(packaged).digest("hex");
console.log(`[HDU-SNAP] 已校验安装包补丁：sha256=${digest}`);

const sidecarInfo = await stat(sidecarPath);
if (!sidecarInfo.isFile() || sidecarInfo.size === 0) {
  throw new Error(`sidecar 不存在或为空：${sidecarPath}`);
}
const { stdout: fileOutput } = await execFile("file", [sidecarPath]);
if (!/Mach-O 64-bit executable arm64/.test(fileOutput)) {
  throw new Error(`sidecar 不是 Apple Silicon Mach-O：${fileOutput.trim()}`);
}

const resourcePaths = await walk(resourcesRoot);
assertNoRetiredResources(resourcePaths, "Contents/Resources");

const asarEntries = listPackage(asarPath);
assertNoRetiredResources(asarEntries, "app.asar");
if (asarEntries.some((entry) => /(^|\/)resources\/prepared(\/|$)/.test(entry))) {
  throw new Error("prepared 资源被重复写入 app.asar");
}

console.log(`[HDU-SNAP] 已校验 sidecar 架构：${fileOutput.trim()}`);
console.log("[HDU-SNAP] 已确认安装包不含向量、旧插件或本地服务资源，prepared 仅位于 Resources。");
