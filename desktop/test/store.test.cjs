"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DesktopStore, NewerSchemaError } = require("../src/main/store.cjs");
const { BATCH_STATUS } = require("../src/shared/constants.cjs");

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hdu-snap-store-"));
}

test("schema 1 account data is removed while its login partition and batches are preserved", () => {
  const directory = temporaryDirectory();
  fs.writeFileSync(path.join(directory, "state.json"), JSON.stringify({
    schemaVersion: 1,
    onboardingComplete: true,
    profiles: [{ id: "p1", name: "张三", studentId: "1001", partition: "persist:hdu-snap-profile-p1", pending: false }],
    batches: [{ id: "b1", profileId: "p1", profileName: "张三", studentId: "1001", status: BATCH_STATUS.COMPLETED }],
    activeBatch: null,
    migrationFingerprints: []
  }));
  const store = new DesktopStore(directory);
  const state = store.initialize();
  assert.equal(state.schemaVersion, 3);
  assert.equal(state.browserPartition, "persist:hdu-snap-profile-p1");
  assert.equal("profiles" in state, false);
  assert.equal("profileName" in state.batches[0], false);
  assert.equal("studentId" in state.batches[0], false);
  assert.equal(fs.readdirSync(path.join(directory, "backups")).length, 1);
});

test("schema 2 update settings migrate to the fixed public manifest safely", () => {
  const directory = temporaryDirectory();
  fs.writeFileSync(path.join(directory, "state.json"), JSON.stringify({
    schemaVersion: 2,
    onboardingComplete: true,
    settings: {
      learningHome: "https://skl.hdu.edu.cn/#/english/list",
      updateChannel: "test",
      lastUpdateCheckAt: "2026-08-20T00:00:00Z",
      updateManifestUrl: "https://untrusted.example/manifest.json"
    },
    batches: [],
    migrationFingerprints: [],
    activeBatch: null,
    browserPartition: "persist:hdu-snap-browser"
  }));
  const store = new DesktopStore(directory);
  const state = store.initialize();
  assert.equal(state.schemaVersion, 3);
  assert.equal(state.settings.updateChannel, "test");
  assert.equal("updateManifestUrl" in state.settings, false);
  assert.equal(fs.readdirSync(path.join(directory, "backups")).length, 1);
});

test("schema 3 rejects persisted update and navigation settings outside the allowlist", () => {
  const directory = temporaryDirectory();
  fs.writeFileSync(path.join(directory, "state.json"), JSON.stringify({
    schemaVersion: 3,
    settings: {
      learningHome: "https://example.com/phishing",
      updateChannel: "nightly",
      lastUpdateCheckAt: { unsafe: true },
      updateManifestUrl: "https://untrusted.example/manifest.json"
    },
    batches: [],
    migrationFingerprints: [],
    activeBatch: null,
    browserPartition: "persist:hdu-snap-browser"
  }));
  const state = new DesktopStore(directory).initialize();
  assert.equal(state.settings.learningHome, "https://skl.hduhelp.com/?type=5#/english/list");
  assert.equal(state.settings.updateChannel, "stable");
  assert.equal(state.settings.lastUpdateCheckAt, null);
  assert.equal("updateManifestUrl" in state.settings, false);
});

test("batch retention deletes the oldest record", () => {
  const store = new DesktopStore(temporaryDirectory(), { maxBatches: 2 });
  store.initialize();
  for (let index = 1; index <= 3; index += 1) {
    store.addImportedBatch({
      id: "b" + index,
      status: BATCH_STATUS.COMPLETED,
      startedAt: "2026-08-0" + index + "T00:00:00Z"
    });
  }
  assert.deepEqual(store.listBatches({}).items.map((item) => item.id), ["b3", "b2"]);
});

test("record dates include the entire end date in local time", () => {
  const store = new DesktopStore(temporaryDirectory());
  store.initialize();
  const localTimestamp = (day, hour) => new Date(2026, 7, day, hour, 30).toISOString();
  for (const [id, day, hour] of [["before", 16, 23], ["morning", 17, 0], ["evening", 17, 23], ["after", 18, 0]]) {
    store.addImportedBatch({ id, status: BATCH_STATUS.COMPLETED, startedAt: localTimestamp(day, hour) });
  }
  const result = store.listAllBatches({ dateFrom: "2026-08-17", dateTo: "2026-08-17" });
  assert.deepEqual(result.map((item) => item.id), ["evening", "morning"]);
  assert.throws(() => store.listBatches({ dateFrom: "2026-08-18", dateTo: "2026-08-17" }), /date range/);
});

test("record pagination uses 50 rows and clamps an empty final page", () => {
  const store = new DesktopStore(temporaryDirectory());
  store.initialize();
  for (let index = 0; index < 101; index += 1) {
    store.addImportedBatch({
      id: "batch-" + String(index).padStart(3, "0"),
      status: BATCH_STATUS.COMPLETED,
      startedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
    });
  }
  assert.equal(store.listBatches({ page: 1 }).items.length, 50);
  assert.equal(store.listBatches({ page: 3 }).items.length, 1);
  assert.equal(store.listAllBatches({}).length, 101);
  store.deleteBatches(["batch-000"]);
  const clamped = store.listBatches({ page: 3 });
  assert.equal(clamped.page, 2);
  assert.equal(clamped.pageCount, 2);
  assert.equal(clamped.items.length, 50);
});

test("active batch is recovered as unconfirmed or interrupted", () => {
  const directory = temporaryDirectory();
  let store = new DesktopStore(directory);
  store.initialize();
  store.setActiveBatch({ id: "b1", status: BATCH_STATUS.FINAL_PENDING });
  store = new DesktopStore(directory);
  const state = store.initialize();
  assert.equal(state.activeBatch, null);
  assert.equal(state.batches[0].status, BATCH_STATUS.SUBMISSION_UNCONFIRMED);
});

test("newer schemas are blocked", () => {
  const directory = temporaryDirectory();
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "state.json"), JSON.stringify({ schemaVersion: 999 }));
  const store = new DesktopStore(directory);
  assert.throws(() => store.initialize(), NewerSchemaError);
});

test("only the three most recent backups are kept", () => {
  const directory = temporaryDirectory();
  let tick = 0;
  const store = new DesktopStore(directory, {
    clock: () => new Date("2026-08-09T00:00:0" + tick++ + "Z")
  });
  store.initialize();
  for (let index = 0; index < 5; index += 1) {
    store.createBackup("b" + index);
  }
  assert.equal(fs.readdirSync(path.join(directory, "backups")).length, 3);
});

test("a validated backup can restore state after corruption", () => {
  const directory = temporaryDirectory();
  const store = new DesktopStore(directory);
  store.initialize();
  store.updateSettings({ updateChannel: "test" });
  const backupPath = store.createBackup("known-good");
  store.updateSettings({ updateChannel: "stable" });
  store.restoreBackup(path.basename(backupPath));
  assert.equal(store.state.settings.updateChannel, "test");
});
