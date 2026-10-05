import { describe, expect, it } from "vitest";
import f from "./fixtures/apps.json";
import { parseOpnsense } from "@/integrations/opnsense";
import { parsePfsense } from "@/integrations/pfsense";
import { parseNpm } from "@/integrations/npm";
import { parseTraefik } from "@/integrations/traefik";
import { parseTailscale } from "@/integrations/tailscale";
import { parseCloudflare } from "@/integrations/cloudflare";
import { parseAuthentik, parseGitea, parseImmich, parseNextcloud, parsePaperless, parseSpeedtest } from "@/integrations/apps";
import { parseArr, parseJellyfin, parsePlex, parseQbittorrent, parseSabnzbd, parseSeerr, parseTautulli, parseTransmission } from "@/integrations/media";
import { parseFrigate, parseGotify, parseNtfy, parseScrutiny } from "@/integrations/homelab";
import { integrations } from "@/integrations";
import { integrationFields } from "@/integrations/fields";
import type { WidgetField } from "@/integrations/types";

const fields = (r: WidgetField[] | { fields: WidgetField[] }) => (Array.isArray(r) ? r : r.fields);
const v = (r: WidgetField[] | { fields: WidgetField[] }, label: string) => fields(r).find((x) => x.label === label);
const now = Date.parse("2026-10-05T00:00:00Z");

describe("network and edge", () => {
  it("opnsense: CPU from top, WAN totals, updates", () => {
    const r = parseOpnsense(f["opnsense-activity"], f["opnsense-traffic"], f["opnsense-firmware"], "wan");
    expect(v(r, "CPU")).toMatchObject({ value: "5.8%", status: "ok" });
    expect(v(r, "WAN ↓")?.value).toBe("115 GB");
    expect(v(r, "Updates")).toMatchObject({ value: "available", status: "warn" });
    // Interfaces can also be found by their display name.
    expect(v(parseOpnsense(f["opnsense-activity"], f["opnsense-traffic"], undefined, "LAN"), "WAN ↑")?.value).toBe("2 B");
  });

  it("pfsense: load, temperature and gateways", () => {
    const r = parsePfsense(f["pfsense-system"].data, f["pfsense-gateways"].data);
    expect(fields(r).map((x) => x.value)).toEqual(["13%", "41%", "18%", "47 °C", "1 / 2"]);
    expect(v(r, "Gateways")?.status).toBe("error");
    expect(r.list?.[1]).toMatchObject({ label: "WAN2_PPPOE", value: "down", status: "error" });
  });

  it("nginx proxy manager: hosts and certificates by expiry", () => {
    const r = parseNpm(f["npm-proxy"], f["npm-redirect"], f["npm-certs"], now, 14);
    expect(fields(r).map((x) => x.value)).toEqual(["2 / 3", 1, 2, 1]);
    expect(v(r, "Expiring")?.status).toBe("warn");
    expect(r.list?.[0]).toEqual({ label: "soon.example.com", value: "5 d", status: "warn" });
    expect(parseNpm([], [], [{ id: 3, domain_names: ["x"], expires_on: "2026-09-01 00:00:00" }], now, 14).list?.[0]).toMatchObject({ value: "expired", status: "error" });
  });

  it("traefik: counts across http/tcp and problem routers", () => {
    const r = parseTraefik(f["traefik-overview"], f["traefik-routers"]);
    expect(fields(r).map((x) => x.value)).toEqual([26, 22, 8, 1]);
    expect(v(r, "Issues")?.status).toBe("warn");
    expect(r.list).toEqual([{ label: "broken@file", value: 'the service "missing@file" does not exist', status: "warn" }]);
  });

  it("tailscale: online devices, expiring keys, updates", () => {
    const r = parseTailscale(f["tailscale-devices"].devices, now, 14);
    expect(fields(r).map((x) => x.value)).toEqual(["2 / 3", 1, 1]);
    expect(r.list?.map((x) => [x.label, x.value])).toEqual([
      ["nas", "online"],
      ["router", "online"],
      ["laptop", "key 7 d"],
    ]);
  });

  it("cloudflare: tunnel health and edges", () => {
    const r = parseCloudflare(f["cloudflare-tunnels"].result);
    expect(fields(r).map((x) => x.value)).toEqual(["1 / 2", 5, "fra06, ams01"]);
    expect(v(r, "Healthy")?.status).toBe("warn");
    expect(r.list?.[1]).toMatchObject({ label: "lab", status: "warn" });
  });
});

describe("apps", () => {
  it("immich, nextcloud, paperless", () => {
    expect(fields(parseImmich(f["immich-stats"])).map((x) => x.value)).toEqual(["48,213", "1,874", "384 GB", 2]);
    expect(fields(parseNextcloud(f["nextcloud-info"])).map((x) => x.value)).toEqual(["4", "6", "182,340", "838 GB"]);
    expect(parsePaperless(f["paperless-stats"])[1]).toMatchObject({ value: "7", status: "warn" });
  });

  it("gitea and authentik", () => {
    expect(fields(parseGitea(12, 2, 5, 1, "1.22.3+gitea")).map((x) => x.value)).toEqual([12, 5, 1, 2, "1.22.3"]);
    expect(v(parseAuthentik(14, 37, 3), "Failed 24h")).toMatchObject({ value: 3, status: "warn" });
    expect(v(parseAuthentik(14, 37, 12), "Failed 24h")?.status).toBe("error");
  });

  it("speedtest tracker: bits (v1) and Mbit/s (v0)", () => {
    const r = parseSpeedtest(f["speedtest-latest"].data, Date.parse("2026-10-05T10:30:00Z"));
    expect(fields(r).map((x) => x.value)).toEqual(["912 Mb/s", "48.1 Mb/s", "10 ms", "30m ago"]);
    expect(parseSpeedtest({ download: 95.5, upload: 20, ping: 12 }, now)[0].value).toBe("95.5 Mb/s");
  });
});

describe("media", () => {
  it("jellyfin: playing sessions only", () => {
    const r = parseJellyfin(f["jellyfin-sessions"], f["jellyfin-counts"]);
    expect(fields(r).map((x) => x.value)).toEqual([2, "812", "143", "6,021"]);
    expect(r.list).toEqual([
      { label: "alice: Severance – Pilot", value: "direct" },
      { label: "bob: Dune", value: "paused" },
    ]);
  });

  it("plex and tautulli", () => {
    const p = parsePlex(f["plex-sessions"], f["plex-libraries"]);
    expect(fields(p).map((x) => x.value)).toEqual([1, 1, 3, 1]);
    expect(p.list?.[0]).toEqual({ label: "dave: Arrival", value: "playing" });
    expect(fields(parseTautulli(f["tautulli-activity"].response.data)).map((x) => x.value)).toEqual([2, 1, "14.5 Mb/s"]);
  });

  it("arr: queue, missing and health; prowlarr: indexers", () => {
    const s = parseArr("sonarr", f["sonarr-health"] as never, f["sonarr-queue"].totalRecords, f["sonarr-missing"].totalRecords);
    expect(fields(s).map((x) => x.value)).toEqual(["4", "27", "1 issue"]);
    expect(v(s, "Health")?.status).toBe("warn");
    expect(s.list?.[0]).toMatchObject({ label: "IndexerStatusCheck", status: "warn" });
    const p = parseArr("prowlarr", [], undefined, undefined, { total: 5, failing: 1 });
    expect(fields(p)).toEqual([
      { label: "Indexers", value: "4 / 5", status: "warn" },
      { label: "Health", value: "ok", status: "ok" },
    ]);
  });

  it("overseerr and download clients", () => {
    expect(parseSeerr(f["overseerr-count"]).map((x) => x.value)).toEqual([3, 5, 98, 120]);
    expect(parseQbittorrent(f["qbt-transfer"], f["qbt-torrents"]).map((x) => x.value)).toEqual(["12 MB/s", "1.0 MB/s", 2, 3]);
    expect(parseQbittorrent(f["qbt-transfer"], [{ state: "error" }]).at(-1)).toEqual({ label: "Errors", value: 1, status: "error" });
    expect(parseTransmission(f["transmission-stats"].arguments).map((x) => x.value)).toEqual(["2.0 MB/s", "512 KB/s", 3, 12]);
    expect(parseSabnzbd(f["sab-queue"].queue).map((x) => x.value)).toEqual(["10 MB/s", 3, "2.0 GB", "0:03:20"]);
  });
});

describe("homelab", () => {
  it("frigate: cameras online, inference, events", () => {
    const r = parseFrigate(f["frigate-stats"], f["frigate-events"].length);
    expect(fields(r).map((x) => x.value)).toEqual(["1 / 2", "8.4 ms", 3, "1d 2h"]);
    expect(r.list?.[1]).toMatchObject({ label: "garage", value: "offline", status: "error" });
  });

  it("scrutiny: failing disks first, hottest disk", () => {
    const r = parseScrutiny(f["scrutiny-summary"]);
    expect(fields(r).map((x) => x.value)).toEqual([2, 1, "47 °C"]);
    expect(v(r, "Hottest")?.status).toBe("warn");
    expect(r.list?.[0]).toMatchObject({ label: "sdb ST8000VN004", status: "error" });
  });

  it("gotify and ntfy", () => {
    const g = parseGotify(f["gotify-apps"], f["gotify-clients"], f["gotify-messages"].messages, false);
    expect(fields(g).map((x) => x.value)).toEqual([2, 1, "2"]);
    expect(g.list?.[1].status).toBe("error");
    expect(parseNtfy(f["ntfy-stats"]).map((x) => x.value)).toEqual(["52,310", "0.04"]);
  });
});

describe("registry", () => {
  it("every integration has editor fields and vice versa", () => {
    expect(Object.keys(integrationFields).sort()).toEqual(Object.keys(integrations).sort());
  });
});
