"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");

test("remote content is sandboxed and isolated from Node", () => {
  const source = fs.readFileSync(path.join(desktopRoot, "src/main/browser-controller.cjs"), "utf8");
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /webSecurity:\s*true/);
  assert.match(source, /setPermissionRequestHandler\([^\n]+callback\(false\)/);
  assert.doesNotMatch(source, /\.enableDeviceEmulation\(/);
});

test("the final-answer routine has no submit lookup or action", () => {
  const source = fs.readFileSync(path.join(desktopRoot, "src/site/preload.cjs"), "utf8");
  const routine = source.slice(source.indexOf("async function applyDecision"), source.indexOf('ipcRenderer.on("site:command"'));
  assert.doesNotMatch(routine, /提交|交卷|submit/i);
  assert.doesNotMatch(routine, /next button not found/);
  assert.match(routine, /nextAction === "next"/);
  assert.match(routine, /if \(nextAction === "finish"\)[\s\S]+send\("final-pending"/);
});

test("local UI CSP does not allow network requests or inline script", () => {
  const html = fs.readFileSync(path.join(desktopRoot, "src/renderer/index.html"), "utf8");
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
});

test("account identity is not collected or exposed by the desktop app", () => {
  const main = fs.readFileSync(path.join(desktopRoot, "src/main/index.cjs"), "utf8");
  const site = fs.readFileSync(path.join(desktopRoot, "src/site/preload.cjs"), "utf8");
  const bridge = fs.readFileSync(path.join(desktopRoot, "src/preload/app.cjs"), "utf8");
  assert.doesNotMatch(main, /register\("profile:/);
  assert.doesNotMatch(site, /inferIdentity|identity,/);
  assert.doesNotMatch(bridge, /createProfile|confirmProfile|studentId/);
});

test("the settings UI supports manual and legacy patch entry", () => {
  const source = fs.readFileSync(path.join(desktopRoot, "src/renderer/app.js"), "utf8");
  assert.match(source, /id="patch-source"/);
  assert.match(source, /id="patch-answer"/);
  assert.match(source, /data-action="add-patch"/);
  assert.match(source, /updatePatch\(\{ source_text, answer_text, wrong_answer_text, note \}\)/);
  assert.match(source, /导入旧版补丁（JSON\/JSONC）/);
});

test("the desktop UI exposes only normal answering and keeps the run bar on one line", () => {
  const renderer = fs.readFileSync(path.join(desktopRoot, "src/renderer/app.js"), "utf8");
  const styles = fs.readFileSync(path.join(desktopRoot, "src/renderer/styles.css"), "utf8");
  const main = fs.readFileSync(path.join(desktopRoot, "src/main/index.cjs"), "utf8");
  const bridge = fs.readFileSync(path.join(desktopRoot, "src/preload/app.cjs"), "utf8");
  const site = fs.readFileSync(path.join(desktopRoot, "src/site/preload.cjs"), "utf8");
  const store = fs.readFileSync(path.join(desktopRoot, "src/main/store.cjs"), "utf8");
  assert.doesNotMatch(renderer, /调试复盘|name="mode"|record-mode|apply-review/);
  assert.doesNotMatch(main, /review:start|review:apply|review_preview|review_apply|pendingReview/);
  assert.doesNotMatch(bridge, /stopReview|applyReview/);
  assert.doesNotMatch(site, /reviewActive|review-start|review-results/);
  assert.doesNotMatch(renderer, /最后一题已选，请亲自提交/);
  assert.match(renderer, /本次答题详情/);
  assert.match(renderer, /仅在本次运行中保留/);
  assert.match(renderer, /answer-history-panel/);
  assert.match(renderer, /词库匹配/);
  assert.match(renderer, /AI 大模型/);
  assert.match(renderer, /向量模型/);
  assert.match(main, /let answerHistory = \[\]/);
  assert.match(main, /answerHistory: structuredClone\(answerHistory\)/);
  assert.doesNotMatch(store, /answerHistory/);
  assert.match(renderer, /class="run-bar \$\{final \? "final-state" : ""\}"/);
  assert.match(styles, /\.run-status, \.run-actions, \.final-actions[^}]+white-space:\s*nowrap/s);
  assert.match(styles, /\.answer-history-panel[^}]+right:\s*12px[^}]+width:\s*clamp\(214px,/s);
  assert.match(styles, /body[^}]+min-width:\s*1100px/s);
  assert.match(main, /minWidth:\s*1100/);
});

test("the desktop app uses one instance and gates answering on a ready core", () => {
  const source = fs.readFileSync(path.join(desktopRoot, "src/main/index.cjs"), "utf8");
  assert.match(source, /requestSingleInstanceLock\(\)/);
  assert.match(source, /coreHealth\?\.ok && !coreError/);
  assert.match(source, /await initializeCore\(\)/);
  assert.doesNotMatch(source, /core\.request\(/);
});

test("the packaged resources include and self-check the patch baseline", () => {
  const prepare = fs.readFileSync(path.join(desktopRoot, "scripts/prepare-resources.mjs"), "utf8");
  const main = fs.readFileSync(path.join(desktopRoot, "src/main/index.cjs"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
  assert.match(prepare, /patch_rules\.jsonc/);
  assert.match(prepare, /cp\(patchRulesSource/);
  assert.match(main, /coreHealth\?\.checks\?\.patch_bundle/);
  assert.match(main, /fs\.existsSync\(patchRulesPath\)/);
  assert.match(manifest.scripts["make:dmg"], /verify:package/);
});
