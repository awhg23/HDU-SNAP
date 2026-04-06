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
  scanTimer: null,
  reviewEnabled: false,
  reviewPhase: "idle",
  reviewTimer: null,
  reviewWorking: false,
  reviewRecordOpened: false,
  reviewQueue: [],
  reviewCollected: new Set(),
  reviewResults: [],
  reviewResultsSent: false,
  answerHistory: {},
  reviewVisited: new Set(),
  reviewNavigationMode: "card",
  mobileEmulationEnabled: false,
  examEmulationReleaseRequested: false
};

function persistReviewState(partialState) {
  return chrome.runtime.sendMessage({
    type: "UPDATE_REVIEW_STATE",
    payload: partialState
  }).catch((error) => {
    console.warn("[HDU-SNAP][content] failed to persist review state:", error);
  });
}

function persistExamState(partialState) {
  return chrome.runtime.sendMessage({
    type: "UPDATE_EXAM_STATE",
    payload: partialState
  }).catch((error) => {
    console.warn("[HDU-SNAP][content] failed to persist exam state:", error);
  });
}

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

function elementTrail(element, depth = 3) {
  const trail = [];
  let current = element;
  for (let index = 0; index < depth && current; index += 1) {
    trail.push(current);
    current = current.parentElement;
  }
  return trail;
}

function textLooksLikeButton(text) {
  return /^(开始|开始答题|考试|提交|确认|返回|继续|题卡|自动下一题|下一项|下一题|最终保存)$/.test(text);
}

function classTrail(element) {
  return elementTrail(element, 4)
    .map((node) => String(node.className || ""))
    .join(" ")
    .toLowerCase();
}

function parseRgb(color) {
  const match = String(color || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) {
    return null;
  }
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3])
  };
}

function isRedRgb(rgb) {
  return Boolean(rgb && rgb.r >= 150 && rgb.g <= 140 && rgb.b <= 140);
}

function isGreenRgb(rgb) {
  return Boolean(rgb && rgb.g >= 120 && rgb.r <= 170 && rgb.b <= 170);
}

function elementLooksRed(element) {
  return elementTrail(element, 4).some((node) => {
    const cls = classTrail(node);
    if (/(wrong|error|danger|fail|red|incorrect)/.test(cls)) {
      return true;
    }
    const style = window.getComputedStyle(node);
    return [style.color, style.backgroundColor, style.borderColor].some((value) => isRedRgb(parseRgb(value)));
  });
}

function elementLooksGreen(element) {
  return elementTrail(element, 4).some((node) => {
    const cls = classTrail(node);
    if (/(correct|right|success|green|true)/.test(cls)) {
      return true;
    }
    const style = window.getComputedStyle(node);
    return [style.color, style.backgroundColor, style.borderColor].some((value) => isGreenRgb(parseRgb(value)));
  });
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
        const container = candidate.element.closest("[class*='option'], [class*='answer'], .van-cell, li, label, button, div") || candidate.element;
        result[parsed.letter] = {
          text: parsed.text,
          element: candidate.element,
          container
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

function toClickableCandidate(element) {
  if (!(element instanceof HTMLElement)) {
    return null;
  }
  return element.closest("button, [role='button'], .van-button, .btn, a, li, div") || element;
}

function findQuestionCardButtons() {
  const rawCandidates = queryVisible("button, [role='button'], .van-button, .btn, a, span, div")
    .filter((element) => /题卡/.test(visibleText(element)))
    .map((element) => toClickableCandidate(element))
    .filter(Boolean);

  const deduped = [...new Set(rawCandidates)];
  return deduped
    .map((element) => ({
      element,
      text: visibleText(element),
      rect: element.getBoundingClientRect(),
      cls: classTrail(element),
      style: window.getComputedStyle(element)
    }))
    .filter(({ text, rect }) => /题卡/.test(text) && rect.width > 0 && rect.height > 0)
    .sort((left, right) => {
      const leftFixedBonus = /fixed|sticky/.test(left.style.position) ? 50 : 0;
      const rightFixedBonus = /fixed|sticky/.test(right.style.position) ? 50 : 0;
      const leftBottomRightBonus = (left.rect.bottom >= window.innerHeight - 120 && left.rect.right >= window.innerWidth - 160) ? 80 : 0;
      const rightBottomRightBonus = (right.rect.bottom >= window.innerHeight - 120 && right.rect.right >= window.innerWidth - 160) ? 80 : 0;
      const leftTextBonus = left.text === "题卡" ? 20 : 0;
      const rightTextBonus = right.text === "题卡" ? 20 : 0;
      const leftScore = leftFixedBonus + leftBottomRightBonus + leftTextBonus + (/(button|btn|van-button|card)/.test(left.cls) ? 10 : 0) - left.rect.top;
      const rightScore = rightFixedBonus + rightBottomRightBonus + rightTextBonus + (/(button|btn|van-button|card)/.test(right.cls) ? 10 : 0) - right.rect.top;
      return rightScore - leftScore;
    })
    .map((item) => item.element);
}

async function seekQuestionCardButtons(maxAttempts = 4) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const cardButtons = findQuestionCardButtons();
    if (cardButtons.length > 0) {
      return cardButtons;
    }

    const viewportStep = Math.max(Math.floor(window.innerHeight * 0.85), 420);
    const beforeY = window.scrollY;
    window.scrollTo({
      top: beforeY + viewportStep,
      behavior: "auto"
    });
    await sleep(50);

    if (window.scrollY === beforeY) {
      break;
    }
  }

  return findQuestionCardButtons();
}

function pageText() {
  return visibleText(document.body);
}

function currentUrl() {
  return String(window.location.href || "");
}

function isHistoryRoute() {
  return /#\/english\/list(?:[/?#]|$)/.test(currentUrl());
}

function isReviewDetailRoute() {
  return /#\/english\/detail(?:[/?#]|$)/.test(currentUrl());
}

function looksLikeHistoryPage() {
  const text = pageText();
  if (!text) {
    return false;
  }
  return isHistoryRoute() && /(历史记录|做题记录|答题记录|记录列表|提交记录|开始答题)/.test(text);
}

function looksLikeReviewPage() {
  const text = pageText();
  return isReviewDetailRoute() && Boolean(buildSnapshot()) && /(答题结果|正确\s*\d+|错误\s*\d+)/.test(text);
}

function pageShowsPhoneOnlyExamWarning() {
  const text = pageText();
  return /(请在手机端开考|请在手机端打开|仅支持手机端开考|手机端开考|钉钉客户端打开)/.test(text);
}

function findLatestHistoryRecord() {
  const candidates = queryVisible("a, button, [role='button'], .van-cell, .van-card, li, div")
    .map((element) => {
      const text = visibleText(element);
      const rect = element.getBoundingClientRect();
      return { element, text, rect };
    })
    .filter(({ text, rect }) => text && text.length <= 120 && rect.height >= 24)
    .filter(({ text }) => !textLooksLikeButton(text))
    .filter(({ text }) => !/^(历史记录|做题记录|答题记录|题卡|返回|关闭|确认)$/.test(text))
    .sort((left, right) => left.rect.top - right.rect.top);

  const prioritized = candidates.filter(({ text }) => /(\d{4}[-/]\d{1,2}[-/]\d{1,2})|(\d{1,2}:\d{2})|(%|分|正确率)/.test(text));
  return (prioritized[0] || candidates[0] || {}).element || null;
}

function inferTargetsFromPageText() {
  const text = pageText();
  const wrongMatch = text.match(/(?:你的答案|所选答案|错误答案)\s*[:：]?\s*([ABCD])/i);
  const correctMatch = text.match(/(?:正确答案|参考答案|标准答案)\s*[:：]?\s*([ABCD])/i);
  return {
    wrongTarget: wrongMatch ? wrongMatch[1].toUpperCase() : null,
    correctTarget: correctMatch ? correctMatch[1].toUpperCase() : null
  };
}

function reviewPageShowsWrongStatus() {
  const text = pageText();
  return /(回答错误|答错|错误答案|回答有误|正确答案是)/.test(text);
}

function buildReviewResult() {
  const snapshot = buildSnapshot();
  if (!snapshot) {
    return null;
  }

  const progress = snapshot.progress;
  const itemId = progress?.current || snapshot.itemId;
  const optionEntries = snapshot.options;
  const inferred = inferTargetsFromPageText();
  let wrongTarget = inferred.wrongTarget;
  let correctTarget = inferred.correctTarget;

  for (const letter of LETTERS) {
    const option = optionEntries[letter];
    const trail = [option.element, option.container].filter(Boolean);
    const hasCorrect = trail.some((node) => elementLooksGreen(node) || /正确/.test(visibleText(node)));
    const hasWrong = trail.some((node) => elementLooksRed(node) || /错误/.test(visibleText(node)));
    if (!correctTarget && hasCorrect) {
      correctTarget = letter;
    }
    if (!wrongTarget && hasWrong) {
      wrongTarget = letter;
    }
  }

  if (!wrongTarget && reviewPageShowsWrongStatus() && itemId && state.answerHistory[itemId]) {
    wrongTarget = state.answerHistory[itemId];
  }

  if (!reviewPageShowsWrongStatus()) {
    return null;
  }

  if (!correctTarget || !wrongTarget || !optionEntries[correctTarget] || !optionEntries[wrongTarget]) {
    return null;
  }

  return {
    itemId,
    sourceText: snapshot.normalizedQuestion,
    options: snapshot.optionTexts,
    wrongTarget,
    correctTarget,
    wrongOptionText: snapshot.optionTexts[wrongTarget],
    correctOptionText: snapshot.optionTexts[correctTarget]
  };
}

async function openQuestionCardIfNeeded() {
  if (collectWrongQuestionCardItems().length > 0) {
    debugLog("question card already open");
    return true;
  }

  const cardButtons = await seekQuestionCardButtons();
  if (!cardButtons.length) {
    debugLog("question card button not found after scrolling");
    return false;
  }

  debugLog("question card candidates", cardButtons.length);
  for (const [index, cardButton] of cardButtons.entries()) {
    try {
      await safeClick(cardButton, `question-card-${index + 1}`);
    } catch (error) {
        console.warn("[HDU-SNAP][content] question card click failed:", error);
        continue;
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await sleep(100 + attempt * 50);
      const cardItems = collectWrongQuestionCardItems();
      if (cardItems.length > 0) {
        debugLog("question card opened", {
          candidate: index + 1,
          wrongItems: cardItems.length
        });
        return true;
      }
    }
  }

  debugLog("question card click attempted but wrong items not found");
  return false;
}

function collectWrongQuestionCardItems() {
  const result = [];
  for (const element of queryVisible("button, [role='button'], .van-button, .van-cell, .van-grid-item, .van-col, li, a, span, div")) {
    const text = visibleText(element);
    if (!/^\d{1,3}$/.test(text)) {
      continue;
    }
    const itemId = Number(text);
    if (itemId < 1 || itemId > AGENT_CONFIG.maxItems) {
      continue;
    }
    if (!elementLooksRed(element)) {
      continue;
    }
    result.push({ itemId, element });
  }

  const deduped = new Map();
  for (const item of result) {
    if (!deduped.has(item.itemId)) {
      deduped.set(item.itemId, item);
    }
  }
  return [...deduped.values()].sort((left, right) => left.itemId - right.itemId);
}

async function jumpToWrongQuestion(itemId) {
  await openQuestionCardIfNeeded();
  const wrongItems = collectWrongQuestionCardItems();
  const target = wrongItems.find((item) => item.itemId === itemId);
  if (!target) {
    debugLog("wrong question target not found in card", { itemId, available: wrongItems.map((item) => item.itemId) });
    return false;
  }
  await safeClick(target.element, `wrong-question-${itemId}`);
  await sleep(320);
  return true;
}

function findReviewNextButton() {
  const candidates = queryVisible("button, [role='button'], .van-button, .btn, a, span, div")
    .map((element) => {
      const text = visibleText(element);
      const rect = element.getBoundingClientRect();
      const cls = classTrail(element);
      return { element, text, rect, cls };
    })
    .filter(({ rect }) => rect.width >= 24 && rect.height >= 24)
    .filter(({ text }) => !/题卡/.test(text))
    .filter(({ rect }) => rect.bottom >= window.innerHeight - 120)
    .sort((left, right) => right.rect.right - left.rect.right);

  const prioritized = candidates.filter(({ text, cls, rect }) => {
    const rightSide = rect.right >= window.innerWidth * 0.65;
    const arrowLike = /next|right|arrow|icon-right|icon-arrow/.test(cls) || /^(>|》|›|→)$/.test(text);
    return rightSide && (arrowLike || text === "");
  });

  return (prioritized[0] || candidates[0] || {}).element || null;
}

async function sendReviewResults() {
  if (state.reviewResultsSent) {
    return;
  }

  state.reviewResultsSent = true;
  await postMessageToBackground("REVIEW_RESULTS", {
    type: "review_results",
    session_id: state.sessionId,
    errors: state.reviewResults.map((item) => ({
      item_id: item.itemId,
      source_text: item.sourceText,
      options: item.options,
      wrong_target: item.wrongTarget,
      correct_target: item.correctTarget,
      wrong_option_text: item.wrongOptionText,
      correct_option_text: item.correctOptionText,
      method: "结果页采集"
    }))
  });
}

async function ensureExamEmulation() {
  if (state.mobileEmulationEnabled) {
    return true;
  }

  const response = await postMessageToBackground("ENABLE_EXAM_EMULATION", {
    session_id: state.sessionId
  });
  if (!response?.ok) {
    console.error("[HDU-SNAP][content] failed to enable exam emulation:", response?.error || "unknown_error");
    return false;
  }

  state.mobileEmulationEnabled = true;
  state.examEmulationReleaseRequested = false;
  debugLog("exam emulation enabled");
  return true;
}

async function releaseExamEmulation(reason) {
  if (!state.mobileEmulationEnabled || state.examEmulationReleaseRequested) {
    return;
  }

  state.examEmulationReleaseRequested = true;
  const response = await postMessageToBackground("DISABLE_EXAM_EMULATION", {
    reason
  }).catch((error) => {
    console.warn("[HDU-SNAP][content] failed to disable exam emulation:", error);
    return { ok: false };
  });

  if (response?.ok) {
    state.mobileEmulationEnabled = false;
    debugLog("exam emulation released", reason);
  } else {
    state.examEmulationReleaseRequested = false;
  }
}

function debugLog(...args) {
  console.info("[HDU-SNAP][content]", ...args);
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

function maybeReleaseExamEmulationAfterFlow() {
  if (!state.mobileEmulationEnabled || state.examEmulationReleaseRequested) {
    return;
  }
  if (!state.batchCompleteSent) {
    return;
  }
  if (state.reviewEnabled && state.reviewPhase !== "done") {
    return;
  }
  if (!looksLikeHistoryPage()) {
    return;
  }
  void releaseExamEmulation("flow-finished");
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
  state.answerHistory[snapshot.itemId] = target;

  await safeClick(selected.element, `option-${target}`);
  await sleep(randomDelay());

  state.answeredCount = Math.max(state.answeredCount, snapshot.itemId);

  if (snapshot.isLastItem) {
    state.suspended = true;
    state.solving = false;
    await finishBatchIfNeeded();
    return;
  }

  if (snapshot.submitButton && !snapshot.nextButton) {
    state.suspended = true;
    state.solving = false;
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
  if (!state.active || state.suspended || state.reviewEnabled) {
    return;
  }

  if (state.scanTimer) {
    window.clearTimeout(state.scanTimer);
  }

  state.scanTimer = window.setTimeout(async () => {
    state.scanTimer = null;

    if (state.solving || state.suspended || state.reviewEnabled) {
      return;
    }

    const snapshot = buildSnapshot();
    if (!snapshot) {
      if (pageShowsPhoneOnlyExamWarning() && !state.mobileEmulationEnabled) {
        await ensureExamEmulation();
      }
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

async function runReviewStep() {
  if (!state.reviewEnabled || state.reviewPhase === "idle" || state.reviewPhase === "done") {
    return;
  }

  if (state.reviewPhase === "await_history") {
    if (!looksLikeHistoryPage()) {
      return;
    }

    const record = findLatestHistoryRecord();
    if (record && !state.reviewRecordOpened) {
      state.reviewRecordOpened = true;
      state.reviewPhase = "await_detail";
      void persistReviewState({
        enabled: true,
        phase: "await_detail",
        recordOpened: true
      });
      await safeClick(record, "latest-history-record");
      await sleep(350);
    }
    return;
  }

  if (looksLikeHistoryPage()) {
    return;
  }

  if (!looksLikeReviewPage()) {
    return;
  }

  if (state.reviewPhase !== "collecting") {
    state.reviewPhase = "collecting";
    void persistReviewState({
      enabled: true,
      phase: "collecting",
      recordOpened: true
    });
  }

  if (state.reviewNavigationMode === "card" && state.reviewQueue.length === 0) {
    const opened = await openQuestionCardIfNeeded();
    if (!opened) {
      state.reviewNavigationMode = "sequence";
    } else {
      state.reviewQueue = collectWrongQuestionCardItems().map((item) => item.itemId);
      if (state.reviewQueue.length === 0) {
        await sendReviewResults();
        state.reviewPhase = "done";
        void persistReviewState({
          enabled: true,
          phase: "done",
          recordOpened: true
        });
        return;
      }
    }
  }

  const progress = findProgress();
  const currentItemId = progress?.current || null;
  if (state.reviewNavigationMode === "card") {
    if (currentItemId && state.reviewQueue.includes(currentItemId) && !state.reviewCollected.has(currentItemId)) {
      const reviewResult = buildReviewResult();
      if (reviewResult) {
        state.reviewResults.push(reviewResult);
        state.reviewCollected.add(currentItemId);
        debugLog("collected review result", reviewResult);
      }
    }

    const pendingItemId = state.reviewQueue.find((itemId) => !state.reviewCollected.has(itemId));
    if (!pendingItemId) {
      await sendReviewResults();
      state.reviewPhase = "done";
      void persistReviewState({
        enabled: true,
        phase: "done",
        recordOpened: true
      });
      return;
    }

    if (currentItemId !== pendingItemId) {
      const jumped = await jumpToWrongQuestion(pendingItemId);
      if (!jumped) {
        state.reviewNavigationMode = "sequence";
      }
      return;
    }

    const reviewResult = buildReviewResult();
    if (reviewResult && !state.reviewCollected.has(pendingItemId)) {
      state.reviewResults.push(reviewResult);
      state.reviewCollected.add(pendingItemId);
    }

    const nextPendingItemId = state.reviewQueue.find((itemId) => !state.reviewCollected.has(itemId));
    if (!nextPendingItemId) {
      await sendReviewResults();
      state.reviewPhase = "done";
      void persistReviewState({
        enabled: true,
        phase: "done",
        recordOpened: true
      });
      return;
    }

    if (nextPendingItemId !== pendingItemId) {
      const jumped = await jumpToWrongQuestion(nextPendingItemId);
      if (!jumped) {
        state.reviewNavigationMode = "sequence";
      }
    }
    return;
  }

  if (currentItemId && !state.reviewVisited.has(currentItemId)) {
    state.reviewVisited.add(currentItemId);
    const reviewResult = buildReviewResult();
    if (reviewResult) {
      state.reviewResults.push(reviewResult);
      debugLog("collected review result by sequence", reviewResult);
    }
  }

  if ((currentItemId && currentItemId >= AGENT_CONFIG.maxItems) || state.reviewVisited.size >= AGENT_CONFIG.maxItems) {
    await sendReviewResults();
    state.reviewPhase = "done";
    void persistReviewState({
      enabled: true,
      phase: "done",
      recordOpened: true
    });
    return;
  }

  const nextButton = findReviewNextButton();
  if (!nextButton) {
    await sendReviewResults();
    state.reviewPhase = "done";
    void persistReviewState({
      enabled: true,
      phase: "done",
      recordOpened: true
    });
    return;
  }

  await safeClick(nextButton, "review-next");
  await sleep(160);
}

function scheduleReviewScan() {
  if (!state.reviewEnabled || state.reviewPhase === "idle" || state.reviewPhase === "done") {
    return;
  }

  if (state.reviewTimer) {
    window.clearTimeout(state.reviewTimer);
  }

  state.reviewTimer = window.setTimeout(async () => {
    state.reviewTimer = null;
    if (state.reviewWorking) {
      return;
    }
    state.reviewWorking = true;
    try {
      await runReviewStep();
    } catch (error) {
      console.error("[HDU-SNAP][content] review step failed:", error);
    } finally {
      state.reviewWorking = false;
      if (state.reviewPhase !== "done") {
        scheduleReviewScan();
      }
    }
  }, 250);
}

function startObserver() {
  if (state.observerStarted) {
    return;
  }

  const observer = new MutationObserver(() => {
    scheduleScan();
    scheduleReviewScan();
    maybeReleaseExamEmulationAfterFlow();
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
      scheduleReviewScan();
      maybeReleaseExamEmulationAfterFlow();
    }
  });

  state.observerStarted = true;
  scheduleScan();
  scheduleReviewScan();
  maybeReleaseExamEmulationAfterFlow();
  void ensureExamEmulation();
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
    state.reviewEnabled = Boolean(payload.review_mode);
    if (state.reviewEnabled) {
      state.reviewPhase = "await_history";
      state.reviewRecordOpened = false;
      state.reviewQueue = [];
      state.reviewCollected = new Set();
      state.reviewResults = [];
      state.reviewResultsSent = false;
      state.reviewVisited = new Set();
      state.reviewNavigationMode = "card";
      scheduleReviewScan();
    }
    return;
  }

  if (message.type === "BACKEND_REVIEW_ACK") {
    const payload = message.payload;
    if (payload.session_id && payload.session_id !== state.sessionId) {
      return;
    }
    debugLog("review results ack", payload);
    void releaseExamEmulation("review-results-ack");
  }
});

chrome.runtime.sendMessage({ type: "PING_CONNECTION" })
  .then((response) => {
    const reviewState = response?.reviewState;
    const examState = response?.examState;
    if (reviewState?.enabled) {
      state.reviewEnabled = true;
      state.reviewPhase = reviewState.phase || "await_history";
      state.reviewRecordOpened = Boolean(reviewState.recordOpened);
      state.reviewQueue = [];
      state.reviewCollected = new Set();
      state.reviewResults = [];
      state.reviewResultsSent = false;
      state.reviewVisited = new Set();
      state.reviewNavigationMode = "card";
    }
    if (examState) {
      state.mobileEmulationEnabled = Boolean(examState.emulationEnabled);
    }
  })
  .catch((error) => {
    console.warn("[HDU-SNAP][content] failed to load background state:", error);
  })
  .finally(() => {
    void ensureExamEmulation();
    startObserver();
  });
