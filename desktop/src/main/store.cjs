"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  BATCH_STATUS,
  BROWSER_PARTITION,
  MAX_BATCH_RECORDS,
  SCHEMA_VERSION,
  SUPPORTED_SITE_URLS
} = require("../shared/constants.cjs");

class NewerSchemaError extends Error {}

function withoutAccountIdentity(batch) {
  if (!batch || typeof batch !== "object") return batch;
  const clean = structuredClone(batch);
  delete clean.profileId;
  delete clean.profileName;
  delete clean.studentId;
  return clean;
}

function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    onboardingComplete: false,
    settings: {
      learningHome: SUPPORTED_SITE_URLS[0],
      updateChannel: "stable",
      lastUpdateCheckAt: null
    },
    browserPartition: BROWSER_PARTITION,
    batches: [],
    migrationFingerprints: [],
    activeBatch: null
  };
}

function sanitizeSettings(value) {
  const defaults = defaultState().settings;
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    learningHome: SUPPORTED_SITE_URLS.includes(candidate.learningHome)
      ? candidate.learningHome
      : defaults.learningHome,
    updateChannel: ["stable", "test"].includes(candidate.updateChannel)
      ? candidate.updateChannel
      : defaults.updateChannel,
    lastUpdateCheckAt: candidate.lastUpdateCheckAt === null || typeof candidate.lastUpdateCheckAt === "string"
      ? candidate.lastUpdateCheckAt
      : defaults.lastUpdateCheckAt
  };
}

class DesktopStore {
  constructor(rootDir, options = {}) {
    this.rootDir = path.resolve(rootDir);
    this.filePath = path.join(this.rootDir, "state.json");
    this.backupDir = path.join(this.rootDir, "backups");
    this.clock = options.clock || (() => new Date());
    this.maxBatches = options.maxBatches || MAX_BATCH_RECORDS;
    this.state = null;
  }

  initialize() {
    fs.mkdirSync(this.rootDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.state = defaultState();
      this.save();
      return this.snapshot();
    }
    const payload = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    const version = Number(payload.schemaVersion || 0);
    if (version > SCHEMA_VERSION) {
      throw new NewerSchemaError(
        "data schema " + version + " is newer than supported " + SCHEMA_VERSION
      );
    }
    if (version < SCHEMA_VERSION) {
      this.createBackup("schema-" + version);
      this.state = this.migrate(payload, version);
      this.save();
    } else {
      this.state = {
        ...defaultState(),
        ...payload,
        settings: sanitizeSettings(payload.settings)
      };
    }
    this.state.settings = sanitizeSettings(this.state.settings);
    if (typeof this.state.browserPartition !== "string" || !this.state.browserPartition.startsWith("persist:hdu-snap-")) {
      throw new TypeError("invalid browser partition in application data");
    }
    delete this.state.profiles;
    this.state.batches = (Array.isArray(this.state.batches) ? this.state.batches : []).map(withoutAccountIdentity);
    this.state.activeBatch = withoutAccountIdentity(this.state.activeBatch);
    this.recoverInterruptedBatch();
    this.enforceBatchLimit();
    this.save();
    return this.snapshot();
  }

  migrate(payload, version) {
    const next = {
      ...defaultState(),
      ...payload,
      settings: sanitizeSettings(payload.settings)
    };
    if (version < 1) {
      next.schemaVersion = 1;
      next.migrationFingerprints = Array.isArray(next.migrationFingerprints)
        ? next.migrationFingerprints
        : [];
    }
    if (version < 2) {
      const legacyProfiles = Array.isArray(next.profiles) ? next.profiles : [];
      const activeProfileId = next.activeBatch?.profileId;
      const preferredProfile = legacyProfiles.find((item) => item.id === activeProfileId)
        || legacyProfiles.find((item) => item.pending === false)
        || legacyProfiles[0];
      if (preferredProfile?.partition?.startsWith("persist:hdu-snap-profile-")) {
        next.browserPartition = preferredProfile.partition;
      }
      delete next.profiles;
      next.batches = (Array.isArray(next.batches) ? next.batches : []).map(withoutAccountIdentity);
      next.activeBatch = withoutAccountIdentity(next.activeBatch);
      next.schemaVersion = 2;
    }
    if (version < 3) {
      delete next.settings.updateManifestUrl;
      next.schemaVersion = 3;
    }
    return next;
  }

  createBackup(label = "manual") {
    if (!fs.existsSync(this.filePath)) {
      return null;
    }
    const stamp = this.clock().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(this.backupDir, stamp + "-" + label + ".json");
    fs.copyFileSync(this.filePath, backupPath);
    const backups = fs.readdirSync(this.backupDir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .reverse();
    for (const oldName of backups.slice(3)) {
      fs.unlinkSync(path.join(this.backupDir, oldName));
    }
    return backupPath;
  }

  listBackups() {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs.readdirSync(this.backupDir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .reverse();
  }

  restoreBackup(name) {
    if (!this.listBackups().includes(name)) throw new Error("backup not found");
    const backupPath = path.join(this.backupDir, name);
    const payload = JSON.parse(fs.readFileSync(backupPath, "utf8"));
    if (Number(payload.schemaVersion || 0) > SCHEMA_VERSION) {
      throw new NewerSchemaError("backup schema is newer than this application");
    }
    const content = JSON.stringify(payload, null, 2) + "\n";
    this.createBackup("before-restore");
    const tempPath = this.filePath + ".restore.tmp";
    fs.writeFileSync(tempPath, content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempPath, this.filePath);
    return this.initialize();
  }

  recoverInterruptedBatch() {
    if (!this.state.activeBatch) {
      return;
    }
    const batch = structuredClone(this.state.activeBatch);
    if ([BATCH_STATUS.FINAL_PENDING, BATCH_STATUS.CONFIRMING_SUBMISSION].includes(batch.status)) {
      batch.status = BATCH_STATUS.SUBMISSION_UNCONFIRMED;
    } else {
      batch.status = BATCH_STATUS.INTERRUPTED;
    }
    batch.endedAt = this.clock().toISOString();
    this.state.activeBatch = null;
    this.state.batches.unshift(batch);
  }

  save() {
    if (!this.state) {
      throw new Error("store is not initialized");
    }
    const tempPath = this.filePath + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600
    });
    fs.renameSync(tempPath, this.filePath);
  }

  snapshot() {
    return structuredClone(this.state);
  }

  setOnboardingComplete(value) {
    this.state.onboardingComplete = Boolean(value);
    this.save();
  }

  updateSettings(patch) {
    const allowed = {};
    if (SUPPORTED_SITE_URLS.includes(patch.learningHome)) {
      allowed.learningHome = patch.learningHome;
    }
    if (["stable", "test"].includes(patch.updateChannel)) {
      allowed.updateChannel = patch.updateChannel;
    }
    if (patch.lastUpdateCheckAt === null || typeof patch.lastUpdateCheckAt === "string") {
      allowed.lastUpdateCheckAt = patch.lastUpdateCheckAt;
    }
    this.state.settings = { ...this.state.settings, ...allowed };
    this.save();
    return structuredClone(this.state.settings);
  }

  setActiveBatch(batch) {
    if (this.state.activeBatch && this.state.activeBatch.id !== batch.id) {
      throw new Error("another batch is already active");
    }
    this.state.activeBatch = withoutAccountIdentity(batch);
    this.save();
  }

  clearActiveBatch(id) {
    if (this.state.activeBatch && (!id || this.state.activeBatch.id === id)) {
      this.state.activeBatch = null;
      this.save();
      return true;
    }
    return false;
  }

  finalizeActiveBatch(batch) {
    this.state.activeBatch = null;
    this.state.batches.unshift(withoutAccountIdentity(batch));
    this.enforceBatchLimit();
    this.save();
  }

  addImportedBatch(batch) {
    this.state.batches.push(withoutAccountIdentity(batch));
    this.state.batches.sort((left, right) =>
      String(right.startedAt || right.endedAt || "").localeCompare(
        String(left.startedAt || left.endedAt || "")
      )
    );
    this.enforceBatchLimit();
    this.save();
  }

  enforceBatchLimit() {
    if (this.state.batches.length > this.maxBatches) {
      this.state.batches.length = this.maxBatches;
    }
  }

  listBatches(filters = {}) {
    const pageSize = 50;
    const items = this.filterBatches(filters);
    const total = items.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const requestedPage = Math.max(1, Math.trunc(Number(filters.page || 1)) || 1);
    const page = Math.min(requestedPage, pageCount);
    const offset = (page - 1) * pageSize;
    return {
      items: structuredClone(items.slice(offset, offset + pageSize)),
      page,
      pageSize,
      total,
      pageCount
    };
  }

  filterBatches(filters = {}) {
    const dateFrom = parseLocalDateBoundary(filters.dateFrom, false);
    const dateTo = parseLocalDateBoundary(filters.dateTo, true);
    if (dateFrom !== null && dateTo !== null && dateFrom >= dateTo) {
      throw new TypeError("record date range is invalid");
    }
    const items = this.state.batches.filter((batch) => {
      if (filters.status && batch.status !== filters.status) return false;
      const timestamp = Date.parse(batch.startedAt || batch.endedAt || "");
      if ((dateFrom !== null || dateTo !== null) && !Number.isFinite(timestamp)) return false;
      if (dateFrom !== null && timestamp < dateFrom) return false;
      if (dateTo !== null && timestamp >= dateTo) return false;
      return true;
    });
    return items.sort((left, right) =>
      String(right.startedAt || right.endedAt || "").localeCompare(
        String(left.startedAt || left.endedAt || "")
      )
    );
  }

  listAllBatches(filters = {}) {
    return structuredClone(this.filterBatches(filters));
  }

  deleteBatches(ids) {
    const selected = new Set(Array.isArray(ids) ? ids : []);
    const before = this.state.batches.length;
    this.state.batches = this.state.batches.filter((batch) => !selected.has(batch.id));
    this.save();
    return before - this.state.batches.length;
  }

  fingerprintMigrationSource(sourcePath, stats = "") {
    return createHash("sha256")
      .update(path.resolve(sourcePath))
      .update(String(stats))
      .digest("hex");
  }

  hasMigrationFingerprint(value) {
    return this.state.migrationFingerprints.includes(value);
  }

  addMigrationFingerprint(value) {
    if (!this.hasMigrationFingerprint(value)) {
      this.state.migrationFingerprints.push(value);
      this.save();
    }
  }
}

function parseLocalDateBoundary(value, endExclusive) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) throw new TypeError("record date must use YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day + (endExclusive ? 1 : 0));
  const check = new Date(year, month - 1, day);
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) {
    throw new TypeError("record date is invalid");
  }
  return date.getTime();
}

module.exports = {
  DesktopStore,
  NewerSchemaError,
  defaultState,
  parseLocalDateBoundary,
  sanitizeSettings
};
