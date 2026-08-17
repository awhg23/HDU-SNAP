"use strict";

const fs = require("node:fs");

function csvCell(value) {
  const text = String(value == null ? "" : value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function exportBatchCsv(filePath, batches) {
  const headers = ["时间", "目标题量", "实际题量", "状态", "提交确认", "站点成绩"];
  const rows = batches.map((batch) => [
    batch.startedAt || batch.endedAt || "",
    batch.targetCount || 0,
    batch.answeredCount || 0,
    batch.status || "",
    batch.submissionConfirmation || "",
    batch.siteScore || ""
  ]);
  const content = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  fs.writeFileSync(filePath, "\ufeff" + content, { encoding: "utf8", mode: 0o600 });
}

function exportBatchJson(filePath, batches) {
  const sanitized = batches.map((batch) => {
    const clean = structuredClone(batch);
    delete clean.profileId;
    delete clean.profileName;
    delete clean.studentId;
    delete clean.mode;
    delete clean.reviewStatus;
    delete clean.reviewCounts;
    delete clean.debugItems;
    return clean;
  });
  fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, batches: sanitized }, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600
  });
}

module.exports = { exportBatchCsv, exportBatchJson };
