export const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8765";

export function normalizeBackendBaseUrl(value) {
  const raw = String(value || "").trim();
  const url = new URL(raw);
  if (url.protocol !== "http:") {
    throw new Error("后端地址必须使用 http://");
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("后端地址只允许 127.0.0.1 或 localhost");
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    throw new Error("后端地址不能包含认证信息、路径、查询参数或片段");
  }
  return `${url.protocol}//${url.host}`;
}

export async function getBackendBaseUrl() {
  const stored = await chrome.storage.local.get("backend_base_url");
  try {
    return normalizeBackendBaseUrl(stored.backend_base_url || DEFAULT_BACKEND_BASE_URL);
  } catch (_error) {
    return DEFAULT_BACKEND_BASE_URL;
  }
}

export function joinBackendUrl(baseUrl, path) {
  return `${normalizeBackendBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

export function toWebSocketUrl(baseUrl, path) {
  const url = new URL(joinBackendUrl(baseUrl, path));
  url.protocol = "ws:";
  return url.toString();
}
