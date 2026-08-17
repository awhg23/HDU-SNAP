"use strict";

const { ipcRenderer } = require("electron");
const {
  extractCorrectTarget,
  extractQuestionCore,
  extractWrongTarget,
  isWrongQuestionResult,
  nextActionAfterDecision,
  normalizeText,
  parseOptionLine
} = require("./dom.cjs");

const LETTERS = ["A", "B", "C", "D"];
const state = {
  active: false,
  paused: false,
  targetCount: 100,
  answeredCount: 0,
  scanDebounceMs: 180,
  minDelayMs: 100,
  maxDelayMs: 300,
  solving: false,
  lastFingerprint: null,
  timer: null,
  observer: null,
  submissionWatch: false,
  userLocked: false,
  lastPageState: ""
};

const send = (type, payload = {}) => ipcRenderer.send("site:event", { type, payload });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function visible(element) {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
}

function textOf(element) {
  return normalizeText(element?.innerText || element?.textContent || "");
}

function visibleElements(selector) {
  return [...document.querySelectorAll(selector)].filter(visible);
}

function progressFromPage() {
  for (const element of visibleElements("body *")) {
    const text = textOf(element);
    let match = text.match(/第\s*(\d+)\s*题/);
    if (match) return { current: Number(match[1]), total: state.targetCount };
    match = text.match(/(?:^|\s)(\d+)\s*\/\s*(\d+)(?:\s|$)/);
    if (match) return { current: Number(match[1]), total: Number(match[2]) };
  }
  return null;
}

function optionCandidates() {
  const selector = [
    "#app [class*='option']", "#app [class*='answer']", "#app [class*='item']",
    "#app button", "#app .van-cell", "#app .van-radio", "#app li", "#app label", "#app span"
  ].join(",");
  const result = {};
  for (const element of visibleElements(selector)) {
    const rawValues = [textOf(element), textOf(element.parentElement)];
    for (const raw of rawValues) {
      const parsed = parseOptionLine(raw);
      if (!parsed || parsed.text.length > 300) continue;
      if (!result[parsed.letter] || parsed.text.length < result[parsed.letter].text.length) {
        result[parsed.letter] = { text: parsed.text, element };
      }
    }
  }
  return LETTERS.every((letter) => result[letter]) ? result : null;
}

function questionElement() {
  const selectors = [
    "#app [class*='question']", "#app [class*='stem']", "#app [class*='topic']",
    "#app [class*='title']", "#app main p", "#app main span", "#app .van-cell__title"
  ];
  const candidates = [];
  for (const selector of selectors) {
    for (const element of visibleElements(selector)) {
      const text = textOf(element);
      if (!text || text.length > 120 || parseOptionLine(text)) continue;
      if (/^(开始|提交|确认|返回|继续|题卡|下一题|最终保存)$/.test(text)) continue;
      const score = (/\p{Script=Han}{2,}/u.test(text) ? 20 : 0) + (/[A-Za-z]{2,}/.test(text) ? 20 : 0) - text.length / 100;
      candidates.push({ element, score });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.element || null;
}

function nextButton() {
  return visibleElements("button, [role='button'], .van-button, .btn, a")
    .find((element) => /(下一项|下一题|继续|下一个)/.test(textOf(element))) || null;
}

function snapshot() {
  const question = questionElement();
  const options = optionCandidates();
  if (!question || !options) return null;
  const sourceText = extractQuestionCore(textOf(question));
  if (!sourceText) return null;
  const progress = progressFromPage();
  const itemId = progress?.current || state.answeredCount + 1;
  const optionTexts = Object.fromEntries(LETTERS.map((letter) => [letter, options[letter].text]));
  return {
    itemId,
    sourceText,
    options: optionTexts,
    progress,
    fingerprint: JSON.stringify({ itemId, sourceText, optionTexts }),
    elements: options,
    next: nextButton()
  };
}

function optionStateTokens(element) {
  const tokens = [];
  let current = element;
  for (let depth = 0; current instanceof HTMLElement && depth < 4; depth += 1) {
    tokens.push(String(current.className || ""));
    tokens.push(String(current.getAttribute("data-status") || ""));
    tokens.push(String(current.getAttribute("aria-label") || ""));
    if (current.matches("input:checked, [aria-checked='true']")) tokens.push("selected");
    current = current.parentElement;
  }
  return normalizeText(tokens.join(" ")).toLowerCase();
}

function wrongTargetFromOptions(current, correctTarget) {
  for (const letter of LETTERS) {
    if (letter === correctTarget) continue;
    const tokens = optionStateTokens(current.elements[letter]?.element);
    if (/(?:^|[\s_-])(wrong|incorrect|error|danger|failed?|selected-wrong)(?:$|[\s_-])/.test(tokens)) {
      return letter;
    }
  }
  return null;
}

function captureWrongQuestion(requestId) {
  const current = snapshot();
  const bodyText = textOf(document.body);
  const correctTarget = extractCorrectTarget(bodyText);
  if (!current || !isWrongQuestionResult(bodyText) || !correctTarget || !current.options[correctTarget]) {
    send("wrong-question-scan-result", {
      requestId,
      ok: false,
      error: "当前页面未识别到可记录的错题，请先翻到显示正确答案的错题详情。"
    });
    return;
  }
  const wrongTarget = extractWrongTarget(bodyText) || wrongTargetFromOptions(current, correctTarget);
  send("wrong-question-scan-result", {
    requestId,
    ok: true,
    itemId: current.itemId,
    sourceText: current.sourceText,
    options: current.options,
    correctTarget,
    correctOptionText: current.options[correctTarget],
    wrongTarget,
    wrongOptionText: wrongTarget ? current.options[wrongTarget] : ""
  });
}

function pageState() {
  const current = snapshot();
  const bodyText = textOf(document.body);
  const supported = ["skl.hduhelp.com", "skl.hdu.edu.cn"].includes(location.hostname);
  const historyRoute = /#\/english\/list(?:[/?#]|$)/.test(location.href);
  const resultPage = /(答题结果|正确率|本次得分)/.test(bodyText)
    || (historyRoute && /(历史记录|做题记录|答题记录|提交记录)/.test(bodyText));
  const payload = {
    url: location.href,
    title: document.title,
    supported,
    questionReady: supported && Boolean(current),
    resultPage,
    resultItemId: resultPage ? current?.itemId || null : null,
    wrongQuestionReady: supported && Boolean(current) && isWrongQuestionResult(bodyText)
  };
  const serialized = JSON.stringify(payload);
  if (serialized !== state.lastPageState) {
    state.lastPageState = serialized;
    send("page-state", payload);
  }
  if (state.submissionWatch && resultPage) {
    const score = bodyText.match(/(?:得分|成绩|正确率)\s*[:：]?\s*([0-9.]+%?)/)?.[1] || null;
    state.submissionWatch = false;
    send("submission-detected", { score });
  }
}

function scheduleScan() {
  pageState();
  if (!state.active || state.paused || state.solving) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    const current = snapshot();
    if (!current || current.fingerprint === state.lastFingerprint) return;
    state.solving = true;
    state.lastFingerprint = current.fingerprint;
    send("question", {
      itemId: current.itemId,
      sourceText: current.sourceText,
      options: current.options
    });
  }, state.scanDebounceMs);
}

async function clickElement(element) {
  if (!(element instanceof HTMLElement)) throw new Error("click target missing");
  element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
  await sleep(50);
  for (const type of ["mouseover", "mousedown", "mouseup"]) {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  element.click();
}

async function applyDecision(decision) {
  const current = snapshot();
  if (!current || !LETTERS.includes(decision.target) || !current.elements[decision.target]) {
    throw new Error("current question changed before decision");
  }
  const isFinal = state.answeredCount + 1 >= state.targetCount;
  await clickElement(current.elements[decision.target].element);
  const delay = state.minDelayMs + Math.floor(Math.random() * (state.maxDelayMs - state.minDelayMs + 1));
  await sleep(delay);
  const nextAction = nextActionAfterDecision({
    isFinal,
    nextAvailable: Boolean(current.next?.isConnected)
  });
  if (nextAction === "next") await clickElement(current.next);
  state.answeredCount += 1;
  send("answer-selected", {
    question: { itemId: current.itemId, sourceText: current.sourceText, options: current.options },
    decision
  });

  // Safety invariant: reaching the configured target ends this routine immediately.
  if (nextAction === "finish") {
    state.active = false;
    state.solving = false;
    send("final-pending", { answeredCount: state.answeredCount });
    return;
  }
  // The real HDU exercise page commonly enables "自动下一题" and exposes no
  // textual next button. That is a valid state: wait for its DOM to advance
  // instead of counting a missing button as an automation failure.
  state.solving = false;
  scheduleScan();
}

ipcRenderer.on("site:command", (_event, command) => {
  if (!command || typeof command !== "object") return;
  const payload = command.payload || {};
  if (command.type === "configure") {
    state.targetCount = Number(payload.targetCount) || 100;
    state.answeredCount = Number(payload.answeredCount) || 0;
    state.scanDebounceMs = Number(payload.scanDebounceMs) || 180;
    state.minDelayMs = Number(payload.minDelayMs) || 100;
    state.maxDelayMs = Number(payload.maxDelayMs) || 300;
  } else if (command.type === "start" || command.type === "resume") {
    state.active = true;
    state.paused = false;
    state.solving = false;
    state.lastFingerprint = null;
    scheduleScan();
  } else if (command.type === "pause") {
    state.paused = true;
    state.solving = false;
  } else if (command.type === "stop") {
    state.active = false;
    state.paused = false;
    state.solving = false;
  } else if (command.type === "decision") {
    applyDecision(payload).catch((error) => {
      state.solving = false;
      send("automation-error", { reason: error.message });
    });
  } else if (command.type === "watch-submission") {
    state.submissionWatch = true;
    pageState();
  } else if (command.type === "inspect") {
    pageState();
  } else if (command.type === "capture-wrong-question") {
    captureWrongQuestion(String(payload.requestId || ""));
  } else if (command.type === "set-locked") {
    state.userLocked = Boolean(payload.locked);
  }
});

function boot() {
  state.observer = new MutationObserver(() => {
    scheduleScan();
  });
  state.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener("load", pageState);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pageState();
  });
  document.addEventListener("click", (event) => {
    if (state.userLocked && event.isTrusted) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!state.submissionWatch) return;
    const target = event.target instanceof Element
      ? event.target.closest("button, [role='button'], .van-button, .btn, a")
      : null;
    if (target && /(提交|保存|最终保存|交卷)/.test(textOf(target))) {
      send("submission-started");
    }
  }, true);
  pageState();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
