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
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.browserPartition, "persist:hdu-snap-profile-p1");
  assert.equal("profiles" in state, false);
  assert.equal("profileName" in state.batches[0], false);
  assert.equal("studentId" in state.batches[0], false);
  assert.equal(fs.readdirSync(path.join(directory, "backups")).length, 1);
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
