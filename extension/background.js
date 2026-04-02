const DEFAULT_WS_URL = "ws://127.0.0.1:8765/ws/solve";

let socket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

const pendingMessages = [];
const itemRouteMap = new Map();
const batchRouteMap = new Map();
const reviewStateByTab = new Map();
const REVIEW_STATE_TTL_MS = 30 * 60 * 1000;

function reviewStorageKey(tabId) {
  return `review_state_${tabId}`;
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
    loadReviewState(sender.tab?.id).then((reviewState) => {
      sendResponse({
        ok: true,
        connected: Boolean(socket && socket.readyState === WebSocket.OPEN),
        reviewState
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

  sendResponse({ ok: false, error: "unsupported_message_type" });
  return false;
});

ensureSocket();
