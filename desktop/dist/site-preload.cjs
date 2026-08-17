"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// src/site/dom.cjs
var require_dom = __commonJS({
  "src/site/dom.cjs"(exports2, module2) {
    "use strict";
    function normalizeText2(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }
    function parseOptionLine2(text) {
      const match = normalizeText2(text).match(/^([ABCD])[.\s:：、)]\s*(.+)$/i);
      if (!match) return null;
      return {
        letter: match[1].toUpperCase(),
        text: normalizeText2(match[2]).replace(/[ .。?？:：;；]+$/g, "")
      };
    }
    function extractQuestionCore2(text) {
      return normalizeText2(text).replace(/^QUESTION\s*\d+\s*/i, "").replace(/^第\s*\d+\s*题\s*/i, "").replace(/^CET\s*[- ]\s*\d+\s+/i, "").replace(/^(?:CET[- ]?[46])\s+/i, "").replace(/(自动下一题|题卡|上一题|下一题).*$/i, "").split(/\sA[.\s:：、)]/)[0].replace(/^[：:.。\s]+|[：:.。?？\s]+$/g, "");
    }
    function nextActionAfterDecision2({ isFinal, nextAvailable }) {
      if (isFinal) return "finish";
      return nextAvailable ? "next" : "wait";
    }
    module2.exports = {
      extractQuestionCore: extractQuestionCore2,
      nextActionAfterDecision: nextActionAfterDecision2,
      normalizeText: normalizeText2,
      parseOptionLine: parseOptionLine2
    };
  }
});

// src/site/preload.cjs
var { ipcRenderer } = require("electron");
var {
  extractQuestionCore,
  nextActionAfterDecision,
  normalizeText,
  parseOptionLine
} = require_dom();
var LETTERS = ["A", "B", "C", "D"];
var state = {
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
var send = (type, payload = {}) => ipcRenderer.send("site:event", { type, payload });
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
    "#app [class*='option']",
    "#app [class*='answer']",
    "#app [class*='item']",
    "#app button",
    "#app .van-cell",
    "#app .van-radio",
    "#app li",
    "#app label",
    "#app span"
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
    "#app [class*='question']",
    "#app [class*='stem']",
    "#app [class*='topic']",
    "#app [class*='title']",
    "#app main p",
    "#app main span",
    "#app .van-cell__title"
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
  return visibleElements("button, [role='button'], .van-button, .btn, a").find((element) => /(下一项|下一题|继续|下一个)/.test(textOf(element))) || null;
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
function pageState() {
  const current = snapshot();
  const bodyText = textOf(document.body);
  const supported = ["skl.hduhelp.com", "skl.hdu.edu.cn"].includes(location.hostname);
  const historyRoute = /#\/english\/list(?:[/?#]|$)/.test(location.href);
  const resultPage = /(答题结果|正确率|本次得分)/.test(bodyText) || historyRoute && /(历史记录|做题记录|答题记录|提交记录)/.test(bodyText);
  const payload = {
    url: location.href,
    title: document.title,
    supported,
    questionReady: supported && Boolean(current),
    resultPage
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
  if (nextAction === "finish") {
    state.active = false;
    state.solving = false;
    send("final-pending", { answeredCount: state.answeredCount });
    return;
  }
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
    const target = event.target instanceof Element ? event.target.closest("button, [role='button'], .van-button, .btn, a") : null;
    if (target && /(提交|保存|最终保存|交卷)/.test(textOf(target))) {
      send("submission-started");
    }
  }, true);
  pageState();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
