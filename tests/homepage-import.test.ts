import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { convertHomepage, toYaml } from "@/lib/import/homepage";
import { bookmarksFileSchema, servicesFileSchema, settingsSchema, widgetsFileSchema } from "@/lib/config/schema";

const dir = path.join(__dirname, "fixtures", "homepage");
const read = (f: string) => fs.readFileSync(path.join(dir, `${f}.yaml`), "utf8");
const files = { services: read("services"), bookmarks: read("bookmarks"), settings: read("settings"), widgets: read("widgets"), docker: read("docker") };

describe("Homepage import", () => {
  const out = convertHomepage(files);
  const svc = (group: string, name: string) =>
    (out.services.find((g) => g.name === group)?.services as Record<string, unknown>[] | undefined)?.find((s) => s.name === name);

  it("converts groups (flattening nested ones) and applies layout", () => {
    expect(out.services.map((g) => [g.name, g.tab, g.columns, g.collapsed])).toEqual([
      ["Infrastructure", "Home", 3, undefined],
      ["Infrastructure / Network", undefined, undefined, undefined],
      ["Media", "Media", undefined, true],
    ]);
  });

  it("maps services, monitors, icons and widgets, keeping env placeholders", () => {
    expect(svc("Infrastructure", "Proxmox")).toEqual({
      name: "Proxmox",
      href: "https://pve.lan:8006",
      icon: "proxmox.png",
      description: "Hypervisor",
      ping: "https://pve.lan:8006",
      widget: { type: "proxmox", url: "https://pve.lan:8006", username: "api@pam!homepage", password: "{{HOMEPAGE_VAR_PROXMOX_SECRET}}", node: "pve" },
    });
    expect(svc("Infrastructure", "Pi-hole")?.ping).toBe("http://pihole.lan");
    expect(svc("Infrastructure / Network", "UniFi")?.icon).toBe("https://cdn.jsdelivr.net/gh/selfhst/icons/png/unifi.png");
  });

  it("turns server+container into a docker widget using docker.yaml", () => {
    expect(svc("Media", "Jellyfin")?.widget).toEqual({ type: "docker", container: "jellyfin", host: "tcp://192.168.1.20:2375" });
    expect(out.settings.docker).toEqual({
      hosts: [
        { name: "nas", host: "tcp://192.168.1.20:2375" },
        { name: "local", host: "unix:///var/run/docker.sock" },
      ],
    });
  });

  it("resolves calendar sources that point at other services, and converts customapi fields", () => {
    expect(svc("Media", "Calendar")?.widget).toEqual({
      type: "calendar",
      sources: [
        { type: "sonarr", url: "http://sonarr.lan:8989", key: "sonarr-key" },
        { type: "ical", url: "https://example.com/family.ics", name: "Family" },
      ],
    });
    expect(svc("Media", "Stats")?.widget).toEqual({
      type: "customapi",
      url: "http://stats.lan/api",
      headers: { "X-Token": "{{HOMEPAGE_VAR_STATS}}" },
      mappings: [
        { label: "Users", field: "data.users.count", format: "number" },
        { label: "Up since", field: "uptime", format: "text" },
      ],
    });
    // Unsupported widget: service kept, widget dropped.
    expect(svc("Media", "Sonarr")).toEqual({ name: "Sonarr", href: "http://sonarr.lan:8989", icon: "sonarr.png" });
  });

  it("converts settings, bookmarks and info widgets", () => {
    expect(out.settings).toMatchObject({
      title: "My Homelab",
      theme: "dark",
      accent: "#10b981",
      target: "_self",
      background: { image: "https://images.example.com/wall.jpg", blur: 4, brightness: 0.5 },
      tabs: ["Home", "Media"],
    });
    expect(out.bookmarks).toEqual([
      { name: "Developer", links: [{ name: "Github", href: "https://github.com/", icon: "github.png" }] },
      { name: "Media", tab: "Media", collapsed: true, links: [{ name: "YouTube", href: "https://youtube.com/" }] },
    ]);
    expect(out.widgets).toEqual([
      { type: "resources", disks: ["/mnt/data"] },
      { type: "weather", label: "Paris", latitude: 48.85, longitude: 2.35, units: "metric" },
      { type: "greeting" },
    ]);
  });

  it("explains everything it could not carry over", () => {
    expect(out.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ICMP ping"),
        expect.stringContaining("UniFi API-key login"),
        expect.stringContaining('widget "sonarr" isn\'t supported'),
        expect.stringContaining('format "relativeDate"'),
        expect.stringContaining('Bookmark "Developer › Broken"'),
        expect.stringContaining("settings.quicklaunch"),
        expect.stringContaining('Info widget "search"'),
        expect.stringContaining("was nested"),
      ]),
    );
  });

  it("produces YAML that Page's schemas accept", () => {
    const y = toYaml(out);
    expect(settingsSchema.safeParse(YAML.parse(y.settings)).success).toBe(true);
    expect(servicesFileSchema.safeParse(YAML.parse(y.services)).success).toBe(true);
    expect(bookmarksFileSchema.safeParse(YAML.parse(y.bookmarks)).success).toBe(true);
    expect(widgetsFileSchema.safeParse(YAML.parse(y.widgets)).success).toBe(true);
  });

  it("reports unreadable files instead of throwing", () => {
    expect(convertHomepage({ services: "- a: [unclosed" }).warnings[0]).toContain("services.yaml could not be read");
  });
});
