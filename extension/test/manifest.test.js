import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

describe("extension package", () => {
  it("loads committed dist entries and exposes an options page", () => {
    expect(manifest.background.service_worker).toBe("dist/background.js");
    expect(manifest.content_scripts[0].js).toEqual(["dist/content.js"]);
    expect(manifest.options_ui.page).toBe("options.html");
  });

  it("grants loopback access without pinning a port", () => {
    expect(manifest.host_permissions).toContain("http://127.0.0.1/*");
    expect(manifest.host_permissions).toContain("http://localhost/*");
    expect(manifest.host_permissions.some((permission) => permission.includes(":8765"))).toBe(false);
  });
});
