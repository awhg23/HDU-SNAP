"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { redact } = require("./logger.cjs");

function sanitizeValue(value, seen = new WeakSet()) {
  if (value instanceof Error) {
    return {
      name: redact(value.name),
      message: redact(value.message),
      stack: redact(value.stack || "")
    };
  }
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return redact(value);
  if (typeof value !== "object") return redact(String(value));
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, seen));
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = /(deepseek|api[_-]?key|authorization|cookie|token|password|secret)/i.test(key)
      ? "[REDACTED]"
      : sanitizeValue(item, seen);
  }
  return result;
}

class CrashStore {
  constructor(directory, clock = () => new Date()) {
    this.directory = directory;
    this.clock = clock;
    this.filePath = path.join(directory, "last-crash.json");
    fs.mkdirSync(directory, { recursive: true });
  }

  record(kind, details) {
    const payload = {
      occurredAt: this.clock().toISOString(),
      kind: redact(kind),
      details: sanitizeValue(details)
    };
    const temporaryPath = this.filePath + ".tmp";
    fs.writeFileSync(temporaryPath, JSON.stringify(payload, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600
    });
    fs.renameSync(temporaryPath, this.filePath);
    return payload;
  }

  read() {
    if (!fs.existsSync(this.filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      return { kind: "invalid_crash_context", details: null };
    }
  }

  clear() {
    if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
  }
}

module.exports = { CrashStore, sanitizeValue };
