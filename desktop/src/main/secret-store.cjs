"use strict";

const fs = require("node:fs");
const path = require("node:path");

class SecretStore {
  constructor(safeStorage, rootDir) {
    this.safeStorage = safeStorage;
    this.filePath = path.join(rootDir, "deepseek-key.bin");
  }

  available() {
    return Boolean(this.safeStorage?.isEncryptionAvailable());
  }

  has() {
    return fs.existsSync(this.filePath);
  }

  get() {
    if (!this.has()) return null;
    if (!this.available()) throw new Error("keychain_unavailable");
    return this.safeStorage.decryptString(fs.readFileSync(this.filePath));
  }

  set(value) {
    const key = String(value || "").trim();
    if (!key) throw new TypeError("api_key_is_required");
    if (!this.available()) throw new Error("keychain_unavailable");
    const encrypted = this.safeStorage.encryptString(key);
    fs.writeFileSync(this.filePath, encrypted, { mode: 0o600 });
  }

  remove() {
    if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
  }
}

module.exports = { SecretStore };
