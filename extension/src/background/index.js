import {
  getBackendBaseUrl,
  joinBackendUrl,
  toWebSocketUrl
} from "../shared/backend-url.js";
import { createTabStateStore } from "./tab-state-store.js";
import { computeReconnectDelay, itemRouteKey, sessionRouteKey } from "./transport-policy.js";

let socket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let connectPromise = null;
let agentConfigCache = null;

const pendingMessages = [];
const itemRouteMap = new Map();
const batchRouteMap = new Map();
const DEBUGGER_PROTOCOL_VERSION = "1.3";

const reviewStore = createTabStateStore(
  "review_state",
  () => agentConfigCache?.automation?.review_state_ttl_ms
);
const examStore = createTabStateStore(
  "exam_state",
  () => agentConfigCache?.automation?.exam_state_ttl_ms
);

async function fetchAgentConfig() {
  try {
    const baseUrl = await getBackendBaseUrl();
    const response = await fetch(joinBackendUrl(baseUrl, "/api/v1/client-config"), {
      method: "GET",
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`client_config_http_${response.status}`);
    }
    const payload = await response.json();
    if (payload.schema_version !== 1 || payload.protocol_version !== 1) {
      throw new Error("unsupported_client_config_version");
    }
    agentConfigCache = payload;
    return payload;
  } catch (error) {
    console.warn("[HDU-SNAP][background] failed to fetch agent config:", error);
    agentConfigCache = null;
    return null;
  }
}

async function broadcastAgentConfig(config) {
  if (!config) {
    return;
  }
  const tabs = await chrome.tabs.query({
    url: ["https://skl.hdu.edu.cn/*", "https://skl.hduhelp.com/*"]
  });
  for (const tab of tabs) {
    postToTab(tab.id, { type: "CLIENT_CONFIG_UPDATED", payload: config });
  }
}

const saveReviewState = (tabId, state) => reviewStore.save(tabId, state);
const loadReviewState = (tabId) => reviewStore.load(tabId);
const clearReviewState = (tabId) => reviewStore.clear(tabId);
const saveExamState = (tabId, state) => examStore.save(tabId, state);
const loadExamState = (tabId) => examStore.load(tabId);
const clearExamState = (tabId) => examStore.clear(tabId);

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
  const profile = agentConfigCache?.mobile_emulation;
  if (!profile) {
    throw new Error("client_config_unavailable");
  }
  await sendDebuggerCommand(target, "Network.setUserAgentOverride", {
    userAgent: profile.user_agent,
    acceptLanguage: profile.accept_language,
    platform: profile.platform
  });
  await sendDebuggerCommand(target, "Emulation.setDeviceMetricsOverride", {
    width: profile.width,
    height: profile.height,
    deviceScaleFactor: profile.device_scale_factor,
    mobile: true
  });
  await sendDebuggerCommand(target, "Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: profile.max_touch_points
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
  const maxDelay = agentConfigCache?.automation?.reconnect_max_delay_ms || 10000;
  const delay = computeReconnectDelay(reconnectAttempts, maxDelay);
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
    const routeKey = itemRouteKey(payload.session_id, payload.item_id);
    const tabId = itemRouteMap.get(routeKey);
    postToTab(tabId, {
      type: payload.type === "decision" ? "BACKEND_DECISION" : "BACKEND_ERROR",
      payload
    });
    return;
  }

  if (payload.type === "batch_summary") {
    const tabId = batchRouteMap.get(sessionRouteKey(payload.session_id));
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
    const tabId = batchRouteMap.get(sessionRouteKey(payload.session_id));
    if (payload.status === "ok" || payload.status === "ignored") {
      await clearReviewState(tabId);
    }
    postToTab(tabId, {
      type: "BACKEND_REVIEW_ACK",
      payload
    });
  }
}

async function ensureSocket() {
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    return socket;
  }
  if (connectPromise) {
    return connectPromise;
  }
  connectPromise = (async () => {
    const baseUrl = await getBackendBaseUrl();
    socket = new WebSocket(toWebSocketUrl(baseUrl, "/ws/solve"));

    socket.addEventListener("open", () => {
    reconnectAttempts = 0;
    flushPendingMessages();
    void fetchAgentConfig().then(broadcastAgentConfig).catch((error) => {
      console.warn("[HDU-SNAP][background] failed to broadcast client config:", error);
    });
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
  })();
  try {
    return await connectPromise;
  } finally {
    connectPromise = null;
  }
}

function sendOrQueue(payload) {
  void ensureSocket();

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
    return;
  }

  pendingMessages.push(payload);
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureSocket();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureSocket();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    sendResponse({ ok: false, error: "invalid_message" });
    return false;
  }

  if (message.type === "PING_CONNECTION") {
    void ensureSocket();
    fetchAgentConfig().then(async (agentConfig) => {
      const [reviewState, examState] = agentConfig
        ? await Promise.all([loadReviewState(sender.tab?.id), loadExamState(sender.tab?.id)])
        : [null, null];
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
    const routeKey = itemRouteKey(payload.session_id, payload.item_id);

    itemRouteMap.set(routeKey, tabId);
    sendOrQueue(payload);
    sendResponse({ ok: true, queued: true });
    return false;
  }

  if (message.type === "BATCH_COMPLETE") {
    const tabId = sender.tab?.id;
    const sessionId = sessionRouteKey(message.payload?.session_id);
    batchRouteMap.set(sessionId, tabId);
    sendOrQueue(message.payload);
    sendResponse({ ok: true, queued: true });
    return false;
  }

  if (message.type === "REVIEW_RESULTS") {
    const tabId = sender.tab?.id;
    const sessionId = sessionRouteKey(message.payload?.session_id);
    batchRouteMap.set(sessionId, tabId);
    sendOrQueue(message.payload);
    sendResponse({ ok: true, queued: true });
    return false;
  }

  if (message.type === "UPDATE_REVIEW_STATE") {
    const tabId = sender.tab?.id;
    loadReviewState(tabId).then((currentState) => {
      const nextState = {
        ...(currentState || {}),
        ...(message.payload || {}),
        updatedAt: Date.now()
      };
      return saveReviewState(tabId, nextState).then(() => {
        sendResponse({ ok: true });
      });
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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.backend_base_url) {
    return;
  }
  agentConfigCache = null;
  if (socket) {
    socket.close();
    socket = null;
  }
  void ensureSocket();
});

void ensureSocket();
