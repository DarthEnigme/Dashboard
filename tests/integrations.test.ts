import { describe, expect, it } from "vitest";
import { parseProxmox } from "@/integrations/proxmox";
import { parsePortainer } from "@/integrations/portainer";
import { parseUptimeKuma } from "@/integrations/uptimekuma";
import { parseDocker } from "@/integrations/docker";
import { duration, bytes, pct } from "@/integrations/format";
import pve from "./fixtures/proxmox-resources.json";
import kuma from "./fixtures/uptimekuma-heartbeat.json";

type Fields = { label: string; value: string | number }[];
const value = (r: Fields | { fields: Fields }, label: string) =>
  (Array.isArray(r) ? r : r.fields).find((f) => f.label === label)?.value;

describe("proxmox", () => {
  it("counts guests (excluding templates) and averages node load", () => {
    const f = parseProxmox(pve.data);
    expect(value(f, "VMs")).toBe("2 / 3");
    expect(value(f, "LXC")).toBe("1 / 2");
    // (0.1*8 + 0.5*8) / 16 = 0.3
    expect(value(f, "CPU")).toBe("30%");
    expect(value(f, "RAM")).toBe("50%");
  });

  it("scopes to a node", () => {
    expect(value(parseProxmox(pve.data, "pve2"), "VMs")).toBe("1 / 1");
  });
});

describe("portainer", () => {
  it("counts container states", () => {
    const f = parsePortainer([{ State: "running" }, { State: "running" }, { State: "exited" }, { State: "created" }]);
    expect(f.map((x) => x.value)).toEqual([2, 1, 4]);
    expect(f[1].status).toBe("warn");
  });
});

describe("uptime kuma", () => {
  it("uses each monitor's latest beat and 24h uptime", () => {
    const f = parseUptimeKuma(kuma);
    expect(value(f, "Up")).toBe(2);
    expect(value(f, "Down")).toBe(1);
    expect(value(f, "Uptime 24h")).toBe("97%");
  });
});

describe("docker", () => {
  const now = Date.parse("2026-01-02T03:00:00Z");
  it("reports stopped containers", () => {
    const f = parseDocker({ Status: "exited", StartedAt: "2026-01-01T00:00:00Z" }, undefined, now);
    expect(f).toEqual([{ label: "Status", value: "exited", status: "error" }]);
  });

  it("computes uptime, cpu and memory", () => {
    const f = parseDocker(
      { Status: "running", StartedAt: "2026-01-01T00:00:00Z", Health: { Status: "healthy" } },
      {
        cpu_stats: { cpu_usage: { total_usage: 300 }, system_cpu_usage: 2000, online_cpus: 4 },
        precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
        memory_stats: { usage: 300 * 1024 * 1024, stats: { inactive_file: 44 * 1024 * 1024 } },
      },
      now,
    );
    expect(value(f, "Status")).toBe("running · healthy");
    expect(value(f, "Uptime")).toBe("1d 3h");
    expect(value(f, "CPU")).toBe("80%");
    expect(value(f, "RAM")).toBe("256 MB");
  });
});

describe("format", () => {
  it("formats", () => {
    expect(duration(59)).toBe("0m");
    expect(duration(3 * 3600 + 120)).toBe("3h 2m");
    expect(bytes(1536)).toBe("1.5 KB");
    expect(pct(0.054)).toBe("5.4%");
  });
});
