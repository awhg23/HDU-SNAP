"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { LocalLogger, redact } = require("../src/main/logger.cjs");
const { SecretStore } = require("../src/main/secret-store.cjs");
const { sanitizeSnapshot } = require("../src/main/diagnostics.cjs");
const { shouldCheck } = require("../src/main/update-checker.cjs");
const { exportBatchCsv, exportBatchJson } = require("../src/main/exports.cjs");

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hdu-snap-local-"));
}

test("secret values are encrypted at rest and logs are redacted", () => {
  const root = temporaryDirectory();
  const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from("cipher:" + value, "utf8"),
    decryptString: (value) => value.toString("utf8").slice(7)
  };
  const secret = new SecretStore(fakeSafeStorage, root);
  secret.set("sk-private-secret");
  assert.equal(secret.get(), "sk-private-secret");
  assert.doesNotMatch(fs.readFileSync(secret.filePath, "utf8"), /^sk-private/);

  const logger = new LocalLogger(root);
  logger.warn("authorization=Bearer sk-private-secret");
  const log = fs.readFileSync(logger.filePath, "utf8");
  assert.doesNotMatch(log, /sk-private-secret/);
  assert.match(redact("api_key=sk-private-secret"), /REDACTED/);
});

test("diagnostic snapshots remove password, token, cookie, and key material", () => {
  const input = '<input type="password" value="secret"> document.cookie=abc api_key=sk-abcdefghijk';
  const sanitized = sanitizeSnapshot(input);
  assert.doesNotMatch(sanitized, /secret|abcdefghijk|cookie=abc/);
});

test("automatic version checks are limited to once per 24 hours", () => {
  const now = Date.parse("2026-08-09T00:00:00Z");
  assert.equal(shouldCheck("2026-08-08T12:00:00Z", now), false);
  assert.equal(shouldCheck("2026-08-07T23:59:59Z", now), true);
});

test("record exports do not contain account identity fields", () => {
  const root = temporaryDirectory();
  const batches = [{
    id: "b1",
    startedAt: "2026-08-17T00:00:00Z",
    mode: "normal",
    targetCount: 10,
    answeredCount: 10,
    status: "completed",
    mode: "debug",
    reviewStatus: "complete",
    debugItems: [{ sourceText: "不应导出的调试题目" }],
    profileName: "不应导出",
    studentId: "25030122"
  }];
  const csvPath = path.join(root, "records.csv");
  const jsonPath = path.join(root, "records.json");
  exportBatchCsv(csvPath, batches);
  exportBatchJson(jsonPath, batches);
  const content = fs.readFileSync(csvPath, "utf8") + fs.readFileSync(jsonPath, "utf8");
  assert.doesNotMatch(content, /姓名|学号|profileName|studentId|模式|debug|reviewStatus|debugItems|不应导出的调试题目/);
});
