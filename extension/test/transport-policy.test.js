import { describe, expect, it } from "vitest";

import { computeReconnectDelay, itemRouteKey, sessionRouteKey } from "../src/background/transport-policy.js";

describe("background transport policy", () => {
  it("uses capped exponential reconnect delays", () => {
    expect(computeReconnectDelay(0, 10000)).toBe(1000);
    expect(computeReconnectDelay(3, 10000)).toBe(8000);
    expect(computeReconnectDelay(9, 10000)).toBe(10000);
  });

  it("keeps item and batch routing keys compatible", () => {
    expect(sessionRouteKey(null)).toBe("default");
    expect(itemRouteKey("tab-1", 4)).toBe("tab-1:4");
  });
});
