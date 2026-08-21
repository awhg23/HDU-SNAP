"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { LocalLogger, redact } = require("../src/main/logger.cjs");
const { CrashStore } = require("../src/main/crash-store.cjs");
const { SecretStore } = require("../src/main/secret-store.cjs");
const { createDiagnosticZip, sanitizeDiagnosticValue, sanitizeSnapshot } = require("../src/main/diagnostics.cjs");
const { fetchManifest, isAllowedReleaseUrl, shouldCheck, validateManifest } = require("../src/main/update-checker.cjs");
const { exportBatchCsv, exportBatchJson } = require("../src/main/exports.cjs");

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hdu-snap-local-"));
}

test("secret values are encrypted at rest and logs are redacted", () => {
  const root = temporaryDirectory();
  const privateValue = ["sk", "private", "secret"].join("-");
  const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from("cipher:" + Buffer.from(value, "utf8").toString("base64"), "utf8"),
    decryptString: (value) => Buffer.from(value.toString("utf8").slice(7), "base64").toString("utf8")
  };
  const secret = new SecretStore(fakeSafeStorage, root);
  secret.set(privateValue);
  assert.equal(secret.get(), privateValue);
  assert.doesNotMatch(fs.readFileSync(secret.filePath, "utf8"), new RegExp(privateValue));

  const logger = new LocalLogger(root);
  logger.warn("authorization=Bearer " + privateValue);
  const log = fs.readFileSync(logger.filePath, "utf8");
  assert.doesNotMatch(log, new RegExp(privateValue));
  assert.match(redact("api_key=" + privateValue), /REDACTED/);
});

test("diagnostic snapshots remove password, token, cookie, and key material", () => {
  const keyValue = ["sk", "abcdefghijk"].join("-");
  const input = `<input type="password" value="secret"> document.cookie=abc api_key=${keyValue}`;
  const sanitized = sanitizeSnapshot(input);
  assert.doesNotMatch(sanitized, /secret|abcdefghijk|cookie=abc/);
});

test("crash context is persisted with stacks but without secrets", () => {
  const root = temporaryDirectory();
  const privateKey = ["sk", "private", "secret"].join("-");
  const store = new CrashStore(root, () => new Date("2026-08-22T00:00:00Z"));
  store.record("main_process_exception", {
    api_key: privateKey,
    error: new Error("token=private-value")
  });
  const persisted = JSON.stringify(store.read());
  assert.match(persisted, /main_process_exception|Error/);
  assert.doesNotMatch(persisted, new RegExp(privateKey + "|private-value"));
  assert.doesNotMatch(JSON.stringify(sanitizeDiagnosticValue(store.read())), /private-value/);
});

test("the generated diagnostic ZIP excludes secrets from every entry", async () => {
  const root = temporaryDirectory();
  const values = Object.fromEntries(
    ["diagnostic", "state", "health", "crash", "snapshot", "session"]
      .map((name) => [name, [name, "private", "value"].join("-")])
  );
  const logger = new LocalLogger(root);
  logger.warn("authorization=Bearer " + values.diagnostic);
  const zipPath = path.join(root, "diagnostic.zip");
  await createDiagnosticZip({
    filePath: zipPath,
    state: { password: values.state, batches: [] },
    health: { token: values.health },
    crash: { api_key: values.crash },
    logPath: logger.filePath,
    snapshot: `<input type="password" value="${values.snapshot}"> document.cookie=${values.session}`
  });
  const contents = execFileSync("unzip", ["-p", zipPath], { encoding: "utf8" });
  assert.match(contents, /REDACTED/);
  assert.doesNotMatch(contents, /state-private-value|health-private-value|crash-private-value|diagnostic-private-value|snapshot-private-value|session-private-value/);
});

test("automatic version checks are limited to once per 24 hours", () => {
  const now = Date.parse("2026-08-09T00:00:00Z");
  assert.equal(shouldCheck("2026-08-08T12:00:00Z", now), false);
  assert.equal(shouldCheck("2026-08-07T23:59:59Z", now), true);
});

function release(version, channel = "stable") {
  return {
    version,
    channel,
    published_at: "2026-08-22T00:00:00Z",
    summary: `HDU-SNAP ${version}`,
    sha256: "a".repeat(64),
    release_url: `https://github.com/awhg23/HDU-SNAP/releases/tag/v${version}`
  };
}

test("version manifests are validated, sorted and compared with the current app", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ schema_version: 1, releases: [release("2.3.0"), release("2.5.0", "test"), release("2.4.0")] })
  });
  const stable = await fetchManifest("https://example.invalid/manifest.json", "stable", "2.3.0", fetchImpl);
  assert.equal(stable.status, "update_available");
  assert.equal(stable.latest.version, "2.4.0");
  const testChannel = await fetchManifest("https://example.invalid/manifest.json", "test", "2.5.0", fetchImpl);
  assert.equal(testChannel.status, "up_to_date");
  assert.equal(testChannel.latest.version, "2.5.0");
});

test("version manifests reject invalid integrity data and release hosts", () => {
  assert.throws(() => validateManifest({ schema_version: 2, releases: [] }), /schema/);
  assert.throws(() => validateManifest({ schema_version: 1, releases: [{ ...release("2.4.0"), sha256: "bad" }] }), /integrity/);
  assert.throws(() => validateManifest({ schema_version: 1, releases: [{ ...release("2.4.0"), extra: true }] }), /schema/);
  assert.throws(() => validateManifest({ schema_version: 1, releases: [release("2.4.0"), release("2.4.0")] }), /duplicate/);
  assert.throws(() => validateManifest({ schema_version: 1, releases: [release("2.4.0-test.1")] }), /prerelease/);
  assert.equal(isAllowedReleaseUrl("https://github.com/awhg23/HDU-SNAP/releases/tag/v2.4.0", "2.4.0"), true);
  assert.equal(isAllowedReleaseUrl("https://example.com/awhg23/HDU-SNAP/releases/tag/v2.4.0", "2.4.0"), false);
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
