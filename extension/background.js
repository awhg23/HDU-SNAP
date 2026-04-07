const DEFAULT_WS_URL = "ws://127.0.0.1:8765/ws/solve";

let socket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

const pendingMessages = [];
const itemRouteMap = new Map();
const batchRouteMap = new Map();
const reviewStateByTab = new Map();
const examStateByTab = new Map();
const REVIEW_STATE_TTL_MS = 30 * 60 * 1000;
const EXAM_STATE_TTL_MS = 30 * 60 * 1000;
const DEBUGGER_PROTOCOL_VERSION = "1.3";
const DEFAULT_ANSWER_COUNT = 100;
const MOBILE_EMULATION_PROFILE = {
  userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
  platform: "Android",
  width: 412,
  height: 915,
  deviceScaleFactor: 2.625,
  mobile: true
};

async function fetchAgentConfig() {
  try {
    const response = await fetch("http://127.0.0.1:8765/health", {
      method: "GET",
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`health_http_${response.status}`);
    }
    const payload = await response.json();
    const answerCount = Number(payload.answer_count || DEFAULT_ANSWER_COUNT);
    return {
      answerCount: Number.isFinite(answerCount) && answerCount > 0 ? answerCount : DEFAULT_ANSWER_COUNT
    };
  } catch (error) {
    console.warn("[HDU-SNAP][background] failed to fetch agent config:", error);
    return {
      answerCount: DEFAULT_ANSWER_COUNT
    };
  }
}

function reviewStorageKey(tabId) {
  return `review_state_${tabId}`;
}

function examStorageKey(tabId) {
  return `exam_state_${tabId}`;
}

async function saveReviewState(tabId, state) {
  if (typeof tabId !== "number") {
    return;
  }
  reviewStateByTab.set(tabId, state);
  await chrome.storage.local.set({ [reviewStorageKey(tabId)]: state });
}

async function loadReviewState(tabId) {
  if (typeof tabId !== "number") {
    return null;
  }
  if (reviewStateByTab.has(tabId)) {
    return reviewStateByTab.get(tabId);
  }
  const payload = await chrome.storage.local.get(reviewStorageKey(tabId));
  const state = payload[reviewStorageKey(tabId)] || null;
  if (state && state.updatedAt && Date.now() - state.updatedAt > REVIEW_STATE_TTL_MS) {
    await clearReviewState(tabId);
    return null;
  }
  if (state) {
    reviewStateByTab.set(tabId, state);
  }
  return state;
}

async function clearReviewState(tabId) {
  if (typeof tabId !== "number") {
    return;
  }
  reviewStateByTab.delete(tabId);
  await chrome.storage.local.remove(reviewStorageKey(tabId));
}

async function saveExamState(tabId, state) {
  if (typeof tabId !== "number") {
    return;
  }
  examStateByTab.set(tabId, state);
  await chrome.storage.local.set({ [examStorageKey(tabId)]: state });
}

async function loadExamState(tabId) {
  if (typeof tabId !== "number") {
    return null;
  }
  if (examStateByTab.has(tabId)) {
    return examStateByTab.get(tabId);
  }
  const payload = await chrome.storage.local.get(examStorageKey(tabId));
  const state = payload[examStorageKey(tabId)] || null;
  if (state && state.updatedAt && Date.now() - state.updatedAt > EXAM_STATE_TTL_MS) {
    await clearExamState(tabId);
    return null;
  }
  if (state) {
    examStateByTab.set(tabId, state);
  }
  return state;
}

async function clearExamState(tabId) {
  if (typeof tabId !== "number") {
    return;
  }
  examStateByTab.delete(tabId);
  await chrome.storage.local.remove(examStorageKey(tabId));
}

function attachDebugger(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, DEBUGGER_PROTOCOL_VERSION, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        if (/Another debugger is already attached/i.test(error.message || "")) {
          resolve();
          return;
        }
        reject(new Error(error.message || "debugger attach failed"));
        return;
      }
      resolve();
    });
  });
}

function detachDebugger(target) {
  return new Promise((resolve) => {
    chrome.debugger.detach(target, () => {
      resolve();
    });
  });
}

function sendDebuggerCommand(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || `${method} failed`));
        return;
      }
      resolve(result);
    });
  });
}

async function enableExamEmulation(tabId) {
  if (typeof tabId !== "number") {
    throw new Error("missing_tab_id");
  }
  const target = { tabId };
  await attachDebugger(target);
  await sendDebuggerCommand(target, "Network.enable");
  await sendDebuggerCommand(target, "Network.setUserAgentOverride", {
    userAgent: MOBILE_EMULATION_PROFILE.userAgent,
    acceptLanguage: MOBILE_EMULATION_PROFILE.acceptLanguage,
    platform: MOBILE_EMULATION_PROFILE.platform
  });
  await sendDebuggerCommand(target, "Emulation.setDeviceMetricsOverride", {
    width: MOBILE_EMULATION_PROFILE.width,
    height: MOBILE_EMULATION_PROFILE.height,
    deviceScaleFactor: MOBILE_EMULATION_PROFILE.deviceScaleFactor,
    mobile: MOBILE_EMULATION_PROFILE.mobile
  });
  await sendDebuggerCommand(target, "Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1
  });

  const current = (await loadExamState(tabId)) || {};
  const nextState = {
    ...current,
    emulationEnabled: true,
    updatedAt: Date.now()
  };
  await saveExamState(tabId, nextState);
  return nextState;
}

async function disableExamEmulation(tabId) {
  if (typeof tabId !== "number") {
    return;
  }

  const target = { tabId };
  try {
    await sendDebuggerCommand(target, "Emulation.setTouchEmulationEnabled", {
      enabled: false,
      maxTouchPoints: 1
    });
  } catch (error) {
    console.warn("[HDU-SNAP][background] failed to disable touch emulation:", error);
  }
  try {
    await sendDebuggerCommand(target, "Emulation.clearDeviceMetricsOverride");
  } catch (error) {
    console.warn("[HDU-SNAP][background] failed to clear device metrics:", error);
  }
  try {
    await detachDebugger(target);
  } catch (error) {
    console.warn("[HDU-SNAP][background] failed to detach debugger:", error);
  }
  await clearExamState(tabId);
}

function getBackoffDelay() {
  const delay = Math.min(1000 * (2 ** reconnectAttempts), 10000);
  reconnectAttempts += 1;
  return delay;
}

function postToTab(tabId, message) {
  if (typeof tabId !== "number") {
    return;
  }

  chrome.tabs.sendMessage(tabId, message).catch((error) => {
    console.warn("[HDU-SNAP][background] failed to post to tab:", error);
  });
}

function flushPendingMessages() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  while (pendingMessages.length > 0) {
    const payload = pendingMessages.shift();
    socket.send(JSON.stringify(payload));
  }
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  const delay = getBackoffDelay();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureSocket();
  }, delay);
}

async function handleSocketMessage(event) {
  let payload = null;

  try {
    payload = JSON.parse(event.data);
  } catch (error) {
    console.warn("[HDU-SNAP][background] invalid server payload:", error);
    return;
  }

  if (payload.type === "decision" || payload.type === "error") {
    const routeKey = `${payload.session_id || "default"}:${payload.item_id}`;
    const tabId = itemRouteMap.get(routeKey);
    postToTab(tabId, {
      type: payload.type === "decision" ? "BACKEND_DECISION" : "BACKEND_ERROR",
      payload
    });
    return;
  }

  if (payload.type === "batch_summary") {
    const tabId = batchRouteMap.get(payload.session_id || "default");
    if (payload.review_mode && typeof tabId === "number") {
      await saveReviewState(tabId, {
        enabled: true,
        phase: "await_history",
        recordOpened: false,
        updatedAt: Date.now()
      });
    } else if (typeof tabId === "number") {
      await clearReviewState(tabId);
    }
    postToTab(tabId, {
      type: "BACKEND_BATCH_SUMMARY",
      payload
    });
    return;
  }

  if (payload.type === "review_results_ack") {
    const tabId = batchRouteMap.get(payload.session_id || "default");
    if (payload.status === "ok" || payload.status === "ignored") {
      await clearReviewState(tabId);
    }
    postToTab(tabId, {
      type: "BACKEND_REVIEW_ACK",
      payload
    });
  }
}

function ensureSocket() {
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    return socket;
  }

  socket = new WebSocket(DEFAULT_WS_URL);

  socket.addEventListener("open", () => {
    reconnectAttempts = 0;
    flushPendingMessages();
    console.info("[HDU-SNAP][background] websocket connected");
  });

  socket.addEventListener("message", handleSocketMessage);

  socket.addEventListener("close", () => {
    console.warn("[HDU-SNAP][background] websocket closed, scheduling reconnect");
    scheduleReconnect();
  });

  socket.addEventListener("error", (error) => {
    console.warn("[HDU-SNAP][background] websocket error:", error);
    if (socket && socket.readyState === WebSocket.OPEN) {
      return;
    }
    scheduleReconnect();
  });

  return socket;
}

function sendOrQueue(payload) {
  ensureSocket();

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
    return;
  }

  pendingMessages.push(payload);
}

chrome.runtime.onInstalled.addListener(() => {
  ensureSocket();
});

chrome.runtime.onStartup.addListener(() => {
  ensureSocket();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    sendResponse({ ok: false, error: "invalid_message" });
    return false;
  }

  if (message.type === "PING_CONNECTION") {
    ensureSocket();
    Promise.all([
      loadReviewState(sender.tab?.id),
      loadExamState(sender.tab?.id),
      fetchAgentConfig()
    ]).then(([reviewState, examState, agentConfig]) => {
      sendResponse({
        ok: true,
        connected: Boolean(socket && socket.readyState === WebSocket.OPEN),
        reviewState,
        examState,
        agentConfig
      });
    });
    return true;
  }

  if (message.type === "SOLVE_ITEM") {
    const tabId = sender.tab?.id;
    const payload = message.payload;
    const routeKey = `${payload.session_id || "default"}:${payload.item_id}`;

    itemRouteMap.set(routeKey, tabId);
    sendOrQueue(payload);
    sendResponse({ ok: true, queued: true });
    return false;
  }

  if (message.type === "BATCH_COMPLETE") {
    const tabId = sender.tab?.id;
    const sessionId = message.payload?.session_id || "default";
    batchRouteMap.set(sessionId, tabId);
    sendOrQueue(message.payload);
    sendResponse({ ok: true, queued: true });
    return false;
  }

  if (message.type === "REVIEW_RESULTS") {
    const tabId = sender.tab?.id;
    const sessionId = message.payload?.session_id || "default";
    batchRouteMap.set(sessionId, tabId);
    sendOrQueue(message.payload);
    sendResponse({ ok: true, queued: true });
    return false;
  }

  if (message.type === "UPDATE_REVIEW_STATE") {
    const tabId = sender.tab?.id;
    const currentState = reviewStateByTab.get(tabId) || {};
    const nextState = {
      ...currentState,
      ...(message.payload || {}),
      updatedAt: Date.now()
    };
    saveReviewState(tabId, nextState).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "ENABLE_EXAM_EMULATION") {
    const tabId = sender.tab?.id;
    enableExamEmulation(tabId)
      .then((examState) => {
        sendResponse({ ok: true, examState });
      })
      .catch((error) => {
        console.warn("[HDU-SNAP][background] failed to enable exam emulation:", error);
        sendResponse({ ok: false, error: error.message || "enable_exam_emulation_failed" });
      });
    return true;
  }

  if (message.type === "DISABLE_EXAM_EMULATION") {
    const tabId = sender.tab?.id;
    disableExamEmulation(tabId)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        console.warn("[HDU-SNAP][background] failed to disable exam emulation:", error);
        sendResponse({ ok: false, error: error.message || "disable_exam_emulation_failed" });
      });
    return true;
  }

  if (message.type === "UPDATE_EXAM_STATE") {
    const tabId = sender.tab?.id;
    loadExamState(tabId).then((currentState) => {
      const nextState = {
        ...(currentState || {}),
        ...(message.payload || {}),
        updatedAt: Date.now()
      };
      return saveExamState(tabId, nextState).then(() => {
        sendResponse({ ok: true, examState: nextState });
      });
    });
    return true;
  }

  sendResponse({ ok: false, error: "unsupported_message_type" });
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  disableExamEmulation(tabId).catch((error) => {
    console.warn("[HDU-SNAP][background] failed to cleanup exam emulation on tab close:", error);
  });
  clearReviewState(tabId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const url = String(changeInfo.url || "");
  if (!url) {
    return;
  }
  if (/https:\/\/skl\.(hdu\.edu\.cn|hduhelp\.com)\//.test(url)) {
    return;
  }
  disableExamEmulation(tabId).catch((error) => {
    console.warn("[HDU-SNAP][background] failed to cleanup exam emulation on navigation:", error);
  });
});

ensureSocket();
