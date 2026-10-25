import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const settingsFile = () => path.join(process.env.HOMEPAGE_CONFIG_DIR!, "settings.yaml");

describe("an invalid config file", () => {
  it("keeps the last valid version in force (a typo doesn't make a private dashboard public)", async () => {
    const { loadConfig, invalidate } = await import("@/lib/config/load");
    loadConfig(); // writes the default files
    fs.writeFileSync(settingsFile(), "title: Mine\nauth:\n  publicView: false\n");
    invalidate();
    expect(loadConfig().settings.auth.publicView).toBe(false);

    fs.writeFileSync(settingsFile(), "title: Mine\npingInterval: often\nauth:\n  publicView: false\n");
    invalidate();
    const cfg = loadConfig();
    expect(cfg.settings.title).toBe("Mine");
    expect(cfg.settings.auth.publicView).toBe(false);
    expect(cfg.errors.join()).toMatch(/pingInterval.*last valid version/);
  });

  it("falls back to signed-in-only defaults when no valid version was seen since start", async () => {
    vi.resetModules();
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), "pingInterval: often\n");
    const { loadConfig } = await import("@/lib/config/load");
    const cfg = loadConfig();
    expect(cfg.settings.auth.publicView).toBe(false);
    expect(cfg.settings.title).toBe("NanoDash");
    expect(cfg.errors.join()).toMatch(/sign-in required/);
  });
});
