export function createTabStateStore(prefix, getTtlMs) {
  const memory = new Map();
  const key = (tabId) => `${prefix}_${tabId}`;

  async function save(tabId, state) {
    if (typeof tabId !== "number") {
      return;
    }
    memory.set(tabId, state);
    await chrome.storage.local.set({ [key(tabId)]: state });
  }

  async function clear(tabId) {
    if (typeof tabId !== "number") {
      return;
    }
    memory.delete(tabId);
    await chrome.storage.local.remove(key(tabId));
  }

  async function load(tabId) {
    if (typeof tabId !== "number") {
      return null;
    }
    if (memory.has(tabId)) {
      return memory.get(tabId);
    }
    const payload = await chrome.storage.local.get(key(tabId));
    const state = payload[key(tabId)] || null;
    const ttl = getTtlMs();
    if (state?.updatedAt && ttl && Date.now() - state.updatedAt > ttl) {
      await clear(tabId);
      return null;
    }
    if (state) {
      memory.set(tabId, state);
    }
    return state;
  }

  return { save, load, clear };
}
