import { z } from "zod";
import { http, httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField, WidgetResult } from "./types";
import { bytes, duration } from "./format";

// Self-hosted apps with a small stats API: Immich, Nextcloud, Gitea/Forgejo, Speedtest Tracker,
// Paperless-ngx and Authentik. Each has a pure parser (unit tested) and a thin fetch.

const n = (v: number | undefined) => (v === undefined ? "–" : v.toLocaleString("en-US"));
const base = z.object({ url: z.string().url(), insecure: z.boolean().optional() });

// ---------- Immich ----------

export interface ImmichStats {
  photos: number;
  videos: number;
  usage: number;
  usageByUser?: unknown[];
}

export const parseImmich = (s: ImmichStats): WidgetField[] => [
  { label: "Photos", value: n(s.photos), raw: s.photos },
  { label: "Videos", value: n(s.videos), raw: s.videos },
  { label: "Storage", value: bytes(s.usage), raw: s.usage },
  ...(s.usageByUser ? [{ label: "Users", value: s.usageByUser.length }] : []),
];

const immichSchema = base.extend({ key: z.string().min(1) });
export const immich: Integration<typeof immichSchema> = {
  type: "immich",
  schema: immichSchema,
  async fetch(cfg) {
    return parseImmich(await httpJson<ImmichStats>(`${trimSlash(cfg.url)}/api/server/statistics`, { insecure: cfg.insecure, headers: { "x-api-key": cfg.key } }));
  },
};

// ---------- Nextcloud ----------

export interface NextcloudInfo {
  ocs: {
    data: {
      nextcloud?: { system?: { freespace?: number; version?: string }; storage?: { num_users?: number; num_files?: number }; shares?: { num_shares?: number } };
      activeUsers?: { last5minutes?: number; last1hour?: number; last24hours?: number };
    };
  };
}

export function parseNextcloud(info: NextcloudInfo): WidgetField[] {
  const d = info.ocs.data;
  return [
    { label: "Active 24h", value: n(d.activeUsers?.last24hours), raw: d.activeUsers?.last24hours },
    { label: "Users", value: n(d.nextcloud?.storage?.num_users) },
    { label: "Files", value: n(d.nextcloud?.storage?.num_files), raw: d.nextcloud?.storage?.num_files },
    { label: "Free", value: d.nextcloud?.system?.freespace === undefined ? "–" : bytes(d.nextcloud.system.freespace), raw: d.nextcloud?.system?.freespace },
  ];
}

const nextcloudSchema = base.extend({
  /** Server info token (occ config:app:set serverinfo token --value …), or an admin login. */
  token: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});
export const nextcloud: Integration<typeof nextcloudSchema> = {
  type: "nextcloud",
  schema: nextcloudSchema,
  async fetch(cfg) {
    const headers: Record<string, string> = { "OCS-APIRequest": "true" };
    if (cfg.token) headers["NC-Token"] = cfg.token;
    else if (cfg.username) headers.Authorization = `Basic ${Buffer.from(`${cfg.username}:${cfg.password ?? ""}`).toString("base64")}`;
    return parseNextcloud(await httpJson<NextcloudInfo>(`${trimSlash(cfg.url)}/ocs/v2.php/apps/serverinfo/api/v1/info?format=json&skipApps=true&skipUpdate=true`, { insecure: cfg.insecure, headers }));
  },
};

// ---------- Gitea / Forgejo ----------

export function parseGitea(repos: number, notifications: number, openIssues: number, openPulls: number, version?: string): WidgetField[] {
  return [
    { label: "Repos", value: repos },
    { label: "Issues", value: openIssues },
    { label: "PRs", value: openPulls },
    { label: "Notifications", value: notifications, status: notifications ? "warn" : "ok" },
    ...(version ? [{ label: "Version", value: version.split("+")[0] }] : []),
  ];
}

const giteaSchema = base.extend({ key: z.string().min(1) });
export const gitea: Integration<typeof giteaSchema> = {
  type: "gitea",
  schema: giteaSchema,
  async fetch(cfg) {
    const b = trimSlash(cfg.url);
    const headers = { Authorization: `token ${cfg.key}`, Accept: "application/json" };
    // List endpoints report their size in X-Total-Count.
    const total = async (path: string) => {
      const res = await http(`${b}/api/v1${path}`, { insecure: cfg.insecure, headers });
      await res.body?.cancel();
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(b).host}`);
      return Number(res.headers.get("x-total-count") ?? 0);
    };
    const [repos, issues, pulls, notif, version] = await Promise.all([
      total("/repos/search?limit=1"),
      total("/repos/issues/search?state=open&type=issues&limit=1"),
      total("/repos/issues/search?state=open&type=pulls&limit=1"),
      httpJson<{ new: number }>(`${b}/api/v1/notifications/new`, { insecure: cfg.insecure, headers }).catch(() => ({ new: 0 })),
      httpJson<{ version: string }>(`${b}/api/v1/version`, { insecure: cfg.insecure, headers }).catch(() => undefined),
    ]);
    return parseGitea(repos, notif.new, issues, pulls, version?.version);
  },
};

// ---------- Speedtest Tracker ----------

export interface SpeedtestResult {
  /** v0.20+: bits per second. */
  download_bits?: number;
  upload_bits?: number;
  /** Older versions: Mbit/s. */
  download?: number;
  upload?: number;
  ping?: number;
  created_at?: string;
  failed?: boolean;
}

export function parseSpeedtest(r: SpeedtestResult, now: number): WidgetField[] {
  const mbps = (bits?: number, legacy?: number) => (bits !== undefined ? bits / 1e6 : legacy);
  const down = mbps(r.download_bits, r.download);
  const up = mbps(r.upload_bits, r.upload);
  const f = (v?: number) => (v === undefined ? "–" : `${v.toFixed(v < 100 ? 1 : 0)} Mb/s`);
  return [
    { label: "Download", value: f(down), raw: down },
    { label: "Upload", value: f(up), raw: up },
    { label: "Ping", value: r.ping === undefined ? "–" : `${Math.round(r.ping)} ms`, raw: r.ping },
    ...(r.created_at ? [{ label: "Tested", value: `${duration((now - Date.parse(r.created_at)) / 1000)} ago`, status: r.failed ? ("error" as const) : undefined }] : []),
  ];
}

const speedtestSchema = base.extend({ key: z.string().optional(), version: z.coerce.number().int().min(0).max(1).default(1) });
export const speedtest: Integration<typeof speedtestSchema> = {
  type: "speedtest",
  schema: speedtestSchema,
  async fetch(cfg) {
    const b = trimSlash(cfg.url);
    const r =
      cfg.version === 1
        ? await httpJson<{ data: SpeedtestResult }>(`${b}/api/v1/results/latest`, { insecure: cfg.insecure, headers: cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {} })
        : await httpJson<{ data: SpeedtestResult }>(`${b}/api/speedtest/latest`, { insecure: cfg.insecure });
    return parseSpeedtest(r.data, Date.now());
  },
};

// ---------- Paperless-ngx ----------

export interface PaperlessStats {
  documents_total: number;
  documents_inbox?: number | null;
  character_count?: number;
  document_file_type_counts?: unknown[];
}

export const parsePaperless = (s: PaperlessStats): WidgetField[] => [
  { label: "Documents", value: n(s.documents_total), raw: s.documents_total },
  { label: "Inbox", value: n(s.documents_inbox ?? 0), raw: s.documents_inbox ?? 0, status: s.documents_inbox ? "warn" : "ok" },
];

const paperlessSchema = base.extend({ key: z.string().min(1) });
export const paperless: Integration<typeof paperlessSchema> = {
  type: "paperless",
  schema: paperlessSchema,
  async fetch(cfg) {
    return parsePaperless(await httpJson<PaperlessStats>(`${trimSlash(cfg.url)}/api/statistics/`, { insecure: cfg.insecure, headers: { Authorization: `Token ${cfg.key}` } }));
  },
};

// ---------- Authentik ----------

export function parseAuthentik(users: number, logins: number, failed: number): WidgetResult {
  return {
    fields: [
      { label: "Users", value: users },
      { label: "Logins 24h", value: logins, raw: logins },
      { label: "Failed 24h", value: failed, raw: failed, status: failed >= 10 ? "error" : failed ? "warn" : "ok" },
    ],
  };
}

const authentikSchema = base.extend({ key: z.string().min(1) });
export const authentik: Integration<typeof authentikSchema> = {
  type: "authentik",
  schema: authentikSchema,
  async fetch(cfg) {
    const b = trimSlash(cfg.url);
    const opts = { insecure: cfg.insecure, headers: { Authorization: `Bearer ${cfg.key}` } };
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const count = (path: string) => httpJson<{ pagination: { count: number } }>(`${b}/api/v3${path}`, opts).then((r) => r.pagination.count);
    const [users, logins, failed] = await Promise.all([
      count("/core/users/?page_size=1&is_active=true"),
      count(`/events/events/?action=login&page_size=1&created__gte=${encodeURIComponent(since)}`),
      count(`/events/events/?action=login_failed&page_size=1&created__gte=${encodeURIComponent(since)}`),
    ]);
    return parseAuthentik(users, logins, failed);
  },
};
