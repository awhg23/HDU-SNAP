"use strict";

const fs = require("node:fs");
const path = require("node:path");

function parseJsonc(filePath) {
  if (!fs.existsSync(filePath)) return { rules: [] };
  const withoutComments = fs.readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  return JSON.parse(withoutComments);
}

function readPatchRulesFile(filePath) {
  const payload = parseJsonc(filePath);
  if (!payload || !Array.isArray(payload.rules)) {
    throw new TypeError("patch rules file is invalid");
  }
  return payload;
}

function sourceStats(projectDir) {
  const names = ["patch_rules.jsonc", ".env"];
  return names.map((name) => {
    const filePath = path.join(projectDir, name);
    if (!fs.existsSync(filePath)) return name + ":missing";
    const stat = fs.statSync(filePath);
    return name + ":" + stat.size + ":" + Math.floor(stat.mtimeMs);
  }).join("|");
}

function extractLegacyKey(projectDir) {
  const envPath = path.join(projectDir, ".env");
  if (!fs.existsSync(envPath)) return null;
  const line = fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((entry) => /^\s*DEEPSEEK_API_KEY\s*=/.test(entry));
  if (!line) return null;
  const value = line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
  return value || null;
}

function scanLegacyProject(projectDir) {
  const root = path.resolve(projectDir);
  if (!fs.statSync(root).isDirectory()) throw new TypeError("legacy path is not a directory");
  const patchPayload = readPatchRulesFile(path.join(root, "patch_rules.jsonc"));
  if (!Array.isArray(patchPayload.rules)) {
    throw new TypeError("legacy data format is invalid");
  }
  return {
    root,
    stats: sourceStats(root),
    rules: patchPayload.rules,
    apiKey: extractLegacyKey(root),
    summary: {
      ruleCount: patchPayload.rules.length,
      hasApiKey: Boolean(extractLegacyKey(root))
    }
  };
}

module.exports = { readPatchRulesFile, scanLegacyProject };
