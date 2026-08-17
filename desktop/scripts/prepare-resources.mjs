import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(desktopRoot, "..");
const prepared = path.join(desktopRoot, "resources", "prepared", "core-resources");
const dictionarySource = path.join(projectRoot, "CET", "Data.lexicon.cache.json");
const patchRulesSource = path.join(projectRoot, "patch_rules.jsonc");
const modelSource = path.join(projectRoot, ".models", "moka-ai_m3e-base");

await access(dictionarySource);
await access(patchRulesSource);
await access(modelSource);
await mkdir(path.join(prepared, "CET"), { recursive: true });
await mkdir(path.join(prepared, "models"), { recursive: true });
await cp(dictionarySource, path.join(prepared, "CET", "Data.lexicon.cache.json"), { force: true });
await cp(patchRulesSource, path.join(prepared, "patch_rules.jsonc"), { force: true });
await cp(modelSource, path.join(prepared, "models", "moka-ai_m3e-base"), { recursive: true, force: true });
