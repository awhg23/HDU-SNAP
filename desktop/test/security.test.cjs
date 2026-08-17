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
  assert.match(source, /this\.view\.setVisible\(false\);[\s\S]+addChildView\(this\.view\)/);
  const openRoutine = source.slice(source.indexOf("async open(url)"), source.indexOf("_secureSession"));
  assert.doesNotMatch(openRoutine, /this\.show\(\)/);
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
  assert.match(source, /let patchDraft = \{/);
  assert.match(source, /root\.addEventListener\("input"/);
  assert.match(source, /value="\$\{esc\(patchDraft\.source_text\)\}"/);
});

test("result pages support explicit one-question patch capture without restoring debug review", () => {
  const renderer = fs.readFileSync(path.join(desktopRoot, "src/renderer/app.js"), "utf8");
  const main = fs.readFileSync(path.join(desktopRoot, "src/main/index.cjs"), "utf8");
  const bridge = fs.readFileSync(path.join(desktopRoot, "src/preload/app.cjs"), "utf8");
  const site = fs.readFileSync(path.join(desktopRoot, "src/site/preload.cjs"), "utf8");
  assert.match(renderer, /data-action="capture-wrong-question"/);
  assert.match(renderer, /captureWrongQuestion\(\)/);
  assert.match(bridge, /captureWrongQuestion:\s*\(\)\s*=>\s*invoke\("patch:capture-current"\)/);
  assert.match(site, /command\.type === "capture-wrong-question"/);
  assert.match(site, /send\("wrong-question-scan-result"/);
  assert.match(main, /register\("patch:capture-current"/);
  assert.match(main, /coreRequest\("patch_update"/);
  assert.doesNotMatch(renderer, /自动复盘|开始复盘|调试复盘/);
  assert.doesNotMatch(main, /register\("review:/);
});

test("records and diagnostics use compact functional toolbars without marketing headers", () => {
  const renderer = fs.readFileSync(path.join(desktopRoot, "src/renderer/app.js"), "utf8");
  assert.doesNotMatch(renderer, /练习足迹|每一轮，都算数。|这里只保存批次摘要，不保存账号身份和逐题内容。/);
  assert.doesNotMatch(renderer, /本机状态|看得见，才放心。|检查核心、日志和版本状态；所有诊断都由你主动导出。/);
  assert.doesNotMatch(renderer, /偏好与维护|把工具调成顺手的样子。|所有设置都保存在这台 Mac 上。不会同步，也不会上传。/);
  assert.doesNotMatch(renderer, /设定一个舒服的题量，登录和最终提交仍然由你掌握。/);
  assert.match(renderer, /table-toolbar-actions/);
  assert.match(renderer, /data-action="run-self-check"/);
});

test("the patch library renders the newest stored rule first", () => {
  const renderer = fs.readFileSync(path.join(desktopRoot, "src/renderer/app.js"), "utf8");
  assert.match(renderer, /const patchRows = \[\.\.\.\(patches\?\.rules \|\| \[\]\)\]\.reverse\(\)\.map/);
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

test("the desktop UI uses the warm local design system and bundled illustration", () => {
  const renderer = fs.readFileSync(path.join(desktopRoot, "src/renderer/app.js"), "utf8");
  const styles = fs.readFileSync(path.join(desktopRoot, "src/renderer/styles.css"), "utf8");
  const build = fs.readFileSync(path.join(desktopRoot, "scripts/build.mjs"), "utf8");
  const illustration = path.join(desktopRoot, "src/renderer/assets/study-companion.png");
  assert.match(renderer, /assets\/study-companion\.png/);
  assert.doesNotMatch(renderer, /🔒/);
  assert.match(styles, /--terracotta:\s*#c45f3c/i);
  assert.match(styles, /--olive-deep:\s*#343c2b/i);
  assert.doesNotMatch(styles, /--blue/i);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(build, /study-companion\.png/);
  assert.equal(fs.existsSync(illustration), true);
});

test("task creation refreshes renderer state and preserves the requested home copy", () => {
  const renderer = fs.readFileSync(path.join(desktopRoot, "src/renderer/app.js"), "utf8");
  const main = fs.readFileSync(path.join(desktopRoot, "src/main/index.cjs"), "utf8");
  assert.doesNotMatch(renderer, /lastBrowserVisible/);
  assert.match(renderer, /state = result\?\.state \|\| await window\.hduSnap\.getState\(\)/);
  assert.match(main, /state:\s*publicState\(\)/);
  assert.match(renderer, /本周练习/);
  assert.match(renderer, /我爱记单词/);
  assert.match(renderer, /这次想答多少题？/);
  assert.match(renderer, /\[90,95,100\]/);
  assert.doesNotMatch(renderer, /\[50,100,200\]|可以输入任意正整数|准备好，慢慢来。|这一轮想练多少题？/);
  assert.match(renderer, /<h3>补丁库<\/h3>/);
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
