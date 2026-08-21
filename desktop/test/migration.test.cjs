"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { scanLegacyProject } = require("../src/main/migration.cjs");

test("legacy migration imports patches and optional key but not debug records", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hdu-snap-migration-"));
  fs.mkdirSync(path.join(root, "runtime"));
  fs.writeFileSync(path.join(root, "patch_rules.jsonc"), '// comment\n{"rules":[{"source_text":"管理","answer_text":"manage"}]}');
  fs.writeFileSync(path.join(root, ".env"), "DEEPSEEK_API_KEY=sk-legacy-value\n");
  fs.writeFileSync(path.join(root, "runtime", "debug_error_1000.json"), JSON.stringify([
    { session_id: "s1", timestamp: 10, method: "字典匹配" },
    { timestamp: 20, method: "确定性兜底" }
  ]));
  const scan = scanLegacyProject(root);
  assert.deepEqual(scan.summary, { ruleCount: 1, hasApiKey: true });
  assert.equal("sessions" in scan, false);
  assert.equal("archived" in scan, false);
});
