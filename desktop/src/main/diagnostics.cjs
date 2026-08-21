"use strict";

const fs = require("node:fs");
const path = require("node:path");
const archiver = require("archiver");
const { sanitizeValue } = require("./crash-store.cjs");
const { redact } = require("./logger.cjs");

function sanitizeSnapshot(value) {
  return redact(value)
    .replace(/(<input[^>]+(?:type=["']?password|name=["']?(?:token|password|csrf))[^>]*)(?:value=["'][^"']*["'])/gi, "$1 value=\"[REDACTED]\"")
    .replace(/(localStorage|sessionStorage|document\.cookie)[\s\S]{0,300}/gi, "$1 [REDACTED]");
}

async function createDiagnosticZip({ filePath, state, health, logPath, crash, snapshot }) {
  const output = fs.createWriteStream(filePath, { mode: 0o600 });
  const archive = archiver("zip", { zlib: { level: 9 } });
  const completed = new Promise((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
  });
  archive.pipe(output);
  archive.append(JSON.stringify({
    generatedAt: new Date().toISOString(),
    health: sanitizeDiagnosticValue(health),
    crash: sanitizeDiagnosticValue(crash)
  }, null, 2), {
    name: "component-status.json"
  });
  archive.append(JSON.stringify(sanitizeDiagnosticValue(state), null, 2), { name: "application-state.json" });
  if (snapshot) archive.append(sanitizeSnapshot(snapshot), { name: "webpage-snapshot.html" });
  if (logPath && fs.existsSync(logPath)) {
    archive.append(redact(fs.readFileSync(logPath, "utf8")), { name: "logs/hdu-snap.log" });
  }
  await archive.finalize();
  await completed;
  return filePath;
}

function sanitizeDiagnosticValue(value) {
  return sanitizeValue(value);
}

function directorySize(directory) {
  if (!fs.existsSync(directory)) return 0;
  return fs.readdirSync(directory).reduce((sum, name) => {
    const item = path.join(directory, name);
    const stat = fs.statSync(item);
    return sum + (stat.isFile() ? stat.size : 0);
  }, 0);
}

module.exports = { createDiagnosticZip, directorySize, sanitizeDiagnosticValue, sanitizeSnapshot };
