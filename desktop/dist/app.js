"use strict";

const root = document.getElementById("app");
let state = null;
let page = "home";
let answerCount = "100";
let settingsTab = "general";
let selfCheckResult = null;
let records = null;
let patches = null;
let diagnostic = null;
let recordFilters = {};
let lastBrowserVisible = null;

const esc = (value) => String(value == null ? "" : value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const activeBatch = () => state?.data?.activeBatch || null;
const statusText = (status) => ({
  ready: "待就绪", running: "运行中", paused: "已暂停", error_paused: "错误暂停",
  final_pending: "最终待提交", confirming_submission: "正在确认提交", completed: "已完成",
  stopped: "已中止", interrupted: "异常中止", submission_unconfirmed: "未确认提交"
}[status] || status || "—");

async function call(promise, success) {
  const result = await promise;
  if (result?.ok === false) window.alert(result.error || "操作失败");
  else if (success) success(result);
  return result;
}

function setBrowserVisible(value) {
  if (lastBrowserVisible === value) return;
  lastBrowserVisible = value;
  void window.hduSnap.browserVisible(value);
}

function lockedNavigation() {
  return Boolean(activeBatch() && !["ready", "stopped", "interrupted", "submission_unconfirmed"].includes(activeBatch().status));
}

function renderShell(content, className = "") {
  const locked = lockedNavigation();
  return `<div class="shell">
    <aside class="sidebar">
      <div class="brand">HDU-SNAP<small>macOS 自包含版 · ${esc(state.version)}</small></div>
      <nav class="nav">
        ${[["home","首页"],["learn","学习"],["records","记录"],["settings","设置"],["diagnostic","诊断"]].map(([id,label]) => {
          const navLocked = locked && id !== "learn";
          return `<button data-nav="${id}" class="${page === id ? "active" : ""} ${navLocked ? "locked" : ""}" ${navLocked ? "disabled" : ""}>${label}</button>`;
        }).join("")}
      </nav>
      <div class="sidebar-foot">本地运行 · 无遥测<br>最终提交始终由你完成</div>
    </aside>
    <main class="main ${className}">${content}</main>
  </div>`;
}

function renderOnboarding() {
  setBrowserVisible(false);
  const checks = selfCheckResult?.checks;
  const labels = {
    system: "系统与 Apple 芯片", core: "内置答题核心", dictionary: "词典与纠错资源",
    vectorModel: "本地向量模型", dataDirectory: "应用数据目录", webComponent: "内嵌网页组件",
    targetNetwork: "目标站点连接", keychain: "macOS 钥匙串", deepseek: "DeepSeek（可选）"
  };
  root.innerHTML = `<section class="onboarding stack">
    <div><h1>欢迎使用 HDU-SNAP</h1><div class="steps">1 欢迎　────　2 系统自检　────　3 初始配置　────　4 完成</div></div>
    <div class="card stack">
      <div class="row between"><h2>严格系统自检</h2><button data-action="self-check">${checks ? "重新检查" : "开始检查"}</button></div>
      ${checks ? `<div class="checks">${Object.entries(checks).map(([key,value]) => `<div class="check ${value === false ? "error" : value === true ? "success" : "muted"}">${value === true ? "✓" : value === false ? "✕" : "—"} ${esc(labels[key] || key)}</div>`).join("")}</div>` : `<p class="muted">首次进入前将检查内置核心、词典、模型、数据目录、网页组件和网络。</p>`}
      <div><label>DeepSeek Key（可跳过）</label><div class="row"><input id="onboarding-key" type="password" autocomplete="off" placeholder="仅验证后写入钥匙串" size="38"><button data-action="save-onboarding-key">验证并保存</button></div></div>
      <p class="hint">Key 仅保存到 macOS 钥匙串，不进入网页、日志、记录或诊断包。</p>
      <div class="row between"><span class="${selfCheckResult?.ok ? "success" : "error"}">${selfCheckResult ? (selfCheckResult.ok ? "所有必需检查已通过" : "存在阻断项，修复后请重试") : "尚未检查"}</span><button class="primary" data-action="finish-onboarding" ${selfCheckResult?.ok ? "" : "disabled"}>进入 HDU-SNAP</button></div>
    </div>
  </section>`;
}

function renderBlocked() {
  setBrowserVisible(false);
  root.innerHTML = `<section class="onboarding stack"><h1>HDU-SNAP 数据恢复</h1><div class="card stack"><p class="error">${esc(state.blocked)}</p><p>为防止进一步损坏，主流程已停止。可以恢复最近备份，或先导出诊断。</p><div class="row"><button data-action="load-blocked-diagnostic">查看可用备份</button><button data-action="export-diagnostic">导出脱敏诊断</button></div>${diagnostic?.backups?.length ? `<div class="stack">${diagnostic.backups.map((name)=>`<button data-restore-backup="${esc(name)}">恢复 ${esc(name)}</button>`).join("")}</div>` : ""}</div></section>`;
}

function renderHome() {
  setBrowserVisible(false);
  const running = activeBatch();
  return renderShell(`<div class="page-title"><h1>准备一批答题任务</h1>${running ? `<span class="pill ${esc(running.status)}">${statusText(running.status)}</span>` : ""}</div>
    <div class="card stack">
      ${running ? `<p>已有批次：${running.answeredCount}/${running.targetCount}</p><div class="row"><button class="primary" data-nav="learn">返回学习页</button>${running.status === "ready" ? `<button data-action="discard-task">放弃并重新配置</button>` : ""}</div>` : `
      <div class="form-grid">
        <label for="answer-count">答题数量</label><div><input id="answer-count" type="number" min="1" step="1" value="${esc(answerCount)}"> 题</div>
      </div>
      <div class="row between"><span class="hint">App 使用一份持久登录会话，不识别或保存姓名学号；进入站点后仍需手动登录、导航并点击开始。</span><button class="primary" data-action="create-task" ${Number(answerCount)>0 ? "" : "disabled"}>进入学习站点 →</button></div>`}
    </div>`);
}

function runControls(batch) {
  if (!batch) return "";
  if (batch.status === "ready") return `<button class="primary" data-action="start-batch" ${state.canStart ? "" : "disabled"}>开始答题</button>`;
  if (batch.status === "running") return `<button data-action="pause-batch">暂停</button><button class="danger" data-action="stop-batch">停止批次</button>`;
  if (["paused","error_paused"].includes(batch.status)) return `<button class="primary" data-action="resume-batch">${batch.status === "error_paused" ? "重试当前题" : "继续"}</button><button class="danger" data-action="stop-batch">停止批次</button>`;
  return "";
}

function decisionMethodInfo(method) {
  const raw = String(method || "未知方式");
  return ({
    "补丁规则": { label: "补丁规则", tone: "patch" },
    "字典匹配": { label: "词库匹配", tone: "dictionary" },
    "词典匹配": { label: "词库匹配", tone: "dictionary" },
    "向量相似度": { label: "向量模型", tone: "vector" },
    "向量模型": { label: "向量模型", tone: "vector" },
    "大模型决策": { label: "AI 大模型", tone: "llm" },
    "AI 大模型": { label: "AI 大模型", tone: "llm" },
    "向量兜底": { label: "向量兜底", tone: "fallback" }
  })[raw] || { label: raw, tone: "default" };
}

function renderAnswerHistoryPanel(batch) {
  const history = Array.isArray(state.answerHistory) ? state.answerHistory : [];
  const counts = new Map();
  for (const item of history) {
    const method = decisionMethodInfo(item.method);
    const key = method.tone + "\u0000" + method.label;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const summary = [...counts.entries()].map(([key, count]) => {
    const [tone, label] = key.split("\u0000");
    return `<span class="answer-summary-item ${esc(tone)}"><strong>${count}</strong>${esc(label)}</span>`;
  }).join("");
  const cards = [...history].reverse().map((item, index) => {
    const method = decisionMethodInfo(item.method);
    const confidence = item.confidence != null && Number.isFinite(Number(item.confidence))
      ? `<span class="answer-card-confidence">置信度 ${Math.round(Number(item.confidence) * 100)}%</span>`
      : "";
    const time = item.answeredAt
      ? new Date(item.answeredAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
      : "";
    return `<article class="answer-card ${index === 0 ? "latest" : ""}" title="${esc(item.detail || method.label)}">
      <div class="answer-card-head"><span class="answer-number">第 ${esc(item.itemId)} 题</span>${index === 0 ? `<span class="latest-mark">最新</span>` : ""}<time>${esc(time)}</time></div>
      <div class="answer-source">${esc(item.sourceText || "未识别题目")}</div>
      <div class="answer-result"><strong>${esc(item.target || "—")}</strong><span class="answer-text">${esc(item.answerText || "未识别答案文本")}</span></div>
      <div class="answer-card-foot"><span class="decision-method ${esc(method.tone)}">${esc(method.label)}</span>${confidence}</div>
    </article>`;
  }).join("");
  const total = batch?.targetCount || history.length;
  return `<aside class="answer-history-panel" aria-label="本次答题详情">
    <header class="answer-panel-header"><div><h2>本次答题详情</h2><p>仅在本次运行中保留</p></div><span class="answer-total">${history.length}${total ? ` / ${total}` : ""}</span></header>
    ${summary ? `<div class="answer-summary">${summary}</div>` : ""}
    <div class="answer-history-list">${cards || `<div class="answer-empty"><strong>等待开始答题</strong><span>每题的答案和决策来源会显示在这里</span></div>`}</div>
  </aside>`;
}

function renderLearning() {
  const batch = activeBatch();
  setBrowserVisible(Boolean(state.browserOpen || batch));
  const pageInfo = state.page || {};
  const percent = batch ? Math.min(100, Math.round(batch.answeredCount / batch.targetCount * 100)) : 0;
  const final = batch && ["final_pending","confirming_submission"].includes(batch.status);
  const browserLocked = batch?.status === "running";
  const finalControls = final ? `<div class="final-actions"><label class="extend-field"><span>追加</span><input id="extend-count" aria-label="增加题量" type="number" min="1" value="10"></label><button data-action="extend-batch">增加题量</button>${batch.submissionTimedOut ? `<button class="primary" data-action="manual-submitted">我已提交</button>` : `<span class="hint final-wait">${batch.status === "confirming_submission" ? "识别结果页中" : "等待网页提交"}</span>`}</div>` : "";
  return renderShell(`<div class="browser-bar"><button data-action="browser-back" ${browserLocked?"disabled":""}>←</button><button data-action="browser-forward" ${browserLocked?"disabled":""}>→</button><button data-action="browser-reload" ${browserLocked?"disabled":""}>⟳</button><button data-action="browser-home" ${browserLocked?"disabled":""}>⌂</button><input id="address" value="${esc(pageInfo.url || state.data.settings.learningHome)}" ${browserLocked?"disabled":""}><button data-action="browser-go" ${browserLocked?"disabled":""}>前往</button></div>
    <div class="run-bar ${final ? "final-state" : ""}"><div class="run-status"><strong>学习站点</strong>${batch ? `<span class="pill ${esc(batch.status)}">${statusText(batch.status)}</span><div class="progress"><span style="width:${percent}%"></span></div><span class="progress-count">${batch.answeredCount} / ${batch.targetCount}</span>` : ""}</div><div class="run-actions">${finalControls}${runControls(batch)}</div></div>
    ${(state.browserOpen || batch || (state.answerHistory?.length || 0) > 0) ? renderAnswerHistoryPanel(batch) : ""}
    ${!state.browserOpen && !batch ? `<div class="browser-placeholder">请从首页配置题量并进入学习站点</div>` : ""}`,
    "learning");
}

async function loadRecords() {
  records = await window.hduSnap.listRecords({ ...recordFilters, page: 1 });
  render();
}

function renderRecords() {
  setBrowserVisible(false);
  if (!records) void loadRecords();
  const items = records?.items || [];
  return renderShell(`<div class="page-title"><h1>批次记录</h1><div class="row"><button data-action="export-csv">导出 CSV</button><button data-action="export-json">导出 JSON</button><button class="danger" data-action="delete-records">删除选中</button></div></div>
    <div class="card"><div class="toolbar"><select id="record-status"><option value="">全部状态</option><option value="completed">已完成</option><option value="stopped">已中止</option><option value="interrupted">异常中止</option><option value="submission_unconfirmed">未确认提交</option></select><button data-action="filter-records">筛选</button></div>
    <table><thead><tr><th></th><th>时间</th><th>进度</th><th>状态</th></tr></thead><tbody>${items.map((item)=>`<tr><td><input class="record-check" type="checkbox" value="${esc(item.id)}"></td><td>${esc(item.startedAt || item.endedAt)}</td><td>${item.answeredCount}/${item.targetCount}</td><td>${statusText(item.status)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">暂无记录</td></tr>`}</tbody></table><p class="hint">最多保留 1000 批；批次记录不包含姓名、学号或登录身份。</p></div>`);
}

async function loadPatches() { patches = await window.hduSnap.listPatches(); render(); }

function renderSettings() {
  setBrowserVisible(false);
  return renderShell(`<div class="page-title"><h1>设置</h1></div><div class="card">
    <div class="tabs">${[["general","常规"],["patches","纠错补丁"],["migration","迁移与数据"]].map(([id,label])=>`<button data-settings-tab="${id}" class="${settingsTab===id?"active":""}">${label}</button>`).join("")}</div>
    ${settingsTab === "general" ? `<div class="stack"><label>学习首页 <select id="learning-home">${SUPPORTED_SITE_OPTIONS()}</select></label><div class="row"><span>DeepSeek：${state.keyConfigured?"✓ 已配置":"未配置"}</span><input id="settings-key" type="password" autocomplete="off" placeholder="输入新 Key"><button data-action="save-key">验证并更换</button><button data-action="remove-key" ${state.keyConfigured?"":"disabled"}>移除</button></div><label>更新频道 <select id="update-channel"><option value="stable" ${state.data.settings.updateChannel==="stable"?"selected":""}>稳定版</option><option value="test" ${state.data.settings.updateChannel==="test"?"selected":""}>测试版</option></select></label><div class="row"><button data-action="save-general">保存常规设置</button><button data-action="clear-browser-session">清除网页登录数据</button></div><p class="hint">App 只保留一份网站登录会话，不识别或记录账号身份。</p></div>` : ""}
    ${settingsTab === "patches" ? `<div class="stack"><section class="card stack"><h3>手动添加补丁</h3><div class="form-grid"><label for="patch-source">题目</label><input id="patch-source" maxlength="500" placeholder="例如：管理，经营"><label for="patch-answer">正确答案</label><input id="patch-answer" maxlength="300" placeholder="例如：manage"><label for="patch-wrong">错误答案（可选）</label><input id="patch-wrong" maxlength="300" placeholder="例如：finish"><label for="patch-note">备注（可选）</label><input id="patch-note" maxlength="500" placeholder="补丁来源或说明"></div><div class="row"><button class="primary" data-action="add-patch">保存补丁</button></div></section><div class="toolbar"><button data-action="load-patches">刷新</button><button data-action="import-patches">导入旧版补丁（JSON/JSONC）</button><button data-action="export-patches">导出 JSON</button></div><table><thead><tr><th>题目</th><th>正确答案</th><th>错误答案</th><th>备注</th><th>操作</th></tr></thead><tbody>${(patches?.rules||[]).map((rule)=>`<tr><td>${esc(rule.source_text)}</td><td>${esc(rule.answer_text)}</td><td>${esc(rule.wrong_answer_text)}</td><td>${esc(rule.note)}</td><td><button data-delete-patch-source="${esc(rule.source_text)}" data-delete-patch-answer="${esc(rule.answer_text)}">删除</button></td></tr>`).join("") || `<tr><td colspan="5" class="muted">点击刷新加载纠错规则</td></tr>`}</tbody></table></div>` : ""}
    ${settingsTab === "migration" ? `<div class="stack"><div><h3>旧版项目迁移</h3><p class="muted">选择第一阶段项目目录，迁入根目录 patch_rules.jsonc 和可选 Key；不会迁移调试记录、Chrome Cookie，也不会修改旧文件。</p><button data-action="scan-migration">选择并扫描旧项目目录</button></div><div class="danger-zone card"><h3>全部重置</h3><p>清除网页登录数据、记录、纠错和 Key，内置资源保留。</p><button class="danger" data-action="reset-all">全部重置 HDU-SNAP</button></div></div>` : ""}
  </div>`);
}

function SUPPORTED_SITE_OPTIONS() {
  return ["https://skl.hduhelp.com/?type=5#/english/list","https://skl.hdu.edu.cn/#/english/list"]
    .map((url)=>`<option value="${esc(url)}" ${state.data.settings.learningHome===url?"selected":""}>${esc(url)}</option>`).join("");
}

async function loadDiagnostic() { diagnostic = await window.hduSnap.diagnosticStatus(); render(); }

function renderDiagnostic() {
  setBrowserVisible(false);
  if (!diagnostic) void loadDiagnostic();
  return renderShell(`<div class="page-title"><h1>诊断与版本</h1><button data-action="run-self-check">重新检查组件</button></div>
    <div class="stack"><div class="card"><h3>组件状态</h3><div class="row"><span class="pill">${state.core?.vector_mode === "embedding" ? "✓ 向量模型" : "— 向量兜底"}</span><span class="pill">${state.keyConfigured ? "✓ DeepSeek" : "— DeepSeek"}</span><span class="pill">✓ 内嵌网页</span></div>${state.coreError?`<p class="error">${esc(state.coreError)}</p>`:""}</div>
    <div class="card"><h3>本地日志与诊断</h3><p>日志：${Math.round((diagnostic?.logBytes||0)/1024)} KB · 保留 30 天或 100 MB</p><div class="row"><button data-action="show-logs">在 Finder 中显示</button><button data-action="clear-logs">清空日志</button><button class="primary" data-action="export-diagnostic">导出完整诊断 ZIP</button></div><p class="hint">诊断可能包含答题内容、网页快照及页面中可见的个人信息；密码、Cookie、令牌和 Key 永远排除。</p></div>
    <div class="card"><h3>版本维护</h3><p>当前版本：${esc(state.version)}　频道：${esc(state.data.settings.updateChannel)}</p><button data-action="check-update">立即检查</button><p class="hint">只读取公开版本清单，不保存 GitHub Token，不自动下载或替换 App。</p></div></div>`);
}

function render() {
  if (!state) return;
  if (state.blocked) return renderBlocked();
  if (!state.data.onboardingComplete) return renderOnboarding();
  const renderer = { home: renderHome, learn: renderLearning, records: renderRecords, settings: renderSettings, diagnostic: renderDiagnostic }[page] || renderHome;
  root.innerHTML = renderer();
}

root.addEventListener("change", (event) => {
  if (event.target.id === "answer-count") answerCount = event.target.value;
});

root.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-nav]");
  if (nav && !nav.disabled) { page = nav.dataset.nav; render(); return; }
  const tab = event.target.closest("[data-settings-tab]");
  if (tab) {
    settingsTab = tab.dataset.settingsTab;
    if (settingsTab === "patches" && !patches) await loadPatches();
    else render();
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) {
    const restore = event.target.closest("[data-restore-backup]");
    if (restore && confirm("恢复该备份并重新启动数据层？当前损坏文件会先备份。")) await call(window.hduSnap.restoreBackup(restore.dataset.restoreBackup));
    const patchDelete = event.target.closest("[data-delete-patch-source]");
    if (patchDelete && confirm("删除这条共享纠错？")) { await call(window.hduSnap.deletePatch({ source_text: patchDelete.dataset.deletePatchSource, answer_text: patchDelete.dataset.deletePatchAnswer })); await loadPatches(); }
    return;
  }
  if (action === "self-check" || action === "run-self-check") { selfCheckResult = await window.hduSnap.selfCheck(); if (page === "diagnostic") alert(selfCheckResult.ok?"所有必需组件正常":"存在阻断项"); render(); }
  else if (action === "load-blocked-diagnostic") { diagnostic = await window.hduSnap.diagnosticStatus(); render(); }
  else if (action === "save-onboarding-key" || action === "save-key") { const input = document.getElementById(action === "save-key" ? "settings-key" : "onboarding-key"); if (input.value) await call(window.hduSnap.saveKey(input.value),()=>alert("Key 验证成功并已保存到钥匙串")); }
  else if (action === "finish-onboarding") await call(window.hduSnap.finishOnboarding());
  else if (action === "create-task") { answerCount = document.getElementById("answer-count").value; await call(window.hduSnap.createTask({answerCount:Number(answerCount)}),()=>{page="learn";render();}); }
  else if (action === "discard-task" && confirm("放弃尚未开始的批次并重新配置？")) await call(window.hduSnap.discardTask());
  else if (action === "browser-back") window.hduSnap.browserBack();
  else if (action === "browser-forward") window.hduSnap.browserForward();
  else if (action === "browser-reload") window.hduSnap.browserReload();
  else if (action === "browser-home") window.hduSnap.browserHome();
  else if (action === "browser-go") { const url=document.getElementById("address").value; let result=await window.hduSnap.browserNavigate({url}); if(result?.blocked==="http_confirmation" && confirm("HTTP 连接不安全，仍要加载？")) await window.hduSnap.browserNavigate({url,httpConfirmed:true}); }
  else if (action === "start-batch") await call(window.hduSnap.startBatch());
  else if (action === "pause-batch") await call(window.hduSnap.pauseBatch());
  else if (action === "resume-batch") await call((activeBatch().status==="error_paused"?window.hduSnap.retryBatch():window.hduSnap.resumeBatch()));
  else if (action === "stop-batch" && confirm("停止后该批次不可恢复，确定停止？")) await call(window.hduSnap.stopBatch());
  else if (action === "extend-batch") await call(window.hduSnap.extendBatch(Number(document.getElementById("extend-count").value)));
  else if (action === "manual-submitted" && confirm("只更新本地状态，不会操作网页。确认你已经亲自提交？")) await call(window.hduSnap.confirmSubmitted());
  else if (action === "filter-records") { recordFilters={status:document.getElementById("record-status").value}; records=await window.hduSnap.listRecords({...recordFilters,page:1}); render(); }
  else if (["export-csv","export-json"].includes(action)) { if(confirm("导出包含本地批次记录，请确认保存位置安全。")) await call(window.hduSnap.exportRecords({format:action.endsWith("json")?"json":"csv",privacyConfirmed:true,filters:recordFilters})); }
  else if (action === "delete-records") { const ids=[...document.querySelectorAll(".record-check:checked")].map(x=>x.value); if(ids.length&&confirm("删除后不可恢复，确定删除？")){await call(window.hduSnap.deleteRecords(ids));await loadRecords();} }
  else if (action === "save-general") { await call(window.hduSnap.updateSettings({learningHome:document.getElementById("learning-home").value,updateChannel:document.getElementById("update-channel").value})); }
  else if (action === "clear-browser-session" && confirm("这会清除当前网站登录状态，需要重新手动登录。确定继续？")) await call(window.hduSnap.clearBrowserSession());
  else if (action === "remove-key" && confirm("移除 DeepSeek Key？之后将使用确定性兜底。")) await call(window.hduSnap.removeKey());
  else if (action === "load-patches") await loadPatches();
  else if (action === "add-patch") {
    const source_text = document.getElementById("patch-source")?.value.trim() || "";
    const answer_text = document.getElementById("patch-answer")?.value.trim() || "";
    const wrong_answer_text = document.getElementById("patch-wrong")?.value.trim() || "";
    const note = document.getElementById("patch-note")?.value.trim() || "";
    if (!source_text || !answer_text) return alert("题目和正确答案必须填写。");
    const conflicts = (patches?.rules || []).filter((rule) => String(rule.source_text).trim() === source_text && String(rule.answer_text).trim() !== answer_text);
    if (conflicts.length && !confirm("已有相同题目的其他补丁。继续会替换旧规则，确定保存？")) return;
    const result = await call(window.hduSnap.updatePatch({ source_text, answer_text, wrong_answer_text, note }));
    if (result?.ok !== false) { await loadPatches(); alert("补丁已保存并立即生效。"); }
  }
  else if (action === "export-patches") await call(window.hduSnap.exportPatches());
  else if (action === "import-patches") { const preview=await call(window.hduSnap.importPatches()); if(preview?.preview&&confirm(`发现 ${preview.preview.candidates.length} 条规则。冲突默认跳过，确认合并？`)){await call(window.hduSnap.importPatches({confirm:true}));await loadPatches();} }
  else if (action === "scan-migration") { const result=await call(window.hduSnap.scanMigration()); if(result?.summary&&!result.alreadyImported&&confirm(`发现纠错 ${result.summary.ruleCount} 条。确认导入？`)) await call(window.hduSnap.importMigration({includeKey:result.summary.hasApiKey&&confirm("发现旧 Key。验证成功后迁入钥匙串？")})); else if(result?.alreadyImported) alert("该来源已导入，不会重复写入。") }
  else if (action === "reset-all") { const value=prompt("此操作不可恢复。请输入：重置 HDU-SNAP"); if(value) await call(window.hduSnap.resetAll(value)); }
  else if (action === "show-logs") window.hduSnap.showLogs();
  else if (action === "clear-logs" && confirm("清空本地日志？")) { await call(window.hduSnap.clearLogs()); await loadDiagnostic(); }
  else if (action === "export-diagnostic" && confirm("诊断包可能包含答题数据、网页快照及页面中可见的个人信息，但不含密码、Cookie、会话令牌或 Key。确认导出？")) await call(window.hduSnap.exportDiagnostic({privacyConfirmed:true}));
  else if (action === "check-update") { const result=await call(window.hduSnap.checkUpdate(true)); if(result?.status==="not_configured") alert("尚未配置公开版本清单地址。") ; else if(result?.latest) alert(`最新版本：${result.latest.version}`); }
});

window.hduSnap.onState((next) => { state = next; render(); });
window.hduSnap.getState().then((initial) => { state = initial; render(); });
