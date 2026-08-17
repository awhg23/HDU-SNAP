"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { LOG_MAX_BYTES, LOG_RETENTION_DAYS } = require("../shared/constants.cjs");

function redact(value) {
  return String(value == null ? "" : value)
    .replace(/(deepseek|api[_-]?key|authorization|cookie|token|password)(\s*[=:]\s*)[^\s,;]+/gi, "$1$2[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED_KEY]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]");
}

class LocalLogger {
  constructor(directory, clock = () => new Date()) {
    this.directory = directory;
    this.clock = clock;
    fs.mkdirSync(directory, { recursive: true });
    this.filePath = path.join(directory, "hdu-snap.log");
    this.prune();
  }

  prune() {
    const now = this.clock().getTime();
    const maxAge = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const entries = fs.readdirSync(this.directory)
      .filter((name) => name.endsWith(".log"))
      .map((name) => {
        const filePath = path.join(this.directory, name);
        return { filePath, stat: fs.statSync(filePath) };
      })
      .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
    let total = entries.reduce((sum, item) => sum + item.stat.size, 0);
    for (const item of entries) {
      if (now - item.stat.mtimeMs > maxAge || total > LOG_MAX_BYTES) {
        fs.unlinkSync(item.filePath);
        total -= item.stat.size;
      }
    }
  }

  write(level, message, detail = "") {
    const line = [this.clock().toISOString(), level.toUpperCase(), redact(message), redact(detail)]
      .filter(Boolean)
      .join(" ") + "\n";
    fs.appendFileSync(this.filePath, line, { encoding: "utf8", mode: 0o600 });
  }

  info(message, detail) { this.write("info", message, detail); }
  warn(message, detail) { this.write("warn", message, detail); }
  error(message, detail) { this.write("error", message, detail); }
}

module.exports = { LocalLogger, redact };
