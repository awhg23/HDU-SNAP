import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import { bindOptionsPage } from "../src/options/index.js";

function fixture() {
  const dom = new JSDOM(`
    <input id="backend-url">
    <button id="save"></button><button id="test"></button><button id="reset"></button>
    <p id="status"></p>
  `);
  const values = {};
  const chromeApi = {
    storage: {
      local: {
        get: vi.fn(async () => ({ ...values })),
        set: vi.fn(async (payload) => Object.assign(values, payload)),
        remove: vi.fn(async (key) => delete values[key])
      }
    }
  };
  return { dom, values, chromeApi };
}

describe("options page", () => {
  it("saves normalized loopback addresses and resets them", async () => {
    const { dom, values, chromeApi } = fixture();
    const controller = bindOptionsPage({ documentRef: dom.window.document, chromeApi, fetchImpl: vi.fn() });
    await controller.load();
    const input = dom.window.document.querySelector("#backend-url");
    input.value = "http://localhost:9000/";
    await controller.save();
    expect(values.backend_base_url).toBe("http://localhost:9000");
    await controller.reset();
    expect(values.backend_base_url).toBeUndefined();
    expect(input.value).toBe("http://127.0.0.1:8765");
  });

  it("tests the versioned client configuration endpoint", async () => {
    const { dom, chromeApi } = fixture();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ schema_version: 1, protocol_version: 1, answer_count: 25 })
    }));
    const controller = bindOptionsPage({ documentRef: dom.window.document, chromeApi, fetchImpl });
    await controller.load();
    await controller.testConnection();
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/api/v1/client-config",
      { method: "GET", cache: "no-store" }
    );
    expect(dom.window.document.querySelector("#status").textContent).toContain("25");
  });
});
