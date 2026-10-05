import { z } from "zod";
import { http, httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField, WidgetResult } from "./types";
import { bytes } from "./format";

// The media stack: Jellyfin/Emby, Plex, Tautulli, the *arr apps, Overseerr/Jellyseerr and the
// download clients (qBittorrent, Transmission, SABnzbd).

const base = z.object({ url: z.string().url(), insecure: z.boolean().optional() });
const n = (v: number | undefined) => (v === undefined ? "–" : v.toLocaleString("en-US"));
const rate = (bytesPerSec: number) => `${bytes(bytesPerSec)}/s`;

// ---------- Jellyfin / Emby ----------

export interface JellyfinSession {
  UserName?: string;
  NowPlayingItem?: { Name?: string; SeriesName?: string; Type?: string };
  PlayState?: { IsPaused?: boolean };
  TranscodingInfo?: unknown;
}
export interface JellyfinCounts {
  MovieCount?: number;
  SeriesCount?: number;
  EpisodeCount?: number;
  SongCount?: number;
}

export function parseJellyfin(sessions: JellyfinSession[], counts: JellyfinCounts): WidgetResult {
  const playing = sessions.filter((s) => s.NowPlayingItem);
  return {
    fields: [
      { label: "Streams", value: playing.length, raw: playing.length },
      { label: "Movies", value: n(counts.MovieCount) },
      { label: "Shows", value: n(counts.SeriesCount) },
      { label: "Episodes", value: n(counts.EpisodeCount) },
    ],
    compactList: 2,
    list: playing.map((s) => ({
      label: `${s.UserName ?? "?"}: ${s.NowPlayingItem!.SeriesName ? `${s.NowPlayingItem!.SeriesName} – ` : ""}${s.NowPlayingItem!.Name ?? "?"}`,
      value: s.PlayState?.IsPaused ? "paused" : s.TranscodingInfo ? "transcode" : "direct",
    })),
  };
}

const jellyfinSchema = base.extend({ key: z.string().min(1) });
export const jellyfin: Integration<typeof jellyfinSchema> = {
  type: "jellyfin",
  schema: jellyfinSchema,
  async fetch(cfg) {
    const b = trimSlash(cfg.url);
    const opts = { insecure: cfg.insecure, headers: { "X-Emby-Token": cfg.key } };
    const [sessions, counts] = await Promise.all([
      httpJson<JellyfinSession[]>(`${b}/Sessions?activeWithinSeconds=600`, opts),
      httpJson<JellyfinCounts>(`${b}/Items/Counts`, opts),
    ]);
    return parseJellyfin(sessions, counts);
  },
};

// ---------- Plex ----------

export interface PlexSessions {
  MediaContainer: { size: number; Metadata?: { title?: string; grandparentTitle?: string; User?: { title?: string }; Player?: { state?: string }; TranscodeSession?: unknown }[] };
}
export interface PlexLibraries {
  MediaContainer: { Directory?: { key: string; type: string; title: string }[] };
}

export function parsePlex(s: PlexSessions, libs: PlexLibraries): WidgetResult {
  const dirs = libs.MediaContainer.Directory ?? [];
  const count = (t: string) => dirs.filter((d) => d.type === t).length;
  const items = s.MediaContainer.Metadata ?? [];
  return {
    fields: [
      { label: "Streams", value: s.MediaContainer.size, raw: s.MediaContainer.size },
      { label: "Transcodes", value: items.filter((m) => m.TranscodeSession).length },
      { label: "Libraries", value: dirs.length },
      { label: "Movie libs", value: count("movie") },
    ],
    compactList: 2,
    list: items.map((m) => ({
      label: `${m.User?.title ?? "?"}: ${m.grandparentTitle ? `${m.grandparentTitle} – ` : ""}${m.title ?? "?"}`,
      value: m.Player?.state ?? "playing",
    })),
  };
}

const plexSchema = base.extend({ key: z.string().min(1) });
export const plex: Integration<typeof plexSchema> = {
  type: "plex",
  schema: plexSchema,
  async fetch(cfg) {
    const b = trimSlash(cfg.url);
    const opts = { insecure: cfg.insecure, headers: { "X-Plex-Token": cfg.key, Accept: "application/json" } };
    const [s, libs] = await Promise.all([httpJson<PlexSessions>(`${b}/status/sessions`, opts), httpJson<PlexLibraries>(`${b}/library/sections`, opts)]);
    return parsePlex(s, libs);
  },
};

// ---------- Tautulli ----------

export interface TautulliActivity {
  stream_count: string | number;
  stream_count_transcode?: string | number;
  total_bandwidth?: number;
  wan_bandwidth?: number;
  sessions?: { friendly_name?: string; full_title?: string; progress_percent?: string | number; transcode_decision?: string }[];
}

export function parseTautulli(a: TautulliActivity): WidgetResult {
  const kbps = a.total_bandwidth ?? 0;
  return {
    fields: [
      { label: "Streams", value: Number(a.stream_count), raw: Number(a.stream_count) },
      { label: "Transcodes", value: Number(a.stream_count_transcode ?? 0) },
      { label: "Bandwidth", value: kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mb/s` : `${kbps} kb/s`, raw: kbps * 1000 },
    ],
    compactList: 2,
    list: (a.sessions ?? []).map((s) => ({ label: `${s.friendly_name ?? "?"}: ${s.full_title ?? "?"}`, value: `${s.progress_percent ?? 0}% · ${s.transcode_decision ?? ""}`.trim() })),
  };
}

const tautulliSchema = base.extend({ key: z.string().min(1) });
export const tautulli: Integration<typeof tautulliSchema> = {
  type: "tautulli",
  schema: tautulliSchema,
  async fetch(cfg) {
    const r = await httpJson<{ response: { result: string; data: TautulliActivity; message?: string } }>(
      `${trimSlash(cfg.url)}/api/v2?apikey=${encodeURIComponent(cfg.key)}&cmd=get_activity`,
      { insecure: cfg.insecure },
    );
    if (r.response.result !== "success") throw new Error(r.response.message ?? "Tautulli error");
    return parseTautulli(r.response.data);
  },
};

// ---------- Sonarr / Radarr / Lidarr / Readarr / Prowlarr ----------

export const arrApps = ["sonarr", "radarr", "lidarr", "readarr", "prowlarr"] as const;
type ArrApp = (typeof arrApps)[number];
const arrApi = (app: ArrApp) => (app === "sonarr" || app === "radarr" ? "v3" : "v1");

export interface ArrHealth {
  type: "ok" | "notice" | "warning" | "error";
  message: string;
  source?: string;
}

export function parseArr(app: ArrApp, health: ArrHealth[], queue?: number, missing?: number, indexers?: { total: number; failing: number }): WidgetResult {
  const issues = health.filter((h) => h.type === "warning" || h.type === "error");
  const fields: WidgetField[] =
    app === "prowlarr"
      ? [
          { label: "Indexers", value: indexers ? `${indexers.total - indexers.failing} / ${indexers.total}` : "–", status: indexers?.failing ? "warn" : "ok" },
        ]
      : [
          { label: "Queue", value: n(queue), raw: queue },
          { label: "Missing", value: n(missing), raw: missing },
        ];
  fields.push({ label: "Health", value: issues.length ? `${issues.length} issue${issues.length > 1 ? "s" : ""}` : "ok", status: issues.some((h) => h.type === "error") ? "error" : issues.length ? "warn" : "ok" });
  return { fields, list: issues.map((h) => ({ label: h.source ?? h.type, value: h.message.slice(0, 70), status: h.type === "error" ? ("error" as const) : ("warn" as const) })) };
}

const arrSchema = base.extend({ app: z.enum(arrApps), key: z.string().min(1) });
export const arr: Integration<typeof arrSchema> = {
  type: "arr",
  schema: arrSchema,
  async fetch(cfg) {
    const b = `${trimSlash(cfg.url)}/api/${arrApi(cfg.app)}`;
    const opts = { insecure: cfg.insecure, headers: { "X-Api-Key": cfg.key } };
    const health = await httpJson<ArrHealth[]>(`${b}/health`, opts);
    if (cfg.app === "prowlarr") {
      const [indexers, status] = await Promise.all([httpJson<unknown[]>(`${b}/indexer`, opts), httpJson<unknown[]>(`${b}/indexerstatus`, opts).catch(() => [])]);
      return parseArr(cfg.app, health, undefined, undefined, { total: indexers.length, failing: status.length });
    }
    const [queue, missing] = await Promise.all([
      httpJson<{ totalRecords: number }>(`${b}/queue?pageSize=1`, opts).then((r) => r.totalRecords),
      httpJson<{ totalRecords: number }>(`${b}/wanted/missing?pageSize=1`, opts)
        .then((r) => r.totalRecords)
        .catch(() => undefined),
    ]);
    return parseArr(cfg.app, health, queue, missing);
  },
};

// ---------- Overseerr / Jellyseerr ----------

export interface SeerrCounts {
  total: number;
  pending: number;
  approved?: number;
  processing: number;
  available: number;
}

export const parseSeerr = (c: SeerrCounts): WidgetField[] => [
  { label: "Pending", value: c.pending, status: c.pending ? "warn" : "ok", raw: c.pending },
  { label: "Processing", value: c.processing },
  { label: "Available", value: c.available },
  { label: "Total", value: c.total },
];

const seerrSchema = base.extend({ key: z.string().min(1) });
export const overseerr: Integration<typeof seerrSchema> = {
  type: "overseerr",
  schema: seerrSchema,
  async fetch(cfg) {
    return parseSeerr(await httpJson<SeerrCounts>(`${trimSlash(cfg.url)}/api/v1/request/count`, { insecure: cfg.insecure, headers: { "X-Api-Key": cfg.key } }));
  },
};

// ---------- qBittorrent ----------

export interface QbtTransfer {
  dl_info_speed: number;
  up_info_speed: number;
}

const QBT_DOWN = new Set(["downloading", "stalledDL", "metaDL", "forcedDL", "queuedDL", "checkingDL", "forcedMetaDL"]);
const QBT_UP = new Set(["uploading", "stalledUP", "forcedUP", "queuedUP", "checkingUP"]);

export function parseQbittorrent(t: QbtTransfer, torrents: { state: string }[]): WidgetField[] {
  const errors = torrents.filter((x) => x.state === "error" || x.state === "missingFiles").length;
  return [
    { label: "↓", value: rate(t.dl_info_speed), raw: t.dl_info_speed },
    { label: "↑", value: rate(t.up_info_speed), raw: t.up_info_speed },
    { label: "Downloading", value: torrents.filter((x) => QBT_DOWN.has(x.state)).length },
    { label: "Seeding", value: torrents.filter((x) => QBT_UP.has(x.state)).length },
    ...(errors ? [{ label: "Errors", value: errors, status: "error" as const }] : []),
  ];
}

const qbtSchema = base.extend({ username: z.string().optional(), password: z.string().optional() });
const qbtCookies = new Map<string, string>();
export const qbittorrent: Integration<typeof qbtSchema> = {
  type: "qbittorrent",
  schema: qbtSchema,
  async fetch(cfg) {
    const b = trimSlash(cfg.url);
    const login = async () => {
      const res = await http(`${b}/api/v2/auth/login`, {
        method: "POST",
        insecure: cfg.insecure,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: b },
        body: new URLSearchParams({ username: cfg.username ?? "", password: cfg.password ?? "" }).toString(),
      });
      const text = await res.text();
      if (!res.ok || text.trim() === "Fails.") throw new Error("qBittorrent rejected the login");
      const sid = res.headers.get("set-cookie")?.match(/SID=[^;]+/)?.[0] ?? "";
      qbtCookies.set(b, sid);
      return sid;
    };
    const get = async <T>(path: string): Promise<T> => {
      let cookie = qbtCookies.get(b) ?? (cfg.username ? await login() : "");
      let res = await http(`${b}${path}`, { insecure: cfg.insecure, headers: cookie ? { Cookie: cookie } : {} });
      if (res.status === 403 && cfg.username) {
        await res.body?.cancel();
        cookie = await login();
        res = await http(`${b}${path}`, { insecure: cfg.insecure, headers: { Cookie: cookie } });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} from qBittorrent`);
      return (await res.json()) as T;
    };
    const [t, torrents] = await Promise.all([get<QbtTransfer>("/api/v2/transfer/info"), get<{ state: string }[]>("/api/v2/torrents/info")]);
    return parseQbittorrent(t, torrents);
  },
};

// ---------- Transmission ----------

export interface TransmissionStats {
  downloadSpeed: number;
  uploadSpeed: number;
  activeTorrentCount: number;
  pausedTorrentCount: number;
  torrentCount: number;
}

export const parseTransmission = (s: TransmissionStats): WidgetField[] => [
  { label: "↓", value: rate(s.downloadSpeed), raw: s.downloadSpeed },
  { label: "↑", value: rate(s.uploadSpeed), raw: s.uploadSpeed },
  { label: "Active", value: s.activeTorrentCount },
  { label: "Torrents", value: s.torrentCount },
];

const transmissionSchema = base.extend({ username: z.string().optional(), password: z.string().optional(), rpcPath: z.string().default("/transmission/rpc") });
const transmissionIds = new Map<string, string>();
export const transmission: Integration<typeof transmissionSchema> = {
  type: "transmission",
  schema: transmissionSchema,
  async fetch(cfg) {
    const endpoint = `${trimSlash(cfg.url)}${cfg.rpcPath}`;
    const auth: Record<string, string> = cfg.username ? { Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password ?? ""}`).toString("base64")}` } : {};
    const call = () =>
      http(endpoint, {
        method: "POST",
        insecure: cfg.insecure,
        headers: { ...auth, "Content-Type": "application/json", "X-Transmission-Session-Id": transmissionIds.get(endpoint) ?? "" },
        body: JSON.stringify({ method: "session-stats" }),
      });
    let res = await call();
    // CSRF handshake: the first call answers 409 with the session id to use.
    if (res.status === 409) {
      transmissionIds.set(endpoint, res.headers.get("x-transmission-session-id") ?? "");
      await res.body?.cancel();
      res = await call();
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from Transmission`);
    const body = (await res.json()) as { result: string; arguments: TransmissionStats };
    if (body.result !== "success") throw new Error(body.result);
    return parseTransmission(body.arguments);
  },
};

// ---------- SABnzbd ----------

export interface SabQueue {
  kbpersec: string;
  mbleft: string;
  noofslots: number;
  timeleft: string;
  status: string;
  paused?: boolean;
}

export const parseSabnzbd = (q: SabQueue): WidgetField[] => [
  { label: "Speed", value: rate(Number(q.kbpersec) * 1024), raw: Number(q.kbpersec) * 1024 },
  { label: "Queue", value: q.noofslots },
  { label: "Left", value: bytes(Number(q.mbleft) * 1024 * 1024) },
  { label: q.paused ? "Status" : "Time left", value: q.paused ? "paused" : q.noofslots ? q.timeleft : "–", status: q.paused ? "warn" : undefined },
];

const sabSchema = base.extend({ key: z.string().min(1) });
export const sabnzbd: Integration<typeof sabSchema> = {
  type: "sabnzbd",
  schema: sabSchema,
  async fetch(cfg) {
    const r = await httpJson<{ queue: SabQueue }>(`${trimSlash(cfg.url)}/api?mode=queue&output=json&limit=1&apikey=${encodeURIComponent(cfg.key)}`, { insecure: cfg.insecure });
    return parseSabnzbd(r.queue);
  },
};
