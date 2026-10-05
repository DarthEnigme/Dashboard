import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { describeAlert, evaluate, type AlertState } from "@/lib/alerts";
import { bucketize, overallUptime } from "@/lib/history";
import { mergeDiscovered, servicesFromContainers, type ContainerInfo } from "@/lib/discovery";
import { listTabs, tabForPath, tabOf } from "@/lib/tabs";
import { maskRaw, sanitize } from "@/lib/config/sanitize";
import { MASK, servicesFileSchema, settingsSchema } from "@/lib/config/schema";
import { defaultFiles } from "@/lib/config/defaults";
import { accentFromPixels, serverAccent } from "@/lib/theme";
import { pickDisks } from "@/info/resources";
import { parseOpenMeteo } from "@/info/weather";
import { parseCoinGecko, parseYahoo } from "@/info/markets";
import { parseFrankfurter } from "@/info/currency";

describe("alert state machine", () => {
  const run = (checks: boolean[], threshold = 2) => {
    let state: AlertState = { failures: 0, down: false };
    return checks.map((up, i) => {
      const r = evaluate(state, up, threshold, i * 1000);
      state = r.state;
      return r.event?.kind ?? null;
    });
  };

  it("fires DOWN after threshold failures, once", () => {
    expect(run([true, false, false, false, false])).toEqual([null, null, "down", null, null]);
  });

  it("ignores a single blip", () => {
    expect(run([false, true, false, true])).toEqual([null, null, null, null]);
  });

  it("fires RECOVERED with the outage length from the first failure", () => {
    let state: AlertState = { failures: 0, down: false };
    for (const [up, t] of [[false, 1000], [false, 2000]] as const) state = evaluate(state, up, 2, t).state;
    expect(evaluate(state, true, 2, 61_000).event).toEqual({ kind: "recovered", since: 1000, durationMs: 60_000 });
  });

  it("describes outages in readable units", () => {
    expect(describeAlert({ service: "NAS", status: "down", httpStatus: 503 })).toBe("NAS is DOWN (HTTP 503).");
    expect(describeAlert({ service: "NAS", status: "down", error: "ECONNREFUSED" })).toBe("NAS is DOWN (ECONNREFUSED).");
    expect(describeAlert({ service: "NAS", status: "up", durationSeconds: 10 })).toBe("NAS is back UP after 10s.");
    expect(describeAlert({ service: "NAS", status: "up", durationSeconds: 3900 })).toBe("NAS is back UP after 1h 5m.");
  });

  it("threshold 1 alerts immediately", () => {
    expect(run([false, true], 1)).toEqual(["down", "recovered"]);
  });
});

describe("history", () => {
  it("buckets pings and computes uptime and latency", () => {
    const rows = [
      { ts: 0, up: 1, latency_ms: 10 },
      { ts: 10, up: 0, latency_ms: null },
      { ts: 60, up: 1, latency_ms: 30 },
    ];
    const b = bucketize(rows, 0, 100, 2);
    expect(b).toEqual([
      { start: 0, uptime: 0.5, avgLatency: 10, p95Latency: 10, checks: 2 },
      { start: 50, uptime: 1, avgLatency: 30, p95Latency: 30, checks: 1 },
    ]);
    // Weighted by checks: 2 of 3 checks were up.
    expect(overallUptime(b)).toBeCloseTo(2 / 3);
    expect(bucketize([], 0, 100, 2)[0].uptime).toBeNull();
    expect(overallUptime(bucketize([], 0, 100, 2))).toBeNull();
  });
});

describe("docker discovery", () => {
  const containers: ContainerInfo[] = [
    { Names: ["/jellyfin"], Labels: { "page.group": "Media", "page.icon": "jellyfin", "page.href": "http://jf", "page.ping": "true", "page.size": "wide" } },
    { Names: ["/kuma"], Labels: { "page.name": "Kuma", "page.widget.type": "uptimekuma", "page.widget.url": "http://kuma", "page.widget.slug": "home", "page.widget.insecure": "true" } },
    { Names: ["/db"], Labels: { "com.docker.compose.service": "db" } },
  ];

  it("builds services from page.* labels", () => {
    const found = servicesFromContainers(containers, "tcp://nas:2375");
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({
      group: "Media",
      service: { name: "jellyfin", ping: true, size: "wide", widget: { type: "docker", container: "jellyfin", host: "tcp://nas:2375" }, source: "docker" },
    });
    expect(found[1]).toMatchObject({ group: "Docker", service: { name: "Kuma", widget: { type: "uptimekuma", slug: "home", insecure: true } } });
  });

  it("merges into existing groups or appends new ones", () => {
    const merged = mergeDiscovered(
      [{ name: "Media", services: [{ name: "Plex" }] }],
      servicesFromContainers(containers),
    );
    expect(merged.map((g) => [g.name, g.services.map((s) => s.name)])).toEqual([
      ["Media", ["Plex", "jellyfin"]],
      ["Docker", ["Kuma"]],
    ]);
  });
});

describe("tabs", () => {
  it("has no tabs when no group uses one", () => {
    expect(listTabs(undefined, [{}, {}])).toEqual([]);
    expect(tabForPath([], "/")).toBeDefined();
    expect(tabForPath([], "/media")).toBeUndefined();
  });

  it("puts untagged groups in a Home tab at /", () => {
    const tabs = listTabs(undefined, [{}, { tab: "Media" }, { tab: "Home" }, { tab: "Infra Stuff" }]);
    expect(tabs).toEqual([
      { name: "Home", slug: "" },
      { name: "Media", slug: "media" },
      { name: "Infra Stuff", slug: "infra-stuff" },
    ]);
    expect(tabForPath(tabs, "/infra-stuff")?.name).toBe("Infra Stuff");
    expect(tabOf(tabs, undefined)).toBe("Home");
  });

  it("respects the configured order", () => {
    expect(listTabs(["Infra", "Media"], [{}, { tab: "Media" }]).map((t) => t.name)).toEqual(["Infra", "Media"]);
  });
});

describe("secrets in v2 config", () => {
  it("strips alerts and docker settings from the client config", () => {
    const settings = settingsSchema.parse({ alerts: { discord: "https://discord.com/api/webhooks/1/SECRET" }, docker: { discovery: true } });
    const json = JSON.stringify(sanitize({ settings, services: [], bookmarks: [], widgets: [{ type: "x", apikey: "K" }], errors: [] }));
    expect(json).not.toContain("SECRET");
    expect(json).not.toContain("discovery");
    expect(json).not.toContain('"K"');
  });

  it("masks alert URLs and header values for the editor", () => {
    const s = maskRaw("settings", { alerts: { discord: "https://x/SECRET", webhook: "{{HOMEPAGE_VAR_HOOK}}", threshold: 3 } }) as {
      alerts: Record<string, unknown>;
    };
    expect(s.alerts).toEqual({ discord: MASK, webhook: "{{HOMEPAGE_VAR_HOOK}}", threshold: 3 });
    const [g] = maskRaw("services", [
      { name: "G", services: [{ name: "A", widget: { type: "customapi", url: "u", headers: { Authorization: "Bearer T" } } }] },
    ]) as { services: { widget: { headers: Record<string, string> } }[] }[];
    expect(g.services[0].widget.headers.Authorization).toBe(MASK);
  });

  it("still accepts v1 config files and the shipped defaults", () => {
    expect(servicesFileSchema.safeParse([{ name: "G", services: [{ name: "S", ping: true }] }]).success).toBe(true);
    expect(settingsSchema.parse({ title: "x" }).style).toBe("glass");
    for (const [name, text] of Object.entries(defaultFiles)) {
      expect(() => YAML.parse(text), name).not.toThrow();
    }
  });
});

describe("theme", () => {
  it("auto accent falls back to the gradient colour on the server", () => {
    expect(serverAccent("#123456", "aurora")).toBe("#123456");
    expect(serverAccent("auto", "sunset")).toBe("#f97316");
  });

  it("finds a vivid hue and ignores greys", () => {
    const red = [220, 40, 40, 255];
    const grey = [128, 128, 128, 255];
    expect(accentFromPixels([...red, ...red, ...grey])).toBe("hsl(0 75% 62%)");
    expect(accentFromPixels([...grey, ...grey])).toBeNull();
  });
});

describe("info widgets", () => {
  it("picks disks, falling back to the first filesystem", () => {
    const fs = [
      { mount: "C:", used: 1, size: 2 },
      { mount: "/mnt/data", used: 3, size: 4 },
    ];
    expect(pickDisks(fs, ["/mnt/data/"]).map((d) => d.mount)).toEqual(["/mnt/data"]);
    expect(pickDisks(fs, ["/"]).map((d) => d.mount)).toEqual(["C:"]);
  });

  it("parses Open-Meteo", () => {
    const w = parseOpenMeteo(
      {
        current: { temperature_2m: 21.6, weather_code: 3, is_day: 1, wind_speed_10m: 11.2 },
        daily: { temperature_2m_max: [24.4], temperature_2m_min: [12.5] },
      },
      { latitude: 1, longitude: 2, units: "metric", label: "Paris" },
    );
    expect(w).toEqual({ label: "Paris", temp: 22, high: 24, low: 13, wind: 11, code: 3, isDay: true, units: "metric" });
  });

  it("parses Yahoo and CoinGecko quotes", () => {
    const q = parseYahoo({
      chart: { result: [{ meta: { symbol: "AAPL", currency: "USD", regularMarketPrice: 110, chartPreviousClose: 100 } }], error: null },
    });
    expect(q).toMatchObject({ symbol: "AAPL", price: 110, change: 10, currency: "USD" });
    expect(() => parseYahoo({ chart: { result: null, error: { description: "No data found" } } })).toThrow("No data found");
    expect(parseCoinGecko({ bitcoin: { eur: 50000, eur_24h_change: -2.5 } }, ["bitcoin", "dogecoin"], "EUR")).toEqual([
      { symbol: "bitcoin", price: 50000, change: -2.5, currency: "EUR" },
    ]);
  });

  it("parses Frankfurter rates", () => {
    expect(parseFrankfurter({ base: "EUR", date: "2026-10-02", rates: { USD: 1.1, GBP: 0.85 } }).rates).toEqual([
      { symbol: "USD", rate: 1.1 },
      { symbol: "GBP", rate: 0.85 },
    ]);
  });
});
