import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTabStateStore } from "../src/background/tab-state-store.js";

describe("tab state store", () => {
  let values;

  beforeEach(() => {
    values = {};
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async (key) => ({ [key]: values[key] })),
          set: vi.fn(async (payload) => Object.assign(values, payload)),
          remove: vi.fn(async (key) => delete values[key])
        }
      }
    };
  });

  it("persists and clears per-tab state", async () => {
    const store = createTabStateStore("review", () => 1000);
    await store.save(7, { enabled: true, updatedAt: Date.now() });
    expect((await store.load(7)).enabled).toBe(true);
    await store.clear(7);
    expect(await store.load(7)).toBeNull();
  });

  it("expires persisted state using the configured TTL", async () => {
    values.review_8 = { updatedAt: Date.now() - 2000 };
    const store = createTabStateStore("review", () => 1000);
    expect(await store.load(8)).toBeNull();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith("review_8");
  });
});
