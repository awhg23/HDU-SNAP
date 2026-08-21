import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(desktopRoot, "..");
const preparedRoot = path.join(desktopRoot, "resources", "prepared");
const prepared = path.join(preparedRoot, "core-resources");
const dictionarySource = path.join(projectRoot, "CET", "Data.lexicon.cache.json");
const patchRulesSource = path.join(projectRoot, "patch_rules.jsonc");

await access(dictionarySource);
await access(patchRulesSource);
await rm(prepared, { recursive: true, force: true });
await mkdir(path.join(prepared, "CET"), { recursive: true });
await cp(dictionarySource, path.join(prepared, "CET", "Data.lexicon.cache.json"), { force: true });
await cp(patchRulesSource, path.join(prepared, "patch_rules.jsonc"), { force: true });
