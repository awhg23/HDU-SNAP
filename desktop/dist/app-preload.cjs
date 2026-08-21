"use strict";

// src/preload/app.cjs
var { contextBridge, ipcRenderer } = require("electron");
var invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
contextBridge.exposeInMainWorld("hduSnap", Object.freeze({
  getState: () => invoke("app:get-state"),
  selfCheck: () => invoke("app:self-check"),
  finishOnboarding: () => invoke("app:finish-onboarding"),
  createTask: (payload) => invoke("task:create", payload),
  discardTask: () => invoke("task:discard"),
  browserNavigate: (payload) => invoke("browser:navigate", payload),
  browserBack: () => invoke("browser:back"),
  browserForward: () => invoke("browser:forward"),
  browserReload: () => invoke("browser:reload"),
  browserHome: () => invoke("browser:home"),
  browserVisible: (visible) => invoke("browser:visible", { visible }),
  clearBrowserSession: () => invoke("browser:clear-session"),
  startBatch: () => invoke("batch:start"),
  pauseBatch: () => invoke("batch:pause"),
  resumeBatch: () => invoke("batch:resume"),
  retryBatch: () => invoke("batch:retry"),
  stopBatch: () => invoke("batch:stop"),
  extendBatch: (count) => invoke("batch:extend", { count }),
  confirmSubmitted: () => invoke("batch:confirm-submitted"),
  listRecords: (filters) => invoke("records:list", filters),
  deleteRecords: (ids) => invoke("records:delete", { ids }),
  exportRecords: (payload) => invoke("records:export", payload),
  updateSettings: (payload) => invoke("settings:update", payload),
  keyStatus: () => invoke("key:status"),
  testKey: (apiKey) => invoke("key:test", { apiKey }),
  saveKey: (apiKey) => invoke("key:save", { apiKey }),
  removeKey: () => invoke("key:remove"),
  listPatches: () => invoke("patch:list"),
  updatePatch: (payload) => invoke("patch:update", payload),
  captureWrongQuestion: (payload) => invoke("patch:capture-current", payload),
  deletePatch: (payload) => invoke("patch:delete", payload),
  exportPatches: () => invoke("patch:export"),
  importPatches: (payload) => invoke("patch:import", payload),
  scanMigration: () => invoke("migration:scan"),
  importMigration: (payload) => invoke("migration:import", payload),
  diagnosticStatus: () => invoke("diagnostic:status"),
  exportDiagnostic: (payload) => invoke("diagnostic:export", payload),
  restoreBackup: (name) => invoke("diagnostic:restore-backup", { name }),
  clearLogs: () => invoke("diagnostic:clear-logs"),
  showLogs: () => invoke("diagnostic:show-logs"),
  checkUpdate: (manual = true) => invoke("update:check", { manual }),
  openLatestRelease: () => invoke("update:open-release"),
  resetAll: (confirmation) => invoke("data:reset-all", { confirmation }),
  onState: (listener) => {
    const wrapped = (_event, value) => listener(value);
    ipcRenderer.on("app:state", wrapped);
    return () => ipcRenderer.removeListener("app:state", wrapped);
  }
}));
