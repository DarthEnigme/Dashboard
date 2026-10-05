import { describe, expect, it } from "vitest";
import { fuzzyScore, scoreItem } from "@/lib/fuzzy";

describe("fuzzy palette matching", () => {
  it("matches subsequences and rejects missing characters", () => {
    expect(fuzzyScore("pxm", "Proxmox")).not.toBeNull();
    expect(fuzzyScore("rst", "Restart")).not.toBeNull();
    expect(fuzzyScore("xyz", "Proxmox")).toBeNull();
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("ranks substrings first, word starts above mid-word", () => {
    const rank = (q: string, names: string[]) =>
      names
        .map((n) => [n, fuzzyScore(q, n)] as const)
        .filter(([, s]) => s !== null)
        .sort((a, b) => b[1]! - a[1]!)
        .map(([n]) => n);
    expect(rank("plex", ["Proxmox Plex VM", "Plex", "Complex"])).toEqual(["Plex", "Proxmox Plex VM", "Complex"]);
    expect(rank("ha", ["Home Assistant", "Grafana dashboards"])[0]).toBe("Home Assistant");
  });

  it("scores the title above secondary fields", () => {
    expect(scoreItem("dns", "DNS")!).toBeGreaterThan(scoreItem("dns", "Pi-hole", "DNS")!);
    expect(scoreItem("zzz", "Pi-hole", "DNS")).toBeNull();
  });
});
