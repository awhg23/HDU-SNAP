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
let recordFilters = { status: "", dateFrom: "", dateTo: "" };
let diagnosticPrivacyConfirmed = false;
let updateCheckFeedback = null;
let patchDraft = {
  source_text: "",
  answer_text: "",
  wrong_answer_text: "",
  note: ""
};
let wrongQuestionFeedback = null;

const esc = (value) => String(value == null ? "" : value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const ICONS = {
  home: '<path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>',
  learn: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2h5a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3Z"/><path d="M21 18a1 1 0 0 0 1-1V5a2 2 0 0 0-2-2h-5a3 3 0 0 0-3 3v15a3 3 0 0 1 3-3Z"/>',
  records: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  settings: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
  diagnostic: '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
  lock: '<rect width="14" height="10" x="5" y="11" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  arrowLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  rotate: '<path d="M20 11a8.1 8.1 0 1 0 .5 4"/><path d="M20 4v7h-7"/>',
  siteHome: '<path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/>',
  play: '<path d="m6 3 14 9-14 9Z"/>',
  pause: '<rect width="4" height="16" x="6" y="4" rx="1"/><rect width="4" height="16" x="14" y="4" rx="1"/>',
  stop: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  minus: '<path d="M5 12h14"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3Z"/><path d="m9 12 2 2 4-4"/>',
  sparkles: '<path d="m12 3-1.9 4.8a2 2 0 0 1-1.1 1.1L4 11l5 2.1a2 2 0 0 1 1.1 1.1L12 19l1.9-4.8a2 2 0 0 1 1.1-1.1l5-2.1-5-2.1a2 2 0 0 1-1.1-1.1Z"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 18 2 18 2c1 4.5.2 8-1.6 10.1C14.6 14.3 12 15 9 15"/><path d="M2 21c0-3 1.9-5.5 7-6"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 15H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>',
  filter: '<path d="M4 5h16"/><path d="M7 12h10"/><path d="M10 19h4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8"/><path d="m18 5 2 2"/><path d="m15 8 2 2"/>',
  patch: '<path d="M15.5 6.5 17 5a2.1 2.1 0 0 1 3 3l-1.5 1.5"/><path d="m14 8 2 2"/><path d="M9.5 14.5 11 13"/><path d="m8 16 2 2"/><path d="M3 21l5-5"/><path d="M14 3a7 7 0 0 0-9 9l7 7a7 7 0 0 0 9-9Z"/>',
  folder: '<path d="M3 5h6l2 2h10v12H3Z"/>',
  refresh: '<path d="M20 11a8.1 8.1 0 1 0 .5 4"/><path d="M20 4v7h-7"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v13h16V8"/><path d="M10 12h4"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'
};

function icon(name, className = "") {
  return `<svg class="icon ${esc(className)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
}

function pageHeader(kicker, title, description, actions = "") {
  return `<header class="page-title"><div><span class="eyebrow">${esc(kicker)}</span><h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ""}</div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</header>`;
}

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
  // BrowserController.open() can create the native view between renderer state
  // updates. Always send the desired visibility so the WebContentsView cannot
  // remain above a local page because of a stale renderer-side cache.
  void window.hduSnap.browserVisible(Boolean(value));
}

function lockedNavigation() {
  return Boolean(activeBatch() && !["ready", "stopped", "interrupted", "submission_unconfirmed"].includes(activeBatch().status));
}

function renderShell(content, className = "") {
  const locked = lockedNavigation();
  const navItems = [["home","home","首页"],["learn","learn","学习"],["records","records","记录"],["settings","settings","设置"],["diagnostic","diagnostic","诊断"]];
  return `<a class="skip-link" href="#main-content">跳到主要内容</a><div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">H</span><div><strong>HDU-SNAP</strong><small>学习搭子 · ${esc(state.version)}</small></div></div>
      <span class="nav-caption">你的学习空间</span>
      <nav class="nav" aria-label="主导航">
        ${navItems.map(([id,iconName,label]) => {
          const navLocked = locked && id !== "learn";
          return `<button data-nav="${id}" class="${page === id ? "active" : ""} ${navLocked ? "locked" : ""}" ${page === id ? 'aria-current="page"' : ""} ${navLocked ? "disabled" : ""}>${icon(iconName)}<span>${label}</span>${navLocked ? `<span class="nav-lock">${icon("lock")}</span>` : ""}</button>`;
        }).join("")}
      </nav>
      <div class="sidebar-foot"><div class="local-badge"><span></span>本地运行</div><p>没有遥测，也不会替你提交最后一题。</p></div>
    </aside>
    <main id="main-content" class="main ${className}" tabindex="-1">${content}</main>
  </div>`;
}

function renderOnboarding() {
  setBrowserVisible(false);
  const checks = selfCheckResult?.checks;
  const labels = {
    system: "系统与 Apple 芯片", core: "内置答题核心", dictionary: "词典与纠错资源",
    dataDirectory: "应用数据目录", webComponent: "内嵌网页组件",
    targetNetwork: "目标站点连接", keychain: "macOS 钥匙串", deepseek: "DeepSeek（可选）"
  };
  const checkCards = checks ? Object.entries(checks).map(([key, value]) => {
    const tone = value === false ? "failed" : value === true ? "passed" : "waiting";
    const iconName = value === false ? "x" : value === true ? "check" : "minus";
    return `<div class="check ${tone}"><span class="check-icon">${icon(iconName)}</span><span>${esc(labels[key] || key)}</span></div>`;
  }).join("") : "";
  root.innerHTML = `<main class="onboarding-shell">
    <section class="onboarding-hero" aria-labelledby="welcome-title">
      <div class="onboarding-brand"><span class="brand-mark">H</span><strong>HDU-SNAP</strong></div>
      <span class="eyebrow">LOCAL STUDY COMPANION</span>
      <h1 id="welcome-title">把词汇练习，<br>安静地留在自己的 Mac 里。</h1>
      <p>无需浏览器插件，也不会替你提交。你只需要登录、设定题量，然后掌握最后一步。</p>
      <img class="study-illustration" src="assets/study-companion.png" alt="" aria-hidden="true">
    </section>
    <section class="onboarding-card" aria-label="首次使用设置">
      <div class="step-track" aria-label="首次使用步骤">
        ${[["01","欢迎"],["02","自检"],["03","配置"],["04","完成"]].map(([number,label], index)=>`<span class="${index <= (checks ? 2 : 1) ? "active" : ""}"><b>${number}</b>${label}</span>`).join("")}
      </div>
      <div class="section-heading"><div><span class="eyebrow">准备就绪检查</span><h2>先确认一切都在本机正常工作</h2></div><button class="soft" data-action="self-check">${icon("refresh")}${checks ? "重新检查" : "开始检查"}</button></div>
      ${checks ? `<div class="checks">${checkCards}</div>` : `<div class="empty-note">${icon("shield")}<div><strong>还没有开始检查</strong><p>将依次检查内置核心、词典、纠错资源、数据目录、网页组件和目标站点。</p></div></div>`}
      <div class="key-card"><div class="key-card-copy"><span class="key-icon">${icon("key")}</span><div><label for="onboarding-key">DeepSeek Key <small>可跳过</small></label><p>验证通过后，只写入 macOS 钥匙串。</p></div></div><div class="key-input-row"><input id="onboarding-key" type="password" autocomplete="off" placeholder="输入 Key"><button data-action="save-onboarding-key">验证并保存</button></div></div>
      <div class="onboarding-footer"><div class="readiness ${selfCheckResult?.ok ? "ready" : selfCheckResult ? "blocked" : "waiting"}"><span>${selfCheckResult?.ok ? icon("check") : selfCheckResult ? icon("x") : icon("minus")}</span><div><strong>${selfCheckResult ? (selfCheckResult.ok ? "可以开始使用" : "还有项目需要处理") : "等待系统自检"}</strong><small>${selfCheckResult ? (selfCheckResult.ok ? "所有必需组件已经就绪" : "修复阻断项后再试一次") : "Key 是可选项，不影响进入"}</small></div></div><button class="primary" data-action="finish-onboarding" ${selfCheckResult?.ok ? "" : "disabled"}>进入应用 ${icon("arrowRight")}</button></div>
    </section>
  </main>`;
}

function renderBlocked() {
  setBrowserVisible(false);
  root.innerHTML = `<main class="recovery-page"><section class="recovery-card"><span class="recovery-icon">${icon("archive")}</span><span class="eyebrow">SAFE RECOVERY</span><h1>先停一下，我们保护住了数据。</h1><p class="error-panel">${esc(state.blocked)}</p><p>主流程已暂停，避免继续写入。你可以先查看备份，或者导出一份不含密钥和会话信息的诊断包。</p><label class="privacy-confirm"><input id="diagnostic-privacy" type="checkbox" ${diagnosticPrivacyConfirmed ? "checked" : ""}><span>我确认诊断包可能包含答题内容、网页快照和页面中可见的个人信息。</span></label><div class="row"><button class="primary" data-action="load-blocked-diagnostic">${icon("archive")} 查看可用备份</button><button data-action="export-diagnostic" ${diagnosticPrivacyConfirmed ? "" : "disabled"}>${icon("download")} 导出脱敏诊断</button></div>${diagnostic?.backups?.length ? `<div class="backup-list">${diagnostic.backups.map((name)=>`<button data-restore-backup="${esc(name)}">${icon("rotate")}<span>恢复 ${esc(name)}</span></button>`).join("")}</div>` : ""}</section></main>`;
}

function renderHome() {
  setBrowserVisible(false);
  const running = activeBatch();
  const header = pageHeader("本周练习", running ? "这一轮还在继续" : "我爱记单词", running ? "回到学习页继续当前批次，配置不会被意外覆盖。" : "", running ? `<span class="pill ${esc(running.status)}">${statusText(running.status)}</span>` : "");
  if (running) {
    const percent = Math.min(100, Math.round(running.answeredCount / running.targetCount * 100));
    return renderShell(`${header}<section class="card active-task-card"><div class="active-task-main"><span class="feature-icon">${icon("learn")}</span><div><span class="eyebrow">CURRENT SESSION</span><h2>${running.answeredCount} / ${running.targetCount} 题</h2><p>当前状态：${statusText(running.status)}</p></div></div><div class="progress large"><span style="width:${percent}%"></span></div><div class="row"><button class="primary" data-nav="learn">返回学习页 ${icon("arrowRight")}</button>${running.status === "ready" ? `<button class="ghost-danger" data-action="discard-task">放弃并重新配置</button>` : ""}</div></section>`);
  }
  return renderShell(`${header}<section class="home-hero card"><div class="home-task-copy"><span class="feature-icon">${icon("sparkles")}</span><h2>这次想答多少题？</h2><div class="count-control"><input id="answer-count" aria-label="答题数量" type="number" min="1" step="1" value="${esc(answerCount)}"><span>题</span></div><div class="preset-row" aria-label="快速选择题量">${[90,95,100].map((count)=>`<button class="preset ${Number(answerCount)===count?"active":""}" data-answer-preset="${count}">${count} 题</button>`).join("")}</div><button class="primary large-button" data-action="create-task" ${Number(answerCount)>0 ? "" : "disabled"}>进入学习站点 ${icon("arrowRight")}</button></div><div class="home-art"><span class="paper-orbit"></span><img src="assets/study-companion.png" alt="由单词卡、笔记本和嫩芽组成的学习插画"></div></section><section class="promise-strip"><div>${icon("shield")}<span><strong>只在本地</strong><small>没有遥测和账号记录</small></span></div><div>${icon("siteHome")}<span><strong>登录会保留</strong><small>使用唯一持久网页会话</small></span></div><div>${icon("check")}<span><strong>最后一步归你</strong><small>永远不会自动提交</small></span></div></section>`);
}

function runControls(batch) {
  if (!batch) return "";
  if (batch.status === "ready") return `<button class="primary" data-action="start-batch" ${state.canStart ? "" : "disabled"}>${icon("play")} 开始答题</button>`;
  if (batch.status === "running") return `<button data-action="pause-batch">${icon("pause")} 暂停</button><button class="ghost-danger" data-action="stop-batch">${icon("stop")} 停止</button>`;
  if (["paused","error_paused"].includes(batch.status)) return `<button class="primary" data-action="resume-batch">${icon(batch.status === "error_paused" ? "refresh" : "play")} ${batch.status === "error_paused" ? "重试当前题" : "继续"}</button><button class="ghost-danger" data-action="stop-batch">${icon("stop")} 停止</button>`;
  return "";
}

function decisionMethodInfo(method) {
  const raw = String(method || "未知方式");
  return ({
    "补丁规则": { label: "补丁规则", tone: "patch" },
    "字典匹配": { label: "词库匹配", tone: "dictionary" },
    "词典匹配": { label: "词库匹配", tone: "dictionary" },
    "大模型决策": { label: "AI 大模型", tone: "llm" },
    "AI 大模型": { label: "AI 大模型", tone: "llm" },
    "确定性兜底": { label: "确定性兜底", tone: "fallback" }
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
      <div class="answer-card-head"><span class="answer-number">Q${esc(item.itemId)}</span>${index === 0 ? `<span class="latest-mark">刚刚</span>` : ""}<time>${esc(time)}</time></div>
      <div class="answer-source">${esc(item.sourceText || "未识别题目")}</div>
      <div class="answer-result"><strong>${esc(item.target || "—")}</strong><span class="answer-text">${esc(item.answerText || "未识别答案文本")}</span></div>
      <div class="answer-card-foot"><span class="decision-method ${esc(method.tone)}">${esc(method.label)}</span>${confidence}</div>
    </article>`;
  }).join("");
  const total = batch?.targetCount || history.length;
  return `<aside class="answer-history-panel" aria-label="本次答题详情">
    <header class="answer-panel-header"><span class="panel-leaf">${icon("leaf")}</span><div><h2>本次答题详情</h2><p>仅在本次运行中保留</p></div><span class="answer-total">${history.length}${total ? ` / ${total}` : ""}</span></header>
    ${summary ? `<div class="answer-summary">${summary}</div>` : ""}
    <div class="answer-history-list" aria-live="polite">${cards || `<div class="answer-empty">${icon("sparkles")}<strong>等待开始答题</strong><span>每题的答案和决策来源会显示在这里</span></div>`}</div>
  </aside>`;
}

function renderLearning() {
  const batch = activeBatch();
  setBrowserVisible(Boolean(state.browserOpen || batch));
  const pageInfo = state.page || {};
  const percent = batch ? Math.min(100, Math.round(batch.answeredCount / batch.targetCount * 100)) : 0;
  const final = batch && ["final_pending","confirming_submission"].includes(batch.status);
  const browserLocked = batch?.status === "running";
  const finalControls = final ? `<div class="final-actions"><label class="extend-field"><span>再练</span><input id="extend-count" aria-label="增加题量" type="number" min="1" value="10"><small>题</small></label><button data-action="extend-batch">增加</button>${batch.submissionTimedOut ? `<button class="primary" data-action="manual-submitted">${icon("check")} 我已提交</button>` : `<span class="final-wait">${batch.status === "confirming_submission" ? "正在识别结果页" : "等待你在网页提交"}</span>`}</div>` : "";
  const capturingWrongQuestion = wrongQuestionFeedback?.tone === "working";
  const resultControls = pageInfo.resultPage ? `<div class="result-capture-actions"><button class="capture-wrong-button" data-action="capture-wrong-question" ${pageInfo.wrongQuestionReady && !capturingWrongQuestion ? "" : "disabled"}>${icon(capturingWrongQuestion ? "refresh" : "patch")} ${capturingWrongQuestion ? "正在扫描" : "记录错题"}</button>${wrongQuestionFeedback ? `<span class="capture-feedback ${esc(wrongQuestionFeedback.tone)}" role="status" aria-live="polite" title="${esc(wrongQuestionFeedback.text)}">${esc(wrongQuestionFeedback.text)}</span>` : `<span class="capture-feedback hint">${pageInfo.wrongQuestionReady ? "当前错题可以记录" : "请翻到一条错题"}</span>`}</div>` : "";
  return renderShell(`<div class="browser-bar"><div class="browser-actions"><button class="icon-button" aria-label="后退" title="后退" data-action="browser-back" ${browserLocked?"disabled":""}>${icon("arrowLeft")}</button><button class="icon-button" aria-label="前进" title="前进" data-action="browser-forward" ${browserLocked?"disabled":""}>${icon("chevronRight")}</button><button class="icon-button" aria-label="刷新" title="刷新" data-action="browser-reload" ${browserLocked?"disabled":""}>${icon("rotate")}</button><button class="icon-button" aria-label="返回学习首页" title="返回学习首页" data-action="browser-home" ${browserLocked?"disabled":""}>${icon("siteHome")}</button></div><label class="address-field"><span class="visually-hidden">网页地址</span>${icon("lock")}<input id="address" value="${esc(pageInfo.url || state.data.settings.learningHome)}" ${browserLocked?"disabled":""}></label><button class="go-button" data-action="browser-go" ${browserLocked?"disabled":""}>前往 ${icon("arrowRight")}</button></div>
    <div class="run-bar ${final ? "final-state" : ""}"><div class="run-status"><span class="site-mark">${icon("learn")}</span><div class="site-copy"><strong>学习站点</strong><small>${batch ? statusText(batch.status) : pageInfo.resultPage ? "结果复盘" : "等待创建任务"}</small></div>${batch ? `<span class="pill ${esc(batch.status)}">${statusText(batch.status)}</span><div class="progress" role="progressbar" aria-label="答题进度" aria-valuemin="0" aria-valuemax="${batch.targetCount}" aria-valuenow="${batch.answeredCount}"><span style="width:${percent}%"></span></div><span class="progress-count"><b>${batch.answeredCount}</b> / ${batch.targetCount}</span>` : ""}</div><div class="run-actions">${resultControls}${finalControls}${runControls(batch)}</div></div>
    ${(state.browserOpen || batch || (state.answerHistory?.length || 0) > 0) ? renderAnswerHistoryPanel(batch) : ""}
    ${!state.browserOpen && !batch ? `<div class="browser-placeholder">${icon("learn")}<strong>还没有学习任务</strong><span>先到首页选择这一轮的题量</span></div>` : ""}`,
    "learning");
}

async function loadRecords(pageNumber = records?.page || 1) {
  records = await window.hduSnap.listRecords({ ...recordFilters, page: pageNumber });
  render();
}

function renderRecords() {
  setBrowserVisible(false);
  if (!records) void loadRecords();
  const items = records?.items || [];
  const actions = `<button data-action="export-csv">${icon("download")} CSV</button><button data-action="export-json">${icon("download")} JSON</button><button class="ghost-danger" data-action="delete-records">${icon("trash")} 删除选中</button>`;
  return renderShell(`<section class="card table-card"><div class="table-toolbar"><div class="table-filter-controls"><label for="record-status">状态<select id="record-status"><option value="" ${!recordFilters.status?"selected":""}>全部状态</option><option value="completed" ${recordFilters.status==="completed"?"selected":""}>已完成</option><option value="stopped" ${recordFilters.status==="stopped"?"selected":""}>已中止</option><option value="interrupted" ${recordFilters.status==="interrupted"?"selected":""}>异常中止</option><option value="submission_unconfirmed" ${recordFilters.status==="submission_unconfirmed"?"selected":""}>未确认提交</option></select></label><label for="record-date-from">开始日期<input id="record-date-from" type="date" value="${esc(recordFilters.dateFrom)}"></label><label for="record-date-to">结束日期<input id="record-date-to" type="date" value="${esc(recordFilters.dateTo)}"></label><button class="soft" data-action="filter-records">${icon("filter")} 应用</button><button data-action="reset-record-filters">重置</button></div><div class="table-toolbar-tail"><span>共 ${records?.total || 0} 条</span><div class="table-toolbar-actions">${actions}</div></div></div><div class="table-wrap"><table><thead><tr><th class="select-column"><span class="visually-hidden">选择</span></th><th>开始时间</th><th>答题进度</th><th>批次状态</th></tr></thead><tbody>${items.map((item)=>`<tr><td><input class="record-check" aria-label="选择该批次" type="checkbox" value="${esc(item.id)}"></td><td><strong class="table-date">${esc(item.startedAt || item.endedAt)}</strong></td><td><span class="table-progress">${item.answeredCount}<small>/ ${item.targetCount}</small></span></td><td><span class="pill ${esc(item.status)}">${statusText(item.status)}</span></td></tr>`).join("") || `<tr><td colspan="4"><div class="table-empty">${icon("records")}<strong>这里还没有练习记录</strong><span>完成或停止一个批次后，它会出现在这里。</span></div></td></tr>`}</tbody></table></div><footer class="card-footer records-footer"><span>${icon("info")} 最多保留 1000 批，超出后自动清理最旧记录。</span><div class="pagination"><button data-action="records-prev" ${!records || records.page <= 1 ? "disabled" : ""}>${icon("arrowLeft")} 上一页</button><strong>${records?.page || 1} / ${records?.pageCount || 1}</strong><button data-action="records-next" ${!records || records.page >= records.pageCount ? "disabled" : ""}>下一页 ${icon("chevronRight")}</button></div></footer></section>`);
}

async function loadPatches() { patches = await window.hduSnap.listPatches(); render(); }

function renderSettings() {
  setBrowserVisible(false);
  const tabs = [["general","settings","常规"],["patches","patch","纠错补丁"],["migration","archive","迁移与数据"]];
  const general = `<div class="settings-grid"><section class="setting-section"><div class="setting-heading"><span class="setting-icon">${icon("siteHome")}</span><div><h3>学习站点</h3><p>选择点击“返回学习首页”时打开的站点。</p></div></div><label class="field"><span>默认学习首页</span><select id="learning-home">${SUPPORTED_SITE_OPTIONS()}</select></label></section><section class="setting-section"><div class="setting-heading"><span class="setting-icon">${icon("key")}</span><div><h3>DeepSeek</h3><p>Key 只经过主进程验证，并由 macOS 钥匙串保护。</p></div><span class="config-status ${state.keyConfigured?"configured":""}">${state.keyConfigured?icon("check"):icon("minus")}${state.keyConfigured?"已配置":"未配置"}</span></div><div class="inline-form"><label class="field grow"><span>更换 Key</span><input id="settings-key" type="password" autocomplete="off" placeholder="输入新的 Key"></label><button data-action="save-key">验证并更换</button><button class="ghost-danger" data-action="remove-key" ${state.keyConfigured?"":"disabled"}>移除</button></div></section><section class="setting-section"><div class="setting-heading"><span class="setting-icon">${icon("refresh")}</span><div><h3>版本与会话</h3><p>选择更新频道，或清除唯一的网页登录会话。</p></div></div><div class="inline-form"><label class="field"><span>更新频道</span><select id="update-channel"><option value="stable" ${state.data.settings.updateChannel==="stable"?"selected":""}>稳定版</option><option value="test" ${state.data.settings.updateChannel==="test"?"selected":""}>测试版</option></select></label><button class="primary align-end" data-action="save-general">${icon("check")} 保存设置</button><button class="align-end" data-action="clear-browser-session">清除网页登录数据</button></div></section></div>`;
  const patchRows = [...(patches?.rules || [])].reverse().map((rule)=>`<tr><td><strong>${esc(rule.source_text)}</strong></td><td><span class="answer-chip">${esc(rule.answer_text)}</span></td><td>${esc(rule.wrong_answer_text) || "—"}</td><td class="note-cell">${esc(rule.note) || "—"}</td><td><button class="icon-button danger-icon" aria-label="删除补丁" title="删除补丁" data-delete-patch-source="${esc(rule.source_text)}" data-delete-patch-answer="${esc(rule.answer_text)}">${icon("trash")}</button></td></tr>`).join("");
  const patchContent = `<div class="settings-grid"><section class="setting-section patch-editor"><div class="setting-heading"><span class="setting-icon">${icon("patch")}</span><div><h3>手动添加补丁</h3><p>新补丁立即对后续所有答题生效；同题冲突会先要求确认。</p></div></div><div class="form-grid"><label for="patch-source">题目</label><input id="patch-source" maxlength="500" value="${esc(patchDraft.source_text)}" placeholder="例如：管理，经营"><label for="patch-answer">正确答案</label><input id="patch-answer" maxlength="300" value="${esc(patchDraft.answer_text)}" placeholder="例如：manage"><label for="patch-wrong">错误答案 <small>可选</small></label><input id="patch-wrong" maxlength="300" value="${esc(patchDraft.wrong_answer_text)}" placeholder="例如：finish"><label for="patch-note">备注 <small>可选</small></label><input id="patch-note" maxlength="500" value="${esc(patchDraft.note)}" placeholder="补丁来源或说明"></div><div class="row end"><button class="primary" data-action="add-patch">${icon("check")} 保存补丁</button></div></section><section class="setting-section patch-library"><div class="section-heading"><div><span class="eyebrow">PATCH LIBRARY</span><h3>补丁库</h3></div><div class="toolbar"><button class="soft" data-action="load-patches">${icon("refresh")} 刷新</button><button data-action="import-patches">${icon("folder")} 导入旧版补丁（JSON/JSONC）</button><button data-action="export-patches">${icon("download")} 导出 JSON</button></div></div><div class="table-wrap compact"><table><thead><tr><th>题目</th><th>正确答案</th><th>错误答案</th><th>备注</th><th></th></tr></thead><tbody>${patchRows || `<tr><td colspan="5"><div class="table-empty">${icon("patch")}<strong>还没有加载纠错规则</strong><span>点击右上角“刷新”查看当前补丁。</span></div></td></tr>`}</tbody></table></div></section></div>`;
  const migration = `<div class="settings-grid"><section class="setting-section migration-card"><div class="migration-heading"><span class="large-setting-icon">${icon("archive")}</span><div><span class="eyebrow">LEGACY IMPORT</span><h3>从第一阶段项目迁入补丁</h3></div></div><p>选择旧项目目录，读取根目录的 <code>patch_rules.jsonc</code> 和可选 Key。不会迁移调试记录、Chrome Cookie，也不会修改旧文件。</p><button class="primary" data-action="scan-migration">${icon("folder")} 选择并扫描旧项目</button></section><section class="setting-section danger-zone"><div class="migration-heading"><span class="large-setting-icon danger">${icon("trash")}</span><div><span class="eyebrow">DANGER ZONE</span><h3>全部重置</h3></div></div><p>清除网页登录数据、记录、纠错和 Key；随 App 提供的内置资源会保留。</p><button class="ghost-danger" data-action="reset-all">全部重置 HDU-SNAP</button></section></div>`;
  return renderShell(`<section class="settings-card card"><div class="tabs" role="tablist" aria-label="设置类别">${tabs.map(([id,iconName,label])=>`<button role="tab" aria-selected="${settingsTab===id}" data-settings-tab="${id}" class="${settingsTab===id?"active":""}">${icon(iconName)}${label}</button>`).join("")}</div><div class="settings-content">${settingsTab === "general" ? general : settingsTab === "patches" ? patchContent : migration}</div></section>`);
}

function SUPPORTED_SITE_OPTIONS() {
  return ["https://skl.hduhelp.com/?type=5#/english/list","https://skl.hdu.edu.cn/#/english/list"]
    .map((url)=>`<option value="${esc(url)}" ${state.data.settings.learningHome===url?"selected":""}>${esc(url)}</option>`).join("");
}

async function loadDiagnostic() { diagnostic = await window.hduSnap.diagnosticStatus(); render(); }

function renderDiagnostic() {
  setBrowserVisible(false);
  if (!diagnostic) void loadDiagnostic();
  const update = state.update;
  const latest = update?.latest;
  const updateChecking = updateCheckFeedback?.status === "checking";
  const updateLabel = update?.status === "update_available" ? "发现新版本" : update?.status === "up_to_date" ? "当前已是最新" : update?.status === "no_eligible_release" ? "当前频道暂无版本" : "尚未检查";
  const updateFeedback = updateCheckFeedback
    ? `<div class="update-check-feedback ${esc(updateCheckFeedback.status)}" role="status" aria-live="polite" aria-atomic="true">${icon(updateCheckFeedback.status === "error" ? "x" : updateCheckFeedback.status === "checking" ? "refresh" : "check", updateCheckFeedback.status === "checking" ? "update-spinner" : "")}<span>${esc(updateCheckFeedback.message)}</span></div>`
    : "";
  return renderShell(`<section class="health-grid"><article class="health-card card"><div class="health-card-head"><span class="health-icon sage">${icon("diagnostic")}</span><div class="health-head-actions"><span class="health-state good">${icon("check")} 核心在线</span><button class="soft compact-button" data-action="run-self-check">${icon("refresh")} 重新检查</button></div></div><span class="eyebrow">COMPONENTS</span><h2>本地组件</h2><div class="component-list"><div><span>${icon("check")}</span><p><strong>答题流水线</strong><small>补丁、词典与大模型接口就绪</small></p></div><div><span>${state.keyConfigured?icon("check"):icon("minus")}</span><p><strong>DeepSeek</strong><small>${state.keyConfigured ? "Key 已由钥匙串保护" : "未配置，将使用确定性兜底"}</small></p></div><div><span>${icon("check")}</span><p><strong>内嵌网页</strong><small>隔离容器可用</small></p></div></div>${state.coreError?`<p class="error-panel">${esc(state.coreError)}</p>`:""}</article><article class="health-card card"><div class="health-card-head"><span class="health-icon terracotta">${icon("folder")}</span><span class="health-metric">${Math.round((diagnostic?.logBytes||0)/1024)} KB</span></div><span class="eyebrow">LOCAL LOGS</span><h2>日志与诊断</h2><p>日志保留 30 天或 100 MB。诊断包会排除密码、Cookie、令牌和 Key。</p><label class="privacy-confirm"><input id="diagnostic-privacy" type="checkbox" ${diagnosticPrivacyConfirmed ? "checked" : ""}><span>我确认诊断包可能包含答题内容、网页快照和页面中可见的个人信息。</span></label><div class="health-actions"><button data-action="show-logs">${icon("folder")} Finder 中显示</button><button data-action="clear-logs">清空日志</button><button class="primary" data-action="export-diagnostic" ${diagnosticPrivacyConfirmed ? "" : "disabled"}>${icon("download")} 导出诊断 ZIP</button></div></article><article class="health-card card version-card"><div class="health-card-head"><span class="health-icon mustard">${icon("refresh")}</span><span class="version-number">v${esc(state.version)}</span></div><span class="eyebrow">VERSION</span><h2>版本维护</h2><p>当前频道：<strong>${esc(state.data.settings.updateChannel === "stable" ? "稳定版" : "测试版")}</strong> · ${esc(updateLabel)}</p>${latest ? `<div class="release-summary"><strong>v${esc(latest.version)}</strong><span>${esc(latest.summary)}</span><code>${esc(latest.sha256)}</code></div>` : ""}${updateFeedback}<div class="version-actions"><button data-action="check-update" ${updateChecking ? "disabled" : ""} aria-busy="${updateChecking}">${updateChecking ? `${icon("refresh", "update-spinner")} 正在检查…` : `立即检查新版本 ${icon("refresh")}`}</button>${latest ? `<button class="primary" data-action="open-release">打开私有 Release ${icon("arrowRight")}</button>` : ""}</div><div class="privacy-note">${icon("info")} 只读取公开版本清单，不保存 GitHub Token，也不会自动下载或安装更新。</div></article></section>`);
}

function render() {
  if (!state) return;
  if (state.blocked) return renderBlocked();
  if (!state.data.onboardingComplete) return renderOnboarding();
  const renderer = { home: renderHome, learn: renderLearning, records: renderRecords, settings: renderSettings, diagnostic: renderDiagnostic }[page] || renderHome;
  root.innerHTML = renderer();
}

root.addEventListener("change", (event) => {
  if (event.target.id === "answer-count") {
    answerCount = event.target.value;
    document.querySelectorAll("[data-answer-preset]").forEach((button) => button.classList.toggle("active", Number(button.dataset.answerPreset) === Number(answerCount)));
  }
  if (event.target.id === "diagnostic-privacy") {
    diagnosticPrivacyConfirmed = event.target.checked;
    render();
  }
});

root.addEventListener("input", (event) => {
  const patchField = {
    "patch-source": "source_text",
    "patch-answer": "answer_text",
    "patch-wrong": "wrong_answer_text",
    "patch-note": "note"
  }[event.target.id];
  if (patchField) patchDraft[patchField] = event.target.value;
});

root.addEventListener("click", async (event) => {
  const preset = event.target.closest("[data-answer-preset]");
  if (preset) {
    answerCount = preset.dataset.answerPreset;
    const input = document.getElementById("answer-count");
    if (input) input.value = answerCount;
    document.querySelectorAll("[data-answer-preset]").forEach((button) => button.classList.toggle("active", button === preset));
    return;
  }
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
  else if (action === "create-task") {
    answerCount = document.getElementById("answer-count").value;
    const result = await call(window.hduSnap.createTask({ answerCount: Number(answerCount) }));
    if (result?.ok !== false) {
      state = result?.state || await window.hduSnap.getState();
      page = "learn";
      render();
    }
  }
  else if (action === "discard-task" && confirm("放弃尚未开始的批次并重新配置？")) await call(window.hduSnap.discardTask());
  else if (action === "browser-back") window.hduSnap.browserBack();
  else if (action === "browser-forward") window.hduSnap.browserForward();
  else if (action === "browser-reload") window.hduSnap.browserReload();
  else if (action === "browser-home") await call(window.hduSnap.browserHome());
  else if (action === "browser-go") { const url=document.getElementById("address").value; let result=await window.hduSnap.browserNavigate({url}); if(result?.blocked==="http_confirmation" && confirm("HTTP 连接不安全，仍要加载？")) await window.hduSnap.browserNavigate({url,httpConfirmed:true}); }
  else if (action === "start-batch") await call(window.hduSnap.startBatch());
  else if (action === "pause-batch") await call(window.hduSnap.pauseBatch());
  else if (action === "resume-batch") await call((activeBatch().status==="error_paused"?window.hduSnap.retryBatch():window.hduSnap.resumeBatch()));
  else if (action === "stop-batch" && confirm("停止后该批次不可恢复，确定停止？")) await call(window.hduSnap.stopBatch());
  else if (action === "extend-batch") await call(window.hduSnap.extendBatch(Number(document.getElementById("extend-count").value)));
  else if (action === "manual-submitted" && confirm("只更新本地状态，不会操作网页。确认你已经亲自提交？")) await call(window.hduSnap.confirmSubmitted());
  else if (action === "capture-wrong-question") {
    wrongQuestionFeedback = { tone: "working", text: "正在扫描当前题…" };
    render();
    let result = await window.hduSnap.captureWrongQuestion();
    if (result?.status === "conflict") {
      const existing = (result.existingRules || []).map((rule) => rule.answer_text).join("、") || "未知答案";
      if (confirm(`补丁库中已有同题答案：${existing}。本次识别为：${result.answerText}。确认替换吗？`)) {
        result = await window.hduSnap.captureWrongQuestion({ confirmConflict: true });
      } else {
        wrongQuestionFeedback = { tone: "error", text: "已保留原补丁，未写入本次结果。" };
        render();
        return;
      }
    }
    wrongQuestionFeedback = result?.ok === false
      ? { tone: "error", text: result.error || "当前错题记录失败" }
      : result?.status === "duplicate"
        ? { tone: "success", text: `补丁已存在：${result.sourceText} → ${result.answerText}` }
        : { tone: "success", text: `已记录：${result.sourceText} → ${result.answerText}` };
    render();
  }
  else if (action === "filter-records") {
    const dateFrom = document.getElementById("record-date-from").value;
    const dateTo = document.getElementById("record-date-to").value;
    if (dateFrom && dateTo && dateFrom > dateTo) return alert("开始日期不能晚于结束日期。");
    recordFilters = { status: document.getElementById("record-status").value, dateFrom, dateTo };
    await loadRecords(1);
  }
  else if (action === "reset-record-filters") { recordFilters={status:"",dateFrom:"",dateTo:""}; await loadRecords(1); }
  else if (action === "records-prev") await loadRecords(Math.max(1, (records?.page || 1) - 1));
  else if (action === "records-next") await loadRecords(Math.min(records?.pageCount || 1, (records?.page || 1) + 1));
  else if (["export-csv","export-json"].includes(action)) { if(confirm("导出包含本地批次记录，请确认保存位置安全。")) await call(window.hduSnap.exportRecords({format:action.endsWith("json")?"json":"csv",privacyConfirmed:true,filters:recordFilters})); }
  else if (action === "delete-records") { const ids=[...document.querySelectorAll(".record-check:checked")].map(x=>x.value); if(ids.length&&confirm("删除后不可恢复，确定删除？")){await call(window.hduSnap.deleteRecords(ids));await loadRecords(records?.page || 1);} }
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
    let conflictConfirmed = false;
    if (conflicts.length) {
      if (!confirm("已有相同题目的其他补丁。继续会替换旧规则，确定保存？")) return;
      conflictConfirmed = true;
    }
    let result = await call(window.hduSnap.updatePatch({ source_text, answer_text, wrong_answer_text, note, confirm_conflict: conflictConfirmed }));
    if (result?.status === "conflict") {
      if (!confirm("补丁库中存在规范化后相同的题目。继续会替换旧规则，确定保存？")) return;
      result = await call(window.hduSnap.updatePatch({ source_text, answer_text, wrong_answer_text, note, confirm_conflict: true }));
    }
    if (result?.ok !== false) {
      patchDraft = { source_text: "", answer_text: "", wrong_answer_text: "", note: "" };
      await loadPatches();
      alert("补丁已保存并立即生效。");
    }
  }
  else if (action === "export-patches") await call(window.hduSnap.exportPatches());
  else if (action === "import-patches") { const preview=await call(window.hduSnap.importPatches()); if(preview?.preview&&confirm(`发现 ${preview.preview.candidates.length} 条规则。冲突默认跳过，确认合并？`)){await call(window.hduSnap.importPatches({confirm:true}));await loadPatches();} }
  else if (action === "scan-migration") { const result=await call(window.hduSnap.scanMigration()); if(result?.summary&&!result.alreadyImported&&confirm(`发现纠错 ${result.summary.ruleCount} 条。确认导入？`)) await call(window.hduSnap.importMigration({includeKey:result.summary.hasApiKey&&confirm("发现旧 Key。验证成功后迁入钥匙串？")})); else if(result?.alreadyImported) alert("该来源已导入，不会重复写入。") }
  else if (action === "reset-all") { const value=prompt("此操作不可恢复。请输入：重置 HDU-SNAP"); if(value) await call(window.hduSnap.resetAll(value)); }
  else if (action === "show-logs") window.hduSnap.showLogs();
  else if (action === "clear-logs" && confirm("清空本地日志？")) { await call(window.hduSnap.clearLogs()); await loadDiagnostic(); }
  else if (action === "export-diagnostic" && diagnosticPrivacyConfirmed) await call(window.hduSnap.exportDiagnostic({privacyConfirmed:true}));
  else if (action === "check-update") {
    if (updateCheckFeedback?.status === "checking") return;
    updateCheckFeedback = { status: "checking", message: "正在连接公开版本清单…" };
    render();
    try {
      const result = await window.hduSnap.checkUpdate(true);
      if (result?.ok === false) {
        updateCheckFeedback = { status: "error", message: result.error || "检查失败，请稍后重试。" };
      } else {
        state = { ...state, update: result };
        const message = result?.status === "update_available"
          ? `发现新版本 v${result.latest?.version || ""}，可以打开私有 Release 查看。`
          : result?.status === "up_to_date"
            ? `检查完成，当前已是最新版本 v${state.version}。`
            : result?.status === "no_eligible_release"
              ? "检查完成，当前频道暂无适用版本。"
              : "检查完成。";
        updateCheckFeedback = { status: result?.status === "update_available" ? "available" : "success", message };
      }
    } catch (error) {
      updateCheckFeedback = { status: "error", message: error?.message || "检查失败，请稍后重试。" };
    }
    render();
  }
  else if (action === "open-release" && confirm("将打开私有 GitHub Release。需要登录且拥有 HDU-SNAP 仓库访问权限，继续吗？")) await call(window.hduSnap.openLatestRelease());
});

window.hduSnap.onState((next) => {
  const previousResultItemId = state?.page?.resultItemId;
  state = next;
  if (previousResultItemId !== state?.page?.resultItemId && wrongQuestionFeedback?.tone !== "working") {
    wrongQuestionFeedback = null;
  }
  render();
});
window.hduSnap.getState().then((initial) => { state = initial; render(); });
