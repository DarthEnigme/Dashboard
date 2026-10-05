import { z } from "zod";
import { http, httpJson, trimSlash } from "@/lib/http";
import type { Integration, SeriesSet, ServiceAction, WidgetField, WidgetResult } from "./types";
import { bytes, duration, loadStatus, pct } from "./format";

const schema = z.object({
  url: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  node: z.string().optional(),
  insecure: z.boolean().optional(),
  /** Look at backups (needs Datastore.Audit on the backup storages). */
  backups: z.boolean().default(true),
  /** A guest's newest backup older than this many days is flagged. */
  backupMaxAge: z.number().min(0.1).default(2),
});
type Config = z.infer<typeof schema>;

export interface PveResource {
  type: string;
  name?: string;
  vmid?: number;
  node?: string;
  status?: string;
  template?: number;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  /** storage entries */
  storage?: string;
  shared?: number;
  content?: string;
}

const isGuest = (r: PveResource) => (r.type === "qemu" || r.type === "lxc") && r.template !== 1;
const guestLabel = (r: PveResource) => `${r.name ?? (r.vmid ? `#${r.vmid}` : r.type)}${r.type === "lxc" ? " (LXC)" : ""}`;

export function parseProxmox(resources: PveResource[], node?: string): WidgetResult {
  const scoped = node ? resources.filter((r) => r.node === node) : resources;
  const count = (type: string) => {
    const g = scoped.filter((r) => r.type === type && r.template !== 1);
    return `${g.filter((r) => r.status === "running").length} / ${g.length}`;
  };
  const nodes = scoped.filter((r) => r.type === "node" && r.status === "online");
  const cpuMax = nodes.reduce((a, n) => a + (n.maxcpu ?? 0), 0);
  const cpu = cpuMax ? nodes.reduce((a, n) => a + (n.cpu ?? 0) * (n.maxcpu ?? 0), 0) / cpuMax : 0;
  const memMax = nodes.reduce((a, n) => a + (n.maxmem ?? 0), 0);
  const mem = memMax ? nodes.reduce((a, n) => a + (n.mem ?? 0), 0) / memMax : 0;
  const fields: WidgetField[] = [
    { label: "VMs", value: count("qemu") },
    { label: "LXC", value: count("lxc") },
    { label: "CPU", value: pct(cpu), status: loadStatus(cpu), raw: cpu * 100 },
    { label: "RAM", value: pct(mem), status: loadStatus(mem), raw: mem * 100 },
  ];
  // Large tiles: every guest, running ones first. On the service page a row opens its charts.
  const list = scoped
    .filter(isGuest)
    .sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || (a.name ?? "").localeCompare(b.name ?? ""))
    .map((r) => ({
      label: guestLabel(r),
      value: r.status === "running" && r.maxcpu ? `${pct(r.cpu ?? 0)} CPU` : (r.status ?? "?"),
      status: r.status === "running" ? undefined : ("warn" as const),
      target: r.vmid && r.node ? `${r.node}/${r.type}/${r.vmid}` : undefined,
    }));
  return { fields, list, sections: [nodeSection(scoped), storageSection(scoped)].filter((s) => s.rows.length) };
}

/** One row per node: CPU, RAM, root disk and uptime. */
export function nodeSection(resources: PveResource[]) {
  const rows: WidgetField[] = resources
    .filter((r) => r.type === "node")
    .sort((a, b) => (a.node ?? "").localeCompare(b.node ?? ""))
    .map((n) => {
      if (n.status !== "online") return { label: n.node ?? "?", value: "offline", status: "error" as const };
      const mem = n.maxmem ? (n.mem ?? 0) / n.maxmem : 0;
      const disk = n.maxdisk ? (n.disk ?? 0) / n.maxdisk : 0;
      const parts = [`CPU ${pct(n.cpu ?? 0)}`, `RAM ${pct(mem)}`];
      if (n.maxdisk) parts.push(`disk ${pct(disk)}`);
      if (n.uptime) parts.push(`up ${duration(n.uptime)}`);
      const worst = Math.max(n.cpu ?? 0, mem, disk);
      return { label: n.node ?? "?", value: parts.join(" · "), status: loadStatus(worst) === "ok" ? undefined : loadStatus(worst) };
    });
  return { title: "Nodes", rows };
}

/** Storage pools, shared ones once. */
export function storageSection(resources: PveResource[]) {
  const seen = new Set<string>();
  const rows: WidgetField[] = [];
  for (const s of resources.filter((r) => r.type === "storage" && r.maxdisk)) {
    const key = s.shared ? s.storage! : `${s.node}/${s.storage}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const used = (s.disk ?? 0) / s.maxdisk!;
    rows.push({
      label: s.shared ? `${s.storage} (shared)` : `${s.storage} (${s.node})`,
      value: `${bytes(s.disk ?? 0)} / ${bytes(s.maxdisk!)} · ${pct(used)}`,
      status: s.status !== "available" ? "error" : loadStatus(used) === "ok" ? undefined : loadStatus(used),
      raw: used * 100,
    });
  }
  return { title: "Storage", rows: rows.sort((a, b) => (b.raw ?? 0) - (a.raw ?? 0)) };
}

export interface BackupFile {
  vmid: number;
  /** Creation time, seconds since epoch. */
  ctime: number;
}

export interface FailedTask {
  node: string;
  starttime: number;
  status: string;
  id?: string;
}

const DAY = 86_400;

/**
 * Newest backup per guest. A guest is flagged when its newest backup is older than `maxAgeDays`,
 * when it has none, or when a backup task failed recently. Guests left out of every backup job
 * (`notBackedUp`) are shown as such but not flagged: that's a choice.
 */
export function parseBackups(
  resources: PveResource[],
  files: BackupFile[],
  notBackedUp: number[],
  failed: FailedTask[],
  now: number,
  maxAgeDays: number,
): { field: WidgetField; section: { title: string; rows: WidgetField[] } } {
  const newest = new Map<number, number>();
  for (const f of files) newest.set(f.vmid, Math.max(newest.get(f.vmid) ?? 0, f.ctime));
  const excluded = new Set(notBackedUp);
  const recentFails = failed.filter((t) => now - t.starttime < maxAgeDays * DAY);
  const failedIds = new Set(recentFails.map((t) => Number(t.id)).filter(Boolean));
  let ok = 0;
  let total = 0;
  const rows: WidgetField[] = resources
    .filter(isGuest)
    .sort((a, b) => (a.vmid ?? 0) - (b.vmid ?? 0))
    .map((g) => {
      const last = newest.get(g.vmid ?? -1);
      if (excluded.has(g.vmid ?? -1) && !last) return { label: guestLabel(g), value: "not in a backup job" };
      total++;
      if (failedIds.has(g.vmid ?? -1)) return { label: guestLabel(g), value: "last backup failed", status: "error" as const };
      if (!last) return { label: guestLabel(g), value: "no backup", status: "warn" as const };
      const age = now - last;
      const stale = age > maxAgeDays * DAY;
      if (!stale) ok++;
      return { label: guestLabel(g), value: `${duration(age)} ago`, status: stale ? ("warn" as const) : undefined };
    });
  // A job that failed without naming one guest (all-guests jobs) still counts.
  const jobFailures = recentFails.filter((t) => !t.id).map((t) => ({ label: `Backup job on ${t.node}`, value: t.status.slice(0, 60), status: "error" as const }));
  const status = recentFails.length ? "error" : ok < total ? "warn" : "ok";
  return { field: { label: "Backups", value: `${ok} / ${total}`, status }, section: { title: "Backups", rows: [...jobFailures, ...rows] } };
}

const POWER = ["start", "shutdown", "reboot", "stop"] as const;

/** Power actions per guest: target is "node/type/vmid". Every guest can also be snapshotted. */
export function proxmoxActions(resources: PveResource[], node?: string): ServiceAction[] {
  return resources
    .filter((r) => isGuest(r) && r.vmid && r.node && (!node || r.node === node))
    .flatMap((r) => {
      const target = `${r.node}/${r.type}/${r.vmid}`;
      const targetLabel = guestLabel(r);
      const snapshot = { id: "snapshot", label: "Take snapshot", target, targetLabel };
      return r.status === "running"
        ? [
            { id: "shutdown", label: "Shut down", target, targetLabel },
            { id: "reboot", label: "Reboot", target, targetLabel },
            { id: "stop", label: "Force stop", target, targetLabel, danger: true },
            snapshot,
          ]
        : [{ id: "start", label: "Start", target, targetLabel }, snapshot];
    });
}

const auth = (cfg: Config) => ({ Authorization: `PVEAPIToken=${cfg.username}=${cfg.password}` });
const api = <T>(cfg: Config, path: string) => httpJson<{ data: T }>(`${trimSlash(cfg.url)}/api2/json${path}`, { insecure: cfg.insecure, headers: auth(cfg) }).then((r) => r.data);

/** Backup files on every backup storage (shared ones once), guests outside backup jobs, failed vzdump tasks. */
async function backupInfo(cfg: Config, resources: PveResource[]) {
  const stores = new Map<string, PveResource>();
  for (const s of resources) {
    if (s.type !== "storage" || s.status !== "available" || !s.content?.split(",").includes("backup")) continue;
    const key = s.shared ? s.storage! : `${s.node}/${s.storage}`;
    if (!stores.has(key)) stores.set(key, s);
  }
  const files = (
    await Promise.all(
      [...stores.values()].map((s) =>
        api<BackupFile[]>(cfg, `/nodes/${encodeURIComponent(s.node!)}/storage/${encodeURIComponent(s.storage!)}/content?content=backup`).catch(() => []),
      ),
    )
  ).flat();
  const notBackedUp = (await api<{ vmid: number }[]>(cfg, "/cluster/backup-info/not-backed-up").catch(() => [])).map((g) => g.vmid);
  const onlineNodes = resources.filter((r) => r.type === "node" && r.status === "online").map((r) => r.node!);
  const failed = (
    await Promise.all(
      onlineNodes.map((n) =>
        api<{ starttime: number; status?: string; id?: string }[]>(cfg, `/nodes/${encodeURIComponent(n)}/tasks?typefilter=vzdump&errors=1&limit=20`)
          .then((ts) => ts.filter((t) => t.status && t.status !== "OK").map((t) => ({ node: n, starttime: t.starttime, status: t.status!, id: t.id || undefined })))
          .catch(() => [] as FailedTask[]),
      ),
    )
  ).flat();
  return { files, notBackedUp, failed, stores: stores.size };
}

interface RrdPoint {
  time: number;
  cpu?: number;
  mem?: number;
  maxmem?: number;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
}

/** rrddata → charts: CPU %, memory, network and disk throughput. */
export function rrdCharts(points: RrdPoint[]): SeriesSet {
  const x = points.map((p) => p.time * 1000);
  const col = (k: keyof RrdPoint, scale = 1) => points.map((p) => (typeof p[k] === "number" ? (p[k] as number) * scale : null));
  return {
    charts: [
      { title: "CPU", unit: "%", x, series: [{ name: "CPU", values: col("cpu", 100) }] },
      { title: "Memory", unit: "B", x, series: [{ name: "Used", values: col("mem") }] },
      { title: "Network", unit: "B/s", x, series: [{ name: "In", values: col("netin") }, { name: "Out", values: col("netout") }] },
      { title: "Disk", unit: "B/s", x, series: [{ name: "Read", values: col("diskread") }, { name: "Write", values: col("diskwrite") }] },
    ],
  };
}

const TARGET = /^([\w.-]+)\/(qemu|lxc)\/(\d+)$/;

export const proxmox: Integration<typeof schema> = {
  type: "proxmox",
  schema,
  async fetch(cfg) {
    const data = await api<PveResource[]>(cfg, "/cluster/resources");
    const result = parseProxmox(data, cfg.node);
    if (!cfg.backups) return result;
    const scoped = cfg.node ? data.filter((r) => r.node === cfg.node) : data;
    try {
      const info = await backupInfo(cfg, data);
      if (!info.stores) return result;
      const b = parseBackups(scoped, info.files, info.notBackedUp, info.failed, Date.now() / 1000, cfg.backupMaxAge);
      return { ...result, fields: [...result.fields, b.field], sections: [...(result.sections ?? []), b.section] };
    } catch {
      return result; // backups are extra: never break the tile
    }
  },
  async series(cfg, target, range) {
    const m = TARGET.exec(target);
    if (!m) throw new Error("Invalid target");
    const timeframe = range === "7d" ? "week" : range === "24h" ? "day" : "hour";
    return rrdCharts(await api<RrdPoint[]>(cfg, `/nodes/${m[1]}/${m[2]}/${m[3]}/rrddata?timeframe=${timeframe}&cf=AVERAGE`));
  },
  actions: {
    async list(cfg) {
      return proxmoxActions(await api<PveResource[]>(cfg, "/cluster/resources"), cfg.node);
    },
    async run(cfg, action, target) {
      const m = TARGET.exec(target ?? "");
      if (!m || ![...POWER, "snapshot"].includes(action)) throw new Error("Invalid action");
      const base = `${trimSlash(cfg.url)}/api2/json/nodes/${m[1]}/${m[2]}/${m[3]}`;
      const snapname = `page-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
      const res =
        action === "snapshot"
          ? await http(`${base}/snapshot`, {
              method: "POST",
              insecure: cfg.insecure,
              headers: { ...auth(cfg), "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ snapname, description: "Taken from Page" }).toString(),
            })
          : await http(`${base}/status/${action}`, { method: "POST", insecure: cfg.insecure, headers: auth(cfg) });
      const body = await res.text();
      if (res.status === 403) throw new Error(`The API token lacks the ${action === "snapshot" ? "VM.Snapshot" : "VM.PowerMgmt"} permission`);
      if (!res.ok) throw new Error(`Proxmox: HTTP ${res.status} ${body.slice(0, 120)}`);
      const what = `${m[2] === "lxc" ? "Container" : "VM"} ${m[3]}`;
      return action === "snapshot" ? `${what}: snapshot ${snapname} requested` : `${what}: ${action} requested`;
    },
  },
};
