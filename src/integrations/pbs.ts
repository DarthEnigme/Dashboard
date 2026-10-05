import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField, WidgetResult } from "./types";
import { bytes, duration, loadStatus, pct } from "./format";

const schema = z.object({
  url: z.string().url(),
  /** API token id, e.g. "page@pbs!dashboard" (needs Datastore.Audit and Sys.Audit). */
  username: z.string().min(1),
  password: z.string().min(1),
  insecure: z.boolean().optional(),
  /** A backup group whose newest snapshot is older than this many days is flagged. */
  maxAge: z.number().min(0.1).default(2),
});
type Config = z.infer<typeof schema>;

export interface PbsUsage {
  store: string;
  total?: number;
  used?: number;
  avail?: number;
  error?: string;
}

export interface PbsGroup {
  "backup-type": string;
  "backup-id": string;
  "last-backup": number;
  "backup-count": number;
  comment?: string;
}

export interface PbsTask {
  worker_type: string;
  worker_id?: string;
  starttime: number;
  status?: string;
}

const DAY = 86_400;
const kind: Record<string, string> = { vm: "VM", ct: "CT", host: "Host" };

/** Datastore usage, backup age per group, and failed tasks of the last day. */
export function parsePbs(usage: PbsUsage[], groups: { store: string; groups: PbsGroup[] }[], tasks: PbsTask[], now: number, maxAgeDays: number): WidgetResult {
  const stores = usage.filter((u) => u.total);
  const fullest = [...stores].sort((a, b) => b.used! / b.total! - a.used! / a.total!)[0];
  const all = groups.flatMap((g) => g.groups.map((x) => ({ ...x, store: g.store })));
  const newest = all.reduce((m, g) => Math.max(m, g["last-backup"] ?? 0), 0);
  const stale = all.filter((g) => now - g["last-backup"] > maxAgeDays * DAY);
  const failed = tasks.filter((t) => t.status && t.status !== "OK" && now - t.starttime < DAY);

  const fields: WidgetField[] = [];
  if (fullest) {
    const r = fullest.used! / fullest.total!;
    fields.push({ label: stores.length > 1 ? `Store ${fullest.store}`.slice(0, 20) : "Datastore", value: pct(r), status: loadStatus(r), raw: r * 100 });
  }
  fields.push({ label: "Groups", value: stale.length ? `${all.length - stale.length} / ${all.length}` : all.length, status: stale.length ? "warn" : undefined });
  fields.push({ label: "Newest", value: newest ? `${duration(now - newest)} ago` : "never", status: !newest || now - newest > maxAgeDays * DAY ? "warn" : undefined });
  fields.push({ label: "Failed 24h", value: failed.length, status: failed.length ? "error" : "ok" });

  const list: WidgetField[] = [...all]
    .sort((a, b) => a["last-backup"] - b["last-backup"])
    .map((g) => ({
      label: `${kind[g["backup-type"]] ?? g["backup-type"]} ${g["backup-id"]}${g.comment ? ` ${g.comment}` : ""}${stores.length > 1 ? ` (${g.store})` : ""}`,
      value: `${duration(now - g["last-backup"])} ago · ${g["backup-count"]}`,
      status: now - g["last-backup"] > maxAgeDays * DAY ? ("warn" as const) : undefined,
    }));

  return {
    fields,
    list,
    sections: [
      {
        title: "Datastores",
        rows: usage.map((u) =>
          u.error || !u.total
            ? { label: u.store, value: u.error ?? "unavailable", status: "error" as const }
            : { label: u.store, value: `${bytes(u.used!)} / ${bytes(u.total)} · ${pct(u.used! / u.total)}`, status: loadStatus(u.used! / u.total) === "ok" ? undefined : loadStatus(u.used! / u.total) },
        ),
      },
      ...(failed.length
        ? [{ title: "Failed tasks (24h)", rows: failed.map((t) => ({ label: `${t.worker_type}${t.worker_id ? ` ${t.worker_id}` : ""}`, value: t.status!.slice(0, 60), status: "error" as const })) }]
        : []),
    ],
  };
}

const api = <T>(cfg: Config, path: string) =>
  httpJson<{ data: T }>(`${trimSlash(cfg.url)}/api2/json${path}`, { insecure: cfg.insecure, headers: { Authorization: `PBSAPIToken=${cfg.username}:${cfg.password}` } }).then((r) => r.data);

export const pbs: Integration<typeof schema> = {
  type: "pbs",
  schema,
  async fetch(cfg) {
    const usage = await api<PbsUsage[]>(cfg, "/status/datastore-usage");
    const groups = await Promise.all(
      usage.map(async (u) => ({ store: u.store, groups: await api<PbsGroup[]>(cfg, `/admin/datastore/${encodeURIComponent(u.store)}/groups`).catch(() => []) })),
    );
    const since = Math.floor(Date.now() / 1000) - DAY;
    const tasks = await api<PbsTask[]>(cfg, `/nodes/localhost/tasks?errors=true&limit=50&since=${since}`).catch(() => []);
    return parsePbs(usage, groups, tasks, Date.now() / 1000, cfg.maxAge);
  },
};
