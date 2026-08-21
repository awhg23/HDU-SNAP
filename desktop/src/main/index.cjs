"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  powerMonitor,
  safeStorage,
  shell
} = require("electron");
const { BatchMachine } = require("../shared/batch-machine.cjs");
const {
  BATCH_STATUS,
  DEFAULT_AUTOMATION_CONFIG,
  PAGE_EXECUTION_GRACE_MS,
  SUPPORTED_SITE_URLS,
  UPDATE_MANIFEST_URL
} = require("../shared/constants.cjs");
const { isSupportedAutomationUrl, positiveInteger, requirePlainObject, validateOptions } = require("../shared/validation.cjs");
const { BrowserController } = require("./browser-controller.cjs");
const { CoreSupervisor } = require("./core-supervisor.cjs");
const { CrashStore } = require("./crash-store.cjs");
const { createDiagnosticZip, directorySize } = require("./diagnostics.cjs");
const { exportBatchCsv, exportBatchJson } = require("./exports.cjs");
const { LocalLogger } = require("./logger.cjs");
const { readPatchRulesFile, scanLegacyProject } = require("./migration.cjs");
const { SecretStore } = require("./secret-store.cjs");
const { SidecarClient } = require("./sidecar-client.cjs");
const { DesktopStore, defaultState } = require("./store.cjs");
const { fetchManifest, isAllowedReleaseUrl, shouldCheck } = require("./update-checker.cjs");

let mainWindow;
let browser;
let store;
let logger;
let crashStore;
let secrets;
let core;
let coreSupervisor;
let coreHealth = null;
let coreError = null;
let machine = null;
let answerHistory = [];
let pageState = { url: "", supported: false, questionReady: false };
let pendingPatchImport = null;
let lastMigrationScan = null;
let pendingWrongQuestionCapture = null;
let wrongQuestionCaptureSequence = 0;
let submissionTimer = null;
let pageUnavailableTimer = null;
let appQuitting = false;
let storeBootError = null;
let updateResult = null;

process.on("uncaughtExceptionMonitor", (error, origin) => {
  try {
    crashStore?.record("main_process_exception", { origin, error });
  } catch {
    // Do not mask the original fatal exception if crash-context persistence fails.
  }
});

const desktopRoot = path.resolve(__dirname, "../..");
const projectRoot = path.resolve(desktopRoot, "..");
const userDataArgument = process.argv.find((value) => value.startsWith("--hdu-snap-user-data-dir="));
if (!app.isPackaged && userDataArgument) {
  const requestedPath = userDataArgument.slice("--hdu-snap-user-data-dir=".length).trim();
  if (requestedPath) app.setPath("userData", path.resolve(requestedPath));
}
const ownsSingleInstanceLock = app.requestSingleInstanceLock();
if (!ownsSingleInstanceLock) app.quit();

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function resourceRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "prepared", "core-resources")
    : projectRoot;
}

function sidecarLaunch() {
  if (app.isPackaged) {
    return {
      command: path.join(process.resourcesPath, "prepared", "sidecar", "hdu-snap-sidecar", "hdu-snap-sidecar"),
      args: []
    };
  }
  const venvPython = path.join(projectRoot, ".venv", "bin", "python");
  return { command: fs.existsSync(venvPython) ? venvPython : "python3", args: ["-m", "hdu_snap.sidecar"] };
}

function dataRoot() { return path.join(app.getPath("userData"), "data"); }
function logRoot() { return path.join(app.getPath("userData"), "logs"); }

function publicState() {
  return {
    ready: Boolean(store && mainWindow),
    blocked: storeBootError,
    version: app.getVersion(),
    packaged: app.isPackaged,
    data: store ? store.snapshot() : null,
    core: coreHealth,
    coreError,
    update: updateResult,
    page: { ...pageState },
    canStart: Boolean(
      coreHealth?.ok && !coreError && machine?.state.status === BATCH_STATUS.READY
      && pageState.questionReady
    ),
    answerHistory: structuredClone(answerHistory),
    browserOpen: Boolean(browser?.view),
    keyConfigured: secrets?.has() || false,
    paths: { data: dataRoot(), logs: logRoot() }
  };
}

function publish() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("app:state", publicState());
}

function persistMachine() {
  if (machine) store.setActiveBatch(machine.snapshot());
  publish();
}

function coreInitializationParams() {
  return {
    data_dir: dataRoot(),
    resource_dir: resourceRoot(),
    api_key: secrets.get()
  };
}

function ensureCoreSupervisor() {
  if (coreSupervisor) return coreSupervisor;
  const launch = sidecarLaunch();
  const cleanEnv = { ...process.env, DEEPSEEK_API_KEY: "", HDU_SNAP_LLM_API_KEY: "" };
  core = new SidecarClient(launch.command, launch.args, {
    cwd: projectRoot,
    env: cleanEnv,
    logger
  });
  coreSupervisor = new CoreSupervisor(core, {
    initializeParams: coreInitializationParams,
    initializeTimeoutMs: 120_000,
    logger
  });
  coreSupervisor.on("state", ({ health, error }) => {
    coreHealth = health;
    coreError = error;
    publish();
  });
  return coreSupervisor;
}

async function initializeCore(force = false) {
  return ensureCoreSupervisor().initialize({ force });
}

async function reinitializeCore() { return initializeCore(true); }

async function coreRequest(method, params = {}, timeoutMs = 30_000) {
  return ensureCoreSupervisor().request(method, params, timeoutMs);
}

function requestWrongQuestionCapture() {
  if (pendingWrongQuestionCapture) throw new Error("正在扫描当前错题，请稍候");
  const requestId = `wrong-question-${Date.now()}-${++wrongQuestionCaptureSequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingWrongQuestionCapture?.requestId !== requestId) return;
      pendingWrongQuestionCapture = null;
      reject(new Error("扫描当前错题超时，请确认结果页已完整显示后重试"));
    }, 5_000);
    pendingWrongQuestionCapture = { requestId, resolve, reject, timer };
    browser.send("capture-wrong-question", { requestId });
  });
}

function handleBrowserFailure(value) {
  const failure = value?.crashed
    ? { kind: "web_process_crash", details: value.crashDetails || null }
    : value?.loadError
      ? { kind: "web_load_failure", details: value.loadError }
      : value?.unavailable
        ? { kind: "web_page_unavailable", details: value.unavailable }
      : null;
  if (!failure) return false;
  clearTimeout(pageUnavailableTimer);
  pageUnavailableTimer = null;
  if (failure.details?.url) {
    try {
      const parsed = new URL(failure.details.url);
      failure.details = { ...failure.details, url: parsed.origin + parsed.pathname };
    } catch {
      failure.details = { ...failure.details, url: "[INVALID_URL]" };
    }
  }
  crashStore?.record(failure.kind, failure.details);
  logger?.warn(failure.kind, JSON.stringify(failure.details || {}));
  if (machine?.state.status === BATCH_STATUS.RUNNING) {
    machine.pause(failure.kind);
    browser?.send("pause");
    persistMachine();
  } else {
    publish();
  }
  return true;
}

function monitorPageExecutable() {
  clearTimeout(pageUnavailableTimer);
  pageUnavailableTimer = null;
  if (machine?.state.status !== BATCH_STATUS.RUNNING) return;
  if (pageState.supported && pageState.questionReady) return;
  pageUnavailableTimer = setTimeout(() => {
    pageUnavailableTimer = null;
    if (machine?.state.status !== BATCH_STATUS.RUNNING) return;
    if (pageState.supported && pageState.questionReady) return;
    handleBrowserFailure({
      unavailable: {
        url: pageState.url || "",
        reason: pageState.supported ? "question_dom_unavailable" : "unsupported_page"
      }
    });
  }, PAGE_EXECUTION_GRACE_MS);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    title: "HDU-SNAP",
    backgroundColor: "#f2eadc",
    show: false,
    webPreferences: {
      preload: path.join(desktopRoot, "dist", "app-preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(desktopRoot, "dist", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.on("close", () => {
    browser?.destroy();
    browser = null;
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  browser = new BrowserController(mainWindow, {
    preloadPath: path.join(desktopRoot, "dist", "site-preload.cjs"),
    partition: store.state.browserPartition,
    logger,
    onState: (value) => {
      pageState = { ...pageState, ...value };
      monitorPageExecutable();
      if (!handleBrowserFailure(value)) publish();
    },
    onHttpBlocked: (url) => {
      pageState = { ...pageState, pendingHttpUrl: url };
      publish();
    }
  });
}

function register(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return await handler(payload, event);
    } catch (error) {
      logger?.warn("IPC " + channel + " failed", error.message);
      return { ok: false, error: error.message };
    }
  });
}

async function checkNetwork(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await net.fetch(url, { method: "GET", signal: controller.signal });
    return response.status > 0 && response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkForUpdates(manual = false) {
  const settings = store.state.settings;
  if (!manual && !shouldCheck(settings.lastUpdateCheckAt)) {
    return { status: "throttled", latest: updateResult?.latest || null };
  }
  store.updateSettings({ lastUpdateCheckAt: new Date().toISOString() });
  const result = await fetchManifest(
    UPDATE_MANIFEST_URL,
    settings.updateChannel,
    app.getVersion()
  );
  updateResult = result;
  publish();
  return result;
}

async function selfCheck() {
  if (storeBootError) throw new Error("数据结构故障尚未恢复");
  if (!coreHealth?.ok) {
    try {
      await initializeCore();
    } catch {
      // The checks below preserve the core supervisor's actionable failure state.
    }
  }
  const major = Number(os.release().split(".")[0]);
  const dictionaryPath = path.join(resourceRoot(), "CET", "Data.lexicon.cache.json");
  const patchRulesPath = path.join(resourceRoot(), "patch_rules.jsonc");
  const checks = {
    system: process.platform === "darwin" && process.arch === "arm64" && major >= 22,
    core: Boolean(coreHealth?.checks?.dictionary && coreHealth?.checks?.patch_bundle),
    dictionary: fs.existsSync(dictionaryPath) && fs.existsSync(patchRulesPath),
    dataDirectory: fs.existsSync(dataRoot()) && fs.statSync(dataRoot()).isDirectory(),
    webComponent: Boolean(browser),
    targetNetwork: await checkNetwork(store.state.settings.learningHome),
    keychain: secrets.available(),
    deepseek: secrets.has() ? Boolean(coreHealth?.deepseek_configured) : null
  };
  return { ok: Object.entries(checks).filter(([key]) => !["deepseek"].includes(key)).every(([, value]) => value), checks };
}

function configureSite() {
  if (!machine) return;
  browser.send("configure", {
    targetCount: machine.state.targetCount,
    answeredCount: machine.state.answeredCount,
    scanDebounceMs: DEFAULT_AUTOMATION_CONFIG.scanDebounceMs,
    minDelayMs: DEFAULT_AUTOMATION_CONFIG.minActionDelayMs,
    maxDelayMs: DEFAULT_AUTOMATION_CONFIG.maxActionDelayMs
  });
}

function completeBatch(confirmation, score = null) {
  if (!machine) return;
  clearTimeout(submissionTimer);
  machine.complete(confirmation, score);
  store.finalizeActiveBatch(machine.snapshot());
  machine = null;
  browser.setLocked(false);
  publish();
}

function registerIpc() {
  register("app:get-state", () => publicState());
  register("app:self-check", () => selfCheck());
  register("app:finish-onboarding", async () => {
    const result = await selfCheck();
    if (!result.ok) throw new Error("必需自检尚未全部通过");
    store.setOnboardingComplete(true);
    publish();
    return { ok: true };
  });

  register("task:create", async (payload) => {
    requirePlainObject(payload);
    if (machine || store.state.activeBatch) throw new Error("已有未结束批次");
    answerHistory = [];
    machine = new BatchMachine({
      answerCount: positiveInteger(payload.answerCount, "answerCount")
    });
    pageState = { url: "", supported: false, questionReady: false };
    try {
      await browser.open(store.state.settings.learningHome);
      configureSite();
      persistMachine();
      return { ok: true, batch: machine.snapshot(), state: publicState() };
    } catch (error) {
      machine = null;
      answerHistory = [];
      throw error;
    }
  });
  register("task:discard", () => {
    if (!machine || machine.state.status !== BATCH_STATUS.READY) throw new Error("只能放弃尚未开始的批次");
    browser.send("stop");
    browser.setLocked(false);
    store.clearActiveBatch(machine.state.id);
    machine = null;
    answerHistory = [];
    publish();
    return { ok: true };
  });

  register("browser:navigate", async (payload) => {
    const result = await browser.navigate(payload?.url, payload?.httpConfirmed === true);
    return { ok: true, ...result };
  });
  register("browser:back", () => { browser.back(); return { ok: true }; });
  register("browser:forward", () => { browser.forward(); return { ok: true }; });
  register("browser:reload", () => { browser.reload(); return { ok: true }; });
  register("browser:home", async () => {
    const result = await browser.navigate(store.state.settings.learningHome, false);
    return { ok: true, ...result };
  });
  register("browser:visible", (payload) => {
    if (payload?.visible) browser.show(); else browser.hide();
    return { ok: true };
  });
  register("browser:clear-session", async () => {
    if (store.state.activeBatch) throw new Error("请先结束当前批次");
    await browser.clearSession();
    if (browser.view) await browser.navigate(store.state.settings.learningHome, false);
    return { ok: true };
  });

  register("batch:start", async () => {
    if (!machine || !pageState.questionReady) throw new Error("识别题目页后才能开始");
    const health = await initializeCore();
    if (!health?.ok) throw new Error("答题核心尚未就绪，请到诊断页重新检查");
    machine.start();
    configureSite();
    browser.setLocked(true);
    browser.send("start");
    persistMachine();
    return { ok: true };
  });
  register("batch:pause", () => {
    if (!machine) throw new Error("没有活动批次");
    machine.pause("user");
    browser.send("pause");
    persistMachine();
    return { ok: true };
  });
  const resume = async () => {
    if (!machine || !pageState.questionReady) throw new Error("重新识别题目页失败");
    const health = await initializeCore();
    if (!health?.ok) throw new Error("答题核心尚未就绪，请到诊断页重新检查");
    machine.start();
    configureSite();
    browser.send("resume");
    persistMachine();
    return { ok: true };
  };
  register("batch:resume", resume);
  register("batch:retry", resume);
  register("batch:stop", () => {
    if (!machine) throw new Error("没有活动批次");
    machine.stop("user");
    browser.send("stop");
    browser.setLocked(false);
    store.finalizeActiveBatch(machine.snapshot());
    machine = null;
    publish();
    return { ok: true };
  });
  register("batch:extend", (payload) => {
    if (!machine) throw new Error("没有活动批次");
    machine.extend(positiveInteger(payload?.count, "count"));
    configureSite();
    browser.setLocked(true);
    browser.send("resume");
    persistMachine();
    return { ok: true };
  });
  register("batch:confirm-submitted", () => {
    if (!machine || ![BATCH_STATUS.FINAL_PENDING, BATCH_STATUS.CONFIRMING_SUBMISSION].includes(machine.state.status)) {
      throw new Error("当前批次不在待提交状态");
    }
    if (!machine.state.submissionTimedOut) throw new Error("请先等待 15 秒自动识别完成");
    completeBatch("manual", null);
    return { ok: true };
  });

  register("records:list", (filters) => ({ ok: true, ...store.listBatches(filters || {}) }));
  register("records:delete", (payload) => ({ ok: true, deleted: store.deleteBatches(payload?.ids || []) }));
  register("records:export", async (payload) => {
    if (payload?.privacyConfirmed !== true) throw new Error("导出前必须确认隐私风险");
    const format = payload?.format === "json" ? "json" : "csv";
    const batches = store.listAllBatches(payload?.filters || {});
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: "HDU-SNAP-记录." + format,
      filters: [{ name: format.toUpperCase(), extensions: [format] }]
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    if (format === "json") exportBatchJson(result.filePath, batches);
    else exportBatchCsv(result.filePath, batches);
    return { ok: true, filePath: result.filePath };
  });

  register("settings:update", (payload) => {
    const settings = store.updateSettings(payload || {});
    publish();
    return { ok: true, settings };
  });
  register("key:status", () => ({ ok: true, configured: secrets.has(), available: secrets.available() }));
  register("key:test", async (payload) => {
    await coreRequest("check_api_key", { api_key: String(payload?.apiKey || "") }, 30_000);
    return { ok: true };
  });
  register("key:save", async (payload) => {
    const value = String(payload?.apiKey || "").trim();
    await coreRequest("check_api_key", { api_key: value }, 30_000);
    secrets.set(value);
    await reinitializeCore();
    return { ok: true };
  });
  register("key:remove", async () => {
    secrets.remove();
    await reinitializeCore();
    return { ok: true };
  });

  register("patch:list", async () => ({ ok: true, ...(await coreRequest("patch_list")) }));
  register("patch:update", async (payload) => ({ ok: true, ...(await coreRequest("patch_update", payload || {})) }));
  register("patch:capture-current", async (payload) => {
    if (!pageState.supported || !pageState.resultPage) {
      throw new Error("请先在支持的学习站点中打开答题结果页");
    }
    const scanned = requirePlainObject(await requestWrongQuestionCapture(), "scanned question");
    if (scanned.ok !== true) throw new Error(String(scanned.error || "当前页面未识别到错题"));
    const sourceText = String(scanned.sourceText || "").replace(/\s+/g, " ").trim();
    if (!sourceText || sourceText.length > 500) throw new Error("当前错题的题目文本无效");
    const options = validateOptions(scanned.options);
    const correctTarget = String(scanned.correctTarget || "").toUpperCase();
    if (!/^[A-D]$/.test(correctTarget)) throw new Error("未识别到合法的正确答案");
    const wrongTargetValue = String(scanned.wrongTarget || "").toUpperCase();
    const wrongTarget = /^[A-D]$/.test(wrongTargetValue) && wrongTargetValue !== correctTarget
      ? wrongTargetValue
      : null;
    const itemId = positiveInteger(scanned.itemId, "itemId");
    const answerText = options[correctTarget];
    const wrongAnswerText = wrongTarget ? options[wrongTarget] : "";
    const noteParts = [`Mac App 手动记录错题：第 ${itemId} 题`, `正确 ${correctTarget}`];
    if (wrongTarget) noteParts.push(`错选 ${wrongTarget}`);
    const patchResult = await coreRequest("patch_update", {
      source_text: sourceText,
      answer_text: answerText,
      wrong_answer_text: wrongAnswerText,
      note: noteParts.join(" · "),
      skip_duplicate: true,
      confirm_conflict: payload?.confirmConflict === true
    });
    return {
      ok: true,
      status: patchResult.status,
      existingRules: patchResult.existing_rules || [],
      itemId,
      sourceText,
      answerText,
      correctTarget,
      wrongTarget
    };
  });
  register("patch:delete", async (payload) => ({ ok: true, ...(await coreRequest("patch_delete", payload || {})) }));
  register("patch:export", async () => {
    const rules = (await coreRequest("patch_list")).rules;
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: "HDU-SNAP-纠错.json" });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify({ schemaVersion: 1, rules }, null, 2), { mode: 0o600 });
    return { ok: true, filePath: result.filePath };
  });
  register("patch:import", async (payload) => {
    if (payload?.confirm === true && pendingPatchImport) {
      let applied = 0;
      for (const candidate of pendingPatchImport.candidates) {
        if (candidate.action === "skip") continue;
        await coreRequest("patch_update", candidate.rule);
        applied += 1;
      }
      pendingPatchImport = null;
      return { ok: true, applied };
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "纠错规则", extensions: ["json", "jsonc"] }]
    });
    if (result.canceled) return { ok: true, canceled: true };
    const incoming = readPatchRulesFile(result.filePaths[0]);
    const existing = (await coreRequest("patch_list")).rules;
    const candidates = incoming.rules.map((rule) => {
      const matches = existing.filter((item) => item.source_text === rule.source_text);
      const duplicate = matches.some((item) => item.answer_text === rule.answer_text);
      return { rule, status: duplicate ? "duplicate" : matches.length ? "conflict" : "new", action: duplicate ? "skip" : matches.length ? "skip" : "replace" };
    });
    pendingPatchImport = { filePath: result.filePaths[0], candidates };
    return { ok: true, preview: pendingPatchImport };
  });

  register("migration:scan", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
    if (result.canceled) return { ok: true, canceled: true };
    const scan = scanLegacyProject(result.filePaths[0]);
    const fingerprint = store.fingerprintMigrationSource(scan.root, scan.stats);
    lastMigrationScan = { ...scan, fingerprint };
    return { ok: true, root: scan.root, fingerprint, alreadyImported: store.hasMigrationFingerprint(fingerprint), summary: scan.summary, rules: scan.rules };
  });
  register("migration:import", async (payload) => {
    if (!lastMigrationScan) throw new Error("请先扫描旧项目目录");
    if (store.hasMigrationFingerprint(lastMigrationScan.fingerprint)) return { ok: true, skipped: true };
    for (const rule of lastMigrationScan.rules) await coreRequest("patch_update", rule);
    if (payload?.includeKey && lastMigrationScan.apiKey) {
      await coreRequest("check_api_key", { api_key: lastMigrationScan.apiKey }, 30_000);
      secrets.set(lastMigrationScan.apiKey);
      await reinitializeCore();
    }
    store.addMigrationFingerprint(lastMigrationScan.fingerprint);
    publish();
    return { ok: true, imported: lastMigrationScan.summary };
  });

  register("diagnostic:status", () => ({
    ok: true,
    logBytes: directorySize(logRoot()),
    logPath: logger.filePath,
    lastCrash: crashStore.read()
      || store.state.batches.find((batch) => batch.status === BATCH_STATUS.INTERRUPTED)
      || null,
    core: coreHealth,
    backups: store.listBackups(),
    blocked: storeBootError
  }));
  register("diagnostic:restore-backup", async (payload) => {
    store.restoreBackup(String(payload?.name || ""));
    storeBootError = null;
    await initializeCore();
    publish();
    return { ok: true };
  });
  register("diagnostic:show-logs", () => { shell.showItemInFolder(logger.filePath); return { ok: true }; });
  register("diagnostic:clear-logs", () => {
    if (fs.existsSync(logger.filePath)) fs.truncateSync(logger.filePath, 0);
    return { ok: true };
  });
  register("diagnostic:export", async (payload) => {
    if (payload?.privacyConfirmed !== true) throw new Error("请先确认诊断包含个人与答题数据");
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: "HDU-SNAP-诊断.zip" });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    const snapshot = await browser.htmlSnapshot().catch(() => "");
    await createDiagnosticZip({
      filePath: result.filePath,
      state: store.snapshot(),
      health: coreHealth,
      logPath: logger.filePath,
      crash: crashStore.read(),
      snapshot
    });
    return { ok: true, filePath: result.filePath };
  });

  register("update:check", async (payload) => {
    return { ok: true, ...(await checkForUpdates(payload?.manual === true)) };
  });
  register("update:open-release", async () => {
    const release = updateResult?.latest;
    if (!release || !isAllowedReleaseUrl(release.release_url, release.version)) {
      throw new Error("没有可打开的安全 Release 链接");
    }
    await shell.openExternal(release.release_url);
    return { ok: true };
  });

  register("data:reset-all", async (payload) => {
    if (payload?.confirmation !== "重置 HDU-SNAP") throw new Error("确认文本不正确");
    if (store.state.activeBatch) throw new Error("请先停止当前批次");
    await browser.clearSession();
    secrets.remove();
    browser.destroyView();
    answerHistory = [];
    pageState = { url: "", supported: false, questionReady: false };
    crashStore.clear();
    for (const filePath of [store.filePath, path.join(dataRoot(), "hdu_snap.db"), path.join(dataRoot(), "patch_rules.jsonc")]) {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
    }
    for (const name of store.listBackups()) {
      const backupPath = path.join(store.backupDir, name);
      if (fs.existsSync(backupPath) && fs.statSync(backupPath).isFile()) fs.unlinkSync(backupPath);
    }
    if (fs.existsSync(logger.filePath)) fs.truncateSync(logger.filePath, 0);
    store.initialize();
    await reinitializeCore();
    publish();
    return { ok: true };
  });
}

function registerSiteEvents() {
  ipcMain.on("site:event", async (event, message) => {
    if (!browser?.matchesSender(event.sender) || !message || typeof message !== "object") return;
    const type = message.type;
    const payload = message.payload || {};
    if (type === "page-state") {
      const supported = isSupportedAutomationUrl(payload.url);
      pageState = {
        ...pageState,
        ...payload,
        supported
      };
      delete pageState.identity;
      monitorPageExecutable();
      publish();
      return;
    }
    if (type === "wrong-question-scan-result") {
      if (!pendingWrongQuestionCapture || payload.requestId !== pendingWrongQuestionCapture.requestId) return;
      const pending = pendingWrongQuestionCapture;
      pendingWrongQuestionCapture = null;
      clearTimeout(pending.timer);
      pending.resolve(payload);
      return;
    }
    if (!pageState.supported) return;
    if (type === "question") {
      if (!machine || machine.state.status !== BATCH_STATUS.RUNNING) return;
      try {
        const question = {
          itemId: positiveInteger(payload.itemId, "itemId"),
          sourceText: String(payload.sourceText || "").trim(),
          options: validateOptions(payload.options)
        };
        if (!question.sourceText) throw new TypeError("question source is empty");
        const decision = await coreRequest("solve", {
          session_id: machine.state.id,
          mode: "normal",
          item_id: question.itemId,
          source_text: question.sourceText,
          options: question.options
        });
        browser.send("decision", decision);
      } catch (error) {
        logger.warn(
          "solve request failed",
          `item=${String(payload.itemId || "unknown")} code=${error.code || error.name || "Error"}`
        );
        machine.recordFailure(error.message);
        persistMachine();
        if (machine.state.status === BATCH_STATUS.RUNNING) browser.send("resume");
        else browser.send("pause");
      }
      return;
    }
    if (type === "answer-selected") {
      if (!machine || machine.state.status !== BATCH_STATUS.RUNNING) return;
      const question = requirePlainObject(payload.question, "question");
      const decision = requirePlainObject(payload.decision, "decision");
      machine.recordDecision(decision, {
        itemId: positiveInteger(question.itemId, "itemId"),
        sourceText: String(question.sourceText || ""),
        options: validateOptions(question.options)
      });
      const selectedTarget = String(decision.target || "").toUpperCase();
      const historyEntry = {
        itemId: positiveInteger(question.itemId, "itemId"),
        sourceText: String(question.sourceText || ""),
        target: selectedTarget,
        answerText: String(question.options?.[selectedTarget] || ""),
        method: String(decision.method || "未知方式"),
        confidence: decision.confidence ?? null,
        detail: decision.detail == null ? null : String(decision.detail),
        answeredAt: new Date().toISOString()
      };
      const existingIndex = answerHistory.findIndex((item) => item.itemId === historyEntry.itemId);
      if (existingIndex >= 0) answerHistory[existingIndex] = historyEntry;
      else answerHistory.push(historyEntry);
      persistMachine();
      return;
    }
    if (type === "final-pending") {
      if (!machine || machine.state.status !== BATCH_STATUS.FINAL_PENDING) return;
      browser.setLocked(false);
      browser.send("watch-submission");
      persistMachine();
      return;
    }
    if (type === "submission-started") {
      if (!machine || machine.state.status !== BATCH_STATUS.FINAL_PENDING) return;
      machine.beginSubmissionConfirmation();
      persistMachine();
      clearTimeout(submissionTimer);
      submissionTimer = setTimeout(() => {
        if (machine?.state.status === BATCH_STATUS.CONFIRMING_SUBMISSION) {
          machine.submissionDetectionTimedOut();
          persistMachine();
        }
      }, DEFAULT_AUTOMATION_CONFIG.submissionDetectionTimeoutMs);
      return;
    }
    if (type === "submission-detected") {
      if (machine && [BATCH_STATUS.FINAL_PENDING, BATCH_STATUS.CONFIRMING_SUBMISSION].includes(machine.state.status)) {
        completeBatch("detected", payload.score || null);
      }
      return;
    }
    if (type === "automation-error") {
      if (!machine || machine.state.status !== BATCH_STATUS.RUNNING) return;
      const reason = String(payload.reason || "automation error");
      machine.recordFailure(reason);
      logger.warn("automation failure", `attempt=${machine.state.retryCount} reason=${reason}`);
      persistMachine();
      if (machine.state.status === BATCH_STATUS.RUNNING) browser.send("resume");
      else browser.send("pause");
      return;
    }
  });
}

app.on("certificate-error", (event, webContents, url, error, _certificate, callback) => {
  if (browser?.matchesSender(webContents)) {
    event.preventDefault();
    callback(false);
    const loadError = { code: "CERTIFICATE_ERROR", description: String(error || "certificate error"), url };
    pageState = { ...pageState, certificateError: loadError, questionReady: false };
    handleBrowserFailure({ loadError });
  }
});

app.whenReady().then(async () => {
  if (!ownsSingleInstanceLock) return;
  fs.mkdirSync(dataRoot(), { recursive: true });
  logger = new LocalLogger(logRoot());
  crashStore = new CrashStore(logRoot());
  store = new DesktopStore(dataRoot());
  try {
    store.initialize();
  } catch (error) {
    storeBootError = "应用数据无法加载：" + error.message;
    store.state = defaultState();
  }
  secrets = new SecretStore(safeStorage, dataRoot());
  createWindow();
  registerIpc();
  registerSiteEvents();
  powerMonitor.on("suspend", () => {
    if (machine?.state.status === BATCH_STATUS.RUNNING) {
      machine.pause("system_sleep");
      browser.send("pause");
      persistMachine();
    }
  });
  if (!storeBootError) {
    try {
      await initializeCore();
    } catch (error) {
      logger.error("core startup failed", `code=${error.code || error.name || "Error"}`);
    }
  }
  publish();
  void (async () => {
    if (shouldCheck(store.state.settings.lastUpdateCheckAt)) {
      try {
        await checkForUpdates(false);
      } catch (error) {
        logger.warn("automatic update check failed", error.message);
      }
    }
  })();
});

app.on("before-quit", () => { appQuitting = true; });
app.on("will-quit", () => {
  clearTimeout(pageUnavailableTimer);
  if (core) {
    core.closing = true;
    if (core.isRunning()) core.process.kill("SIGTERM");
  }
});
app.on("window-all-closed", () => { if (process.platform !== "darwin" || appQuitting) app.quit(); else app.quit(); });
