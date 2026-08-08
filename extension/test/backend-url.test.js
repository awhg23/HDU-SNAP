import { describe, expect, it } from "vitest";

import {
  DEFAULT_BACKEND_BASE_URL,
  joinBackendUrl,
  normalizeBackendBaseUrl,
  toWebSocketUrl
} from "../src/shared/backend-url.js";

describe("backend URL configuration", () => {
  it("normalizes supported loopback URLs", () => {
    expect(normalizeBackendBaseUrl("http://localhost:9000/")).toBe("http://localhost:9000");
    expect(normalizeBackendBaseUrl(DEFAULT_BACKEND_BASE_URL)).toBe(DEFAULT_BACKEND_BASE_URL);
    expect(joinBackendUrl("http://127.0.0.1:9000", "/health")).toBe("http://127.0.0.1:9000/health");
    expect(toWebSocketUrl("http://127.0.0.1:9000", "/ws/solve")).toBe("ws://127.0.0.1:9000/ws/solve");
  });

  it("rejects remote, secure, and path-bearing URLs", () => {
    expect(() => normalizeBackendBaseUrl("https://127.0.0.1:8765")).toThrow();
    expect(() => normalizeBackendBaseUrl("http://example.com:8765")).toThrow();
    expect(() => normalizeBackendBaseUrl("http://localhost:8765/path")).toThrow();
  });
});
