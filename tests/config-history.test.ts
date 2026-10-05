import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Modules read these at import time, so set them before importing anything that touches disk.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "page-history-"));
process.env.HOMEPAGE_CONFIG_DIR = path.join(root, "config");
process.env.HOMEPAGE_DATA_DIR = path.join(root, "data");

type History = typeof import("@/lib/config/history");
type Write = typeof import("@/lib/config/write");
let h: History;
let w: Write;

beforeAll(async () => {
  h = await import("@/lib/config/history");
  w = await import("@/lib/config/write");
});

const file = () => path.join(process.env.HOMEPAGE_CONFIG_DIR!, "bookmarks.yaml");

describe("config history", () => {
  it("snapshots before each write, skips duplicates, and restores", () => {
    w.writeConfig("bookmarks", [{ name: "A", links: [] }]); // creates defaults first
    const original = fs.readFileSync(file(), "utf8");

    h.saveVersionBefore("bookmarks", "alice");
    h.saveVersionBefore("bookmarks", "alice"); // unchanged: no new row
    expect(h.listVersions("bookmarks")).toHaveLength(1);

    w.writeConfig("bookmarks", [{ name: "B", links: [] }]);
    const [latest] = h.listVersions("bookmarks");
    expect(latest.user).toBe("alice");

    const diff = h.diffWithCurrent(h.getVersion(latest.id)!);
    expect(diff.some((d) => d.kind === "add" && d.text.includes("name: A"))).toBe(true);
    expect(diff.some((d) => d.kind === "remove" && d.text.includes("name: B"))).toBe(true);

    h.restoreVersion(latest.id, "bob");
    expect(fs.readFileSync(file(), "utf8")).toBe(original);
    // The restore itself was snapshotted, so it can be undone.
    const [undo] = h.listVersions("bookmarks");
    expect(undo.user).toBe("bob");
    expect(h.getVersion(undo.id)!.content).toContain("name: B");
  });

  it("collapses long unchanged runs in diffs", () => {
    const a = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n") + "\n";
    const b = a.replace("line 10", "LINE 10");
    const d = h.lineDiff(a, b);
    expect(d.find((p) => p.kind === "same")?.text).toContain("unchanged lines");
  });
});
