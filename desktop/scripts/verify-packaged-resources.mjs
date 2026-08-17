import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(desktopRoot, "..");
const sourcePath = path.join(projectRoot, "patch_rules.jsonc");
const packagedPath = path.join(
  desktopRoot,
  "out",
  "HDU-SNAP-darwin-arm64",
  "HDU-SNAP.app",
  "Contents",
  "Resources",
  "prepared",
  "core-resources",
  "patch_rules.jsonc"
);

const [source, packaged] = await Promise.all([readFile(sourcePath), readFile(packagedPath)]);
if (!source.equals(packaged)) {
  throw new Error(`打包补丁与仓库基线不一致：${packagedPath}`);
}

const digest = createHash("sha256").update(packaged).digest("hex");
console.log(`[HDU-SNAP] 已校验安装包补丁：sha256=${digest}`);
