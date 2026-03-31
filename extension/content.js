const AGENT_CONFIG = {
  maxItems: 100,
  scanDebounceMs: 180,
  minActionDelayMs: 100,
  maxActionDelayMs: 300
};

const LETTERS = ["A", "B", "C", "D"];

const state = {
  sessionId: `tab-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
  active: true,
  solving: false,
  suspended: false,
  batchCompleteSent: false,
  observerStarted: false,
  lastFingerprint: null,
  sequenceCounter: 0,
  answeredCount: 0,
  scanTimer: null
};

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function randomDelay() {
  const span = AGENT_CONFIG.maxActionDelayMs - AGENT_CONFIG.minActionDelayMs;
  return AGENT_CONFIG.minActionDelayMs + Math.floor(Math.random() * (span + 1));
}

function normalizeText(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text || "");
}

function isVisible(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function visibleText(element) {
  return normalizeText(element?.innerText || element?.textContent || "");
}

function parseOptionLine(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(/^([ABCD])[\.\s:：、\)]\s*(.+)$/i);
  if (!match) {
    return null;
  }
  return {
    letter: match[1].toUpperCase(),
    text: normalizeText(match[2]).replace(/[ .。?？:：;；]+$/g, "")
  };
}

function scoreQuestionText(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return -999;
  }

  let score = 0;
  if (/^(开始|提交|确认|返回|继续|题卡|自动下一题|下一项|下一题)$/.test(normalized)) {
    score -= 120;
  }
  if (/^第?\s*\d+\s*题/.test(normalized)) {
    score -= 60;
  }
  if (/^\d+$/.test(normalized)) {
    score -= 40;
  }
  if (/[A-Za-z]{2,}/.test(normalized)) {
    score += 20;
  }
  if ((normalized.match(/[\u4e00-\u9fff]/g) || []).length >= 2) {
    score += 20;
  }
  if (normalized.length >= 2 && normalized.length <= 40) {
    score += 8;
  }
  return score;
}

function extractQuestionCore(text) {
  let normalized = normalizeText(text);
  normalized = normalized.replace(/^QUESTION\s*\d+\s*/i, "");
  normalized = normalized.replace(/^第\s*\d+\s*题\s*/i, "");
  normalized = normalized.replace(/^CET\s*[- ]\s*\d+\s+/i, "");
  normalized = normalized.replace(/^(?:CET[- ]?[46])\s+/i, "");
  normalized = normalized.replace(/(自动下一题|题卡|上一题|下一题).*$/i, "");
  normalized = normalized.split(/\sA[\.\s:：、\)]/)[0];
  return normalized.replace(/^[：:.。\s]+|[：:.。?？\s]+$/g, "");
}

function uniqueElements(elements) {
  return [...new Set(elements.filter(Boolean))];
}

function queryVisible(selector) {
  return uniqueElements([...document.querySelectorAll(selector)]).filter(isVisible);
}

function findProgress() {
  const candidates = queryVisible("body *");

  for (const element of candidates) {
    const text = visibleText(element);
    if (!text) {
      continue;
    }

    let match = text.match(/(?:第\s*)(\d+)\s*(?:题)/);
    if (match) {
      return {
        current: Number(match[1]),
        total: AGENT_CONFIG.maxItems,
        raw: text
      };
    }

    match = text.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      return {
        current: Number(match[1]),
        total: Number(match[2]),
        raw: text
      };
    }
  }

  return null;
}

function findQuestionElement() {
  const selectors = [
    "#app [class*='question']",
    "#app [class*='title']",
    "#app [class*='stem']",
    "#app [class*='topic']",
    "#app main p",
    "#app main span",
    "#app .van-cell__title",
    "#app .question",
    "#app .title"
  ];

  for (const selector of selectors) {
    const elements = queryVisible(selector);
    for (const element of elements) {
      const text = visibleText(element);
      if (!text || text.length > 120) {
        continue;
      }
      if (/^(开始|提交|确认|返回|继续|题卡|自动下一题|下一项|下一题)$/.test(text)) {
        continue;
      }
      if (parseOptionLine(text)) {
        continue;
      }
      if (/^[ABCD][\.\s:：、\)]/.test(text)) {
        continue;
      }
      return element;
    }
  }

  const candidates = queryVisible("#app *")
    .map((element) => ({ element, text: visibleText(element) }))
    .filter(({ text }) => text && text.length >= 2 && text.length <= 60)
    .filter(({ text }) => !/^(开始|提交|确认|返回|继续|题卡|自动下一题|下一项|下一题)$/.test(text))
    .filter(({ text }) => !parseOptionLine(text))
    .filter(({ text }) => hasChinese(text) || /^[a-zA-Z][a-zA-Z\s'-]{1,40}$/.test(text))
    .sort((left, right) => scoreQuestionText(right.text) - scoreQuestionText(left.text));

  return candidates[0]?.element || null;
}

function findOptionCandidates() {
  const selectors = [
    "#app [class*='option']",
    "#app [class*='answer']",
    "#app [class*='item']",
    "#app button",
    "#app .van-cell",
    "#app .van-radio",
    "#app .van-radio-group *",
    "#app li",
    "#app label",
    "#app span"
  ];

  const candidates = [];

  for (const selector of selectors) {
    for (const element of queryVisible(selector)) {
      const text = visibleText(element);
      if (!text) {
        continue;
      }
      if (/^(开始|提交|确认|返回|继续|题卡|自动下一题|下一项|下一题|最终保存)$/.test(text)) {
        continue;
      }
      if (text.length > 80) {
        continue;
      }
      candidates.push({ element, text });
    }
  }

  return candidates;
}

function collectOptions() {
  const result = {};

  for (const candidate of findOptionCandidates()) {
    const rawTexts = [
      candidate.text,
      visibleText(candidate.element.parentElement),
      visibleText(candidate.element.closest("[class*='option'], [class*='answer'], .van-cell, li, label, button"))
    ].filter(Boolean);

    for (const rawText of rawTexts) {
      const parsed = parseOptionLine(rawText);
      if (!parsed) {
        continue;
      }
      const previous = result[parsed.letter];
      if (!previous || parsed.text.length < previous.text.length) {
        result[parsed.letter] = {
          text: parsed.text,
          element: candidate.element
        };
      }
    }
  }

  return LETTERS.every((letter) => result[letter]) ? result : null;
}

function findNextButton() {
  const candidates = queryVisible("button, [role='button'], .van-button, .btn, a");
  return candidates.find((element) => {
    const text = visibleText(element);
    return /(下一项|下一题|继续|下一个)/.test(text);
  }) || null;
}

function findSubmitButton() {
  const candidates = queryVisible("button, [role='button'], .van-button, .btn, a");
  return candidates.find((element) => {
    const text = visibleText(element);
    return /(提交|保存|最终保存|交卷)/.test(text);
  }) || null;
}

function buildSnapshot() {
  const questionElement = findQuestionElement();
  const options = collectOptions();

  if (!questionElement || !options) {
    return null;
  }

  const sourceText = visibleText(questionElement);
  const normalizedQuestion = extractQuestionCore(sourceText);
  if (!normalizedQuestion) {
    return null;
  }

  const optionTexts = {};
  for (const letter of LETTERS) {
    optionTexts[letter] = options[letter].text;
  }

  const progress = findProgress();
  const explicitItemId = progress?.current || null;
  const itemId = explicitItemId || state.sequenceCounter + 1;
  const isLastItem = itemId >= AGENT_CONFIG.maxItems;
  const fingerprint = JSON.stringify({
    normalizedQuestion,
    optionTexts,
    itemId
  });

  return {
    itemId,
    sourceText,
    normalizedQuestion,
    options,
    optionTexts,
    progress,
    isLastItem,
    fingerprint,
    nextButton: findNextButton(),
    submitButton: findSubmitButton()
  };
}

function debugLog(...args) {
  console.info("[HDU-SNAP][content]", ...args);
}

function showSuspendBanner(message) {
  const existing = document.getElementById("hdu-snap-suspend-banner");
  if (existing) {
    existing.textContent = message;
    return;
  }

  const banner = document.createElement("div");
  banner.id = "hdu-snap-suspend-banner";
  banner.textContent = message;
  Object.assign(banner.style, {
    position: "fixed",
    top: "12px",
    right: "12px",
    zIndex: "2147483647",
    maxWidth: "360px",
    padding: "10px 12px",
    borderRadius: "8px",
    background: "rgba(255, 244, 229, 0.98)",
    color: "#6c3d00",
    border: "1px solid #f5c38b",
    boxShadow: "0 6px 18px rgba(0,0,0,0.15)",
    fontSize: "13px",
    lineHeight: "1.5"
  });
  document.body.appendChild(banner);
}

async function safeClick(element, label) {
  if (!(element instanceof HTMLElement)) {
    throw new Error(`missing click target: ${label}`);
  }

  element.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "center"
  });

  await sleep(80);

  element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  element.click();
}

function postMessageToBackground(type, payload) {
  return chrome.runtime.sendMessage({ type, payload }).catch((error) => {
    console.warn("[HDU-SNAP][content] background communication failed:", error);
    throw error;
  });
}

async function submitSnapshot(snapshot) {
  state.solving = true;
  state.lastFingerprint = snapshot.fingerprint;
  state.sequenceCounter = Math.max(state.sequenceCounter, snapshot.itemId);

  debugLog("submit item", {
    itemId: snapshot.itemId,
    sourceText: snapshot.normalizedQuestion,
    optionTexts: snapshot.optionTexts,
    isLastItem: snapshot.isLastItem
  });

  await postMessageToBackground("SOLVE_ITEM", {
    type: "solve_item",
    session_id: state.sessionId,
    item_id: snapshot.itemId,
    source_text: snapshot.normalizedQuestion,
    options: snapshot.optionTexts
  });
}

async function finishBatchIfNeeded() {
  if (state.batchCompleteSent) {
    return;
  }

  state.batchCompleteSent = true;
  await postMessageToBackground("BATCH_COMPLETE", {
    type: "batch_complete",
    session_id: state.sessionId,
    total_items: AGENT_CONFIG.maxItems
  });
}

async function handleDecision(payload) {
  const snapshot = buildSnapshot();
  if (!snapshot) {
    state.solving = false;
    debugLog("decision received but page snapshot is unavailable");
    return;
  }

  const target = payload.target;
  const selected = snapshot.options[target];
  if (!selected) {
    state.solving = false;
    throw new Error(`target option not found: ${target}`);
  }

  debugLog("apply decision", payload);

  await safeClick(selected.element, `option-${target}`);
  await sleep(randomDelay());

  state.answeredCount = Math.max(state.answeredCount, snapshot.itemId);

  if (snapshot.isLastItem) {
    state.suspended = true;
    state.solving = false;
    showSuspendBanner("HDU-SNAP 已在第 100 题后自动挂起，未点击最终提交按钮，请人工核验后再提交。");
    await finishBatchIfNeeded();
    return;
  }

  if (snapshot.submitButton && !snapshot.nextButton) {
    state.suspended = true;
    state.solving = false;
    showSuspendBanner("检测到提交按钮但未发现下一项按钮，流程已挂起以避免自动提交。");
    return;
  }

  if (!snapshot.nextButton) {
    state.solving = false;
    debugLog("next button not found, wait for DOM refresh");
    scheduleScan();
    return;
  }

  await safeClick(snapshot.nextButton, "next-button");
  state.solving = false;
  scheduleScan();
}

function scheduleScan() {
  if (!state.active || state.suspended) {
    return;
  }

  if (state.scanTimer) {
    window.clearTimeout(state.scanTimer);
  }

  state.scanTimer = window.setTimeout(async () => {
    state.scanTimer = null;

    if (state.solving || state.suspended) {
      return;
    }

    const snapshot = buildSnapshot();
    if (!snapshot) {
      return;
    }

    if (snapshot.fingerprint === state.lastFingerprint) {
      return;
    }

    try {
      await submitSnapshot(snapshot);
    } catch (error) {
      state.solving = false;
      console.error("[HDU-SNAP][content] submit snapshot failed:", error);
    }
  }, AGENT_CONFIG.scanDebounceMs);
}

function startObserver() {
  if (state.observerStarted) {
    return;
  }

  const observer = new MutationObserver(() => {
    scheduleScan();
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: false
  });

  window.addEventListener("load", scheduleScan, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleScan();
    }
  });

  state.observerStarted = true;
  scheduleScan();
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "BACKEND_DECISION") {
    const payload = message.payload;
    if (payload.session_id !== state.sessionId) {
      return;
    }
    handleDecision(payload).catch((error) => {
      state.solving = false;
      console.error("[HDU-SNAP][content] failed to apply decision:", error);
    });
    return;
  }

  if (message.type === "BACKEND_ERROR") {
    const payload = message.payload;
    if (payload.session_id && payload.session_id !== state.sessionId) {
      return;
    }
    state.solving = false;
    console.error("[HDU-SNAP][content] backend error:", payload);
    scheduleScan();
    return;
  }

  if (message.type === "BACKEND_BATCH_SUMMARY") {
    const payload = message.payload;
    if (payload.session_id && payload.session_id !== state.sessionId) {
      return;
    }
    debugLog("batch summary", payload);
  }
});

chrome.runtime.sendMessage({ type: "PING_CONNECTION" }).finally(() => {
  startObserver();
});
