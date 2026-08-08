import {
  DEFAULT_BACKEND_BASE_URL,
  joinBackendUrl,
  normalizeBackendBaseUrl
} from "../shared/backend-url.js";

export function bindOptionsPage({
  documentRef = document,
  chromeApi = chrome,
  fetchImpl = fetch
} = {}) {
  const input = documentRef.querySelector("#backend-url");
  const status = documentRef.querySelector("#status");
  const saveButton = documentRef.querySelector("#save");
  const testButton = documentRef.querySelector("#test");
  const resetButton = documentRef.querySelector("#reset");

  function showStatus(message, kind = "info") {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  async function load() {
    const stored = await chromeApi.storage.local.get("backend_base_url");
    try {
      input.value = normalizeBackendBaseUrl(stored.backend_base_url || DEFAULT_BACKEND_BASE_URL);
    } catch (_error) {
      input.value = DEFAULT_BACKEND_BASE_URL;
    }
  }

  async function save() {
    try {
      const normalized = normalizeBackendBaseUrl(input.value);
      await chromeApi.storage.local.set({ backend_base_url: normalized });
      input.value = normalized;
      showStatus("后端地址已保存。", "success");
    } catch (error) {
      showStatus(error.message, "error");
    }
  }

  async function testConnection() {
    try {
      const normalized = normalizeBackendBaseUrl(input.value);
      showStatus("正在测试连接……");
      const response = await fetchImpl(joinBackendUrl(normalized, "/api/v1/client-config"), {
        method: "GET",
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(`后端返回 HTTP ${response.status}`);
      }
      const payload = await response.json();
      if (payload.schema_version !== 1 || payload.protocol_version !== 1) {
        throw new Error("后端配置协议版本不兼容");
      }
      showStatus(`连接成功，当前答题数量：${payload.answer_count}`, "success");
    } catch (error) {
      showStatus(`连接失败：${error.message}`, "error");
    }
  }

  async function reset() {
    await chromeApi.storage.local.remove("backend_base_url");
    input.value = DEFAULT_BACKEND_BASE_URL;
    showStatus("已恢复默认地址。", "success");
  }

  saveButton.addEventListener("click", () => void save());
  testButton.addEventListener("click", () => void testConnection());
  resetButton.addEventListener("click", () => void reset());
  void load();
  return { load, save, testConnection, reset };
}

if (typeof document !== "undefined" && typeof chrome !== "undefined") {
  bindOptionsPage();
}
