import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_DIR, loadConfig } from "@/lib/config/load";
import { configVersion, noteDiscovered, onConfigChange, type ConfigChange } from "@/lib/config/watch";

const next = () =>
  new Promise<ConfigChange>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no change event")), 7000);
    const off = onConfigChange((c) => {
      clearTimeout(t);
      off();
      resolve(c);
    });
    offs.push(off);
  });
const offs: (() => void)[] = [];
afterEach(() => offs.splice(0).forEach((off) => off()));

describe("config watcher", () => {
  it("reports a changed YAML file and invalidates the cache", async () => {
    loadConfig(); // writes defaults
    const changed = next();
    await new Promise((r) => setTimeout(r, 50));
    fs.writeFileSync(path.join(CONFIG_DIR, "settings.yaml"), "title: Changed\n");
    const c = await changed;
    expect(c.file).toBe("settings");
    expect(loadConfig().settings.title).toBe("Changed");
  }, 10_000);

  it("ignores non-YAML files", async () => {
    let got: ConfigChange | undefined;
    offs.push(onConfigChange((c) => (got = c)));
    fs.writeFileSync(path.join(CONFIG_DIR, "notes.txt"), "x");
    await new Promise((r) => setTimeout(r, 600));
    expect(got).toBeUndefined();
  });

  it("reports discovery changes as a services change", async () => {
    noteDiscovered("a");
    const changed = next();
    noteDiscovered("b");
    expect((await changed).file).toBe("services");
  });

  it("changes the config version when a file changes", () => {
    const before = configVersion();
    expect(configVersion()).toBe(before);
    const p = path.join(CONFIG_DIR, "bookmarks.yaml");
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(p, t, t);
    expect(configVersion()).not.toBe(before);
  });

  it("defaults liveReload to on", () => {
    expect(loadConfig().settings.liveReload).toBe(true);
  });
});
