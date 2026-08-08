(() => {
  // src/shared/backend-url.js
  var DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8765";
  function normalizeBackendBaseUrl(value) {
    const raw = String(value || "").trim();
    const url = new URL(raw);
    if (url.protocol !== "http:") {
      throw new Error("\u540E\u7AEF\u5730\u5740\u5FC5\u987B\u4F7F\u7528 http://");
    }
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      throw new Error("\u540E\u7AEF\u5730\u5740\u53EA\u5141\u8BB8 127.0.0.1 \u6216 localhost");
    }
    if (url.username || url.password || url.search || url.hash || url.pathname && url.pathname !== "/") {
      throw new Error("\u540E\u7AEF\u5730\u5740\u4E0D\u80FD\u5305\u542B\u8BA4\u8BC1\u4FE1\u606F\u3001\u8DEF\u5F84\u3001\u67E5\u8BE2\u53C2\u6570\u6216\u7247\u6BB5");
    }
    return `${url.protocol}//${url.host}`;
  }
  function joinBackendUrl(baseUrl, path) {
    return `${normalizeBackendBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
  }

  // src/options/index.js
  function bindOptionsPage({
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
        showStatus("\u540E\u7AEF\u5730\u5740\u5DF2\u4FDD\u5B58\u3002", "success");
      } catch (error) {
        showStatus(error.message, "error");
      }
    }
    async function testConnection() {
      try {
        const normalized = normalizeBackendBaseUrl(input.value);
        showStatus("\u6B63\u5728\u6D4B\u8BD5\u8FDE\u63A5\u2026\u2026");
        const response = await fetchImpl(joinBackendUrl(normalized, "/api/v1/client-config"), {
          method: "GET",
          cache: "no-store"
        });
        if (!response.ok) {
          throw new Error(`\u540E\u7AEF\u8FD4\u56DE HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (payload.schema_version !== 1 || payload.protocol_version !== 1) {
          throw new Error("\u540E\u7AEF\u914D\u7F6E\u534F\u8BAE\u7248\u672C\u4E0D\u517C\u5BB9");
        }
        showStatus(`\u8FDE\u63A5\u6210\u529F\uFF0C\u5F53\u524D\u7B54\u9898\u6570\u91CF\uFF1A${payload.answer_count}`, "success");
      } catch (error) {
        showStatus(`\u8FDE\u63A5\u5931\u8D25\uFF1A${error.message}`, "error");
      }
    }
    async function reset() {
      await chromeApi.storage.local.remove("backend_base_url");
      input.value = DEFAULT_BACKEND_BASE_URL;
      showStatus("\u5DF2\u6062\u590D\u9ED8\u8BA4\u5730\u5740\u3002", "success");
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
})();
