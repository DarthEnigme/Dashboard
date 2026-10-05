import { describe, expect, it } from "vitest";
import { nodeSection, parseBackups, parseProxmox, rrdCharts, storageSection, type PveResource } from "@/integrations/proxmox";
import { parsePbs } from "@/integrations/pbs";
import pve from "./fixtures/proxmox-resources.json";

const data = pve.data as PveResource[];
const now = 1_800_000_000;

describe("proxmox nodes and storage", () => {
  it("summarises each node", () => {
    expect(nodeSection(data).rows).toEqual([
      { label: "pve1", value: "CPU 10% · RAM 50% · disk 20% · up 3d 2h", status: undefined },
      { label: "pve2", value: "CPU 50% · RAM 50% · disk 20% · up 3d 2h", status: undefined },
    ]);
    expect(nodeSection([{ type: "node", node: "pve3", status: "offline" }]).rows[0]).toMatchObject({ value: "offline", status: "error" });
  });

  it("lists storage pools, shared ones once, fullest first", () => {
    const rows = storageSection(data).rows;
    expect(rows.map((r) => r.label)).toEqual(["nas-backup (shared)", "local (pve1)"]);
    expect(rows[0].value).toMatch(/50%$/);
  });

  it("guest rows carry a chart target; sections come with the result", () => {
    const r = parseProxmox(data);
    expect(r.list?.find((x) => x.label === "home-assistant")?.target).toBe("pve1/qemu/102");
    expect(r.sections?.map((s) => s.title)).toEqual(["Nodes", "Storage"]);
  });
});

describe("proxmox backups", () => {
  const files = [
    { vmid: 102, ctime: now - 3600 },
    { vmid: 102, ctime: now - 9 * 86400 },
    { vmid: 106, ctime: now - 5 * 86400 },
    { vmid: 104, ctime: now - 7200 },
  ];

  it("ages each guest's newest backup, flags stale, missing and failed ones", () => {
    const { field, section } = parseBackups(data, files, [103], [{ node: "pve1", starttime: now - 3600, status: "job errors", id: "107" }], now, 2);
    const row = (name: string) => section.rows.find((r) => r.label.startsWith(name));
    expect(row("home-assistant")).toEqual({ label: "home-assistant", value: "1h 0m ago", status: undefined });
    expect(row("pihole")).toMatchObject({ value: "5d 0h ago", status: "warn" });
    expect(row("win11")).toEqual({ label: "win11", value: "not in a backup job" });
    expect(row("jellyfin")).toMatchObject({ value: "last backup failed", status: "error" });
    // 102 and 104 are fine; 106 stale; 107 failed; 103 excluded from the count.
    expect(field).toEqual({ label: "Backups", value: "2 / 4", status: "error" });
  });

  it("all-guest jobs that failed are listed on their own", () => {
    const { section, field } = parseBackups(data, files, [], [{ node: "pve2", starttime: now - 60, status: "unable to connect" }], now, 30);
    expect(section.rows[0]).toEqual({ label: "Backup job on pve2", value: "unable to connect", status: "error" });
    expect(field.status).toBe("error");
  });

  it("old failures don't count", () => {
    expect(parseBackups(data, files, [], [{ node: "pve2", starttime: now - 10 * 86400, status: "x" }], now, 7).field.status).toBe("warn");
  });
});

describe("proxmox charts", () => {
  it("turns rrddata into CPU %, memory, network and disk charts", () => {
    const set = rrdCharts([
      { time: 100, cpu: 0.25, mem: 1000, netin: 5, netout: 6, diskread: 7, diskwrite: 8 },
      { time: 160, cpu: 0.5, mem: 2000 },
    ]);
    expect(set.charts.map((c) => c.title)).toEqual(["CPU", "Memory", "Network", "Disk"]);
    expect(set.charts[0]).toMatchObject({ unit: "%", x: [100_000, 160_000], series: [{ values: [25, 50] }] });
    expect(set.charts[2].series[1].values).toEqual([6, null]);
  });
});

describe("proxmox backup server", () => {
  it("reports datastore use, group ages and failed tasks", () => {
    const r = parsePbs(
      [{ store: "main", total: 100, used: 85 }],
      [
        {
          store: "main",
          groups: [
            { "backup-type": "vm", "backup-id": "102", "last-backup": now - 3600, "backup-count": 3 },
            { "backup-type": "ct", "backup-id": "106", "last-backup": now - 5 * 86400, "backup-count": 9, comment: "pihole" },
          ],
        },
      ],
      [
        { worker_type: "verificationjob", starttime: now - 600, status: "verification failed" },
        { worker_type: "backup", starttime: now - 600, status: "OK" },
        { worker_type: "garbage_collection", starttime: now - 3 * 86400, status: "old failure" },
      ],
      now,
      2,
    );
    expect(r.fields).toEqual([
      { label: "Datastore", value: "85%", status: "warn", raw: 85 },
      { label: "Groups", value: "1 / 2", status: "warn" },
      { label: "Newest", value: "1h 0m ago", status: undefined },
      { label: "Failed 24h", value: 1, status: "error" },
    ]);
    expect(r.list?.[0]).toMatchObject({ label: "CT 106 pihole", status: "warn" });
    expect(r.sections?.map((s) => s.title)).toEqual(["Datastores", "Failed tasks (24h)"]);
  });
});
